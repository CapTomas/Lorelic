/**
 * @file Manages the central, in-memory application state.
 * Provides explicit getter and setter functions for all state variables,
 * ensuring controlled and predictable state management. Also handles
 * persistence of user preferences and session data to localStorage.
 */

import { getThemeConfig } from '../services/themeService.js';
import {
  CURRENT_THEME_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  FREE_MODEL_NAME,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
  LANDING_SELECTED_GRID_THEME_KEY,
  MODEL_PREFERENCE_STORAGE_KEY,
  NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY,
} from './config.js';

// --- Module State ---

// Core Application State
let _currentTheme = localStorage.getItem(CURRENT_THEME_STORAGE_KEY) || null;
let _currentAppLanguage = localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY) || DEFAULT_LANGUAGE;
let _currentNarrativeLanguage = localStorage.getItem(NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY) || _currentAppLanguage;
let _currentModelName = localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) || FREE_MODEL_NAME;

// User & Session State
let _currentUser = null; // Holds the authenticated user object, including the token.
let _currentUserApiUsage = null; // Holds { hourly: { count, limit }, daily: { count, limit } }
let _playingThemes = []; // Array of theme IDs the user is currently playing.
let _likedThemes = []; // Array of theme IDs the user has liked.
let _shapedThemeData = new Map(); // Map<themeId, { hasShards: boolean, activeShardCount: number }>

// Active Game Session State
let _gameHistory = [];
let _unsavedHistoryDelta = [];
let _playerIdentifier = '';
let _currentPromptType = 'initial';
let _lastKnownDashboardUpdates = {};
let _lastKnownGameStateIndicators = {};
let _lastKnownCumulativePlayerSummary = '';
let _lastKnownEvolvedWorldLore = '';
let _isInitialGameLoad = true;
let _isRunActive = true;
let _isInitialTraitSelectionPending = false;
let _isBoonSelectionPending = false;
let _currentTurnUnlockData = null; // Data for a world shard unlocked in the current turn.
let _currentUserThemeProgress = null;
let _currentRunStats = {
  currentIntegrity: 0,
  currentWillpower: 0,
  strainLevel: 1,
  conditions: [],
};
let _currentInventory = [];
let _equippedItems = {};

// UI & View State
let _currentPanelStates = {};
let _currentSuggestedActions = [];
let _lastAiSuggestedActions = null; // Actions available before a special state (like boon selection).
let _currentAiPlaceholder = '';
let _currentLandingGridSelection = localStorage.getItem(LANDING_SELECTED_GRID_THEME_KEY) || null;
let _landingSelectedThemeProgress = null; // Progress for the theme selected on the landing page.
let _landingSelectedThemeEvolvedLore = null; // Evolved lore for the theme selected on the landing page.
let _dashboardItemMeta = {}; // UI-specific metadata for dashboard items (e.g., { hasRecentUpdate: true }).
let _currentNewGameSettings = null; // Stores settings for a new game (e.g., { useEvolvedWorld: boolean }).

// --- Getters & Setters ---

// --- Core Application State Management ---

/** @returns {string | null} The ID of the currently active theme, or null. */
export const getCurrentTheme = () => _currentTheme;
export const setCurrentTheme = (themeId) => {
  _currentTheme = themeId;
  if (themeId) {
    localStorage.setItem(CURRENT_THEME_STORAGE_KEY, themeId);
  } else {
    localStorage.removeItem(CURRENT_THEME_STORAGE_KEY);
  }
};

/** @returns {string} The current application language code (e.g., 'en', 'cs'). */
export const getCurrentAppLanguage = () => _currentAppLanguage;
export const setCurrentAppLanguage = (lang) => {
  _currentAppLanguage = lang;
  localStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, lang);
};

/** @returns {string} The current narrative language code. */
export const getCurrentNarrativeLanguage = () => _currentNarrativeLanguage;
export const setCurrentNarrativeLanguage = (lang) => {
  _currentNarrativeLanguage = lang;
  localStorage.setItem(NARRATIVE_LANGUAGE_PREFERENCE_STORAGE_KEY, lang);
};

/** @returns {string} The name of the currently selected AI model. */
export const getCurrentModelName = () => _currentModelName;
export const setCurrentModelName = (modelName) => {
  _currentModelName = modelName;
  localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, modelName);
};

// --- User & Session Management ---

