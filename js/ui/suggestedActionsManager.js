/**
 * @file Manages the display and interaction of AI-suggested action buttons.
 */

// --- IMPORTS ---
import { suggestedActionsWrapper, playerActionInput } from './domElements.js';
import {
  setCurrentSuggestedActions,
  getCurrentTheme,
  getCurrentUser,
  setSelectedSuggestedAction,
} from '../core/state.js';
import { autoGrowTextarea } from './uiUtils.js';
import { handleMullOverShardAction } from '../services/aiService.js';
import { getEffectiveUserTier } from '../services/authService.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_WARN, LOG_LEVEL_ERROR } from '../core/logger.js';
import { attachTooltip, hideCurrentTooltip } from './tooltipManager.js';

// --- CONSTANTS ---
/** The maximum number of suggested actions to display. */
const MAX_SUGGESTED_ACTIONS = 4;

// --- MODULE-LEVEL DEPENDENCIES ---
let _gameControllerRef = null;

// --- INITIALIZATION ---

/**
 * Initializes the SuggestedActionsManager with optional dependencies.
 * @param {object} [dependencies={}] - An object containing optional dependencies.
 * @param {object} [dependencies.gameController] - Reference to the main gameController.
 */
export function initSuggestedActionsManager(dependencies = {}) {
  if (dependencies.gameController) {
    _gameControllerRef = dependencies.gameController;
  }
  log(LOG_LEVEL_DEBUG, 'SuggestedActionsManager initialized.');
}

// --- PUBLIC API ---

/**
 * Displays AI-suggested actions as clickable buttons in the UI.
 *
 * @param {Array<string|object>} actions - An array of action strings or action objects.
 *   - Simple `string` actions are displayed directly.
 *   - `object` actions can have special properties for different behaviors:
 *     - `{ text: string, displayText: string, descriptionForTooltip: string, isBoonChoice: boolean }`
 *     - `{ text: string, isTemporaryMullOver: boolean, shardData: object }`
 *     - `{ text: string, isDefeatAction: boolean }`
 *     - `{ text: string, dice_roll: { notation: string, target: number, comparison: string } }`
 * @param {object} [options={}] - Optional parameters for display.
 * @param {string} [options.headerText] - Text to display as a header above the buttons.
 */
