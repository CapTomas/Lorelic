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
 * Fetches and displays the modal for configuring World Shards for a specific theme.
 * @param {string} themeId - The ID of the theme whose shards are to be configured.
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
  const isPremiumOrTrial = effectiveTier === 'pro' || effectiveTier === 'ultra';

  if (!isPremiumOrTrial) {
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
    list.className = 'shard-list';
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
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'shard-controls';
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'shard-toggle-label';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = shard.isActiveForNewGames;
      toggleInput.setAttribute('aria-label', `${getUIText('shard_active_toggle_label')} for ${shard.loreFragmentTitle}`);
      const updateVisualState = () => {
        titleDiv.style.textDecoration = shard.isActiveForNewGames ? 'none' : 'line-through';
        titleDiv.style.opacity = shard.isActiveForNewGames ? '1' : '0.6';
      };
      updateVisualState();
      toggleInput.addEventListener('change', async (e) => {
        const newStatus = e.target.checked;
        try {
          await apiService.updateWorldShardStatus(currentUser.token, shard.id, newStatus);
          shard.isActiveForNewGames = newStatus; // Optimistic update
          updateVisualState();
          await _refreshDependentUI(themeId);
        } catch (error) {
          log(LOG_LEVEL_ERROR, 'Failed to update shard status', error);
          e.target.checked = !newStatus; // Revert checkbox on error
          updateVisualState();
          displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }), modalContentContainer);
        }
      });
      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(document.createTextNode(` ${getUIText('shard_active_toggle_label')}`));
      const shatterButton = document.createElement('button');
      shatterButton.className = 'ui-button danger small shard-shatter-button';
      shatterButton.textContent = getUIText('button_shatter_shard');
      attachTooltip(shatterButton, 'tooltip_shatter_shard');
      shatterButton.addEventListener('click', async () => {
        const confirmed = await showGenericConfirmModal({
          titleKey: 'confirm_shatter_shard_title',
          messageKey: 'confirm_shatter_shard_message',
          replacements: { SHARD_TITLE: shard.loreFragmentTitle },
        });
        if (confirmed) {
          try {
            await apiService.deleteWorldShard(currentUser.token, shard.id);
            currentShards = currentShards.filter(s => s.id !== shard.id);
            renderShardList(); // Re-render list
            await _refreshDependentUI(themeId);
          } catch (error) {
            log(LOG_LEVEL_ERROR, 'Failed to shatter shard', error);
            displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }), modalContentContainer);
          }
        }
      });
      controlsDiv.appendChild(toggleLabel);
      controlsDiv.appendChild(shatterButton);
      listItem.appendChild(titleDiv);
      listItem.appendChild(unlockDescDiv);
      listItem.appendChild(controlsDiv);
      list.appendChild(listItem);
    });
    modalContentContainer.appendChild(list);
  };
  const bulkActionHandler = async (actionType) => {
    let confirmNeeded = false;
    let confirmTitleKey = '';
    let confirmMessageKey = '';
    let apiCall = async () => {};
    if (actionType === 'activateAll') {
      apiCall = async () => {
        for (const shard of currentShards) {
          if (!shard.isActiveForNewGames) {
            await apiService.updateWorldShardStatus(currentUser.token, shard.id, true);
            shard.isActiveForNewGames = true;
          }
        }
      };
    } else if (actionType === 'deactivateAll') {
      apiCall = async () => {
        for (const shard of currentShards) {
          if (shard.isActiveForNewGames) {
            await apiService.updateWorldShardStatus(currentUser.token, shard.id, false);
            shard.isActiveForNewGames = false;
          }
        }
      };
    } else if (actionType === 'resetAll') {
      confirmNeeded = true;
      confirmTitleKey = 'confirm_reset_world_title';
      confirmMessageKey = 'confirm_reset_world_message';
      apiCall = async () => {
        await apiService.resetWorldShardsForTheme(currentUser.token, themeId);
        currentShards = [];
      };
    }
    if (confirmNeeded) {
      const confirmed = await showGenericConfirmModal({
        titleKey: confirmTitleKey,
        messageKey: confirmMessageKey,
        replacements: { THEME_NAME: themeDisplayName },
      });
      if (!confirmed) return;
    }
    try {
      await apiCall();
      renderShardList(); // Re-render the list after bulk action
      await _refreshDependentUI(themeId);
    } catch (error) {
      log(LOG_LEVEL_ERROR, `Failed to ${actionType} shards for theme ${themeId}:`, error);
      displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }), modalContentContainer);
    }
  };
  const modalCustomActions = [
    { textKey: 'button_activate_all_shards', className: 'ui-button small', onClick: () => bulkActionHandler('activateAll') },
    { textKey: 'button_deactivate_all_shards', className: 'ui-button small', onClick: () => bulkActionHandler('deactivateAll') },
    { textKey: 'button_reset_world_shards', className: 'ui-button danger small', onClick: () => bulkActionHandler('resetAll') },
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
