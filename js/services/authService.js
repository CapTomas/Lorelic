/**
 * @file Manages the user authentication lifecycle, session status, and user profile data.
 * Interacts with apiService.js for backend calls and state.js to update currentUser.
 */

import * as apiService from '../core/apiService.js';
import * as state from '../core/state.js';
import {
  JWT_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  FREE_MODEL_NAME,
  PRO_MODEL_NAME,
  ULTRA_MODEL_NAME,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
  NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY,
  MODEL_PREFERENCE_STORAGE_KEY,
  CURRENT_THEME_STORAGE_KEY,
  LANDING_SELECTED_GRID_THEME_KEY,
} from '../core/config.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { getUIText } from './localizationService.js';

/**
 * A map defining which models are available for each user tier.
 * @private
 */
const ALLOWED_MODELS_BY_TIER = {
  ultra: [FREE_MODEL_NAME, PRO_MODEL_NAME, ULTRA_MODEL_NAME],
  pro: [FREE_MODEL_NAME, PRO_MODEL_NAME],
  free: [FREE_MODEL_NAME],
  anonymous: [FREE_MODEL_NAME],
};

/**
 * Checks if the current user is on a free tier but has an active trial period.
 * @returns {boolean} True if the user is on an active trial, false otherwise.
 */
export function isUserOnActiveTrial() {
  const user = state.getCurrentUser();
  if (!user || user.tier !== 'free' || !user.trial_expires_at) {
    return false;
  }
  const now = new Date();
  const expires = new Date(user.trial_expires_at);
  return expires > now;
}

/**
 * Gets the user's effective tier, considering any active trial.
 * If the user is on the 'free' tier but has an active trial, it returns 'pro'.
 * @returns {string} The user's effective tier ('anonymous', 'free', 'pro', 'ultra').
 */
export function getEffectiveUserTier() {
    const user = state.getCurrentUser();
    if (!user) {
        return 'anonymous';
    }
    if (user.tier === 'free' && isUserOnActiveTrial()) {
        return 'pro'; // On trial, user gets pro features
    }
    return user.tier;
}

/**
 * Handles the user registration process.
 * @param {string} email - User's email.
 * @param {string} password - User's password.
 * @param {object} [preferences={}] - Initial user preferences.
 * @returns {Promise<object>} The API response (user data and message).
 */
export async function handleRegistration(email, password, preferences = {}) {
  log(LOG_LEVEL_INFO, `Attempting registration for email: ${email}`);
  try {
    const response = await apiService.registerUser(email, password, preferences);
    log(LOG_LEVEL_INFO, `Registration successful for ${email}:`, response.message);
    return response;
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Registration failed for ${email}:`, error.message, error.code);
    let translatedError = error;
    if (error.code === 'USERNAME_ALREADY_EXISTS') {
      translatedError = new Error(getUIText('alert_username_already_exists'));
    } else if (error.code === 'INVALID_USERNAME_FORMAT') {
      translatedError = new Error(getUIText('alert_invalid_username_format'));
    }
    translatedError.code = error.code;
    throw translatedError;
  }
}

/**
 * Handles the user login process.
 * @param {string} email - User's email.
 * @param {string} password - User's password.
 * @returns {Promise<object>} User data including token.
 */
export async function handleLogin(email, password) {
  log(LOG_LEVEL_INFO, `Attempting login for email: ${email}`);
  try {
    const response = await apiService.loginUser(email, password);
    const { token, user: userData } = response;

    if (!token || !userData) {
      throw new Error('Login response missing token or user data.');
    }

    const wasAnonymous = !state.getCurrentUser();
    if (wasAnonymous) {
      log(LOG_LEVEL_INFO, 'User was anonymous before login. Clearing any volatile anonymous game state.');
      state.clearVolatileGameState();
      state.setCurrentTheme(null);
    }

    localStorage.setItem(JWT_STORAGE_KEY, token);
    state.setCurrentUser({ ...userData, token });
    log(LOG_LEVEL_INFO, `Login successful for ${userData.email}. Token stored. User state updated.`);

    await loadUserPreferences();
    state.setPlayingThemes([]);
    state.setLikedThemes([]);

    return userData;
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Login failed for ${email}:`, error.message, error.code);
    throw error;
  }
}

