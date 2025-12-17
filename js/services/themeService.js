/**
 * @file Manages loading, caching, and accessing all theme-specific data
 * (configurations, UI texts, prompt files). This service is the single
 * source of truth for all theme-related assets.
 */

import { THEMES_MANIFEST } from '../data/themesManifest.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_ERROR, LOG_LEVEL_INFO, LOG_LEVEL_WARN } from '../core/logger.js';
import { DEFAULT_LANGUAGE } from '../core/config.js';

// --- Module-level Caches ---
const _ALL_THEMES_CONFIG = {};
const _themeTextData = {};
const _PROMPT_URLS_BY_THEME = {};
const _NARRATIVE_LANG_PROMPT_PARTS_BY_THEME = {};
const _gamePrompts = {};
const _themeTraits = {};
const _themeItemData = {};

// --- Private Helpers ---

/**
 * Fetches and parses a JSON file from a given path.
 * @private
 * @param {string} filePath - The path to the JSON file.
 * @returns {Promise<object|null>} The parsed JSON object or null on error.
 */
async function _fetchJSON(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      log(LOG_LEVEL_ERROR, `HTTP error ${response.status} fetching ${filePath}: ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Network error or parsing failed for JSON ${filePath}:`, error);
    return null;
  }
}

/**
 * Fetches a text file from a given path.
 * @private
 * @param {string} filePath - The path to the text file.
 * @returns {Promise<string|null>} The text content. Returns a special "not found" marker for 404s.
 */
async function _fetchText(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      // For optional helper prompts, a 404 is not a critical error.
      if (response.status === 404) {
        return `HELPER_FILE_NOT_FOUND:${filePath}`;
      }
      log(LOG_LEVEL_WARN, `Error fetching text file ${filePath} (Status: ${response.status}).`);
      return null;
    }
    return await response.text();
  } catch (error) {
    log(LOG_LEVEL_ERROR, `Network error fetching text file ${filePath}:`, error);
    return null;
  }
}

// --- Public API ---

/**
 * Eagerly loads essential data for all themes in the manifest at startup.
 * This includes theme configurations, UI texts, and prompt configurations.
 * @returns {Promise<boolean>} True if all essential data loaded successfully.
 */
export async function loadInitialThemeManifestData() {
  log(LOG_LEVEL_INFO, 'Loading initial theme manifest data...');
  if (!THEMES_MANIFEST?.length) {
    log(LOG_LEVEL_ERROR, 'THEMES_MANIFEST is empty or undefined.');
    return false;
  }

  const loadPromises = THEMES_MANIFEST.map(themeMeta => ensureThemeDataLoaded(themeMeta.id));
  const results = await Promise.all(loadPromises);
  const allSuccess = results.every(Boolean);

  if (allSuccess) {
    log(LOG_LEVEL_INFO, 'Initial theme manifest data loaded successfully.');
  } else {
    log(LOG_LEVEL_WARN, 'Some initial theme data failed to load. Check logs for details.');
  }
  return allSuccess;
}

/**
 * Ensures all necessary config data for a specific theme is loaded into the cache.
 * @param {string} themeId - The ID of the theme.
 * @returns {Promise<boolean>} True if data is loaded or was already loaded.
 */
export async function ensureThemeDataLoaded(themeId) {
  const themeManifestEntry = THEMES_MANIFEST.find((t) => t.id === themeId);
  if (!themeManifestEntry) {
    log(LOG_LEVEL_ERROR, `Theme '${themeId}' not found in manifest.`);
    return false;
  }
  const { path: themePath, playable } = themeManifestEntry;

  // Check if all essential data is already loaded
  if (_ALL_THEMES_CONFIG[themeId] && _themeTextData[themeId] && _PROMPT_URLS_BY_THEME[themeId]) {
    return true;
  }

  log(LOG_LEVEL_DEBUG, `Ensuring data is loaded for theme: ${themeId}`);

  const config = _ALL_THEMES_CONFIG[themeId] ?? (await _fetchJSON(`${themePath}config.json`));
  if (!config) {
    if (playable) log(LOG_LEVEL_ERROR, `Failed to load critical config.json for theme: ${themeId}`);
    return false;
  }
  _ALL_THEMES_CONFIG[themeId] = config;

  const texts = _themeTextData[themeId] ?? (await _fetchJSON(`${themePath}texts.json`));
  if (!texts) {
    if (playable) log(LOG_LEVEL_ERROR, `Failed to load critical texts.json for theme: ${themeId}`);
    return false;
  }
  _themeTextData[themeId] = texts;

  if (!_PROMPT_URLS_BY_THEME[themeId]) {
    const promptsConfig = await _fetchJSON(`${themePath}prompts-config.json`);
    if (promptsConfig) {
      _PROMPT_URLS_BY_THEME[themeId] = promptsConfig.PROMPT_URLS || {};
      _NARRATIVE_LANG_PROMPT_PARTS_BY_THEME[themeId] = promptsConfig.NARRATIVE_LANG_PROMPT_PARTS || {};
    } else {
      log(LOG_LEVEL_WARN, `Failed to load prompts-config.json for theme: ${themeId}. Prompt functionality may be limited.`);
    }
  }

  return true;
}

