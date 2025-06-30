/**
 * @file Manages all UI logic specific to the theme selection/landing page,
 * including rendering the theme grid and updating details panels.
 */

// --- IMPORTS ---
import {
  themeGridContainer,
  landingThemeDescriptionContainer,
  landingThemeLoreText,
  landingThemeDetailsContainer,
  landingThemeInfoContent,
  landingThemeActions,
  leftPanel,
  rightPanel,
  storyLogViewport,
  suggestedActionsWrapper,
  playerInputControlPanel,
  nameInputSection,
  actionInputSection,
  leftPanelScrollIndicatorUp,
  leftPanelScrollIndicatorDown,
  rightPanelScrollIndicatorUp,
  rightPanelScrollIndicatorDown,
  systemStatusIndicator,
} from './domElements.js';
import {
  getCurrentLandingGridSelection,
  setCurrentLandingGridSelection,
  setCurrentTheme as setStateCurrentTheme,
  getPlayingThemes,
  getLikedThemes,
  setShapedThemeData,
  getShapedThemeData,
  getCurrentUser,
  setLandingSelectedThemeProgress,
  getLandingSelectedThemeProgress,
  setLandingSelectedThemeEvolvedLore,
  getLandingSelectedThemeEvolvedLore,
} from '../core/state.js';
import * as apiService from '../core/apiService.js';
import * as themeService from '../services/themeService.js';
import { getUIText, getApplicationLanguage } from '../services/localizationService.js';
import { MIN_LEVEL_FOR_STORE } from '../core/config.js';
import { THEMES_MANIFEST } from '../data/themesManifest.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { formatDynamicText, setGMActivityIndicator, activateShardTooltips } from './uiUtils.js';
import { attachTooltip } from './tooltipManager.js';
import { showLoginModal } from './authUiManager.js';
import { animatePanelExpansion } from './dashboardManager.js';

// --- MODULE-LEVEL DEPENDENCIES ---
let _gameControllerRef = null;
let _userThemeControlsManagerRef = null;

// --- INITIALIZATION ---

/**
 * Initializes the landing page manager with references to other modules.
 * @param {object} gameController - Reference to the main gameController.
 * @param {object} userThemeControlsManager - Reference to the userThemeControlsManager.
 */
export function initLandingPageManager(gameController, userThemeControlsManager) {
  _gameControllerRef = gameController;
  _userThemeControlsManagerRef = userThemeControlsManager;
  log(LOG_LEVEL_INFO, 'LandingPageManager initialized.');
}

// --- DATA FETCHING & STATE MANAGEMENT ---

/**
 * Fetches all necessary data (progress, evolved lore) for a selected theme on the landing page.
 * @param {string} themeId - The ID of the theme to fetch data for.
 * @private
 */
async function _prepareDataForLandingThemeSelection(themeId) {
  const currentUser = getCurrentUser();
  // Reset state before fetching
  setLandingSelectedThemeProgress(null);
  setLandingSelectedThemeEvolvedLore(null);

  if (currentUser?.token) {
    try {
      // Fetch both progress and game state in parallel
      const [progressResponse, gameStateResponse] = await Promise.all([
        apiService.fetchUserThemeProgress(currentUser.token, themeId).catch(e => e),
        apiService.loadGameState(currentUser.token, themeId).catch(e => e)
      ]);

      // Handle Progress Response
      if (progressResponse && !progressResponse.code) {
          setLandingSelectedThemeProgress(progressResponse.userThemeProgress);
          log(LOG_LEVEL_DEBUG, `Fetched and set landing theme progress for: ${themeId}`);
      } else {
          log(LOG_LEVEL_WARN, `Could not fetch theme progress for landing selection ${themeId}.`, progressResponse?.message);
      }

      // Handle GameState Response
      if (gameStateResponse && !gameStateResponse.code) {
          // Success: GameState found, use its lore
          setLandingSelectedThemeEvolvedLore(gameStateResponse.game_history_lore);
          log(LOG_LEVEL_DEBUG, `Fetched and set landing theme evolved lore for: ${themeId}`);
      } else if (gameStateResponse?.code === 'GAME_STATE_NOT_FOUND') {
          // Specific case: No GameState, use the base lore provided in the 404 response details
          setLandingSelectedThemeEvolvedLore(gameStateResponse.details?.new_game_context?.base_lore || null);
          log(LOG_LEVEL_DEBUG, `No game state found for landing selection ${themeId}. Using base lore from API response.`);
      } else {
          // Other error fetching GameState
          log(LOG_LEVEL_WARN, `Could not fetch game state for landing selection ${themeId}.`, gameStateResponse?.message);
      }
    } catch (error) {
      log(LOG_LEVEL_ERROR, `Unhandled error fetching data for landing selection ${themeId}.`, error);
    }
  }
}

