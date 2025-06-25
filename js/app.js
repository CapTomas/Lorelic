/**
 * @file Main application entry point. Initializes core services, loads essential data,
 * checks authentication status, sets up global event listeners, and kicks off
 * the initial UI rendering (either landing page or resuming a game).
 */

// --- Core ---
import * as state from './core/state.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG, setLogLevel as setCoreLogLevel } from './core/logger.js';
import { LOG_LEVEL_STORAGE_KEY, DEFAULT_LANGUAGE } from './core/config.js';

// --- Services ---
import * as themeService from './services/themeService.js';
import * as localizationService from './services/localizationService.js';
import * as authService from './services/authService.js';

// --- UI Management ---
import * as dom from './ui/domElements.js';
import * as uiUtils from './ui/uiUtils.js';
import * as storyLogManager from './ui/storyLogManager.js';
import * as modalManager from './ui/modalManager.js';
import * as landingPageManager from './ui/landingPageManager.js';
import * as userThemeControlsManager from './ui/userThemeControlsManager.js';
import * as authUiManager from './ui/authUiManager.js';
import * as modelToggleManager from './ui/modelToggleManager.js';
import * as languageManager from './ui/languageManager.js';
import * as suggestedActionsManager from './ui/suggestedActionsManager.js';
import * as dashboardManager from './ui/dashboardManager.js';
import * as characterPanelManager from './ui/characterPanelManager.js';
import * as worldShardsModalManager from './ui/worldShardsModalManager.js';
import * as billingManager from './ui/billingManager.js';
import * as tooltipManager from './ui/tooltipManager.js';

// --- Game Orchestration ---
import * as gameController from './game/gameController.js';

// --- Global Debug Utility ---
window.setLogLevel = setCoreLogLevel;

/**
 * Handles URL changes or initial application load to determine view.
 * This function is responsible for routing to auth pages, resuming games,
 * or displaying the default landing view.
 * @private
 */
async function _handleUrlChangeOrInitialLoad() {
  log(LOG_LEVEL_INFO, 'Handling URL change or initial load.');
  const currentPath = window.location.pathname;
  const urlParams = new URLSearchParams(window.location.search);
  const actionParam = urlParams.get('action');
  const tokenParam = urlParams.get('token');
  const statusParam = urlParams.get('status');
  const paymentStatus = urlParams.get('payment_status');

  // Handle special auth-related pages first
  if (currentPath.endsWith('/email-confirmation-status') && statusParam) {
    log(LOG_LEVEL_DEBUG, `Displaying email confirmation status: ${statusParam}`);
    authUiManager.displayEmailConfirmationStatusPage(statusParam);
    history.replaceState(null, '', '/');
    return;
  }
  if (paymentStatus === 'success') {
    const tier = urlParams.get('tier');
    const sessionId = urlParams.get('session_id');
    if (tier && sessionId) {
      history.replaceState(null, '', '/'); // Clean URL first
      log(LOG_LEVEL_DEBUG, `Handling successful payment redirect for tier '${tier}'.`);
      billingManager.handleSuccessfulUpgrade(tier, sessionId);
    }
    // Don't return yet, let it fall through to landing page
  }

  if (currentPath.endsWith('/reset-password') && tokenParam) {
    log(LOG_LEVEL_DEBUG, `Displaying password reset page for token: ${tokenParam.substring(0, 10)}...`);
    authUiManager.displayPasswordResetPage(tokenParam, authService.handleResetPassword);
    return;
  }

  // Handle 'showLogin' action from URL
  if (actionParam === 'showLogin') {
    if (!state.getCurrentUser()) {
      log(LOG_LEVEL_INFO, "Action 'showLogin' detected. Opening login modal.");
      authUiManager.showLoginModal();
    } else {
      log(LOG_LEVEL_INFO, "Action 'showLogin' detected, but user is already logged in.");
    }
    history.replaceState(null, '', window.location.pathname);
    if (!state.getCurrentTheme()) {
      await gameController.switchToLanding();
    }
    return;
  }

  // Attempt to resume an existing game session
  const themeToResume = state.getCurrentTheme();
  const playingThemes = state.getPlayingThemes();
  if (themeToResume && playingThemes.includes(themeToResume)) {
    log(LOG_LEVEL_INFO, `Attempting to resume game for theme: ${themeToResume}`);
    const dataLoaded = await themeService.ensureThemeDataLoaded(themeToResume);
    if (dataLoaded) {
      await themeService.getAllPromptsForTheme(themeToResume);
      await gameController.resumeGameSession(themeToResume);
    } else {
      log(LOG_LEVEL_ERROR, `Failed to load data for theme ${themeToResume}. Switching to landing page.`);
      await gameController.switchToLanding();
    }
  } else {
    // Default to landing page if no other action is taken
    log(LOG_LEVEL_INFO, 'No specific action or game to resume. Switching to landing page.');
    await gameController.switchToLanding();
  }
}

/**
 * Main application initialization function. Orchestrates the startup sequence.
 * @private
 */