/**
 * Handles user logout by clearing credentials and resetting state to anonymous defaults.
 */
export function handleLogout() {
  log(LOG_LEVEL_INFO, `User logging out: ${state.getCurrentUser()?.email || 'Unknown User'}`);

  // Clear authentication token
  localStorage.removeItem(JWT_STORAGE_KEY);
  state.setCurrentUser(null);

  // Reset to anonymous preferences from localStorage or defaults
  const anonAppLang = localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY) || DEFAULT_LANGUAGE;
  const anonNarrLang = localStorage.getItem(NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY) || anonAppLang;
  const anonModel = localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) || FREE_MODEL_NAME;

  state.setCurrentAppLanguage(anonAppLang);
  state.setCurrentNarrativeLanguage(anonNarrLang);
  state.setCurrentModelName(anonModel);

  // Clear all game-related session data
  localStorage.removeItem(CURRENT_THEME_STORAGE_KEY);
  localStorage.removeItem(LANDING_SELECTED_GRID_THEME_KEY);
  state.setCurrentTheme(null);
  state.setCurrentLandingGridSelection(null);
  state.clearVolatileGameState();

  // Reset theme interactions
  state.setPlayingThemes([]);
  state.setLikedThemes([]);
  state.setShapedThemeData(new Map());

  log(LOG_LEVEL_INFO, 'User logged out. Local session cleared. Anonymous preferences applied.');
}

/**
 * Checks authentication status on application load.
 * Verifies stored token and updates user state, or logs out if token is invalid.
 * @returns {Promise<boolean>} True if user is successfully authenticated, false otherwise.
 */
export async function checkAuthStatusOnLoad() {
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  if (token) {
    log(LOG_LEVEL_INFO, 'Token found. Verifying session...');
    try {
      const response = await apiService.fetchCurrentUser(token);
      const userData = response.user;
      state.setCurrentUser({ ...userData, token });
      log(LOG_LEVEL_INFO, `Session verified for ${userData.email}.`);
      await loadUserPreferences();
      return true;
    } catch (error) {
      log(LOG_LEVEL_WARN, 'Token verification failed or token expired. Logging out.', error.message);
      handleLogout();
      return false;
    }
  }

  log(LOG_LEVEL_INFO, 'No token found. User is not authenticated.');
  await loadUserPreferences(); // Load anonymous preferences
  return false;
}

/**
 * Loads user preferences, fetching from backend if logged in, otherwise from localStorage.
 * Validates the user's preferred model against their tier and sets a valid default if needed.
 */
