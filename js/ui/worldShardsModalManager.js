/**
 * @file Manages the UI modal for configuring World Shards, allowing users to
 * list, toggle, and delete persisted lore fragments for a theme.
 */

import * as apiService from '../core/apiService.js';
import { getCurrentUser } from '../core/state.js';
import { getUIText } from '../services/localizationService.js';
import { getEffectiveUserTier } from '../services/authService.js';
import { showCustomModal, hideCustomModal, displayModalError, showGenericConfirmModal } from './modalManager.js';
import { getThemeConfig } from '../services/themeService.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { attachTooltip } from './tooltipManager.js';

// --- MODULE-LEVEL DEPENDENCIES ---
let _landingPageManagerRef = null;

// --- INITIALIZATION ---

/**
 * Initializes the WorldShardsModalManager with necessary dependencies.
 * @param {object} [dependencies={}] - An object containing optional dependencies.
 * @param {object} [dependencies.landingPageManager] - Reference to the landingPageManager for UI updates.
 */
export function initWorldShardsModalManager(dependencies = {}) {
  if (dependencies.landingPageManager) {
    _landingPageManagerRef = dependencies.landingPageManager;
  }
}

// --- PRIVATE HELPERS ---

/**
 * Refreshes UI elements that depend on World Shard status after a change.
 * @private
 * @param {string} themeId - The theme ID to refresh for.
 */
async function _refreshDependentUI(themeId) {
  if (!_landingPageManagerRef) return;

  await _landingPageManagerRef.fetchShapedWorldStatusAndUpdateGrid();
  const currentLandingSelection = _landingPageManagerRef.getCurrentLandingSelection?.();
  if (currentLandingSelection === themeId) {
    _landingPageManagerRef.renderLandingPageActionButtons(themeId);
  }
}

// --- PUBLIC API ---

/**
 * Fetches and displays the modal for viewing World Shards and resetting the world state.
 * @param {string} themeId - The ID of the theme whose shards are to be viewed/reset.
 */
export async function showConfigureShardsModal(themeId) {
  const currentUser = getCurrentUser();
  if (!currentUser?.token) {
    log(LOG_LEVEL_ERROR, 'Cannot show configure shards modal: User not logged in.');
    showCustomModal({
      type: 'alert',
      titleKey: 'alert_title_error',
      messageKey: 'error_api_call_failed',
      replacements: { ERROR_MSG: 'You must be logged in to manage World Fragments.' },
    });
    return;
  }

  const effectiveTier = getEffectiveUserTier();
  if (effectiveTier !== 'pro' && effectiveTier !== 'ultra') {
    log(LOG_LEVEL_INFO, `User ${currentUser.id} (Tier: ${currentUser.tier}, Effective: ${effectiveTier}) attempted to access World Shards modal. Blocked.`);
    showCustomModal({
        type: 'alert',
        titleKey: 'modal_title_manage_shards',
        messageKey: 'tooltip_shards_locked_free',
    });
    return;
  }

  const themeConfig = getThemeConfig(themeId);
  const themeDisplayName = themeConfig ? getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeId }) : themeId;
  const modalContentContainer = document.createElement('div');
  modalContentContainer.className = 'configure-shards-modal-content';
  let currentShards = [];

  const renderShardList = () => {
    modalContentContainer.innerHTML = ''; // Clear previous content
    if (currentShards.length === 0) {
      const noShardsP = document.createElement('p');
      noShardsP.textContent = getUIText('modal_shards_none_found');
      modalContentContainer.appendChild(noShardsP);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'shard-list readonly'; // Add readonly class for styling
    currentShards.sort((a, b) => new Date(a.unlockedAt) - new Date(b.unlockedAt));

    currentShards.forEach((shard) => {
      const listItem = document.createElement('li');
      listItem.className = 'shard-item';
      listItem.dataset.shardId = shard.id;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'shard-title';
      titleDiv.textContent = shard.loreFragmentTitle;

      const unlockDescDiv = document.createElement('div');
      unlockDescDiv.className = 'shard-unlock-desc';
      unlockDescDiv.textContent = `(${getUIText('shard_unlock_condition_prefix')} ${shard.unlockConditionDescription})`;

      listItem.appendChild(titleDiv);
      listItem.appendChild(unlockDescDiv);
      list.appendChild(listItem);
    });
    modalContentContainer.appendChild(list);
  };

  const handleResetWorld = async () => {
    const confirmed = await showGenericConfirmModal({
      titleKey: 'confirm_reset_world_title',
      messageKey: 'confirm_reset_world_message',
      replacements: { THEME_NAME: themeDisplayName },
    });
    if (confirmed) {
      try {
        await apiService.resetWorldShardsForTheme(currentUser.token, themeId);
        currentShards = []; // Clear local state
        renderShardList(); // Re-render list to show it's empty
        await _refreshDependentUI(themeId); // Update landing page grid/buttons
      } catch (error) {
        log(LOG_LEVEL_ERROR, `Failed to reset shards for theme ${themeId}:`, error);
        displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }), modalContentContainer);
      }
    }
  };

  const modalCustomActions = [
    { textKey: 'button_reset_world_shards', className: 'ui-button danger', onClick: handleResetWorld },
    { textKey: 'modal_ok_button', className: 'ui-button primary', onClick: () => hideCustomModal() },
  ];

  showCustomModal({
    type: 'custom',
    titleKey: 'modal_title_manage_shards',
    replacements: { THEME_NAME: themeDisplayName },
    htmlContent: modalContentContainer,
    customActions: modalCustomActions,
  });

  // Initial fetch and render of shards
  try {
    const response = await apiService.fetchWorldShards(currentUser.token, themeId);
    currentShards = response.worldShards || [];
    renderShardList();
  } catch (error) {
    log(LOG_LEVEL_ERROR, 'Failed to fetch initial shards for modal:', error);
    displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }), modalContentContainer);
  }
}