/**
 * Fetches the summary of themes with World Shards and updates the UI grid.
 * This also handles pre-fetching character progress if a theme is already selected on load.
 */
export async function fetchShapedWorldStatusAndUpdateGrid() {
  log(LOG_LEVEL_INFO, 'Fetching shaped world status and updating grid...');
  const currentUser = getCurrentUser();
  const newShapedData = new Map();

  if (currentUser?.token) {
    try {
      const response = await apiService.fetchShapedThemesSummary(currentUser.token);
      if (response?.shapedThemes && Array.isArray(response.shapedThemes)) {
        response.shapedThemes.forEach((summary) => {
          newShapedData.set(summary.themeId, {
            hasShards: summary.hasShards === true,
            activeShardCount: summary.activeShardCount || 0,
          });
        });
      } else {
        log(LOG_LEVEL_WARN, 'Unexpected response structure from shaped-themes-summary.', response);
      }
    } catch (error) {
      log(LOG_LEVEL_ERROR, 'Error fetching shaped themes summary:', error.message, error.code);
    }
  } else {
    log(LOG_LEVEL_INFO, 'User not logged in, shaped world status will default to not shaped.');
  }

  THEMES_MANIFEST.filter((tm) => tm.playable).forEach((themeMeta) => {
    if (!newShapedData.has(themeMeta.id)) {
      newShapedData.set(themeMeta.id, { hasShards: false, activeShardCount: 0 });
    }
  });

  setShapedThemeData(newShapedData);
  log(LOG_LEVEL_DEBUG, 'Shaped theme data updated in state:', Object.fromEntries(newShapedData));

  await renderThemeGrid();

  const currentSelection = getCurrentLandingGridSelection();
  if (currentSelection) {
    await _prepareDataForLandingThemeSelection(currentSelection);
    if (document.body.classList.contains('landing-page-active')) {
      updateLandingPagePanelsWithThemeInfo(currentSelection, false);
      const selectedBtn = themeGridContainer?.querySelector(`.theme-grid-icon[data-theme="${currentSelection}"]`);
      if (selectedBtn) {
        selectedBtn.classList.add('active');
      }
    }
  }
}

// --- UI VIEW MANAGEMENT ---

/**
 * Switches the UI to the landing page view.
 * Clears game-specific elements and displays landing page elements.
 */
