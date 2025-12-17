/**
 * @file Exports references to all frequently used DOM elements.
 * This centralization ensures that DOM queries are managed efficiently
 * and consistently across all UI modules.
 */

// --- Root & Main Layout ---
export const appRoot = document.getElementById("app-root");
export const mainLayout = document.getElementById("main-layout");
export const leftPanel = document.getElementById("left-panel");
export const rightPanel = document.getElementById("right-panel");

// --- Header Elements ---
export const applicationHeader = document.getElementById("application-header");
export const applicationLogo = document.getElementById("application-logo");
export const themeSelector = document.getElementById("theme-selector");
export const playingThemesContainer = document.getElementById("playing-themes-container");
export const likedThemesSeparator = document.getElementById("liked-themes-separator");
export const likedThemesContainer = document.getElementById("liked-themes-container");
export const systemStatusIndicator = document.getElementById("system-status-indicator");
export const gmSpecificActivityIndicator = document.getElementById("gm-activity-indicator");
export const userProfileButton = document.getElementById("user-profile-button");
export const loginButton = document.getElementById("login-button");
export const newGameButton = document.getElementById("new-game-button");
export const modelToggleButton = document.getElementById("model-toggle-button");
export const languageToggleButton = document.getElementById("language-toggle-button");

// --- Side Panel Scroll Indicators ---
export const leftPanelScrollIndicatorUp = document.getElementById("left-panel-scroll-indicator-up");
export const leftPanelScrollIndicatorDown = document.getElementById("left-panel-scroll-indicator-down");
export const rightPanelScrollIndicatorUp = document.getElementById("right-panel-scroll-indicator-up");
export const rightPanelScrollIndicatorDown = document.getElementById("right-panel-scroll-indicator-down");

// --- Center Column & Views ---
export const centerColumn = document.getElementById("center-column");

// Landing page specific containers
export const themeGridContainer = document.getElementById("theme-grid-container");
export const landingThemeDescriptionContainer = document.getElementById("landing-theme-description-container");
export const landingThemeLoreText = document.getElementById("landing-theme-lore-text");
export const landingThemeDetailsContainer = document.getElementById("landing-theme-details-container");
export const landingThemeInfoContent = document.getElementById("landing-theme-info-content");
export const landingThemeActions = document.getElementById("landing-theme-actions");

// Game view specific elements
export const storyLogViewport = document.getElementById("story-log-viewport");
export const storyLog = document.getElementById("story-log");
export const suggestedActionsWrapper = document.getElementById("suggested-actions-wrapper");

// --- Player Input Area ---
export const playerInputControlPanel = document.getElementById("player-input-control-panel");
export const nameInputSection = document.getElementById("name-input-section");
export const playerIdentifierInput = document.getElementById("player-identifier-input");
export const startGameButton = document.getElementById("start-game-button");
export const actionInputSection = document.getElementById("action-input-section");
export const playerActionInput = document.getElementById("player-action-input");
export const sendActionButton = document.getElementById("send-action-button");
export const playerActionCharCounter = document.getElementById("player-action-char-counter");
export const forceRollToggleButton = document.getElementById("force-roll-toggle-button");

// --- Modals ---
export const customModalOverlay = document.getElementById("custom-modal-overlay");
export const customModal = document.getElementById("custom-modal");
export const customModalTitle = document.getElementById("custom-modal-title");
export const customModalMessage = document.getElementById("custom-modal-message");
export const customModalInputContainer = document.getElementById("custom-modal-input-container");
export const customModalInput = document.getElementById("custom-modal-input");
export const customModalActions = document.getElementById("custom-modal-actions");

// --- Character Progression Panel ---
export const characterProgressionPanel = document.getElementById("character-progression-panel");
export const charPanelIdentifier = document.getElementById("char-panel-identifier");
export const charPanelLevel = document.getElementById("char-panel-level");
export const charPanelIntegrityMeter = document.getElementById("char-panel-integrity-meter");
export const charPanelIntegrityValue = document.getElementById("char-panel-integrity-value");
export const charPanelWillpowerMeter = document.getElementById("char-panel-willpower-meter");
export const charPanelWillpowerValue = document.getElementById("char-panel-willpower-value");
export const charPanelAptitudeValue = document.getElementById("char-panel-aptitude-value");
export const charPanelResilienceValue = document.getElementById("char-panel-resilience-value");

// --- XP Bar ---
export const xpBarContainer = document.getElementById("xp-bar-container");
export const xpBarFill = document.getElementById("xp-bar-fill");
export const xpBarText = document.getElementById("xp-bar-text");

// --- Footer ---
export const applicationFooter = document.getElementById("application-footer");
