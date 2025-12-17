/**
 * @file Handles UI text retrieval using global and theme-specific text data.
 * Manages application and narrative language settings.
 */

import {
  getCurrentAppLanguage,
  setCurrentAppLanguage as setStateAppLanguage,
  getCurrentNarrativeLanguage,
  setCurrentNarrativeLanguage as setStateNarrativeLanguage,
  getCurrentTheme,
} from '../core/state.js';
import { globalTextData } from '../data/globalTexts.js';
import { getThemeUITexts as getThemeSpecificTexts } from './themeService.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_WARN } from '../core/logger.js';
import { DEFAULT_LANGUAGE } from '../core/config.js';

/**
 * Retrieves UI text based on a key, interpolating replacements.
 * The lookup order is:
 * 1. Current theme's texts (or an explicitly provided theme).
 * 2. Global landing page texts (if `viewContext` is 'landing').
 * 3. General global texts.
 * Each lookup attempts the current language first, then falls back to the default language.
 *
 * @param {string} key - The localization key.
 * @param {object} [replacements={}] - An object of placeholder-value pairs for interpolation.
 * @param {object} [options={}] - Optional parameters.
 * @param {string|null} [options.explicitThemeContext=null] - Specific theme ID to use for lookup, overrides current theme.
 * @param {string|null} [options.viewContext=null] - Hint for view context, e.g., 'landing', 'game'.
 * @returns {string} The localized and interpolated string, or the key itself if not found.
 */
export function getUIText(key, replacements = {}, options = {}) {
  const { explicitThemeContext = null, viewContext = null } = options;
  const lang = getCurrentAppLanguage();
  let text;

  // 1. Try theme-specific text if a theme context is active or explicitly provided.
  // The themeService handles its own language fallback.
  const themeForLookup = explicitThemeContext || getCurrentTheme();
  if (themeForLookup) {
    const themeTexts = getThemeSpecificTexts(themeForLookup, lang);
    text = themeTexts?.[key];
  }

  // 2. If not found in theme, try global text sources.
  if (text === undefined) {
    const globalSources = [];
    if (viewContext === 'landing' && globalTextData.landing) {
      globalSources.push({ contextName: 'landing', data: globalTextData.landing });
    }
    if (globalTextData.global) {
      globalSources.push({ contextName: 'global', data: globalTextData.global });
    }

    for (const source of globalSources) {
      text = source.data[lang]?.[key];
      if (text !== undefined) break;

      if (lang !== DEFAULT_LANGUAGE) {
        text = source.data[DEFAULT_LANGUAGE]?.[key];
        if (text !== undefined) {
          log(
            LOG_LEVEL_DEBUG,
            `Key '${key}' (${source.contextName} context) not found for lang '${lang}', used default '${DEFAULT_LANGUAGE}'.`
          );
          break;
        }
      }
    }
  }

  // 3. Final fallback to the key itself if no text was found in any source.
  if (text === undefined) {
    log(LOG_LEVEL_WARN, `Localization key '${key}' not found for lang '${lang}' in any context.`);
    text = key;
  }

  // 4. Apply replacements and return.
  if (typeof text === 'string') {
    let resultText = text;
    for (const [placeholder, value] of Object.entries(replacements)) {
      resultText = resultText.replace(new RegExp(`{${placeholder}}`, 'g'), value);
    }
    return resultText;
  }

  // This case handles malformed localization data (e.g., a key pointing to an object).
  log(LOG_LEVEL_WARN, `Retrieved non-string value for key '${key}' in lang '${lang}'. Returning key.`);
  return String(key);
}

/**
 * Gets the current application language from the state.
 * @returns {string} The current application language code (e.g., 'en', 'cs').
 */
export function getApplicationLanguage() {
  return getCurrentAppLanguage();
}

/**
 * Sets the application language in the state and persists it.
 * UI updates are handled by UI managers listening for this change.
 * @param {string} lang - The new application language code (e.g., 'en', 'cs').
 */
export function setApplicationLanguage(lang) {
  setStateAppLanguage(lang);
  log(LOG_LEVEL_DEBUG, `Application language set to: ${lang}.`);
}

/**
 * Gets the current narrative language from the state.
 * @returns {string} The current narrative language code.
 */
export function getNarrativeLanguage() {
  return getCurrentNarrativeLanguage();
}

/**
 * Sets the narrative language in the state and persists it.
 * Game logic changes (like AI prompt regeneration) are handled by relevant services.
 * @param {string} lang - The new narrative language code (e.g., 'en', 'cs').
 */
export function setNarrativeLanguage(lang) {
  setStateNarrativeLanguage(lang);
  log(LOG_LEVEL_DEBUG, `Narrative language set to: ${lang}.`);
}