export async function loadUserPreferences() {
  const currentUser = state.getCurrentUser();
  if (currentUser?.token) {
    log(LOG_LEVEL_INFO, `Fetching preferences for logged-in user: ${currentUser.email}`);
    try {
      const response = await apiService.fetchUserPreferences(currentUser.token);
      const userPrefs = response.preferences;
      if (!userPrefs) {
        throw new Error("Preferences object not found in API response.");
      }
      state.setCurrentAppLanguage(userPrefs.preferred_app_language || DEFAULT_LANGUAGE);
      state.setCurrentNarrativeLanguage(userPrefs.preferred_narrative_language || state.getCurrentAppLanguage());
      const userTier = getEffectiveUserTier();
      const allowedModels = ALLOWED_MODELS_BY_TIER[userTier] || ALLOWED_MODELS_BY_TIER.free;
      if (userPrefs.preferred_model_name && allowedModels.includes(userPrefs.preferred_model_name)) {
        state.setCurrentModelName(userPrefs.preferred_model_name);
      } else {
        const defaultModelForTier = allowedModels[0];
        state.setCurrentModelName(defaultModelForTier);
        if (userPrefs.preferred_model_name) {
          log(LOG_LEVEL_WARN, `User's preferred model '${userPrefs.preferred_model_name}' is not allowed for tier '${userTier}'. Defaulting to '${defaultModelForTier}'.`);
        }
      }
      // Update the user object in the state with the fetched preferences
      state.setCurrentUser({ ...currentUser, ...userPrefs });
      log(LOG_LEVEL_INFO, 'User preferences loaded from backend and applied to state.');
    } catch (error) {
      log(LOG_LEVEL_ERROR, 'Failed to fetch user preferences. Logging out for safety.', error.message);
      handleLogout(); // It's safer to log out if preferences can't be fetched, to avoid inconsistent state.
    }
  } else {
    log(LOG_LEVEL_INFO, 'Loading preferences for anonymous user.');
    state.setCurrentAppLanguage(localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY) || DEFAULT_LANGUAGE);
    state.setCurrentNarrativeLanguage(localStorage.getItem(NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY) || state.getCurrentAppLanguage());
    state.setCurrentModelName(localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) || FREE_MODEL_NAME);
  }
}

/**
 * Updates user preferences on the backend and in local state.
 * @param {object} preferencesToUpdate - Object with preference keys and new values.
 * @returns {Promise<object>} The updated user object from the API or a simulated object for anonymous users.
 */
export async function updateUserPreferences(preferencesToUpdate) {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    log(LOG_LEVEL_WARN, 'Cannot update preferences on backend: User not logged in. Updating locally.');
    if (preferencesToUpdate.preferred_app_language) {
      state.setCurrentAppLanguage(preferencesToUpdate.preferred_app_language);
    }
    if (preferencesToUpdate.preferred_narrative_language) {
      state.setCurrentNarrativeLanguage(preferencesToUpdate.preferred_narrative_language);
    }
    if (preferencesToUpdate.preferred_model_name) {
      state.setCurrentModelName(preferencesToUpdate.preferred_model_name);
    }
    return {
      message: 'Local preferences updated.',
      user: {
        preferred_app_language: state.getCurrentAppLanguage(),
        preferred_narrative_language: state.getCurrentNarrativeLanguage(),
        preferred_model_name: state.getCurrentModelName(),
      },
    };
  }

  log(LOG_LEVEL_INFO, `Updating preferences for user ${currentUser.email}:`, preferencesToUpdate);
  try {
    const response = await apiService.updateUserPreferences(currentUser.token, preferencesToUpdate);
    const updatedUser = response.user;
    state.setCurrentUser({ ...currentUser, ...updatedUser }); // Update the full user object
    log(LOG_LEVEL_INFO, 'User preferences updated successfully.');
    return updatedUser;
  } catch (error) {
    log(LOG_LEVEL_ERROR, 'Failed to update user preferences:', error.message);
    throw error;
  }
}

/**
 * Handles changing the user's password.
 * @param {string} currentPassword - The user's current password.
 * @param {string} newPassword - The new password.
 * @returns {Promise<object>} API response.
 */
export async function handleChangePassword(currentPassword, newPassword) {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    throw new Error('User not authenticated.');
  }
  log(LOG_LEVEL_INFO, `Attempting password change for user ${currentUser.email}`);
  try {
    return await apiService.changePassword(currentUser.token, currentPassword, newPassword);
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Password change failed for ${currentUser.email}:`, error.message);
    throw error;
  }
}

/**
 * Initiates the "forgot password" process for an email address.
 * @param {string} email - The user's email address.
 * @returns {Promise<object>} API response (typically a generic success message).
 */
export async function handleForgotPassword(email) {
  log(LOG_LEVEL_INFO, `Initiating password reset for email: ${email}`);
  try {
    return await apiService.requestPasswordReset(email);
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Forgot password request failed for ${email}:`, error.message);
    throw error;
  }
}

