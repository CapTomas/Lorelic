/**
 * @file Manages UI elements related to "playing" and "liked" themes,
 * primarily the top bar icons and interaction logic.
 */

// --- IMPORTS ---
import {
  playingThemesContainer,
  likedThemesContainer,
  likedThemesSeparator,
} from './domElements.js';
import {
  getPlayingThemes,
  setPlayingThemes,
  getLikedThemes,
  setLikedThemes,
  getCurrentTheme as getStateCurrentTheme,
  getCurrentUser,
  getCurrentLandingGridSelection,
} from '../core/state.js';
import { getThemeConfig } from '../services/themeService.js';
import { getUIText } from '../services/localizationService.js';
import * as apiService from '../core/apiService.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_DEBUG, LOG_LEVEL_WARN } from '../core/logger.js';
import { attachTooltip } from './tooltipManager.js';

// --- MODULE-LEVEL DEPENDENCIES ---
let _gameControllerRef = null;
let _landingPageManagerRef = null;

// --- INITIALIZATION ---

/**
 * Initializes the UserThemeControlsManager with references to other modules.
 * @param {object} gameController - Reference to the main gameController.
 * @param {object} landingPageManager - Reference to the landingPageManager.
 */
export function initUserThemeControlsManager(gameController, landingPageManager) {
  _gameControllerRef = gameController;
  _landingPageManagerRef = landingPageManager;
  log(LOG_LEVEL_INFO, 'UserThemeControlsManager initialized.');
}

// --- PRIVATE HELPERS ---

/**
 * Updates a theme interaction on the backend.
 * @private
 * @param {string} themeId - The ID of the theme.
 * @param {object} interactionPayload - The interaction data, e.g., `{ is_playing: true }`.
 * @returns {Promise<boolean>} True if the backend update was successful or not needed, false on API error.
 */