/** @returns {object | null} The current user object, including JWT token. */
export const getCurrentUser = () => _currentUser;
export const setCurrentUser = (user) => {
  _currentUser = user;
  if (user && user.api_usage) {
    setCurrentUserApiUsage(user.api_usage);
  } else if (!user) {
    // If logging out or user object doesn't have usage data, clear it.
    setCurrentUserApiUsage(null);
  }
};

/** @returns {string[]} An array of theme IDs the user is currently playing. */
export const getPlayingThemes = () => _playingThemes;
export const setPlayingThemes = (themes) => {
  _playingThemes = Array.isArray(themes) ? themes : [];
};

/** @returns {string[]} An array of theme IDs the user has liked. */
export const getLikedThemes = () => _likedThemes;
export const setLikedThemes = (themes) => {
  _likedThemes = Array.isArray(themes) ? themes : [];
};

/** @returns {Map<string, {hasShards: boolean, activeShardCount: number}>} A map of themes with unlocked World Shards. */
export const getShapedThemeData = () => _shapedThemeData;
export const setShapedThemeData = (data) => {
  _shapedThemeData = data instanceof Map ? data : new Map();
};

// --- Active Game State Management ---

/** @returns {object | null} The current user's API usage stats. */
export const getCurrentUserApiUsage = () => _currentUserApiUsage;
export const setCurrentUserApiUsage = (usage) => {
  _currentUserApiUsage = usage;
};


/** @returns {object[]} The full game history for the current session. */
export const getGameHistory = () => _gameHistory;
export const setGameHistory = (history) => {
  _gameHistory = Array.isArray(history) ? history : [];
  _unsavedHistoryDelta = []; // Reset delta when history is explicitly set.
};

/**
 * Adds a turn to both the full history and the unsaved delta.
 * @param {object} turn - The turn object to add.
 */
export const addTurnToGameHistory = (turn) => {
  _gameHistory.push(turn);
  _unsavedHistoryDelta.push(turn);
};

/** Clears the entire game history and unsaved delta. */
export const clearGameHistory = () => {
  _gameHistory = [];
  _unsavedHistoryDelta = [];
};

/** @returns {object[]} The array of turns not yet saved to the backend. */
export const getUnsavedHistoryDelta = () => _unsavedHistoryDelta;
export const clearUnsavedHistoryDelta = () => {
  _unsavedHistoryDelta = [];
};

/** @returns {string} The current player's chosen identifier (name/handle). */
export const getPlayerIdentifier = () => _playerIdentifier;
export const setPlayerIdentifier = (identifier) => {
  _playerIdentifier = identifier;
};

/** @returns {string} The type of prompt currently active (e.g., 'default', 'combat_active'). */
export const getCurrentPromptType = () => _currentPromptType;
export const setCurrentPromptType = (type) => {
  _currentPromptType = type;
};

/** @returns {object} The last known set of dashboard updates from the AI. */
export const getLastKnownDashboardUpdates = () => _lastKnownDashboardUpdates;
export const setLastKnownDashboardUpdates = (updates) => {
  _lastKnownDashboardUpdates = typeof updates === 'object' && updates !== null ? { ..._lastKnownDashboardUpdates, ...updates } : {};
};

/** @returns {object} The last known set of game state indicators from the AI. */
export const getLastKnownGameStateIndicators = () => _lastKnownGameStateIndicators;
export const setLastKnownGameStateIndicators = (indicators) => {
  _lastKnownGameStateIndicators = typeof indicators === 'object' && indicators !== null ? indicators : {};
};

/** @returns {string} The last known cumulative summary of the player's story. */
export const getLastKnownCumulativePlayerSummary = () => _lastKnownCumulativePlayerSummary;
export const setLastKnownCumulativePlayerSummary = (summary) => {
  _lastKnownCumulativePlayerSummary = summary || '';
};

/** @returns {string} The last known evolved lore for the current world. */
export const getLastKnownEvolvedWorldLore = () => _lastKnownEvolvedWorldLore;
export const setLastKnownEvolvedWorldLore = (lore) => {
  _lastKnownEvolvedWorldLore = lore || '';
};

/** @returns {boolean} True if the current turn is the very first turn of a new game. */
export const getIsInitialGameLoad = () => _isInitialGameLoad;
export const setIsInitialGameLoad = (isInitial) => {
  _isInitialGameLoad = !!isInitial;
};

/** @returns {boolean} True if a game run is currently active (not in a defeat state). */
export const getIsRunActive = () => _isRunActive;
export const setIsRunActive = (isActive) => {
  _isRunActive = !!isActive;
}