/**
 * Handles resetting the password using a token.
 * @param {string} token - The password reset token.
 * @param {string} newPassword - The new password.
 * @returns {Promise<object>} API response.
 */
export async function handleResetPassword(token, newPassword) {
  log(LOG_LEVEL_INFO, `Attempting to reset password with token.`);
  try {
    return await apiService.resetPassword(token, newPassword);
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Password reset failed:`, error.message);
    throw error;
  }
}

/**
 * Handles resending the email confirmation for an authenticated user.
 * @returns {Promise<object>} API response.
 */
export async function handleResendConfirmation() {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    throw new Error('User not authenticated.');
  }
  log(LOG_LEVEL_INFO, `Requesting to resend confirmation email for ${currentUser.email}`);
  try {
    return await apiService.resendConfirmationEmail(currentUser.token);
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Failed to resend confirmation for ${currentUser.email}:`, error.message);
    throw error;
  }
}

/**
 * Handles publicly requesting a resend of the confirmation email (e.g., from login form).
 * @param {string} email - The email address.
 * @returns {Promise<object>} API response.
 */
export async function handlePublicResendConfirmation(email) {
  log(LOG_LEVEL_INFO, `Requesting public resend confirmation for email: ${email}`);
  try {
    return await apiService.publicResendConfirmationEmail(email);
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Public resend confirmation failed for ${email}:`, error.message);
    throw error;
  }
}

/**
 * Initiates the tier upgrade process by creating a checkout session.
 * @param {string} tier - The target tier ('pro' or 'ultra').
 * @returns {Promise<void>} Redirects the user to the checkout URL.
 */
export async function handleTierUpgrade(tier) {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    throw new Error('User must be logged in to upgrade.');
  }
  log(LOG_LEVEL_INFO, `User ${currentUser.email} initiating upgrade to tier: ${tier}`);
  try {
    const response = await apiService.createCheckoutSession(currentUser.token, tier);
    if (response.redirectUrl) {
      log(LOG_LEVEL_INFO, `Redirecting user to simulated checkout: ${response.redirectUrl}`);
      window.location.href = response.redirectUrl;
    } else {
      throw new Error('Checkout session did not return a redirect URL.');
    }
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Tier upgrade initiation failed for tier ${tier}:`, error);
    throw error;
  }
}

/**
 * Finalizes the tier upgrade after the user returns from the "payment" flow.
 * @param {string} tier - The tier from the URL parameters.
 * @param {string} sessionId - The session ID from the URL parameters.
 * @returns {Promise<object>} The updated user object.
 */
export async function handleUpgradeFinalization(tier, sessionId) {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    throw new Error('User must be logged in to finalize an upgrade.');
  }
  log(LOG_LEVEL_INFO, `Finalizing upgrade for user ${currentUser.email} to tier ${tier} with session ${sessionId}`);
  try {
    const response = await apiService.finalizeUpgrade(currentUser.token, tier, sessionId);
    const updatedUser = response.user;
    if (updatedUser) {
      log(LOG_LEVEL_INFO, 'Upgrade successful. Updating user state.');
      state.setCurrentUser({ ...updatedUser, token: currentUser.token });
      // Re-validate model preference against new tier
      await loadUserPreferences();
      return updatedUser;
    }
    throw new Error('Upgrade finalization response did not include user data.');
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Upgrade finalization failed for tier ${tier}:`, error);
    throw error;
  }
}

/**
 * Handles downgrading the user's subscription to the free tier.
 * @returns {Promise<object>} The updated user object.
 */
export async function handleDowngradeToFree() {
  const currentUser = state.getCurrentUser();
  if (!currentUser?.token) {
    throw new Error('User must be logged in to downgrade.');
  }
  log(LOG_LEVEL_INFO, `User ${currentUser.email} initiating downgrade to free tier.`);
  try {
    const response = await apiService.downgradeToFree(currentUser.token);
    const updatedUser = response.user;
    if (updatedUser) {
      log(LOG_LEVEL_INFO, 'Downgrade successful. Updating user state.');
      state.setCurrentUser({ ...updatedUser, token: currentUser.token });
      await loadUserPreferences(); // Re-validate model preference against new tier
      return updatedUser;
    }
    throw new Error('Downgrade response did not include user data.');
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Tier downgrade failed:`, error);
    throw error;
  }
}