async function _updateThemeInteractionOnBackend(themeId, interactionPayload) {
  const currentUser = getCurrentUser();
  if (!currentUser?.token) {
    log(LOG_LEVEL_DEBUG, 'User not logged in. Skipping backend update for theme interaction.');
    return true; // Not an error, just skipped.
  }

  try {
    log(LOG_LEVEL_DEBUG, `Updating backend theme interaction for theme ${themeId}:`, interactionPayload);
    await apiService.updateThemeInteraction(currentUser.token, themeId, interactionPayload);
    log(LOG_LEVEL_INFO, `Theme interaction for ${themeId} updated successfully on backend.`);
    return true;
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Failed to update theme interaction for ${themeId} on backend:`, error.message, error.code);
    return false;
  }
}

/**
 * Creates a theme icon button element for the top bar.
 * @private
 * @param {string} themeId - The ID of the theme.
 * @param {'playing' | 'liked'} type - The type of interaction this icon represents.
 * @returns {HTMLElement|null} The button element or null if the theme configuration is missing.
 */
function _createThemeTopbarIconElement(themeId, type) {
  const themeConfig = getThemeConfig(themeId);
  if (!themeConfig) {
    log(LOG_LEVEL_WARN, `Cannot create top bar icon for theme ${themeId}: config not found.`);
    return null;
  }

  const isCurrentlyActiveGameTheme = getStateCurrentTheme() === themeId;

  const button = document.createElement('button');
  button.classList.add('theme-button');
  if (isCurrentlyActiveGameTheme) {
    button.classList.add('active');
  }
  button.dataset.theme = themeId;
  button.dataset.interactionType = type;

  const themeNameText = getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeId });
  const tooltipKey = type === 'playing' ? 'tooltip_theme_playing' : 'tooltip_theme_liked';
  const ariaLabelText = getUIText(tooltipKey, { THEME_NAME: themeNameText });

  button.setAttribute('aria-label', ariaLabelText);
  button.removeAttribute('title'); // Let tooltipManager handle titles.
  attachTooltip(button, tooltipKey, { THEME_NAME: themeNameText }, { explicitThemeContext: themeId });

  const img = document.createElement('img');
  img.src = themeConfig.icon;
  img.alt = ''; // Decorative, as button has aria-label.
  button.appendChild(img);

  // Add a close button only for "playing" icons.
  if (type === 'playing') {
    const closeBtn = document.createElement('button');
    closeBtn.classList.add('theme-button-close');
    closeBtn.innerHTML = '×';
    const closeButtonAriaLabelText = getUIText('close_theme_button_aria_label', { THEME_NAME: themeNameText });
    closeBtn.setAttribute('aria-label', closeButtonAriaLabelText);
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCloseThemeIconClick(themeId);
    });
    button.appendChild(closeBtn);
  }

  button.addEventListener('click', () => handleThemeIconClick(themeId));
  return button;
}

// --- PUBLIC API ---

/**
 * Updates the theme icons displayed in the top bar based on the current state.
 * It separates "playing" and "liked" themes, ensuring no duplicates.
 */
export function updateTopbarThemeIcons() {
  if (!playingThemesContainer || !likedThemesContainer || !likedThemesSeparator) {
    log(LOG_LEVEL_WARN, 'Top bar theme containers not found. Cannot update icons.');
    return;
  }

  playingThemesContainer.innerHTML = '';
  likedThemesContainer.innerHTML = '';

  const playing = getPlayingThemes();
  const liked = getLikedThemes();
  const currentActiveGameTheme = getStateCurrentTheme();

  // "Liked" themes are always shown in their section.
  liked.forEach((themeId) => {
    const icon = _createThemeTopbarIconElement(themeId, 'liked');
    if (icon) {
      if (themeId === currentActiveGameTheme) {
        icon.classList.add('active');
      }
      likedThemesContainer.appendChild(icon);
    }
  });

  // "Playing" themes are only shown in their section if they are NOT also "liked".
  playing.forEach((themeId) => {
    if (!liked.includes(themeId)) {
      const icon = _createThemeTopbarIconElement(themeId, 'playing');
      if (icon) {
        playingThemesContainer.appendChild(icon);
      }
    }
  });

  const hasPlayingIcons = playingThemesContainer.children.length > 0;
  const hasLikedIcons = likedThemesContainer.children.length > 0;

  // The separator is only visible if there are both non-liked "playing" icons and "liked" icons.
  likedThemesSeparator.style.display = hasPlayingIcons && hasLikedIcons ? 'block' : 'none';
  log(LOG_LEVEL_DEBUG, 'Top bar theme icons updated.');
}

/**
 * Handles clicks on theme icons in the top bar to switch to the selected theme.
 * @param {string} themeId - The ID of the theme icon that was clicked.
 */
export async function handleThemeIconClick(themeId) {
  log(LOG_LEVEL_INFO, `Top bar theme icon clicked: ${themeId}`);
  if (!_gameControllerRef?.changeActiveTheme) {
    log(LOG_LEVEL_ERROR, 'GameController reference or changeActiveTheme method not available.');
    return;
  }

  try {
    await _gameControllerRef.changeActiveTheme(themeId, false); // `false` for forceNewGame.
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Error changing active theme to ${themeId} from top bar:`, error);
  }
}

/**
 * Toggles the "liked" status of a theme from the landing page.
 * @param {string} themeId - The ID of the theme to like/unlike.
 */
export async function handleLikeThemeOnLandingClick(themeId) {
  const isCurrentlyLiked = getLikedThemes().includes(themeId);
  log(LOG_LEVEL_INFO, `Like button clicked on landing for theme ${themeId}. Currently liked: ${isCurrentlyLiked}.`);

  // Optimistic UI update.
  if (isCurrentlyLiked) {
    setLikedThemes(getLikedThemes().filter(id => id !== themeId));
  } else {
    setLikedThemes([...getLikedThemes(), themeId]);
  }

  // API call to persist the change.
  const apiSuccess = await _updateThemeInteractionOnBackend(themeId, { is_liked: !isCurrentlyLiked });

  if (!apiSuccess) {
    // Revert optimistic state update if API call failed.
    if (isCurrentlyLiked) {
      setLikedThemes([...getLikedThemes(), themeId]);
    } else {
      setLikedThemes(getLikedThemes().filter(id => id !== themeId));
    }
  }

  updateTopbarThemeIcons();

  // Re-render landing page action buttons to reflect the new state.
  if (_landingPageManagerRef?.renderLandingPageActionButtons && document.body.classList.contains('landing-page-active') && getCurrentLandingGridSelection() === themeId) {
    _landingPageManagerRef.renderLandingPageActionButtons(themeId);
  }

  log(LOG_LEVEL_DEBUG, `Theme ${themeId} like status toggled. New state: ${!isCurrentlyLiked}. API success: ${apiSuccess}`);
}