/** @returns {boolean} True if the game is awaiting the player's initial trait selection. */
export const getIsInitialTraitSelectionPending = () => _isInitialTraitSelectionPending;
export const setIsInitialTraitSelectionPending = (isPending) => {
  _isInitialTraitSelectionPending = !!isPending;
};

/** @returns {boolean} True if the game is awaiting the player to select a level-up boon. */
export const getIsBoonSelectionPending = () => _isBoonSelectionPending;
export const setIsBoonSelectionPending = (isPending) => {
  _isBoonSelectionPending = !!isPending;
};

/** @returns {object | null} Data for a World Shard unlocked in the most recent turn. */
export const getCurrentTurnUnlockData = () => _currentTurnUnlockData;
export const setCurrentTurnUnlockData = (data) => {
  _currentTurnUnlockData = data;
};

/** @returns {object} The persistent progress for the current theme (level, XP, traits, etc.). */
export const getCurrentUserThemeProgress = () => _currentUserThemeProgress;
export const setCurrentUserThemeProgress = (progress) => {
  _currentUserThemeProgress = progress;
};

/** @returns {object} The ephemeral stats for the current game run (integrity, willpower, etc.). */
export const getCurrentRunStats = () => _currentRunStats;
export const setCurrentRunStats = (stats) => {
  _currentRunStats = { ..._currentRunStats, ...stats };
};
export const updateCurrentRunStat = (statName, value) => {
  _currentRunStats[statName] = value;
};

/** @returns {object[]} The character's current inventory (backpack). */
export const getCurrentInventory = () => _currentInventory;
export const setCurrentInventory = (inventory) => {
  _currentInventory = Array.isArray(inventory) ? inventory : [];
};

/** @returns {object} An object mapping equipment slots to equipped item objects. */
export const getEquippedItems = () => _equippedItems;
export const setEquippedItems = (items) => {
  _equippedItems = typeof items === 'object' && items !== null && !Array.isArray(items) ? items : {};
};

// --- Player Progression Calculated Getters ---

/** @returns {number} The character's current level. */
export const getPlayerLevel = () => _currentUserThemeProgress?.level || 1;

/** @returns {number} The character's maximum Integrity, including bonuses. */
export const getEffectiveMaxIntegrity = () => (_currentUserThemeProgress?.maxIntegrityBonus || 0) + (getThemeConfig(getCurrentTheme())?.base_attributes?.integrity || 100);

/** @returns {number} The character's maximum Willpower, including bonuses. */
export const getEffectiveMaxWillpower = () => (_currentUserThemeProgress?.maxWillpowerBonus || 0) + (getThemeConfig(getCurrentTheme())?.base_attributes?.willpower || 50);

/** @returns {number} The character's Aptitude score, including bonuses. */
export const getEffectiveAptitude = () => (_currentUserThemeProgress?.aptitudeBonus || 0) + (getThemeConfig(getCurrentTheme())?.base_attributes?.aptitude || 10);

/** @returns {number} The character's Resilience score, including bonuses. */
export const getEffectiveResilience = () => (_currentUserThemeProgress?.resilienceBonus || 0) + (getThemeConfig(getCurrentTheme())?.base_attributes?.resilience || 10);

/** @returns {string[]} An array of keys for all acquired traits. */
export const getAcquiredTraitKeys = () => (Array.isArray(_currentUserThemeProgress?.acquiredTraitKeys) ? _currentUserThemeProgress.acquiredTraitKeys : []);

/** @returns {number} The character's current strain level. */
export const getCurrentStrainLevel = () => _currentRunStats.strainLevel || 1;

/** @returns {string[]} An array of active condition strings. */
export const getActiveConditions = () => _currentRunStats.conditions || [];

// --- UI & View State Management ---

/** @returns {object} An object storing the expansion state of dashboard panels. */
export const getCurrentPanelStates = () => _currentPanelStates;
export const setCurrentPanelStates = (states) => {
  _currentPanelStates = typeof states === 'object' && states !== null ? states : {};
};
export const getPanelState = (panelId) => _currentPanelStates[panelId];
export const setPanelState = (panelId, isExpanded) => {
  _currentPanelStates[panelId] = isExpanded;
};

/** @returns {object[]} An array of suggested action strings or objects. */
export const getCurrentSuggestedActions = () => _currentSuggestedActions;
export const setCurrentSuggestedActions = (actions) => {
  _currentSuggestedActions = Array.isArray(actions) ? actions : [];
};

