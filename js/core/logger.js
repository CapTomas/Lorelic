/**
 * @file Centralized client-side logging utility. Provides level-based logging
 * that can be configured at runtime and persists across sessions.
 */

import { LOG_LEVEL_STORAGE_KEY } from './config.js';

// --- Constants ---

/** @constant {string} Log level for detailed debugging information. */
export const LOG_LEVEL_DEBUG = 'debug';
/** @constant {string} Log level for informational messages. */
export const LOG_LEVEL_INFO = 'info';
/** @constant {string} Log level for warnings. */
export const LOG_LEVEL_WARN = 'warning';
/** @constant {string} Log level for errors. */
export const LOG_LEVEL_ERROR = 'error';
/** @constant {string} Log level to disable all logging output. */
export const LOG_LEVEL_SILENT = 'silent';

const LOG_LEVEL_HIERARCHY = {
  [LOG_LEVEL_DEBUG]: 0,
  [LOG_LEVEL_INFO]: 1,
  [LOG_LEVEL_WARN]: 2,
  [LOG_LEVEL_ERROR]: 3,
  [LOG_LEVEL_SILENT]: 4,
};

const APP_NAME_PREFIX = '[LorelicFE]';

// --- Module State ---

let currentLogLevel = localStorage.getItem(LOG_LEVEL_STORAGE_KEY) || LOG_LEVEL_INFO;

// --- Private Functions ---

/**
 * Formats a log message with a timestamp, app prefix, level, and the message content.
 * @private
 * @param {string} level - The log level (e.g., 'info', 'error').
 * @param {...any} messages - The messages to log. Objects will be stringified.
 * @returns {any[]} The formatted log arguments for console methods.
 */
function _formatMessage(level, ...messages) {
  const timestamp = new Date().toISOString();
  const processedMessages = messages.map((msg) =>
    typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg)
  );
  return [`${timestamp} ${APP_NAME_PREFIX} [${level.toUpperCase()}]`, ...processedMessages];
}

// --- Public Functions ---

/**
 * Logs messages to the console based on the current log level.
 * @param {string} level - The log level, which must be one of the LOG_LEVEL constants.
 * @param {...any} messages - The messages to log.
 */
export function log(level, ...messages) {
  const levelIndex = LOG_LEVEL_HIERARCHY[level];
  const currentLevelIndex = LOG_LEVEL_HIERARCHY[currentLogLevel];

  if (levelIndex === undefined) {
    console.error(..._formatMessage(LOG_LEVEL_ERROR, `Unknown log level: ${level}`), ...messages);
    return;
  }

  if (currentLogLevel === LOG_LEVEL_SILENT || levelIndex < currentLevelIndex) {
    return; // Suppress log
  }

  const formattedMessages = _formatMessage(level, ...messages);

  switch (level) {
    case LOG_LEVEL_DEBUG:
      console.debug(...formattedMessages);
      break;
    case LOG_LEVEL_INFO:
      console.info(...formattedMessages);
      break;
    case LOG_LEVEL_WARN:
      console.warn(...formattedMessages);
      break;
    case LOG_LEVEL_ERROR:
      console.error(...formattedMessages);
      break;
    default:
      console.log(...formattedMessages);
  }
}

/**
 * Sets the application's client-side log level and persists it to local storage.
 * @param {string} newLevel - The new log level to set. Must be one of the LOG_LEVEL constants.
 */
export function setLogLevel(newLevel) {
  if (LOG_LEVEL_HIERARCHY[newLevel] !== undefined) {
    currentLogLevel = newLevel;
    localStorage.setItem(LOG_LEVEL_STORAGE_KEY, newLevel);
    log(LOG_LEVEL_INFO, `Log level set to ${newLevel.toUpperCase()}`);
  } else {
    log(
      LOG_LEVEL_ERROR,
      `Invalid log level: ${newLevel}. Valid levels are: ${Object.keys(LOG_LEVEL_HIERARCHY).join(', ')}`
    );
  }
}

/**
 * Gets the current client-side log level.
 * @returns {string} The current log level.
 */
export function getLogLevel() {
  return currentLogLevel;
}