export async function switchToLandingView() {
  log(LOG_LEVEL_INFO, 'Switching to landing page view.');
  setStateCurrentTheme(null);

  document.body.className = '';
  document.body.classList.add('landing-page-active', 'theme-landing');

  if (storyLogViewport) storyLogViewport.style.display = 'none';
  if (suggestedActionsWrapper) suggestedActionsWrapper.style.display = 'none';
  if (playerInputControlPanel) playerInputControlPanel.style.display = 'none';
  if (nameInputSection) nameInputSection.style.display = 'none';
  if (actionInputSection) actionInputSection.style.display = 'none';

  [leftPanel, rightPanel].forEach((panelContainer) => {
    if (panelContainer) {
      Array.from(panelContainer.querySelectorAll('.panel-box'))
        .filter(box => !box.closest('#landing-theme-description-container') && !box.closest('#landing-theme-details-container'))
        .forEach(el => el.remove());
    }
  });

  [leftPanelScrollIndicatorUp, leftPanelScrollIndicatorDown, rightPanelScrollIndicatorUp, rightPanelScrollIndicatorDown].forEach((indicator) => {
    if (indicator) indicator.style.display = 'none';
  });

  if (themeGridContainer) themeGridContainer.style.display = 'grid';

  if (landingThemeDescriptionContainer) {
    landingThemeDescriptionContainer.style.display = 'flex';
    const descTitle = landingThemeDescriptionContainer.querySelector('.panel-box-title');
    if (descTitle) descTitle.textContent = getUIText('landing_theme_description_title', {}, { viewContext: 'landing' });
    const lorePanelBox = landingThemeDescriptionContainer.querySelector('.panel-box');
    if (lorePanelBox) {
      if (!lorePanelBox.id) lorePanelBox.id = 'landing-lore-panel-box';
      animatePanelExpansion(lorePanelBox.id, true, false, true);
    }
  }

  if (landingThemeDetailsContainer) {
    landingThemeDetailsContainer.style.display = 'flex';
    const detailsTitle = landingThemeDetailsContainer.querySelector('.panel-box-title');
    if (detailsTitle) detailsTitle.textContent = getUIText('landing_theme_info_title', {}, { viewContext: 'landing' });
    const detailsPanelBox = landingThemeDetailsContainer.querySelector('.panel-box');
    if (detailsPanelBox) {
      if (!detailsPanelBox.id) detailsPanelBox.id = 'landing-details-panel-box';
      animatePanelExpansion(detailsPanelBox.id, true, false, true);
    }
  }

  if (landingThemeLoreText) landingThemeLoreText.innerHTML = `<p>${getUIText('landing_select_theme_prompt_lore', {}, { viewContext: 'landing' })}</p>`;
  if (landingThemeInfoContent) landingThemeInfoContent.innerHTML = `<p>${getUIText('landing_select_theme_prompt_details', {}, { viewContext: 'landing' })}</p>`;
  if (landingThemeActions) landingThemeActions.style.display = 'none';

  if (systemStatusIndicator) {
    systemStatusIndicator.textContent = getUIText('standby', {}, { viewContext: 'landing' });
    systemStatusIndicator.className = 'status-indicator status-ok';
  }

  setGMActivityIndicator(false);

  if (_userThemeControlsManagerRef?.updateTopbarThemeIcons) {
    _userThemeControlsManagerRef.updateTopbarThemeIcons();
  }

  await fetchShapedWorldStatusAndUpdateGrid();
}

/**
 * Switches the UI to the main game view for a specific theme.
 * @param {string} themeId - The ID of the theme to switch to.
 */
export function switchToGameView(themeId) {
  document.body.className = '';
  document.body.classList.add(`theme-${themeId}`);

  if (themeGridContainer) themeGridContainer.style.display = 'none';
  if (landingThemeDescriptionContainer) landingThemeDescriptionContainer.style.display = 'none';
  if (landingThemeDetailsContainer) landingThemeDetailsContainer.style.display = 'none';

  if (storyLogViewport) storyLogViewport.style.display = 'block';
  if (suggestedActionsWrapper) suggestedActionsWrapper.style.display = 'flex';
  if (playerInputControlPanel) playerInputControlPanel.style.display = 'block';
}

// --- UI RENDERING ---

/**
 * Renders the theme selection grid on the landing page.
 */
