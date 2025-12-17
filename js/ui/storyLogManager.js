/**
 * @file Manages the display and interaction of the main story log,
 * including message rendering, history persistence, and scroll behavior.
 */

// --- IMPORTS ---
import { storyLog, storyLogViewport } from './domElements.js';
import { formatDynamicText } from './uiUtils.js';
import { AUTOSCROLL_THRESHOLD } from '../core/config.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_WARN } from '../core/logger.js';
import { addTurnToGameHistory as stateAddTurnToGameHistory } from '../core/state.js';
import { attachTooltip } from './tooltipManager.js';

// --- CONSTANTS ---
const LOADING_INDICATOR_ID = 'story-log-loading-indicator';

// --- MODULE STATE ---
let userHasManuallyScrolledLog = false;

/**
 * Adjusts the max-width of a player message bubble to accommodate the dynamically
 * sized dice roll container, preventing layout overlap.
 * @param {HTMLElement} playerMessageElement The player message element.
 * @param {HTMLElement} diceContainerElement The container for the dice.
 * @private
 */
function _adjustPlayerMessageWidthForDice(playerMessageElement, diceContainerElement) {
    const diceContainerWidth = diceContainerElement.offsetWidth;
    if (diceContainerWidth > 0) {
        const gap = 20; // px, provides space between dice and message bubble
        playerMessageElement.style.maxWidth = `calc(99% - ${diceContainerWidth + gap}px)`;
        log(LOG_LEVEL_DEBUG, `Adjusted player message max-width for dice container width of ${diceContainerWidth}px.`);
    } else {
        log(LOG_LEVEL_WARN, 'Could not calculate dice container width. Falling back to default CSS max-width.');
    }
}

// --- RENDERING ---

/**
 * Renders a dice roll animation next to the last player message.
 * It creates a visual representation for each die rolled in each notation.
 * @param {Array<object>} rollResults - The results from the dice roller, including success status.
 * @param {boolean} [skipAnimation=false] - If true, renders the dice instantly without animation.
 * @returns {Promise<void>} A promise that resolves when the rendering and animations are complete.
 */
export function renderDiceRoll(rollResults, skipAnimation = false) {
    return new Promise(resolve => {
        if (!storyLog || !rollResults || !rollResults.length) {
            resolve();
            return;
        }
        const lastPlayerMessage = storyLog.querySelector('.player-message:last-of-type');
        if (!lastPlayerMessage) {
            resolve();
            return;
        }

        const existingContainer = lastPlayerMessage.querySelector('.dice-roll-container');
        if (existingContainer) {
            existingContainer.remove();
        }

        lastPlayerMessage.classList.add('has-dice-roll');
        const mainContainer = document.createElement('div');
        mainContainer.className = 'dice-roll-container';

        const allRollInstancesFinished = [];

        rollResults.forEach(roll => {
            if (roll.error || !roll.rolls || roll.rolls.length === 0) return;

            const rollInstancePromise = new Promise(rollInstanceResolve => {
                const instance = document.createElement('div');
                instance.className = 'dice-roll-instance';

                // Tooltip
                const tooltipText = (typeof roll.target === 'number')
                    ? `${roll.notation} ${roll.comparison} ${roll.target} → Rolled: ${roll.result} `
                    : `${roll.notation} → Rolled: ${roll.result}`;
                attachTooltip(instance, null, {}, { rawText: tooltipText });

                // Instant render for history
                if (skipAnimation) {
                    instance.classList.add(roll.success ? 'success' : 'failure', 'settled');
                    roll.rolls.forEach(dieValue => {
                        const diceEl = document.createElement('div');
                        diceEl.className = 'dice';
                        diceEl.textContent = dieValue;
                        instance.appendChild(diceEl);
                    });
                    mainContainer.appendChild(instance);
                    rollInstanceResolve();
                    return;
                }

                // Animated render
                mainContainer.appendChild(instance);

                const individualDiePromises = roll.rolls.map(dieValue => {
                    return new Promise(dieResolve => {
                        const diceEl = document.createElement('div');
                        diceEl.className = 'dice is-rolling';
                        diceEl.textContent = '?';
                        instance.appendChild(diceEl);

                        const updateInterval = 100;
                        let elapsed = 0;
                        const animationDuration = 1500;

                        const intervalId = setInterval(() => {
                            const randomFlicker = Math.floor(Math.random() * (roll.sides || 20)) + 1;
                            diceEl.textContent = randomFlicker;
                            elapsed += updateInterval;
                            if (elapsed >= animationDuration) {
                                clearInterval(intervalId);
                                diceEl.textContent = dieValue;
                                diceEl.classList.remove('is-rolling');
                                dieResolve();
                            }
                        }, updateInterval);
                    });
                });

                Promise.all(individualDiePromises).then(() => {
                    setTimeout(() => {
                        instance.classList.add(roll.success ? 'success' : 'failure');
                        setTimeout(() => {
                            instance.classList.add('settled');
                            rollInstanceResolve();
                        }, 1200); // Duration of success/fail flash + fade
                    }, 100); // Short delay before flash
                });
            });
            allRollInstancesFinished.push(rollInstancePromise);
        });

        if (mainContainer.hasChildNodes()) {
            lastPlayerMessage.prepend(mainContainer);
            log(LOG_LEVEL_DEBUG, 'Dice roll display rendered.');
            _adjustPlayerMessageWidthForDice(lastPlayerMessage, mainContainer);
        }

        Promise.all(allRollInstancesFinished).then(() => {
            resolve();
        });
    });
}

