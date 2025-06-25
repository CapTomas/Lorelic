/**
 * @file Provides general, reusable UI utility functions for highlighting elements,
 * formatting text, managing input states, and other common tasks.
 */

// --- IMPORTS ---
import {
  UPDATE_HIGHLIGHT_DURATION,
  ANONYMOUS_PLAYER_ACTION_INPUT_LENGTH,
  PLAYER_ACTION_INPUT_LENGTH_BY_TIER,
} from '../core/config.js';
import { getIsRunActive, updateDashboardItemMetaEntry, getCurrentUser } from '../core/state.js';
import {
  gmSpecificActivityIndicator,
  systemStatusIndicator,
  playerActionInput,
  sendActionButton,
  actionInputSection,
  playerActionCharCounter,
} from './domElements.js';
import { attachTooltip } from './tooltipManager.js';
import { log, LOG_LEVEL_DEBUG } from '../core/logger.js';

// --- ELEMENT HIGHLIGHTING ---

/**
 * Briefly highlights a UI element that has been updated and adds a persistent
 * 'has-recent-update' class to its container for dot indicators. Also updates
 * the central state to reflect this change.
 * @param {HTMLElement} element - The element (or its value part) that was updated.
 */
export function highlightElementUpdate(element) {
  if (!element) return;

  let textValueElement = null;
  let containerElement = null;
  let itemId = null;

  // Determine the container and the specific text element being updated.
  if (element.classList.contains('value') || element.classList.contains('value-overlay')) {
    textValueElement = element;
    containerElement = element.closest('.info-item, .info-item-meter');
  } else if (element.classList.contains('info-item') || element.classList.contains('info-item-meter')) {
    containerElement = element;
    textValueElement = element.querySelector('.value, .value-overlay');
  }

  // Extract itemId from the container.
  if (containerElement?.id?.startsWith('info-item-container-')) {
    itemId = containerElement.id.substring('info-item-container-'.length);
  }

  // Add the persistent 'dot' class for out-of-view updates.
  if (containerElement && itemId) {
    const alreadyHasDot = containerElement.classList.contains('has-recent-update');
    if (!alreadyHasDot) {
      containerElement.classList.add('has-recent-update');
      updateDashboardItemMetaEntry(itemId, { hasRecentUpdate: true });
      log(LOG_LEVEL_DEBUG, `Item ${itemId} marked with has-recent-update (dot visible) and state updated.`);
    }
  }

  // Apply the temporary visual flash effect to the text element.
  if (textValueElement) {
    textValueElement.classList.add('value-updated');
    setTimeout(() => {
      if (document.body.contains(textValueElement)) {
        textValueElement.classList.remove('value-updated');
      }
    }, UPDATE_HIGHLIGHT_DURATION);
  }
}

/**
 * Briefly highlights a UI element to indicate an update, using a flash effect.
 * Differentiates between text elements (color flash via CSS) and icons (brightness flash via JS).
 * @param {HTMLElement} element - The DOM element to flash.
 */
export function flashElement(element) {
  if (!element) return;

  // For icons, which are colored via background-color, use a filter animation.
  if (element.classList.contains('status-icon') && typeof element.animate === 'function') {
    element.animate(
      [
        { filter: 'brightness(1.85)', offset: 0 },
        { filter: 'brightness(1.85)', offset: 0.15 },
        { filter: 'brightness(1)', offset: 1 },
      ],
      {
        duration: UPDATE_HIGHLIGHT_DURATION,
        easing: 'ease-out',
      },
    );
  } else {
    // For text elements, use the existing CSS animation by adding a class.
    element.classList.add('value-updated');
    setTimeout(() => {
      if (document.body.contains(element)) {
        element.classList.remove('value-updated');
      }
    }, UPDATE_HIGHLIGHT_DURATION);
  }
}

// --- TEXT & INPUT UTILITIES ---

/**
 * Automatically adjusts the height of a textarea to fit its content,
 * up to a CSS-defined max-height.
 * @param {HTMLTextAreaElement} textareaElement - The textarea element to auto-grow.
 */
export function autoGrowTextarea(textareaElement) {
  if (!textareaElement || typeof textareaElement.scrollHeight === 'undefined') return;

  textareaElement.style.height = 'auto'; // Temporarily shrink to get accurate scrollHeight.
  let newHeight = textareaElement.scrollHeight;

  const maxHeightStyle = window.getComputedStyle(textareaElement).maxHeight;
  const maxHeight = maxHeightStyle && maxHeightStyle !== 'none' ? parseInt(maxHeightStyle, 10) : Infinity;

  if (newHeight > maxHeight) {
    newHeight = maxHeight;
    textareaElement.style.overflowY = 'auto';
  } else {
    textareaElement.style.overflowY = 'hidden';
  }

  textareaElement.style.height = `${newHeight}px`;
}

/**
 * Formats text with simple markdown-like syntax to HTML.
 * Supports `_italic_`, `*bold*`, `~underline~`, and `<shard-update>`.
 * @param {string} text - The text to format.
 * @returns {string} The HTML formatted string.
 */
export function formatDynamicText(text) {
  if (typeof text !== 'string' || !text) return '';
  let formattedText = text;
  formattedText = formattedText.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>'); // _italic_
  formattedText = formattedText.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<strong>$1</strong>'); // *bold*
  formattedText = formattedText.replace(/~([^~]+)~/g, '<u>$1</u>'); // ~underline~
  // New addition for shard updates
  formattedText = formattedText.replace(/<shard-update shard-title="([^"]+)">([\s\S]*?)<\/shard-update>/g, '<span class="shard-update" data-shard-title="$1">$2</span>');
  return formattedText;
}