export async function renderThemeGrid() {
  if (!themeGridContainer) {
    log(LOG_LEVEL_WARN, 'Theme grid container not found. Cannot render theme grid.');
    return;
  }
  themeGridContainer.innerHTML = '';
  const shapedData = getShapedThemeData();
  const currentUser = getCurrentUser(); // Check for logged-in user
  THEMES_MANIFEST.forEach((themeMeta) => {
    const themeConfig = themeService.getThemeConfig(themeMeta.id);
    if (!themeConfig || !themeMeta.playable) {
      return;
    }
    const isLocked = !currentUser && themeMeta.lockedForAnonymous;
    const button = document.createElement('button');
    button.classList.add('theme-grid-icon');
    if (isLocked) {
      button.classList.add('locked');
    }
    button.dataset.theme = themeConfig.id;
    const themeFullNameText = getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeConfig.id, viewContext: 'landing' });
    button.removeAttribute('title');
    button.addEventListener('click', () => handleThemeGridSelection(themeConfig.id));
    const img = document.createElement('img');
    img.src = themeConfig.icon;
    const altTextKey = themeConfig.icon_alt_text_key || `theme_icon_alt_text_default_${themeConfig.id}`;
    img.alt = getUIText(altTextKey, {}, { explicitThemeContext: themeConfig.id, viewContext: 'landing' });
    const nameSpan = document.createElement('span');
    nameSpan.classList.add('theme-grid-icon-name');
    const themeShortNameKey = themeConfig.name_short_key || themeConfig.name_key;
    nameSpan.textContent = getUIText(themeShortNameKey, {}, { explicitThemeContext: themeConfig.id, viewContext: 'landing' });
    const themeStatus = shapedData.get(themeConfig.id);
    if (themeStatus?.hasShards) {
      button.classList.add('theme-grid-icon-shaped');
      const shardIndicator = document.createElement('div');
      shardIndicator.classList.add('shard-indicator-overlay');
      attachTooltip(shardIndicator, 'tooltip_shaped_world', { ACTIVE_SHARDS: themeStatus.activeShardCount }, { viewContext: 'landing' });
      button.appendChild(shardIndicator);
    }
    if (isLocked) {
      attachTooltip(button, 'tooltip_theme_locked_anon', {}, { viewContext: 'global' });
      button.setAttribute('aria-label', `${themeFullNameText} (${getUIText('tooltip_theme_locked_anon')})`);
      const lockIcon = document.createElement('div');
      lockIcon.className = 'lock-icon-overlay';
      button.appendChild(lockIcon);
    } else {
      button.setAttribute('aria-label', themeFullNameText);
    }
    button.appendChild(img);
    button.appendChild(nameSpan);
    themeGridContainer.appendChild(button);
  });
  log(LOG_LEVEL_DEBUG, 'Theme grid rendered.');
}

/**
 * Updates the landing page's side panels with information for the selected theme.
 * @param {string} themeId - The ID of the selected theme.
 * @param {boolean} [animateExpansion=true] - Whether to animate panel expansion.
 */