/**
 * Renders a message to the story log DOM.
 * This function does NOT modify game state/history. It's the core display
 * logic used for both new messages and re-populating from history.
 * @param {string} text - The message text. Can contain simple markdown.
 * @param {string} senderTypes - A space-separated string of sender types (e.g., "gm", "player", "system system-emphasized").
 */
export function renderMessage(text, senderTypes) {
  if (!storyLog) {
    log(LOG_LEVEL_WARN, `Story log element not found. Message not rendered: (${senderTypes}) "${text.substring(0, 50)}..."`);
    return;
  }

  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message');

  const typesArray = senderTypes.split(' ').filter(t => t.trim() !== '');
  typesArray.forEach(type => {
    msgDiv.classList.add(`${type}-message`);
    // Add additional styling classes that aren't the primary role (e.g., "system-error").
    if (type !== 'gm' && type !== 'player' && type !== 'system') {
      msgDiv.classList.add(type);
    }
  });

  // Format text for markdown and handle multiline paragraphs.
  const formattedHtml = formatDynamicText(text);
  const paragraphs = formattedHtml.split(/\n\s*\n/).filter(p => p.trim() !== '');

  if (paragraphs.length === 0 && formattedHtml.trim() !== '') {
    // Handle single-line messages or those without double line breaks.
    const pElement = document.createElement('p');
    pElement.innerHTML = formattedHtml.replace(/\n/g, '<br>'); // Convert single newlines to <br>.
    msgDiv.appendChild(pElement);
  } else {
    paragraphs.forEach(paraHtml => {
      const pElement = document.createElement('p');
      pElement.innerHTML = paraHtml.replace(/\n/g, '<br>'); // Convert single newlines within paragraphs.
      msgDiv.appendChild(pElement);
    });
  }

  // Auto-scroll logic.
  const viewport = storyLogViewport;
  let shouldScroll = false;
  if (viewport && viewport.style.display !== 'none') {
    if (!userHasManuallyScrolledLog) {
      shouldScroll = true;
    } else {
      // Check if user is close enough to the bottom to re-engage auto-scroll.
      if (viewport.scrollHeight - viewport.clientHeight <= viewport.scrollTop + AUTOSCROLL_THRESHOLD) {
        shouldScroll = true;
        userHasManuallyScrolledLog = false; // Reset flag.
      }
    }
  }

  storyLog.appendChild(msgDiv);

  if (shouldScroll && viewport) {
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }
}

/**
 * Shows a loading indicator in the story log.
 * Removes any existing indicator before adding a new one.
 */
