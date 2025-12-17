/**
 * @file Manages the UI for AI model selection, cycling through available models based on user tier.
 */
// --- IMPORTS ---
import { modelToggleButton, storyLogViewport } from './domElements.js';
import {
  getCurrentModelName,
  setCurrentModelName,
  getCurrentUser,
  getCurrentTheme,
  getCurrentUserApiUsage,
} from '../core/state.js';
import * as config from '../core/config.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_DEBUG, LOG_LEVEL_WARN } from '../core/logger.js';
import * as authService from '../services/authService.js';
import { getUIText } from '../services/localizationService.js';
import { attachTooltip, refreshCurrentTooltip } from './tooltipManager.js';
// --- MODULE-LEVEL STATE ---
let _storyLogManagerRef = null;
const LOW_API_CALL_THRESHOLD = 10;
/**
 * Returns a map defining which models are available for each user tier,
 * using the latest model names from the config.
 * @returns {object} The allowed models configuration.
 * @private
 */
function _getModelsByTier() {
  return {
    ultra: [
      { model: config.FREE_MODEL_NAME, nameKey: 'option_model_free' },
      { model: config.PRO_MODEL_NAME, nameKey: 'option_model_pro' },
      { model: config.ULTRA_MODEL_NAME, nameKey: 'option_model_ultra' },
    ],
    pro: [
      { model: config.FREE_MODEL_NAME, nameKey: 'option_model_free' },
      { model: config.PRO_MODEL_NAME, nameKey: 'option_model_pro' },
    ],
    free: [{ model: config.FREE_MODEL_NAME, nameKey: 'option_model_free' }],
    anonymous: [{ model: config.FREE_MODEL_NAME, nameKey: 'option_model_free' }],
  };
}
// --- INITIALIZATION ---
/**
 * Initializes the ModelToggleManager with optional dependencies.
 * @param {object} [dependencies={}] - Optional dependencies.
 * @param {object} [dependencies.storyLogManager] - Reference to storyLogManager for in-game messages.
 */
export function initModelToggleManager(dependencies = {}) {
  if (dependencies.storyLogManager) {
    _storyLogManagerRef = dependencies.storyLogManager;
  }
  updateModelToggleButtonAppearance();
}
// --- PUBLIC API ---
/**
 * Updates the appearance of the AI model toggle button based on the user's tier, current selection, and API usage.
 */
export function updateModelToggleButtonAppearance() {
  if (!modelToggleButton) {
    log(LOG_LEVEL_WARN, 'Model toggle button not found in DOM. Cannot update appearance.');
    return;
  }
  const currentUser = getCurrentUser();
  modelToggleButton.style.display = 'inline-flex';
  const apiUsage = getCurrentUserApiUsage() || {};
  const modelsByTier = _getModelsByTier();
  if (!currentUser) {
    // --- Anonymous User Logic ---
    modelToggleButton.disabled = true;
    const modelInfo = modelsByTier.anonymous[0];
    const modelName = getUIText(modelInfo.nameKey);
    modelToggleButton.textContent = modelName;
    const baseTooltipText = getUIText('tooltip_model_toggle_anon_base');
    const usageForModel = apiUsage[modelInfo.model] || { daily: { count: 0, limit: 0 } };
    const anonLimits = config.ANONYMOUS_API_USAGE_LIMITS[modelInfo.model] || { daily: { limit: 'N/A' } };
    const tooltipText = getUIText('tooltip_model_toggle_usage_anon', {
      BASE_TEXT: baseTooltipText,
      DAILY_COUNT: usageForModel.daily.count,
      DAILY_LIMIT: anonLimits.daily.limit,
    });
    modelToggleButton.setAttribute('aria-label', baseTooltipText);
    attachTooltip(modelToggleButton, null, {}, { rawText: tooltipText });
    return;
  }
  // --- Logged-In User Logic ---
  const userTier = authService.getEffectiveUserTier();
  const availableModels = modelsByTier[userTier] || modelsByTier.free;
  // Build usage string for tooltip
  const usageLines = availableModels.map(m => {
    const usage = apiUsage[m.model] || { daily: { count: 0, limit: 0 } };
    const limitText = typeof usage.daily.limit === 'number' ? usage.daily.limit : getUIText('not_available_short');
    return `${getUIText(m.nameKey)}: ${usage.daily.count}/${limitText}`;
  });
  const usageString = `Daily Usage: ${usageLines.join(' | ')}`;
  if (availableModels.length <= 1) {
    // User is on a tier with only one model (e.g., 'free')
    modelToggleButton.disabled = true;
    const modelInfo = availableModels[0];
    modelToggleButton.textContent = getUIText(modelInfo.nameKey);
    const tooltipText = `${usageString}\nUpgrade your plan to access more powerful models.`;
    attachTooltip(modelToggleButton, null, {}, { rawText: tooltipText });
    return;
  }
  // User is on a tier with multiple models
  const currentModel = getCurrentModelName();
  let currentIndex = availableModels.findIndex(m => m.model === currentModel);
  // If current model isn't in their tier (e.g., after a downgrade), default to the first one
  if (currentIndex === -1) {
    log(LOG_LEVEL_WARN, `Current model ${currentModel} not available for tier ${userTier}. Defaulting to first available.`);
    currentIndex = 0;
    setCurrentModelName(availableModels[0].model);
    authService.updateUserPreferences({ preferred_model_name: availableModels[0].model }).catch(err => {
      log(LOG_LEVEL_ERROR, "Failed to persist model downgrade preference", err);
    });
  }
  // --- Button Text Logic ---
  const currentModelInfo = availableModels[currentIndex];
  const currentModelShortName = getUIText(currentModelInfo.nameKey);
  modelToggleButton.textContent = currentModelShortName;
  // --- Find Next Available Model to determine disabled state and tooltip ---
  let nextAvailableIndex = -1;
  for (let i = 1; i <= availableModels.length; i++) {
    const potentialIndex = (currentIndex + i) % availableModels.length;
    const modelToCheck = availableModels[potentialIndex];
    const usage = apiUsage[modelToCheck.model] || { daily: { count: 0, limit: 0 } };
    const hasCallsLeft = typeof usage.daily.limit !== 'number' || (usage.daily.limit - usage.daily.count) > 0;
    if (potentialIndex !== currentIndex && hasCallsLeft) {
      nextAvailableIndex = potentialIndex;
      break;
    }
  }
  // --- Disabled State Logic ---
  modelToggleButton.disabled = (nextAvailableIndex === -1);
  // --- Tooltip & Aria Label Logic ---
  let ariaLabel;
  if (modelToggleButton.disabled) {
      ariaLabel = getUIText('aria_label_no_other_models_available', { CURRENT_MODEL: currentModelShortName });
  } else {
      const nextModelInfo = availableModels[nextAvailableIndex];
      const nextModelShortName = getUIText(nextModelInfo.nameKey);
      ariaLabel = getUIText('aria_label_toggle_model_specific', { NEXT_MODEL_NAME: nextModelShortName });
  }
  attachTooltip(modelToggleButton, null, {}, { rawText: `${usageString}\n${ariaLabel}` });
  modelToggleButton.setAttribute('aria-label', ariaLabel);
}
/**
 * Handles the click event on the AI model toggle button.
 * It cycles the model to the next one available for the user's tier and updates preferences.
 */
