/**
 * @file Handles all communication with the backend API.
 * Encapsulates fetch logic, error handling, and token management for API calls.
 */
import { PROXY_API_URL } from './config.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_ERROR, LOG_LEVEL_INFO, LOG_LEVEL_WARN } from './logger.js';

// --- Private Helper ---

/**
 * A generic helper function to make API calls, handling headers, body, and errors.
 * @private
 * @param {string} endpoint - The API endpoint (e.g., '/api/v1/auth/login').
 * @param {string} [method='GET'] - HTTP method.
 * @param {object|null} [body=null] - The request body for POST/PUT requests.
 * @param {string|null} [token=null] - Optional JWT for authenticated requests.
 * @returns {Promise<object>} The JSON response from the API.
 * @throws {Error} Throws a detailed error if the API call fails or returns a non-OK status.
 */
async function _callApi(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    config.body = JSON.stringify(body);
  }

  log(LOG_LEVEL_DEBUG, `Calling API: ${method} ${endpoint}`, body ? `with body (keys: ${Object.keys(body).join(', ')})` : 'without body');

  try {
    const response = await fetch(endpoint, config);

    // Handle successful responses with no content
    if (response.status === 204) {
      log(LOG_LEVEL_INFO, `API call ${method} ${endpoint} successful with 204 No Content.`);
      return { success: true, status: response.status };
    }

    const responseData = await response.json();

    if (!response.ok) {
      const errorMessage = responseData.error?.message || `API Error: ${response.statusText} (Status: ${response.status})`;
      const errorCode = responseData.error?.code || `HTTP_${response.status}`;
      log(LOG_LEVEL_WARN, `API Error (${response.status} ${errorCode}) for ${method} ${endpoint}: ${errorMessage}`, responseData.error?.details || responseData);

      const error = new Error(errorMessage);
      error.status = response.status;
      error.code = errorCode;
      error.details = responseData.error?.details || responseData;
      throw error;
    }

    log(LOG_LEVEL_DEBUG, `API call ${method} ${endpoint} successful. Status: ${response.status}.`);
    return responseData;
  } catch (error) {
    if (error.status) { // Re-throw errors we constructed from non-ok responses
      throw error;
    }
    log(LOG_LEVEL_ERROR, `Network or unexpected error in _callApi for ${method} ${endpoint}:`, error.message);
    const networkError = new Error(`Network error or server unavailable: ${error.message}`);
    networkError.isNetworkError = true;
    networkError.code = 'NETWORK_ERROR';
    throw networkError;
  }
}

// --- Authentication Endpoints ---

/**
 * Registers a new user.
 * @param {string} email - The user's email address.
 * @param {string} password - The user's password.
 * @param {object} [preferences={}] - Optional initial user preferences.
 * @returns {Promise<object>} The API response, including user data.
 */
export const registerUser = (email, password, preferences = {}) =>
  _callApi('/api/v1/auth/register', 'POST', {
    email,
    password,
    username: preferences.username,
    story_preference: preferences.storyPreference,
    newsletter_opt_in: preferences.newsletterOptIn,
    preferred_app_language: preferences.appLanguage,
    preferred_narrative_language: preferences.narrativeLanguage,
    preferred_model_name: preferences.modelName,
  });

/**
 * Logs in a user.
 * @param {string} email - The user's email.
 * @param {string} password - The user's password.
 * @returns {Promise<object>} The API response, including a JWT token and user data.
 */
export const loginUser = (email, password) => _callApi('/api/v1/auth/login', 'POST', { email, password });

/**
 * Fetches the currently authenticated user's profile data.
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} An object containing the user's profile data.
 */
export const fetchCurrentUser = (token) => _callApi('/api/v1/auth/me', 'GET', null, token);

/**
 * Requests a resend of the confirmation email for the authenticated user.
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} The API response confirming the request.
 */
export const resendConfirmationEmail = (token) => _callApi('/api/v1/auth/resend-confirmation-email', 'POST', null, token);

/**
 * Publicly requests a resend of the confirmation email for any given email address.
 * @param {string} email - The email address to resend confirmation for.
 * @returns {Promise<object>} The API response confirming the request.
 */
export const publicResendConfirmationEmail = (email) => _callApi('/api/v1/auth/public-resend-confirmation', 'POST', { email });

/**
 * Initiates the password reset process for a given email.
 * @param {string} email - The user's email address.
 * @returns {Promise<object>} A promise that resolves with a confirmation message.
 */
export const requestPasswordReset = (email) => _callApi('/api/v1/auth/forgot-password', 'POST', { email });