/**
 * Finds elements with shard-update class and data-shard-title attribute within a parent
 * and attaches the appropriate tooltip.
 * @param {HTMLElement} parentElement - The element to search within.
 */
export function activateShardTooltips(parentElement) {
    if (!parentElement) return;
    parentElement.querySelectorAll('.shard-update[data-shard-title]').forEach(el => {
        const title = el.dataset.shardTitle;
        const tooltipText = `Updated by Shard: ‘${title}’`;
        attachTooltip(el, null, {}, { rawText: tooltipText });
    });
}

/**
 * Handles input events on the player action textarea.
 * Updates the character counter and calls `autoGrowTextarea`.
 * The `maxlength` attribute on the textarea itself prevents typing beyond the limit,
 * while this handler primarily deals with pasted text and counter updates.
 * @param {Event} event - The input event.
 */
export function handlePlayerActionInput(event) {
  const textareaElement = event.target;
  if (!textareaElement || !playerActionCharCounter) return;

  const maxLength = textareaElement.maxLength;
  let currentValue = textareaElement.value;

  // Truncate if pasted content exceeds the max length.
  if (currentValue.length > maxLength) {
    textareaElement.value = currentValue.slice(0, maxLength);
    currentValue = textareaElement.value;
  }
  const currentLength = currentValue.length;
  playerActionCharCounter.textContent = `${currentLength}/${maxLength}`;
  // Update counter color based on length.
  if (currentLength >= maxLength) {
    playerActionCharCounter.style.color = 'var(--color-meter-critical)';
  } else if (currentLength >= maxLength * 0.9) {
    playerActionCharCounter.style.color = 'var(--color-meter-low)';
  } else {
    playerActionCharCounter.style.color = 'var(--color-text-muted)';
  }
  autoGrowTextarea(textareaElement);
}

/**
 * Updates the maxlength attribute of the player action input based on auth state and tier.
 * Also triggers a re-render of the character counter display.
 */
export function updatePlayerActionInputMaxLength() {
    if (!playerActionInput) return;
    const currentUser = getCurrentUser();
    let newLimit;
    if (currentUser) {
        const userTier = currentUser.tier || 'free';
        newLimit = PLAYER_ACTION_INPUT_LENGTH_BY_TIER[userTier] || PLAYER_ACTION_INPUT_LENGTH_BY_TIER.free;
    } else {
        newLimit = ANONYMOUS_PLAYER_ACTION_INPUT_LENGTH;
    }
    playerActionInput.maxLength = newLimit;
    // Trigger a manual update of the counter display
    handlePlayerActionInput({ target: playerActionInput });
    log(LOG_LEVEL_DEBUG, `Player action input max length updated to: ${newLimit}`);
}

// --- UI STATE MANAGEMENT ---

/**
 * Toggles UI elements to indicate AI processing status.
 * This also respects the overall run state to keep inputs disabled after character defeat.
 * @param {boolean} isProcessing - True if AI is processing, false otherwise.
 */
export function setGMActivityIndicator(isProcessing) {
  const isRunCurrentlyActive = getIsRunActive();
  const inputGroup = playerActionInput?.closest('.input-group');
  const shouldBeDisabled = isProcessing || !isRunCurrentlyActive;

  if (gmSpecificActivityIndicator) gmSpecificActivityIndicator.style.display = isProcessing ? 'inline-flex' : 'none';
  if (systemStatusIndicator) systemStatusIndicator.style.display = isProcessing ? 'none' : 'inline-flex';

  if (playerActionInput) playerActionInput.disabled = shouldBeDisabled;
  if (sendActionButton) sendActionButton.disabled = shouldBeDisabled;

  if (inputGroup) {
    inputGroup.classList.toggle('input-group-disabled', shouldBeDisabled);
  }

  const suggestedActionButtons = document.querySelectorAll('#suggested-actions-wrapper .ui-button');
  suggestedActionButtons.forEach((btn) => {
    // The defeat button is a special case: it should be enabled even if the run is inactive.
    if (btn.classList.contains('defeat-action-button')) {
      btn.disabled = false;
    } else {
      btn.disabled = shouldBeDisabled;
    }
  });

  // Only focus if processing is done AND the run is active.
  const isInputSectionVisible = actionInputSection && actionInputSection.style.display !== 'none';
  if (!isProcessing && isRunCurrentlyActive && isInputSectionVisible && playerActionInput) {
    playerActionInput.focus();
  }
}

/**
 * Enables or disables the main player action input area.
 * Used for states where the user should use suggested actions instead of typing
 * (e.g., boon selection) or after character defeat. Respects the overall game run state.
 * @param {boolean} isEnabled - True to enable, false to disable.
 */
export function setPlayerInputEnabled(isEnabled) {
  const isRunCurrentlyActive = getIsRunActive();
  const finalEnabledState = isEnabled && isRunCurrentlyActive;
  const inputGroup = playerActionInput?.closest('.input-group');

  if (playerActionInput) playerActionInput.disabled = !finalEnabledState;
  if (sendActionButton) sendActionButton.disabled = !finalEnabledState;

  if (inputGroup) {
    inputGroup.classList.toggle('input-group-disabled', !finalEnabledState);
  }

  log(LOG_LEVEL_DEBUG, `Player action input set to enabled: ${finalEnabledState}`);
}