export async function handleModelToggle() {
  if (!modelToggleButton || modelToggleButton.disabled) return;
  const currentUser = getCurrentUser();
  if (!currentUser) {
    log(LOG_LEVEL_WARN, 'Model toggle attempted by anonymous user. This should not happen.');
    return;
  }
  const modelsByTier = _getModelsByTier();
  const userTier = authService.getEffectiveUserTier();
  const availableModels = modelsByTier[userTier] || modelsByTier.free;
  if (availableModels.length <= 1) {
    log(LOG_LEVEL_DEBUG, 'Model toggle clicked, but no other models available for this tier.');
    return;
  }
  const currentModel = getCurrentModelName();
  let currentIndex = availableModels.findIndex(m => m.model === currentModel);
  if (currentIndex === -1) currentIndex = 0; // Fallback
  const apiUsage = getCurrentUserApiUsage() || {};
  let nextAvailableIndex = -1;
  // Start searching from the model after the current one, and loop around.
  for (let i = 1; i <= availableModels.length; i++) {
    const potentialIndex = (currentIndex + i) % availableModels.length;
    const modelToCheck = availableModels[potentialIndex];
    const usage = apiUsage[modelToCheck.model] || { daily: { count: 0, limit: 0 } };
    let hasCallsLeft = false;
    // If limit is not a number (e.g., 'N/A'), assume it's available.
    if (typeof usage.daily.limit !== 'number') {
      hasCallsLeft = true;
    } else {
      hasCallsLeft = (usage.daily.limit - usage.daily.count) > 0;
    }
    if (hasCallsLeft) {
      nextAvailableIndex = potentialIndex;
      break; // Found a usable model
    }
  }
  // This case should be prevented by the button's disabled state, but it's a good safeguard.
  if (nextAvailableIndex === -1) {
    log(LOG_LEVEL_WARN, 'Model toggle clicked, but no other usable models found. Button should have been disabled.');
    // Just in case the UI is out of sync, let's update it.
    updateModelToggleButtonAppearance();
    return;
  }
  const nextModelInfo = availableModels[nextAvailableIndex];
  const newModelName = nextModelInfo.model;
  log(LOG_LEVEL_INFO, `User toggled AI model from ${currentModel} to ${newModelName}.`);
  setCurrentModelName(newModelName);
  try {
    await authService.updateUserPreferences({ preferred_model_name: newModelName });
    log(LOG_LEVEL_INFO, 'Backend model preference updated successfully.');
  } catch (error) {
    log(LOG_LEVEL_ERROR, 'Failed to update backend model preference:', error.message);
    if (_storyLogManagerRef && getCurrentTheme() && storyLogViewport && storyLogViewport.style.display !== 'none') {
      _storyLogManagerRef.addMessageToLog(
        getUIText('error_api_call_failed', { ERROR_MSG: 'Could not save model preference to server.' }),
        'system system-error',
      );
    }
  }
  updateModelToggleButtonAppearance();
  refreshCurrentTooltip();
  if (_storyLogManagerRef && getCurrentTheme() && storyLogViewport && storyLogViewport.style.display !== 'none') {
    const newModelShortName = getUIText(nextModelInfo.nameKey);
    _storyLogManagerRef.addMessageToLog(getUIText('system_model_switched', { MODEL_NAME: newModelShortName }), 'system');
  }
}