/**
 * Handles closing a theme via its top bar icon's close button.
 * This removes it from the "playing" list.
 * @param {string} themeId - The ID of the theme to close.
 */
export async function handleCloseThemeIconClick(themeId) {
  log(LOG_LEVEL_INFO, `Close icon clicked for theme ${themeId}.`);
  const wasCurrentlyActiveGame = getStateCurrentTheme() === themeId;

  setPlayingThemes(getPlayingThemes().filter(id => id !== themeId));

  const apiSuccess = await _updateThemeInteractionOnBackend(themeId, { is_playing: false });

  if (!apiSuccess) {
    setPlayingThemes([...getPlayingThemes(), themeId]); // Revert on failure.
    log(LOG_LEVEL_ERROR, `API update failed on closing ${themeId}. Local state might be temporarily inconsistent with backend.`);
  }

  updateTopbarThemeIcons();

  if (wasCurrentlyActiveGame) {
    log(LOG_LEVEL_INFO, `Closed active game theme ${themeId}. Switching to landing view.`);
    await _gameControllerRef?.switchToLanding();
  } else if (document.body.classList.contains('landing-page-active') && getCurrentLandingGridSelection() === themeId) {
    _landingPageManagerRef?.renderLandingPageActionButtons(themeId);
  }
}

/**
 * Sets a theme as "currently playing" in the state and backend.
 * Called by gameController when a game session for a theme starts.
 * @param {string} themeId - The ID of the theme to set as playing.
 */
export async function setThemeAsPlaying(themeId) {
  if (!getPlayingThemes().includes(themeId)) {
    setPlayingThemes([...getPlayingThemes(), themeId]);
  }

  const apiSuccess = await _updateThemeInteractionOnBackend(themeId, { is_playing: true });
  if (!apiSuccess) {
    log(LOG_LEVEL_WARN, `API call to set ${themeId} as playing failed. Local state updated optimistically.`);
  }

  updateTopbarThemeIcons();
  log(LOG_LEVEL_INFO, `Theme ${themeId} set as playing. API success: ${apiSuccess}`);
}

/**
 * Marks a theme as "not playing" in the state and backend.
 * @param {string} themeId - The ID of the theme.
 */
export async function setThemeAsNotPlaying(themeId) {
  if (getPlayingThemes().includes(themeId)) {
    setPlayingThemes(getPlayingThemes().filter(id => id !== themeId));
  }

  const apiSuccess = await _updateThemeInteractionOnBackend(themeId, { is_playing: false });
  if (!apiSuccess) {
    log(LOG_LEVEL_WARN, `API call to set ${themeId} as NOT playing failed. Local state updated optimistically.`);
  }

  updateTopbarThemeIcons();
  log(LOG_LEVEL_INFO, `Theme ${themeId} set as NOT playing. API success: ${apiSuccess}`);
}

/**
 * Fetches all theme interactions (playing/liked) for the current user from the backend,
 * updates the local state, and refreshes the top bar UI.
 */
export async function loadUserThemeInteractions() {
  const currentUser = getCurrentUser();
  if (currentUser?.token) {
    log(LOG_LEVEL_INFO, `Fetching all theme interactions for user ${currentUser.email}.`);
    try {
      const response = await apiService.fetchThemeInteractions(currentUser.token);
      setPlayingThemes(response.interactions?.playingThemeIds || []);
      setLikedThemes(response.interactions?.likedThemeIds || []);
      log(LOG_LEVEL_INFO, 'Theme interactions loaded from backend:', {
        playing: getPlayingThemes().length,
        liked: getLikedThemes().length,
      });
    } catch (error) {
      log(LOG_LEVEL_ERROR, 'Error fetching all theme interactions:', error.message);
      setPlayingThemes([]);
      setLikedThemes([]);
    }
  } else {
    log(LOG_LEVEL_INFO, 'User not logged in. Initializing theme interaction lists as empty.');
    setPlayingThemes([]);
    setLikedThemes([]);
  }
  updateTopbarThemeIcons();
}