export function showLoadingIndicator() {
  if (!storyLog || !storyLogViewport) {
    log(LOG_LEVEL_WARN, 'Story log or viewport element not found. Cannot show loading indicator.');
    return;
  }
  removeLoadingIndicator(); // Ensure no duplicates.

  const indicatorDiv = document.createElement('div');
  indicatorDiv.id = LOADING_INDICATOR_ID;
  indicatorDiv.classList.add('loading-indicator-message');

  const dotsContainer = document.createElement('div');
  dotsContainer.classList.add('dots-container');
  for (let i = 0; i < 3; i++) {
    const dotSpan = document.createElement('span');
    dotSpan.classList.add('dot');
    dotsContainer.appendChild(dotSpan);
  }

  indicatorDiv.appendChild(dotsContainer);
  storyLog.appendChild(indicatorDiv);

  // Scroll to the bottom to make the indicator visible.
  requestAnimationFrame(() => {
    storyLogViewport.scrollTop = storyLogViewport.scrollHeight;
  });
  log(LOG_LEVEL_DEBUG, 'Loading indicator shown in story log.');
}

/**
 * Removes the loading indicator from the story log, if present.
 */
export function removeLoadingIndicator() {
  const existingIndicator = document.getElementById(LOADING_INDICATOR_ID);
  if (existingIndicator?.parentNode === storyLog) {
    storyLog.removeChild(existingIndicator);
    log(LOG_LEVEL_DEBUG, 'Loading indicator removed from story log.');
  }
}

// --- STATE & UI MANAGEMENT ---

/**
 * Adds a new message to the story log UI and, if it's a system message,
 * adds it to game history for persistence. This should be used by modules
 * that generate new system-level messages.
 * @param {string} text - The message text.
 * @param {string} senderTypes - A space-separated string of sender types. Must include "system".
 */
export function addMessageToLog(text, senderTypes) {
  renderMessage(text, senderTypes);

  // Player and GM messages are added to history by their respective controllers.
  // This function persists system messages.
  if (senderTypes.includes('system')) {
    stateAddTurnToGameHistory({
      role: 'system_log',
      parts: [{ text: text }],
      senderTypes: senderTypes, // Store the types for re-rendering correctly.
    });
    log(LOG_LEVEL_DEBUG, `Persisted system message to game history: "${text.substring(0, 30)}..."`);
  }
}

/**
 * Clears the story log's DOM content and resets manual scroll tracking.
 * This is intended to be called when a new game starts or the view is completely reset.
 */
export function clearStoryLogDOM() {
  if (storyLog) {
    storyLog.innerHTML = '';
    log(LOG_LEVEL_INFO, 'Story log DOM content cleared.');
  } else {
    log(LOG_LEVEL_WARN, 'Story log element not found, cannot clear DOM content.');
  }
  resetManualScrollFlag();
}

/**
 * Resets the manual scroll flag, typically when a new game starts or view changes.
 */
export function resetManualScrollFlag() {
  userHasManuallyScrolledLog = false;
}

// --- INITIALIZATION ---

/**
 * Initializes scroll handling for the story log viewport.
 * Detects manual scrolling to pause auto-scrolling.
 */
export function initStoryLogScrollHandling() {
  if (!storyLogViewport) {
    log(LOG_LEVEL_WARN, 'Story log viewport element not found. Cannot initialize scroll handling.');
    return;
  }

  let scrollTimeout;
  storyLogViewport.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        // If the user has scrolled up and is not near the bottom...
        if (storyLogViewport.scrollHeight - storyLogViewport.clientHeight > storyLogViewport.scrollTop + AUTOSCROLL_THRESHOLD) {
          if (!userHasManuallyScrolledLog) {
            log(LOG_LEVEL_DEBUG, 'User manually scrolled story log up.');
            userHasManuallyScrolledLog = true;
          }
        } else {
          // If user scrolls back to the bottom, re-enable auto-scroll.
          if (userHasManuallyScrolledLog) {
            log(LOG_LEVEL_DEBUG, 'User scrolled story log to bottom. Re-enabling auto-scroll.');
            userHasManuallyScrolledLog = false;
          }
        }
      }, 150); // Debounce scroll event.
    },
    { passive: true },
  );

  log(LOG_LEVEL_INFO, 'Story log scroll handling initialized.');
}