/**
 * Gets the configuration object for a given theme.
 * @param {string} themeId - The ID of the theme.
 * @returns {object|null} The theme's configuration object, or null if not found.
 */
export function getThemeConfig(themeId) {
  if (!_ALL_THEMES_CONFIG[themeId]) {
    log(LOG_LEVEL_WARN, `Theme config for '${themeId}' requested but not loaded.`);
  }
  return _ALL_THEMES_CONFIG[themeId] || null;
}

/**
 * Gets the UI text data object for a given theme and language, with a fallback to the default language.
 * @param {string} themeId - The ID of the theme.
 * @param {string} lang - The desired language code (e.g., 'en', 'cs').
 * @returns {object|null} The language-specific text object, or null if not found.
 */
export function getThemeUITexts(themeId, lang) {
  const themeLocaleData = _themeTextData[themeId];
  if (!themeLocaleData) {
    log(LOG_LEVEL_WARN, `Theme texts for '${themeId}' requested but not loaded.`);
    return null;
  }
  return themeLocaleData[lang] ?? themeLocaleData[DEFAULT_LANGUAGE] ?? null;
}

/**
 * Gets the URL for a specific prompt file of a theme.
 * @param {string} themeId - The ID of the theme.
 * @param {string} promptName - The name of the prompt (key in prompts-config.json).
 * @returns {string|null} The URL string, or null if not found.
 */
export function getThemePromptUrl(themeId, promptName) {
  return _PROMPT_URLS_BY_THEME[themeId]?.[promptName] || null;
}

/**
 * Gets the narrative language-specific prompt part for a theme and language.
 * @param {string} themeId - The ID of the theme.
 * @param {string} lang - The desired language code.
 * @returns {string} The narrative style prompt string.
 */
export function getThemeNarrativeLangPromptPart(themeId, lang) {
  const langParts = _NARRATIVE_LANG_PROMPT_PARTS_BY_THEME[themeId];
  return langParts?.[lang] || langParts?.[DEFAULT_LANGUAGE] || `Narrative must be in ${lang.toUpperCase()}.`;
}

/**
 * Gets the equipment slot configuration for a given theme.
 * @param {string} themeId - The ID of the theme.
 * @returns {object|null} The theme's `equipment_slots` object, or null if not found.
 */
export function getThemeEquipmentSlots(themeId) {
  return getThemeConfig(themeId)?.equipment_slots || null;
}

/**
 * Fetches and caches item data for a specific theme and item type (e.g., 'wardens_blade').
 * @param {string} themeId - The ID of the theme.
 * @param {string} itemType - The type of items to fetch.
 * @returns {Promise<Array|null>} A promise resolving to an array of item objects.
 */
export async function fetchAndCacheItemData(themeId, itemType) {
  if (!_themeItemData[themeId]) {
    _themeItemData[themeId] = {};
  }
  if (_themeItemData[themeId][itemType]) {
    return _themeItemData[themeId][itemType];
  }

  const themePath = THEMES_MANIFEST.find((t) => t.id === themeId)?.path;
  if (!themePath) {
    log(LOG_LEVEL_ERROR, `Theme '${themeId}' not found in manifest. Cannot fetch item data.`);
    return null;
  }

  const itemDataPath = `${themePath}data/${itemType}_items.json`;
  log(LOG_LEVEL_DEBUG, `Fetching item data file: ${itemDataPath}`);

  const itemData = await _fetchJSON(itemDataPath);
  // Cache the result, even if it's null/empty, to prevent re-fetching.
  _themeItemData[themeId][itemType] = itemData || [];
  return _themeItemData[themeId][itemType];
}

/**
 * Synchronously retrieves already loaded item definitions.
 * @param {string} themeId - The ID of the theme.
 * @param {string} itemType - The type of items to retrieve.
 * @returns {Array|null} The cached array of item objects, or null if not loaded.
 */
export function getThemeItemDefinitions(themeId, itemType) {
  const cachedData = _themeItemData[themeId]?.[itemType];
  if (!cachedData) {
    log(LOG_LEVEL_WARN, `Item definitions for '${themeId}/${itemType}' not found in cache. Ensure it was pre-loaded.`);
  }
  return cachedData || null;
}

/**
 * Fetches and caches the content of a specific prompt file.
 * @param {string} themeId - The ID of the theme.
 * @param {string} promptName - The name of the prompt.
 * @returns {Promise<string|null>} The prompt text content, or null on critical error.
 */