/**
 * Saves the current game state to the backend if a user is logged in.
 * Sends only the unsaved history delta and clears it upon success.
 * @param {boolean} [forceSave=false] - If true, saves even if there are no new turns.
 */
export async function saveCurrentGameState(forceSave = false) {
  const currentUser = state.getCurrentUser();
  const currentThemeId = state.getCurrentTheme();
  if (!currentUser?.token) {
    log(LOG_LEVEL_INFO, 'User not logged in. Game state not saved to backend.');
    return;
  }
  if (!currentThemeId) {
    log(LOG_LEVEL_WARN, 'Cannot save game state: currentTheme not set.');
    return;
  }
  const historyDelta = state.getUnsavedHistoryDelta();
  const isSaveNeeded = historyDelta.length > 0 || state.getIsBoonSelectionPending() || forceSave;
  if (!isSaveNeeded) {
    log(LOG_LEVEL_DEBUG, 'No new turns, pending boons, or force flag. Skipping save.');
    return;
  }
  log(LOG_LEVEL_INFO, `Saving game state for theme '${currentThemeId}'. Delta: ${historyDelta.length} turns.`);
  const userThemeProgress = state.getCurrentUserThemeProgress() || {};
  // Ensure acquiredTraitKeys is always an array in the payload.
  if (userThemeProgress && !Array.isArray(userThemeProgress.acquiredTraitKeys)) {
    userThemeProgress.acquiredTraitKeys = [];
  }
  const gameStatePayload = {
    theme_id: currentThemeId,
    player_identifier: state.getPlayerIdentifier() || 'Protagonist',
    game_history_delta: historyDelta,
    last_dashboard_updates: state.getLastKnownDashboardUpdates(),
    last_game_state_indicators: state.getLastKnownGameStateIndicators(),
    current_prompt_type: state.getCurrentPromptType(),
    current_narrative_language: state.getCurrentNarrativeLanguage(),
    last_suggested_actions: state.getCurrentSuggestedActions(),
    actions_before_boon_selection: state.getLastAiSuggestedActions(),
    panel_states: state.getCurrentPanelStates(),
    model_name_used: state.getCurrentModelName(),
    new_persistent_lore_unlock: state.getCurrentTurnUnlockData(),
    dashboard_item_meta: state.getDashboardItemMeta(),
    user_theme_progress: userThemeProgress,
    is_boon_selection_pending: state.getIsBoonSelectionPending(),
    session_inventory: state.getCurrentInventory(),
    equipped_items: state.getEquippedItems(),
  };
  // The unlock data is a one-time signal; reset it after including it in the payload.
  state.setCurrentTurnUnlockData(null);
  try {
    const response = await apiService.saveGameState(currentUser.token, gameStatePayload);
    log(LOG_LEVEL_INFO, 'Game state delta saved successfully to backend.');
    // If the save operation resulted in lore evolution, update the local state immediately.
    if (response?.evolved_lore) {
      log(LOG_LEVEL_INFO, 'Received updated evolved lore from backend. Updating local state.');
      state.setLastKnownEvolvedWorldLore(response.evolved_lore);
    }
    // On successful save, clear the delta buffer.
    state.clearUnsavedHistoryDelta();
  } catch (error) {
    log(LOG_LEVEL_ERROR, 'Error saving game state delta to backend:', error.message, error.code);
    // DO NOT clear the delta on error. The unsaved turns will be retried on the next save attempt.
    throw error;
  }
}