async function _initializeApp() {
  log(LOG_LEVEL_INFO, 'Lorelic Application initializing...');
  // 1. Set logger level from localStorage or default
  const storedLogLevel = localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
  setCoreLogLevel(storedLogLevel || (DEFAULT_LANGUAGE === 'cs' ? 'debug' : 'info'));
  // 2. Check for critical DOM elements
  if (!dom.appRoot || !dom.leftPanel || !dom.rightPanel || !dom.themeGridContainer || !dom.storyLogViewport) {
    log(LOG_LEVEL_ERROR, 'Critical DOM elements missing. Application cannot start.');
    if (dom.appRoot) {
      dom.appRoot.innerHTML = "<p style='color:red;text-align:center;padding:20px;'>Critical Error: Application UI cannot be initialized. Please check console.</p>";
    }
    return;
  }
  // 3. Initialize services and UI managers with their dependencies
  const initialThemeDataLoaded = await themeService.loadInitialThemeManifestData();
  if (!initialThemeDataLoaded) {
    log(LOG_LEVEL_ERROR, 'Failed to load essential theme manifest data. Application might be unstable.');
    modalManager.showCustomModal({
      type: 'alert',
      titleKey: 'alert_title_error',
      messageKey: 'error_initial_theme_data_load_failed',
    });
  }
  gameController.initGameController({ userThemeControlsManager });
  landingPageManager.initLandingPageManager(gameController, userThemeControlsManager);
  userThemeControlsManager.initUserThemeControlsManager(gameController, landingPageManager);
  languageManager.initLanguageManager({ storyLogManager, landingPageManager, dashboardManager });
  authUiManager.initAuthUiManager({ authService, modalManager, gameController, userThemeControlsManager, landingPageManager, languageManager, billingManager });
  worldShardsModalManager.initWorldShardsModalManager({ landingPageManager });
  billingManager.initBillingManager({ authUiManager, landingPageManager });
  characterPanelManager.initCharacterPanelManager({ landingPageManager, userThemeControlsManager, gameController });
  suggestedActionsManager.initSuggestedActionsManager({ gameController });
  modelToggleManager.initModelToggleManager({ storyLogManager });
  storyLogManager.initStoryLogScrollHandling();
  dashboardManager.initDashboardManagerScrollEvents();
  tooltipManager.initTooltipManager();
  log(LOG_LEVEL_INFO, 'All services and UI managers initialized.');
  // 4. Set up global event listeners
  if (dom.applicationLogo) dom.applicationLogo.addEventListener('click', () => gameController.switchToLanding());
  if (dom.languageToggleButton) dom.languageToggleButton.addEventListener('click', () => languageManager.handleLanguageToggle());
  if (dom.modelToggleButton) dom.modelToggleButton.addEventListener('click', () => modelToggleManager.handleModelToggle());
  if (dom.loginButton) dom.loginButton.addEventListener('click', () => authUiManager.showLoginModal());
  if (dom.userProfileButton) dom.userProfileButton.addEventListener('click', () => authUiManager.showUserProfileModal());
  if (dom.newGameButton) {
    dom.newGameButton.addEventListener('click', async () => {
      const currentThemeId = state.getCurrentTheme() || state.getCurrentLandingGridSelection();
      if (currentThemeId) {
        await gameController.initiateNewGameSessionFlow(currentThemeId);
      } else {
        log(LOG_LEVEL_WARN, 'New Game button clicked but no theme is selected.');
        modalManager.showCustomModal({ type: 'alert', titleKey: 'alert_title_notice', messageKey: 'alert_select_theme_first' });
      }
    });
  }
  if (dom.startGameButton && dom.playerIdentifierInput) {
    const submitName = () => gameController.handleIdentifierSubmission(dom.playerIdentifierInput.value);
    dom.startGameButton.addEventListener('click', submitName);
    dom.playerIdentifierInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitName(); });
  }
  if (dom.sendActionButton && dom.playerActionInput) {
    const submitAction = () => gameController.processPlayerAction(dom.playerActionInput.value);
    dom.sendActionButton.addEventListener('click', submitAction);
    dom.playerActionInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitAction();
      }
    });
    dom.playerActionInput.addEventListener('input', uiUtils.handlePlayerActionInput);
    // Add listener to clear selected suggested action if user types something else
    dom.playerActionInput.addEventListener('input', () => {
      const selectedAction = state.getSelectedSuggestedAction();
      if (selectedAction) {
        const actionText = (typeof selectedAction === 'object' && selectedAction.text) ? selectedAction.text : selectedAction;
        if (dom.playerActionInput.value !== actionText) {
          state.setSelectedSuggestedAction(null);
          log(LOG_LEVEL_DEBUG, 'Player input changed, detaching suggested action metadata.');
        }
      }
    });
    uiUtils.handlePlayerActionInput({ target: dom.playerActionInput });
  }
  if (dom.storyLog) {
      dom.storyLog.addEventListener('click', (e) => {
          if (e.target && e.target.id === 'login-from-warning') {
              e.preventDefault();
              authUiManager.showLoginModal();
          }
      });
    }
  window.addEventListener('popstate', async (event) => {
    log(LOG_LEVEL_INFO, 'Popstate event detected. Re-evaluating view.', event.state);
    await _handleUrlChangeOrInitialLoad();
  });
  log(LOG_LEVEL_INFO, 'Global event listeners set up.');
  // 5. Authentication, data fetching, and initial UI rendering
  await authService.checkAuthStatusOnLoad();
  authUiManager.updateAuthUIState();
  await userThemeControlsManager.loadUserThemeInteractions();
  await landingPageManager.fetchShapedWorldStatusAndUpdateGrid();
  await _handleUrlChangeOrInitialLoad();
  languageManager.applyGlobalUITranslations();
  log(LOG_LEVEL_INFO, 'Initial authentication, data fetch, and view rendering complete.');
  // Reveal the fully initialized application UI
  document.body.classList.remove('app-loading');
  log(LOG_LEVEL_DEBUG, 'Application initialized successfully. UI is now visible.');
}

// --- Start the application ---
document.addEventListener('DOMContentLoaded', _initializeApp);
