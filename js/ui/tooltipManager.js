/**
 * @file Manages the creation, display, and behavior of custom tooltips throughout the application.
 */

// --- IMPORTS ---
import { log, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { getCurrentTheme } from '../core/state.js';
import { getUIText } from '../services/localizationService.js';

// --- CONSTANTS ---
const TOOLTIP_OFFSET_Y = 10; // Vertical offset from the element in pixels.
const TOOLTIP_OFFSET_X = 0; // Horizontal offset from the element in pixels.
const FADE_DURATION = 150; // Fade in/out animation duration in milliseconds.
const SHOW_DELAY = 100; // Delay before showing tooltip on hover to prevent fly-by triggering.
const HIDE_DELAY = 75; // Delay before starting to hide the tooltip on mouseleave.

// --- MODULE STATE ---
let tooltipElement;
let currentHoverTarget = null; // The element currently being hovered.
let currentFocusTarget = null; // The element currently in focus.
let showTimeoutId = null;
let hideTimeoutId = null;
let animationCleanupTimeoutId = null;

// --- PRIVATE HELPERS ---

/**
 * Creates the tooltip DOM element and appends it to the document body.
 * This function is called only once when needed.
 * @private
 */
function _createTooltipElement() {
  if (tooltipElement) return;

  tooltipElement = document.createElement('div');
  tooltipElement.id = 'custom-tooltip';

  // Positioning & Sizing
  tooltipElement.style.position = 'absolute';
  tooltipElement.style.zIndex = '1001';
  tooltipElement.style.maxWidth = '800px';

  // Appearance
  tooltipElement.style.backgroundColor = 'var(--color-bg-input-area, #252525)';
  tooltipElement.style.color = 'var(--color-text-primary, #d1d1d6)';
  tooltipElement.style.padding = 'var(--spacing-xs, 4px) var(--spacing-sm, 8px)';
  tooltipElement.style.borderRadius = 'var(--radius-md, 12px)';
  tooltipElement.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
  tooltipElement.style.textAlign = 'center';

  // Typography
  tooltipElement.style.fontSize = 'var(--font-size-xs, 0.75rem)';

  // Behavior
  tooltipElement.style.opacity = '0';
  tooltipElement.style.visibility = 'hidden';
  tooltipElement.style.pointerEvents = 'none';
  tooltipElement.style.transition = `opacity ${FADE_DURATION}ms ease-out, visibility 0s linear ${FADE_DURATION}ms`;

  document.body.appendChild(tooltipElement);
  log(LOG_LEVEL_DEBUG, 'Custom tooltip element created and appended to body.');
}

/**
 * Displays the tooltip UI with the specified text near the target element.
 * @private
 * @param {HTMLElement} targetElement - The element to show the tooltip for.
 * @param {string} textKey - The localization key for the tooltip text.
 * @param {object} textReplacements - Placeholders and their values for the text key.
 * @param {object} textOptions - Additional options, including `rawText` for direct content.
 */
function _displayTooltipUI(targetElement, textKey, textReplacements, textOptions) {
  if (!tooltipElement || !targetElement) return;

  clearTimeout(animationCleanupTimeoutId); // Cancel any pending animation cleanup.

  // Set the tooltip content.
  if (textOptions.rawText) {
    tooltipElement.textContent = textOptions.rawText;
  } else if (textKey) {
    const explicitThemeContext = textOptions.explicitThemeContext || getCurrentTheme();
    tooltipElement.textContent = getUIText(textKey, textReplacements, { ...textOptions, explicitThemeContext });
  } else {
    _hideTooltipUI(); // No text to show.
    return;
  }

  // Calculate position.
  tooltipElement.style.visibility = 'hidden';
  tooltipElement.style.opacity = '0';
  tooltipElement.style.display = 'block';
  const tooltipWidth = tooltipElement.offsetWidth;
  const tooltipHeight = tooltipElement.offsetHeight;
  tooltipElement.style.display = '';

  const targetRect = targetElement.getBoundingClientRect();
  let top = targetRect.bottom + window.scrollY + TOOLTIP_OFFSET_Y;
  let left = targetRect.left + window.scrollX + targetRect.width / 2 - tooltipWidth / 2 + TOOLTIP_OFFSET_X;

  // Adjust for viewport overflow.
  if (left + tooltipWidth > window.innerWidth - TOOLTIP_OFFSET_Y) {
    left = window.innerWidth - tooltipWidth - TOOLTIP_OFFSET_Y;
  }
  if (left < TOOLTIP_OFFSET_Y) {
    left = TOOLTIP_OFFSET_Y;
  }

  // Attempt to flip to top if it overflows the bottom.
  const overflowsBottom = top + tooltipHeight > window.innerHeight + window.scrollY - TOOLTIP_OFFSET_Y;
  const hasSpaceAbove = targetRect.top - (tooltipHeight + TOOLTIP_OFFSET_Y * 2) > 0;
  if (overflowsBottom && hasSpaceAbove) {
    top = targetRect.top + window.scrollY - tooltipHeight - TOOLTIP_OFFSET_Y;
  }

  // Clamp final position to viewport.
  top = Math.max(top, window.scrollY + TOOLTIP_OFFSET_Y);
  tooltipElement.style.left = `${left}px`;
  tooltipElement.style.top = `${top}px`;

  // Animate into view.
  tooltipElement.style.visibility = 'visible';
  tooltipElement.style.opacity = '1';
  tooltipElement.style.transition = `opacity ${FADE_DURATION}ms ease-out, visibility 0s linear 0s`;
}

/**
 * Hides the tooltip UI by fading it out.
 * @private
 */
function _hideTooltipUI() {
  if (!tooltipElement) return;

  tooltipElement.style.opacity = '0';
  tooltipElement.style.transition = `opacity ${FADE_DURATION}ms ease-out, visibility 0s linear ${FADE_DURATION}ms`;

  clearTimeout(animationCleanupTimeoutId);
  animationCleanupTimeoutId = setTimeout(() => {
    if (tooltipElement?.style.opacity === '0') {
      tooltipElement.style.visibility = 'hidden';
    }
  }, FADE_DURATION);
}

// --- PUBLIC API ---

/**
 * Attaches custom tooltip functionality to an HTML element by storing data on its dataset.
 * Listeners are attached only once to be efficient and prevent memory leaks.
 * The element's existing `title` attribute will be removed to prevent native tooltips.
 * @param {HTMLElement} element - The element to attach the tooltip to.
 * @param {string | null} textKey - The localization key for the tooltip text. Use null if providing raw text.
 * @param {object} [textReplacements={}] - Placeholder replacements for the localization key.
 * @param {object} [textOptions={}] - Options for text retrieval (e.g., `{ rawText: 'My custom text' }`).
 */
export function attachTooltip(element, textKey, textReplacements = {}, textOptions = {}) {
  if (!element) {
    log(LOG_LEVEL_DEBUG, 'attachTooltip: Target element is null.');
    return;
  }
  element.removeAttribute('title');
  // Store the data on the element's dataset for easy updating.
  element.dataset.tooltipKey = textKey || '';
  element.dataset.tooltipReplacements = JSON.stringify(textReplacements);
  element.dataset.tooltipOptions = JSON.stringify(textOptions);
  // If listeners are not already attached, attach them once.
  if (element.dataset.tooltipAttached) {
    return; // Listeners are already in place, we just updated the data.
  }
  element.dataset.tooltipAttached = 'true';
  const readDataAndDisplay = () => {
    // Ensure data exists before trying to display
    if (element.dataset.tooltipKey || JSON.parse(element.dataset.tooltipOptions || '{}').rawText) {
        const key = element.dataset.tooltipKey || null;
        const replacements = JSON.parse(element.dataset.tooltipReplacements || '{}');
        const options = JSON.parse(element.dataset.tooltipOptions || '{}');
        _displayTooltipUI(element, key, replacements, options);
    }
  };
  const handleMouseEnter = () => {
    clearTimeout(hideTimeoutId);
    currentHoverTarget = element;
    showTimeoutId = setTimeout(() => {
      if (currentHoverTarget === element && currentFocusTarget !== element) {
        readDataAndDisplay();
      }
    }, SHOW_DELAY);
  };
  const handleMouseLeave = () => {
    clearTimeout(showTimeoutId);
    currentHoverTarget = null;
    if (currentFocusTarget !== element) {
      hideTimeoutId = setTimeout(_hideTooltipUI, HIDE_DELAY);
    }
  };
  const handleFocus = () => {
    clearTimeout(hideTimeoutId);
    clearTimeout(showTimeoutId);
    currentFocusTarget = element;
    readDataAndDisplay(); // Show immediately.
  };
  const handleBlur = () => {
    currentFocusTarget = null;
    if (currentHoverTarget !== element) {
      _hideTooltipUI();
    }
  };
  element.addEventListener('mouseenter', handleMouseEnter);
  element.addEventListener('mouseleave', handleMouseLeave);
  element.addEventListener('focus', handleFocus);
  element.addEventListener('blur', handleBlur);
}

/**
 * Refreshes the content of the currently visible tooltip.
 * Reads the latest data from the target element's dataset and updates the tooltip UI.
 */
export function refreshCurrentTooltip() {
    const target = currentHoverTarget || currentFocusTarget;
    if (target && tooltipElement && tooltipElement.style.visibility === 'visible') {
        if (target.dataset.tooltipKey || JSON.parse(target.dataset.tooltipOptions || '{}').rawText) {
            const key = target.dataset.tooltipKey || null;
            const replacements = JSON.parse(target.dataset.tooltipReplacements || '{}');
            const options = JSON.parse(target.dataset.tooltipOptions || '{}');
            _displayTooltipUI(target, key, replacements, options);
            log(LOG_LEVEL_DEBUG, "Tooltip content refreshed for active target.");
        }
    }
}

/**
 * Forces the currently displayed tooltip to hide immediately, canceling any animations.
 * Useful for events like 'click' on the target element to dismiss the tooltip.
 */
export function hideCurrentTooltip() {
  if (!tooltipElement) return;

  // Clear any pending timers that might show or hide the tooltip.
  clearTimeout(showTimeoutId);
  clearTimeout(hideTimeoutId);
  clearTimeout(animationCleanupTimeoutId);

  // Reset state to prevent lingering hover/focus from re-showing the tooltip.
  currentHoverTarget = null;
  currentFocusTarget = null;

  // Force an immediate, non-transitional hide.
  tooltipElement.style.transition = 'none';
  tooltipElement.style.opacity = '0';
  tooltipElement.style.visibility = 'hidden';

  // Restore the transition property after a frame for future events.
  requestAnimationFrame(() => {
    if (tooltipElement) {
      tooltipElement.style.transition = `opacity ${FADE_DURATION}ms ease-out, visibility 0s linear ${FADE_DURATION}ms`;
    }
  });
}

/**
 * Initializes the tooltip manager. Creates the tooltip element if it doesn't exist.
 * This should be called once when the application starts.
 */
export function initTooltipManager() {
  if (!tooltipElement) {
    _createTooltipElement();
  }
  log(LOG_LEVEL_DEBUG, 'TooltipManager initialized.');
}