/**
 * Resets a user's password using a valid reset token.
 * @param {string} token - The password reset token from the email link.
 * @param {string} newPassword - The new password for the user.
 * @returns {Promise<object>} A promise that resolves with a success message.
 */
export const resetPassword = (token, newPassword) => _callApi('/api/v1/auth/reset-password', 'POST', { token, newPassword });

// --- User Profile & Preferences Endpoints ---

/**
 * Fetches the current user's preferences.
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} An object containing user preferences.
 */
export const fetchUserPreferences = (token) => _callApi('/api/v1/users/me/preferences', 'GET', null, token);

/**
 * Updates the current user's preferences.
 * @param {string} token - The user's JWT.
 * @param {object} preferencesToUpdate - An object with the preferences to update.
 * @returns {Promise<object>} The updated user object from the API.
 */
export const updateUserPreferences = (token, preferencesToUpdate) => _callApi('/api/v1/users/me/preferences', 'PUT', preferencesToUpdate, token);

/**
 * Changes the authenticated user's password.
 * @param {string} token - The user's JWT.
 * @param {string} currentPassword - The user's current password for verification.
 * @param {string} newPassword - The desired new password.
 * @returns {Promise<object>} The API response confirming success.
 */
export const changePassword = (token, currentPassword, newPassword) => _callApi('/api/v1/users/me/password', 'PUT', { currentPassword, newPassword }, token);

// --- Game State Endpoints ---

/**
 * Saves the game state for the current user and theme.
 * @param {string} token - The user's JWT.
 * @param {object} gameStatePayload - The full game state object to save.
 * @returns {Promise<object>} The API response confirming the save.
 */
export const saveGameState = (token, gameStatePayload) => _callApi('/api/v1/gamestates', 'POST', gameStatePayload, token);

/**
 * Loads the game state for a specific theme.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme whose state is to be loaded.
 * @returns {Promise<object>} The loaded game state object.
 */
export const loadGameState = (token, themeId) => _callApi(`/api/v1/gamestates/${themeId}`, 'GET', null, token);

/**
 * Deletes the game state for a specific theme.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme whose state is to be deleted.
 * @returns {Promise<object>} A confirmation message.
 */
export const deleteGameState = (token, themeId) => _callApi(`/api/v1/gamestates/${themeId}`, 'DELETE', null, token);

/**
 * Starts a new game session, clearing session-specific data but preserving persistent lore.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme to start a new session for.
 * @returns {Promise<object>} The API response, potentially including preserved lore/summary.
 */
export const startNewGameSession = (token, themeId) => _callApi(`/api/v1/gamestates/${themeId}/new-session`, 'POST', null, token);

// --- Theme Interaction Endpoints ---

/**
 * Fetches all theme interactions (playing/liked) for the authenticated user.
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} An object containing arrays of playing and liked theme IDs.
 */
export const fetchThemeInteractions = (token) => _callApi('/api/v1/themes/interactions', 'GET', null, token);

/**
 * Updates a theme interaction (like/playing status) for the user.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme to update.
 * @param {object} interactionPayload - The interaction data, e.g., `{ is_liked: true }`.
 * @returns {Promise<object>} The updated interaction object.
 */
export const updateThemeInteraction = (token, themeId, interactionPayload) => _callApi(`/api/v1/themes/${themeId}/interactions`, 'POST', interactionPayload, token);

// --- World Shard Endpoints ---

/**
 * Fetches all unlocked World Shards for a user and theme.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme.
 * @returns {Promise<object>} An object containing an array of World Shard data.
 */
export const fetchWorldShards = (token, themeId) => _callApi(`/api/v1/themes/${themeId}/worldshards`, 'GET', null, token);

/**
 * Updates the active status of a specific World Shard.
 * @param {string} token - The user's JWT.
 * @param {string} shardId - The ID of the shard to update.
 * @param {boolean} isActiveForNewGames - The new active status.
 * @returns {Promise<object>} The updated World Shard object.
 */
export const updateWorldShardStatus = (token, shardId, isActiveForNewGames) => _callApi(`/api/v1/worldshards/${shardId}/status`, 'PUT', { isActiveForNewGames }, token);

/**
 * Deletes (shatters) a specific World Shard.
 * @param {string} token - The user's JWT.
 * @param {string} shardId - The ID of the shard to delete.
 * @returns {Promise<object>} A confirmation message.
 */
export const deleteWorldShard = (token, shardId) => _callApi(`/api/v1/worldshards/${shardId}`, 'DELETE', null, token);

