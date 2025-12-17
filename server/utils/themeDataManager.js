// server/utils/themeDataManager.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THEMES_ROOT_DIR = path.resolve(__dirname, '../../themes');

const themeTextCache = new Map();
const THEME_FILE_CACHE_TTL = process.env.NODE_ENV === 'production' ? 3600000 : 60000;

/**
 * Fetches and parses the texts.json for a given theme and language, with caching.
 * Implements English fallback if the specified language is not found.
 * @param {string} themeId - The ID of the theme.
 * @param {string} language - The desired language code (e.g., 'en', 'cs').
 * @returns {Promise<object|null>} The language-specific text object, or null on critical error.
 */
async function getThemeTexts(themeId, language) {
  const cacheKey = `${themeId}_${language}`;
  const cached = themeTextCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < THEME_FILE_CACHE_TTL)) {
    logger.debug(`[ThemeData] Cache hit for texts: ${themeId}, lang: ${language}`);
    return cached.data;
  }

  const filePath = path.join(THEMES_ROOT_DIR, themeId, 'texts.json');
  try {
    logger.debug(`[ThemeData] Reading texts file: ${filePath}`);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const allTexts = JSON.parse(fileContent);

    let textsForLang = allTexts[language];
    if (!textsForLang) {
      logger.warn(`[ThemeData] Language '${language}' not found in texts for theme '${themeId}'. Falling back to 'en'.`);
      textsForLang = allTexts['en'];
    }

    if (!textsForLang) {
      logger.error(`[ThemeData] Critical: English texts ('en') also not found for theme '${themeId}'. Cannot provide texts.`);
      themeTextCache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    themeTextCache.set(cacheKey, { data: textsForLang, timestamp: Date.now() });
    logger.info(`[ThemeData] Successfully loaded and cached texts for theme: ${themeId}, effective lang: ${allTexts[language] ? language : 'en'}`);
    return textsForLang;

  } catch (error) {
    logger.error(`[ThemeData] Error loading texts for theme '${themeId}' from ${filePath}:`, error.message);
    themeTextCache.set(cacheKey, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Retrieves the base theme lore by constructing the key based on convention.
 * @param {string} themeId - The ID of the theme.
 * @param {string} language - The desired language code.
 * @returns {Promise<string>} The base theme lore string.
 */
export async function getResolvedBaseThemeLore(themeId, language) {
  const targetKey = `theme_lore_${themeId}`;
  const textsForLang = await getThemeTexts(themeId, language);

  if (textsForLang && typeof textsForLang[targetKey] === 'string') {
    return textsForLang[targetKey];
  }

  const fallbackLore = `Base lore for theme '${themeId}' in language '${language}' could not be found using key '${targetKey}'. Please check theme configuration.`;
  logger.warn(`[ThemeData/Lore] Lore key '${targetKey}' not found for theme '${themeId}', lang '${language}'. Using fallback message.`);
  return fallbackLore;
}

/**
 * Retrieves the theme name by constructing the key based on convention.
 * Supports name variants like '_long', '_short'.
 * @param {string} themeId - The ID of the theme.
 * @param {string} language - The desired language code.
 * @param {string} [nameVariant=''] - E.g., '_long', '_short'. Empty for standard name.
 * @returns {Promise<string>} The theme name string.
 */
export async function getResolvedThemeName(themeId, language, nameVariant = '') {
  const targetKey = `theme_name${nameVariant}_${themeId}`;
  const textsForLang = await getThemeTexts(themeId, language);

  if (textsForLang && typeof textsForLang[targetKey] === 'string') {
    return textsForLang[targetKey];
  }

  logger.warn(`[ThemeData/Name] Name key '${targetKey}' not found for theme '${themeId}', lang '${language}'. Using themeId as fallback.`);
  return themeId;
}

export function clearThemeTextCache() {
    themeTextCache.clear();
    logger.info('[ThemeData] Theme text cache cleared.');
}