export async function fetchAndCachePromptFile(themeId, promptName) {
  if (!_gamePrompts[themeId]) {
    _gamePrompts[themeId] = {};
  }
  if (_gamePrompts[themeId]?.[promptName]) {
    log(LOG_LEVEL_DEBUG, `Prompt '${themeId}/${promptName}' found in cache.`);
    return _gamePrompts[themeId][promptName];
  }

  const promptUrl = getThemePromptUrl(themeId, promptName);
  if (!promptUrl) {
    log(LOG_LEVEL_WARN, `URL for prompt '${themeId}/${promptName}' not found in config.`);
    _gamePrompts[themeId][promptName] = `ERROR:URL_NOT_FOUND`;
    return null;
  }

  const promptContent = await _fetchText(promptUrl);
  _gamePrompts[themeId][promptName] = promptContent; // Cache success, null, or "not found" marker.
  log(LOG_LEVEL_DEBUG, `Fetched and cached prompt '${themeId}/${promptName}'.`);
  return promptContent;
}

/**
 * Synchronously retrieves cached prompt text. Returns null for errors or if not found.
 * @param {string} themeId - The ID of the theme.
 * @param {string} promptName - The name of the prompt.
 * @returns {string|null} The cached prompt text, or null.
 */
export function getLoadedPromptText(themeId, promptName) {
  const cachedPrompt = _gamePrompts[themeId]?.[promptName];
  if (cachedPrompt && !cachedPrompt.startsWith('ERROR:') && !cachedPrompt.startsWith('HELPER_FILE_NOT_FOUND:')) {
    return cachedPrompt;
  }
  return null;
}

/**
 * Ensures all prompt files listed in a theme's config are fetched and cached.
 * @param {string} themeId - The ID of the theme.
 * @returns {Promise<boolean>} True if all critical prompts loaded successfully.
 */
export async function getAllPromptsForTheme(themeId) {
  if (!_PROMPT_URLS_BY_THEME[themeId]) {
    const dataLoaded = await ensureThemeDataLoaded(themeId);
    if (!dataLoaded) return false;
  }

  const promptNames = Object.keys(_PROMPT_URLS_BY_THEME[themeId] || {});
  if (promptNames.length === 0) return true;

  log(LOG_LEVEL_INFO, `Fetching all prompts for theme: ${themeId}`);
  const fetchPromises = promptNames.map(name => fetchAndCachePromptFile(themeId, name));
  const results = await Promise.all(fetchPromises);
  const criticalFailure = results.some(content => content === null);

  if (criticalFailure) {
    log(LOG_LEVEL_WARN, `Some critical prompts failed to load for theme '${themeId}'.`);
    return false;
  }
  return true;
}

/**
 * Retrieves and parses trait definitions for a given theme from the cache.
 * @param {string} themeId - The ID of the theme.
 * @returns {object|null} A dictionary of trait objects, or null.
 */
export function getThemeTraits(themeId) {
  if (_themeTraits[themeId]) {
    return _themeTraits[themeId];
  }

  const traitFileContent = getLoadedPromptText(themeId, 'traits');
  if (traitFileContent) {
    try {
      const parsedTraits = JSON.parse(traitFileContent);
      _themeTraits[themeId] = parsedTraits;
      log(LOG_LEVEL_DEBUG, `Parsed and cached traits for theme '${themeId}'.`);
      return parsedTraits;
    } catch (e) {
      log(LOG_LEVEL_ERROR, `Failed to parse traits.json for theme '${themeId}'.`, e);
      return null;
    }
  }

  log(LOG_LEVEL_WARN, `Trait definitions for theme '${themeId}' not loaded.`);
  return null;
}

/**
 * Clears the prompt file cache for a specific theme or all themes.
 * @private For development/testing.
 * @param {string|null} [themeId=null] - The theme ID to clear, or all if null.
 */
export function _clearThemePromptCache(themeId = null) {
  if (themeId) {
    delete _gamePrompts[themeId];
    log(LOG_LEVEL_INFO, `Prompt cache cleared for theme: ${themeId}`);
  } else {
    Object.keys(_gamePrompts).forEach(id => delete _gamePrompts[id]);
    log(LOG_LEVEL_INFO, 'All theme prompt caches cleared.');
  }
}

/**
 * Clears all cached theme data.
 * @private For development/testing.
 */
export function _clearAllThemeDataCache() {
  Object.keys(_ALL_THEMES_CONFIG).forEach(key => delete _ALL_THEMES_CONFIG[key]);
  Object.keys(_themeTextData).forEach(key => delete _themeTextData[key]);
  Object.keys(_PROMPT_URLS_BY_THEME).forEach(key => delete _PROMPT_URLS_BY_THEME[key]);
  Object.keys(_NARRATIVE_LANG_PROMPT_PARTS_BY_THEME).forEach(key => delete _NARRATIVE_LANG_PROMPT_PARTS_BY_THEME[key]);
  Object.keys(_themeTraits).forEach(key => delete _themeTraits[key]);
  Object.keys(_themeItemData).forEach(key => delete _themeItemData[key]);
  _clearThemePromptCache();
  log(LOG_LEVEL_INFO, 'All theme data caches cleared.');
}