/**
 * Resets all World Shards for a user and theme.
 * @param {string} token - The user's JWT.
 * @param {string} themeId - The ID of the theme to reset.
 * @returns {Promise<object>} A confirmation message with the count of deleted shards.
 */
export const resetWorldShardsForTheme = (token, themeId) => _callApi(`/api/v1/themes/${themeId}/worldshards/reset`, 'DELETE', null, token);

/**
 * Fetches a summary of themes that have been "shaped" by the user (i.e., have unlocked World Shards).
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} A summary object for shaped themes.
 */
export const fetchShapedThemesSummary = (token) => _callApi('/api/v1/users/me/shaped-themes-summary', 'GET', null, token);

// --- User Theme Progress Endpoints ---

/**
 * Fetches the user's persistent progress for a specific theme.
 * @param {string} token - The JWT for authentication.
 * @param {string} themeId - The ID of the theme.
 * @returns {Promise<object>} The user's theme progress data.
 */
export const fetchUserThemeProgress = (token, themeId) => _callApi(`/api/v1/users/me/themes/${themeId}/progress`, 'GET', null, token);

/**
 * Completely resets a character's progress for a specific theme, including game state and shards.
 * @param {string} token - The JWT for authentication.
 * @param {string} themeId - The ID of the theme to reset.
 * @returns {Promise<object>} The API response message.
 */
export const resetCharacterProgress = (token, themeId) => _callApi(`/api/v1/users/me/themes/${themeId}/character-reset`, 'DELETE', null, token);

/**
 * Applies a selected Boon to the user's theme progress.
 * @param {string} token - The JWT for authentication.
 * @param {string} themeId - The ID of the theme.
 * @param {object} boonPayload - Details of the boon to apply (e.g., { boonType, targetAttribute, value }).
 * @returns {Promise<object>} The API response containing the updated UserThemeProgress.
 */
export const applyBoonSelection = (token, themeId, boonPayload) => _callApi(`/api/v1/users/me/themes/${themeId}/boon`, 'POST', boonPayload, token);

/**
 * Updates a user's persistent progress for a specific theme (e.g., character name).
 * @param {string} token - The JWT for authentication.
 * @param {string} themeId - The ID of the theme.
 * @param {object} progressToUpdate - The progress data to update (e.g., { characterName: "New Name" }).
 * @returns {Promise<object>} The API response containing the updated UserThemeProgress.
 */
export const updateUserThemeProgress = (token, themeId, progressToUpdate) => _callApi(`/api/v1/users/me/themes/${themeId}/progress`, 'PUT', progressToUpdate, token);

// --- Billing & Subscription Endpoints ---

/**
 * Creates a simulated checkout session for a tier upgrade.
 * @param {string} token - The user's JWT.
 * @param {string} tier - The target tier to upgrade to (e.g., 'pro', 'ultra').
 * @returns {Promise<object>} The API response, containing a redirectUrl.
 */
export const createCheckoutSession = (token, tier) => _callApi('/api/v1/users/me/create-checkout-session', 'POST', { tier }, token);

/**
 * Downgrades the user's subscription to the free tier.
 * @param {string} token - The user's JWT.
 * @returns {Promise<object>} The API response, containing the updated user object.
 */
export const downgradeToFree = (token) => _callApi('/api/v1/users/me/downgrade-to-free', 'POST', null, token);

/**
 * Finalizes a tier upgrade after a successful simulated payment.
 * @param {string} token - The user's JWT.
 * @param {string} tier - The tier that was upgraded to.
 * @param {string} sessionId - The session ID from the payment flow.
 * @returns {Promise<object>} The API response, containing the updated user object.
 */
export const finalizeUpgrade = (token, tier, sessionId) => _callApi('/api/v1/users/me/finalize-upgrade', 'POST', { tier, sessionId }, token);

// --- Application Configuration Endpoints ---
/**
 * Fetches the application's AI model configuration from the backend.
 * @returns {Promise<object>} The model configuration object.
 */
export const fetchModelConfiguration = () => _callApi('/api/v1/config/models', 'GET');

// --- AI Proxy Endpoint ---

/**
 * Calls the backend proxy for Gemini API interaction.
 * @param {object} payload - The payload to send to the Gemini API.
 * @param {string|null} token - The JWT for authentication. Can be null for anonymous calls if allowed by backend.
 * @returns {Promise<object>} The JSON response from the AI proxy.
 */
export const callGeminiProxy = (payload, token) => _callApi(PROXY_API_URL, 'POST', payload, token);