/** @returns {object[] | null} The last set of suggested actions before a special state was entered. */
export const getLastAiSuggestedActions = () => _lastAiSuggestedActions;
export const setLastAiSuggestedActions = (actions) => {
  _lastAiSuggestedActions = Array.isArray(actions) ? actions : null;
};
export const clearLastAiSuggestedActions = () => {
  _lastAiSuggestedActions = null;
};

/** @returns {string} The current placeholder text for the player input area. */
export const getCurrentAiPlaceholder = () => _currentAiPlaceholder;
export const setCurrentAiPlaceholder = (placeholderText) => {
  _currentAiPlaceholder = placeholderText || '';
};

/** @returns {string | null} The ID of the theme currently selected in the landing page grid. */
export const getCurrentLandingGridSelection = () => _currentLandingGridSelection;
export const setCurrentLandingGridSelection = (themeId) => {
  _currentLandingGridSelection = themeId;
  if (themeId) {
    localStorage.setItem(LANDING_SELECTED_GRID_THEME_KEY, themeId);
  } else {
    localStorage.removeItem(LANDING_SELECTED_GRID_THEME_KEY);
  }
};

/** @returns {object | null} The progress object for the theme selected on the landing page. */
export const getLandingSelectedThemeProgress = () => _landingSelectedThemeProgress;
export const setLandingSelectedThemeProgress = (progress) => {
  _landingSelectedThemeProgress = progress;
};

/** @returns {string | null} The evolved lore for the theme selected on the landing page. */
export const getLandingSelectedThemeEvolvedLore = () => _landingSelectedThemeEvolvedLore;
export const setLandingSelectedThemeEvolvedLore = (lore) => {
    _landingSelectedThemeEvolvedLore = lore;
};

/** @returns {object} An object containing UI metadata for dashboard items (e.g., update dots). */
export const getDashboardItemMeta = () => _dashboardItemMeta;
export const setDashboardItemMeta = (meta) => {
  _dashboardItemMeta = typeof meta === 'object' && meta !== null ? meta : {};
};
export const updateDashboardItemMetaEntry = (itemId, itemMeta) => {
  if (typeof itemMeta === 'object' && itemMeta !== null) {
    _dashboardItemMeta[itemId] = { ..._dashboardItemMeta[itemId], ...itemMeta };
  } else if (itemMeta === null) {
    delete _dashboardItemMeta[itemId];
  }
};
export const clearDashboardItemMeta = () => {
  _dashboardItemMeta = {};
};
export const resetAllDashboardItemRecentUpdates = () => {
  for (const itemId in _dashboardItemMeta) {
    if (Object.prototype.hasOwnProperty.call(_dashboardItemMeta, itemId) && _dashboardItemMeta[itemId]) {
      _dashboardItemMeta[itemId].hasRecentUpdate = false;
    }
  }
};

/** @returns {object | null} Settings for a new game being initiated (e.g., world type). */
export const getCurrentNewGameSettings = () => _currentNewGameSettings;
export const setCurrentNewGameSettings = (settings) => {
  _currentNewGameSettings = settings;
};
export const clearCurrentNewGameSettings = () => {
  _currentNewGameSettings = null;
};

// --- State Reset ---

/**
 * Clears all non-persistent game-specific state variables.
 * User preferences and authentication state are preserved.
 */
export const clearVolatileGameState = () => {
  _gameHistory = [];
  _unsavedHistoryDelta = [];
  _playerIdentifier = '';
  _currentPromptType = 'initial';
  _lastKnownDashboardUpdates = {};
  _lastKnownGameStateIndicators = {};
  _currentSuggestedActions = [];
  _isInitialGameLoad = true;
  _currentAiPlaceholder = '';
  _currentTurnUnlockData = null;
  _currentPanelStates = {};
  _lastKnownCumulativePlayerSummary = '';
  _lastKnownEvolvedWorldLore = '';
  _lastAiSuggestedActions = null;
  _currentUserThemeProgress = null;
  _currentRunStats = {
    currentIntegrity: 0,
    currentWillpower: 0,
    strainLevel: 1,
    conditions: [],
  };
  _isBoonSelectionPending = false;
  _isInitialTraitSelectionPending = false;
  _currentInventory = [];
  _equippedItems = {};
  _dashboardItemMeta = {};
  _landingSelectedThemeProgress = null;
  _landingSelectedThemeEvolvedLore = null;
  clearCurrentNewGameSettings();
};