export function updateLandingPagePanelsWithThemeInfo(themeId, animateExpansion = true) {
  const themeConfig = themeService.getThemeConfig(themeId);
  if (!themeConfig || !landingThemeLoreText || !landingThemeInfoContent || !landingThemeDescriptionContainer || !landingThemeDetailsContainer) {
    log(LOG_LEVEL_WARN, `Cannot update landing page panels: Missing config for ${themeId} or DOM elements.`);
    return;
  }
  const descTitle = landingThemeDescriptionContainer.querySelector('.panel-box-title');
  if (descTitle) descTitle.textContent = getUIText('landing_theme_description_title', {}, { viewContext: 'landing' });
  const detailsTitle = landingThemeDetailsContainer.querySelector('.panel-box-title');
  if (detailsTitle) detailsTitle.textContent = getUIText('landing_theme_info_title', {}, { viewContext: 'landing' });
  // Use evolved lore from state if available, otherwise fall back to base lore
  const evolvedLoreData = getLandingSelectedThemeEvolvedLore();
  const currentLang = getApplicationLanguage();
  let selectedEvolvedLore = null;
  // Only use the evolved lore if it's a multi-language object.
  if (typeof evolvedLoreData === 'object' && evolvedLoreData !== null) {
      selectedEvolvedLore = evolvedLoreData[currentLang] || evolvedLoreData.en; // Fallback to 'en'
  }
  // If no multi-language evolved lore is found, use the standard, correctly translated base lore.
  const baseLore = getUIText(themeConfig.lore_key, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
  const loreTextToDisplay = selectedEvolvedLore || baseLore;
  landingThemeLoreText.innerHTML = `<p>${formatDynamicText(loreTextToDisplay)}</p>`;
  activateShardTooltips(landingThemeLoreText); // Activate tooltips on the new content
  const themeDisplayName = getUIText(themeConfig.name_long_key || themeConfig.name_key, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
  const inspirationText = getUIText(themeConfig.inspiration_key, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
  const toneText = getUIText(themeConfig.tone_key, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
  const conceptText = getUIText(themeConfig.concept_key, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
  landingThemeInfoContent.innerHTML = `
    <p><strong>${getUIText('landing_theme_name_label', {}, { viewContext: 'landing' })}:</strong> <span id="landing-selected-theme-name">${themeDisplayName}</span></p>
    <p><strong>${getUIText('landing_theme_inspiration_label', {}, { viewContext: 'landing' })}:</strong> <span id="landing-selected-theme-inspiration">${formatDynamicText(inspirationText)}</span></p>
    <p><strong>${getUIText('landing_theme_tone_label', {}, { viewContext: 'landing' })}:</strong> <span id="landing-selected-theme-tone">${formatDynamicText(toneText)}</span></p>
    <p><strong>${getUIText('landing_theme_concept_label', {}, { viewContext: 'landing' })}:</strong> <span id="landing-selected-theme-concept">${formatDynamicText(conceptText)}</span></p>
  `;
  renderLandingPageActionButtons(themeId);
  if (landingThemeActions) landingThemeActions.style.display = 'flex';
  if (animateExpansion) {
    const lorePanelBox = landingThemeDescriptionContainer.querySelector('.panel-box');
    if (lorePanelBox?.id) animatePanelExpansion(lorePanelBox.id, true, false);
    const detailsPanelBox = landingThemeDetailsContainer.querySelector('.panel-box');
    if (detailsPanelBox?.id) animatePanelExpansion(detailsPanelBox.id, true, false);
  }
  log(LOG_LEVEL_DEBUG, `Landing page panels updated for theme: ${themeId}`);
}

/**
 * Renders the action buttons (e.g., Continue, New Game, Like) for the selected theme on the landing page.
 * @param {string} themeId - The ID of the selected theme.
 */
export function renderLandingPageActionButtons(themeId) {
  if (!landingThemeActions) {
    log(LOG_LEVEL_WARN, 'Landing theme actions container not found.');
    return;
  }
  landingThemeActions.innerHTML = '';
  landingThemeActions.style.flexDirection = 'column';
  landingThemeActions.style.gap = 'var(--spacing-sm)';
  const themeConfig = themeService.getThemeConfig(themeId);
  const themeManifestEntry = THEMES_MANIFEST.find(t => t.id === themeId);
  if (!themeConfig || !themeManifestEntry) {
    log(LOG_LEVEL_ERROR, `Cannot render landing actions: Config or manifest entry missing for ${themeId}.`);
    return;
  }
  const isThemePlayed = getPlayingThemes().includes(themeId);
  const currentUser = getCurrentUser();
  const progressData = getLandingSelectedThemeProgress();
  // Continue & Character Progress Buttons
  if (isThemePlayed && themeManifestEntry.playable) {
    const topActionRow = document.createElement('div');
    topActionRow.className = 'landing-actions-row';
    const continueButton = document.createElement('button');
    continueButton.id = 'continue-theme-button';
    continueButton.classList.add('ui-button', 'primary');
    continueButton.style.flexGrow = '1';
    continueButton.textContent = getUIText('button_continue_game', {}, { explicitThemeContext: themeId, viewContext: 'landing' });
    continueButton.addEventListener('click', () => _gameControllerRef?.changeActiveTheme(themeId, false));
    topActionRow.appendChild(continueButton);
    const characterProgressButton = document.createElement('button');
    characterProgressButton.id = 'character-progress-button';
    characterProgressButton.classList.add('ui-button', 'icon-button', 'character-progress-button');
    const hasProgress = currentUser && progressData && (progressData.currentXP > 0 || progressData.level > 1 || progressData.acquiredTraitKeys?.length > 0);
    const progressIconSrc = hasProgress ? 'images/app/icon_character.svg' : 'images/app/icon_character.svg';
    const progressTooltipKey = 'tooltip_character_progress';
    const progressAltText = getUIText(progressTooltipKey, {}, { viewContext: 'landing' });
    characterProgressButton.innerHTML = `<img src="${progressIconSrc}" alt="${progressAltText}" class="character-icon">`;
    characterProgressButton.setAttribute('aria-label', progressAltText);
    attachTooltip(characterProgressButton, progressTooltipKey, {}, { viewContext: 'landing' });
    if (currentUser && progressData) {
      characterProgressButton.disabled = false;
      characterProgressButton.addEventListener('click', () => _gameControllerRef?.showCharacterProgressModal(themeId));
    } else {
      characterProgressButton.disabled = true;
      characterProgressButton.classList.add('disabled');
    }
    topActionRow.appendChild(characterProgressButton);
    landingThemeActions.appendChild(topActionRow);
  }
  // New Game, Like, Store, Shards Buttons
  const standardActionsRow = document.createElement('div');
  standardActionsRow.className = 'landing-actions-row';
  const newGameButton = document.createElement('button');
  newGameButton.id = 'choose-theme-button';
  newGameButton.classList.add('ui-button');
  if (!isThemePlayed) newGameButton.classList.add('primary');
  const isLockedForAnon = !currentUser && themeManifestEntry.lockedForAnonymous;
  if (themeManifestEntry.playable) {
    if (isLockedForAnon) {
      newGameButton.textContent = getUIText('button_login_to_play', {}, { viewContext: 'global' });
      newGameButton.addEventListener('click', () => showLoginModal());
      attachTooltip(newGameButton, 'tooltip_theme_locked_anon', {}, { viewContext: 'global' });
    } else {
      const newGameButtonTextKey = themeConfig.new_game_button_text_key || 'landing_choose_theme_button';
      newGameButton.textContent = getUIText(newGameButtonTextKey, {}, { explicitThemeContext: themeId, viewContext: 'landing' });
      newGameButton.addEventListener('click', () => _gameControllerRef?.initiateNewGameSessionFlow(themeId));
    }
  } else {
    newGameButton.textContent = getUIText('coming_soon_button', {}, { viewContext: 'landing' });
    newGameButton.disabled = true;
    newGameButton.classList.add('disabled');
  }
  standardActionsRow.appendChild(newGameButton);
  if (_userThemeControlsManagerRef) {
    const likeButton = document.createElement('button');
    likeButton.id = 'like-theme-button';
    likeButton.classList.add('ui-button', 'icon-button', 'like-theme-button');
    if (themeManifestEntry.playable && currentUser) {
      const isLiked = getLikedThemes().includes(themeId);
      likeButton.innerHTML = `<img src="images/app/icon_heart${isLiked ? '_filled' : ''}.svg" alt="" class="like-icon">`;
      const likeAltTextKey = isLiked ? 'aria_label_unlike_theme' : 'aria_label_like_theme';
      likeButton.setAttribute('aria-label', getUIText(likeAltTextKey, {}, { viewContext: 'landing' }));
      attachTooltip(likeButton, likeAltTextKey, {}, { viewContext: 'landing' });
      if (isLiked) likeButton.classList.add('liked');
      likeButton.addEventListener('click', () => _userThemeControlsManagerRef.handleLikeThemeOnLandingClick(themeId));
    } else {
      likeButton.innerHTML = `<img src="images/app/icon_heart.svg" alt="" class="like-icon">`;
      const tooltipKey = !currentUser ? 'tooltip_like_locked_anon' : 'coming_soon_button';
      const ariaLabelText = getUIText(tooltipKey, {}, { viewContext: 'landing' });
      likeButton.setAttribute('aria-label', ariaLabelText);
      attachTooltip(likeButton, tooltipKey, {}, { viewContext: 'landing' });
      likeButton.disabled = true;
      likeButton.classList.add('disabled');
    }
    standardActionsRow.appendChild(likeButton);
  }
  const storeButton = document.createElement('button');
  storeButton.id = 'store-button';
  storeButton.classList.add('ui-button', 'icon-button', 'store-button');
  const canAccessStore = currentUser && progressData && progressData.level >= MIN_LEVEL_FOR_STORE;
  let storeTooltipKey;
  if (!currentUser) {
    storeTooltipKey = 'tooltip_store_locked_anon';
  } else {
    storeTooltipKey = canAccessStore ? 'tooltip_store_button' : 'tooltip_store_locked_level';
  }
  const storeAltText = getUIText(storeTooltipKey, { MIN_LEVEL: MIN_LEVEL_FOR_STORE }, { viewContext: 'landing' });
  storeButton.innerHTML = `<img src="images/app/icon_store.svg" alt="${storeAltText}" class="store-icon">`;
  storeButton.setAttribute('aria-label', storeAltText);
  attachTooltip(storeButton, storeTooltipKey, { MIN_LEVEL: MIN_LEVEL_FOR_STORE }, { viewContext: 'landing' });
  if (themeManifestEntry.playable && canAccessStore && _gameControllerRef?.showStoreModal) {
    storeButton.addEventListener('click', () => _gameControllerRef.showStoreModal(themeId));
  } else {
    storeButton.disabled = true;
    storeButton.classList.add('disabled');
  }
  standardActionsRow.appendChild(storeButton);
  const themeStatus = getShapedThemeData().get(themeId);
  const userTier = currentUser?.tier || 'free';
  const isPremium = userTier === 'pro' || userTier === 'ultra';
  const configureShardsButton = document.createElement('button');
  configureShardsButton.id = 'configure-shards-icon-button';
  configureShardsButton.classList.add('ui-button', 'icon-button', 'configure-shards-button');
  const canConfigureShards = currentUser && isPremium && themeStatus?.hasShards;
  let shardTooltipKey;
  if (!currentUser) {
    shardTooltipKey = 'tooltip_shards_locked_anon';
  } else if (!isPremium) {
    shardTooltipKey = 'tooltip_shards_locked_free';
  } else {
    shardTooltipKey = canConfigureShards ? 'tooltip_configure_fragments' : 'tooltip_no_fragments_to_configure';
  }
  const shardAltText = getUIText(shardTooltipKey, {}, { viewContext: 'global' });
  configureShardsButton.innerHTML = `<img src="images/app/icon_world_shard.svg" alt="${shardAltText}" class="shard-icon">`;
  configureShardsButton.setAttribute('aria-label', shardAltText);
  attachTooltip(configureShardsButton, shardTooltipKey, {}, { viewContext: 'global' });
  if (themeManifestEntry.playable && canConfigureShards && _gameControllerRef?.showConfigureShardsModal) {
    configureShardsButton.addEventListener('click', () => _gameControllerRef.showConfigureShardsModal(themeId));
  } else {
    configureShardsButton.disabled = true;
    configureShardsButton.classList.add('disabled');
  }
  standardActionsRow.appendChild(configureShardsButton);
  landingThemeActions.appendChild(standardActionsRow);
}

// --- EVENT HANDLERS ---

/**
 * Handles the selection of a theme from the grid.
 * Updates the "active" state in the grid and refreshes the side panel content.
 * @param {string} themeId - The ID of the selected theme.
 * @param {boolean} [animatePanel=true] - Whether to animate panel expansion.
 */
export async function handleThemeGridSelection(themeId, animatePanel = true) {
  setCurrentLandingGridSelection(themeId);
  await _prepareDataForLandingThemeSelection(themeId);

  if (themeGridContainer) {
    themeGridContainer.querySelectorAll('.theme-grid-icon.active').forEach(btn => btn.classList.remove('active'));
    const clickedBtn = themeGridContainer.querySelector(`.theme-grid-icon[data-theme="${themeId}"]`);
    if (clickedBtn) {
      clickedBtn.classList.add('active');
    }
  }

  updateLandingPagePanelsWithThemeInfo(themeId, animatePanel);
  log(LOG_LEVEL_INFO, `Theme selected on landing page: ${themeId}`);
}

/**
 * Gets the currently selected theme ID on the landing page grid.
 * @returns {string|null} The theme ID or null if no selection.
 */
export function getCurrentLandingSelection() {
  return getCurrentLandingGridSelection();
}