export function displaySuggestedActions(actions, options = {}) {
  if (!suggestedActionsWrapper) {
    log(LOG_LEVEL_WARN, 'Suggested actions wrapper element not found. Cannot display actions.');
    setCurrentSuggestedActions(actions?.slice(0, MAX_SUGGESTED_ACTIONS) || []);
    return;
  }
  suggestedActionsWrapper.innerHTML = ''; // Clear previous actions
  if (options.headerText) {
    const header = document.createElement('div');
    header.classList.add('suggested-actions-header');
    header.textContent = options.headerText;
    suggestedActionsWrapper.appendChild(header);
  }
  const effectiveTier = getEffectiveUserTier();
  const isPremium = effectiveTier === 'pro' || effectiveTier === 'ultra';
  const displayableActions = actions?.slice(0, MAX_SUGGESTED_ACTIONS) || [];
  let premiumSlots = 0;
  if (!isPremium && displayableActions.length >= 3) {
      premiumSlots = 1;
  }
  const actionsToRender = displayableActions.slice(0, displayableActions.length - premiumSlots);
  const validActionsToStore = [];
  if (actionsToRender.length > 0) {
    actionsToRender.forEach((actionObjOrString) => {
      // Determine action properties from string or object
      const isObject = typeof actionObjOrString === 'object' && actionObjOrString !== null;
      const actionText = isObject ? actionObjOrString.text : actionObjOrString;
      const buttonDisplayText = isObject ? actionObjOrString.displayText || actionText : actionText;
      const {
        descriptionForTooltip: tooltipText = null,
        isTemporaryMullOver: isMullOver = false,
        shardData = null,
        isBoonChoice = false,
        isTraitChoice = false,
        isDefeatAction = false,
        isLoreImplication = false, // Added for destructuring
        dice_roll = null,
      } = isObject ? actionObjOrString : {};
      const isBoonOrTrait = isBoonChoice || isTraitChoice;
      if (!actionText?.trim()) {
        log(LOG_LEVEL_WARN, 'Invalid action format in suggested actions array:', actionObjOrString);
        return; // Skip this invalid action
      }
      const btn = document.createElement('button');
      btn.classList.add('ui-button');
      if (isMullOver) btn.classList.add('mull-over-action');
      if (isBoonOrTrait) btn.classList.add('boon-action');
      if (isLoreImplication) btn.classList.add('lore-implication-action'); // Added class for styling
      if (isDefeatAction) btn.classList.add('defeat-action-button');
      btn.textContent = buttonDisplayText;
      btn.removeAttribute('title');
      let finalTooltipText = tooltipText;
      let rollConfig = null;
      if (dice_roll) {
        // Case 1: The dice_roll object contains the rollConfigs array.
        if (Array.isArray(dice_roll.rollConfigs) && dice_roll.rollConfigs.length > 0) {
          rollConfig = dice_roll.rollConfigs[0];
        // Case 2: The dice_roll object IS the config object itself.
        } else if (dice_roll.notation && typeof dice_roll.target === 'number') {
          rollConfig = dice_roll;
        }
      }
      if (rollConfig) {
        const comparison = rollConfig.comparison || '>=';
        const rollString = `Roll: ${rollConfig.notation} ${comparison} ${rollConfig.target}`;
        finalTooltipText = finalTooltipText ? `${finalTooltipText}\n${rollString}` : rollString;
      }
      if (finalTooltipText) {
        attachTooltip(btn, null, {}, { rawText: finalTooltipText });
      }
      btn.addEventListener('click', () => {
        hideCurrentTooltip();
        setSelectedSuggestedAction(actionObjOrString);
        // --- Defeat Action ---
        if (isDefeatAction) {
          const themeId = getCurrentTheme();
          if (_gameControllerRef && themeId) {
            _gameControllerRef.initiateNewGameSessionFlow(themeId, true); // Force new game
          } else {
            log(LOG_LEVEL_ERROR, 'Cannot start new game from defeat action: GameController or themeId not available.');
          }
        // --- Boon/Trait/Implication Selection (Direct Processing) ---
        } else if (isBoonOrTrait || isLoreImplication) {
          if (_gameControllerRef?.processPlayerAction) {
            _gameControllerRef.processPlayerAction(actionText); // Pass full text for matching
          } else {
            log(LOG_LEVEL_ERROR, 'GameController not available to process choice. Falling back to input population.');
            if (playerActionInput) {
              playerActionInput.value = actionText;
              playerActionInput.focus();
              autoGrowTextarea(playerActionInput);
            }
          }
        // --- Mull Over Shard ---
        } else if (isMullOver && shardData) {
          handleMullOverShardAction(shardData).catch((err) => {
            log(LOG_LEVEL_ERROR, 'Error handling Mull Over Shard action:', err);
          });
        // --- Default Action ---
        } else {
          if (playerActionInput) {
            playerActionInput.value = actionText;
            playerActionInput.focus();
            autoGrowTextarea(playerActionInput);
          } else {
            log(LOG_LEVEL_WARN, 'Player action input element not found for suggested action.');
          }
        }
      });
      suggestedActionsWrapper.appendChild(btn);
      validActionsToStore.push(actionObjOrString);
    });
  }
  // Add premium locked slots
  for (let i = 0; i < premiumSlots; i++) {
      const btn = document.createElement('button');
      btn.classList.add('ui-button', 'premium-locked');
      btn.disabled = true;
      const lockIcon = document.createElement('img');
      lockIcon.src = 'images/app/icon_lock.svg';
      lockIcon.className = 'premium-lock-icon';
      btn.appendChild(lockIcon);
      attachTooltip(btn, 'tooltip_premium_action_locked');
      suggestedActionsWrapper.appendChild(btn);
  }
  setCurrentSuggestedActions(displayableActions);
  log(LOG_LEVEL_DEBUG, `Displayed ${actionsToRender.length} suggested actions and ${premiumSlots} locked slots.`);
}

/**
 * Clears any displayed suggested actions from the UI and state.
 */
export function clearSuggestedActions() {
  if (suggestedActionsWrapper) {
    suggestedActionsWrapper.innerHTML = '';
  }
  setCurrentSuggestedActions([]);
  log(LOG_LEVEL_DEBUG, 'Suggested actions cleared.');
}
