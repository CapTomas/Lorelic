/**
 * @file Responsible for generating, rendering, and updating all dynamic dashboard panels
 * and their items (meters, status levels, text values). Also handles panel expansion/collapse
 * logic and scroll indicators for off-screen updates.
 */

import {
    leftPanel,
    rightPanel,
    leftPanelScrollIndicatorUp,
    leftPanelScrollIndicatorDown,
    rightPanelScrollIndicatorUp,
    rightPanelScrollIndicatorDown,
} from './domElements.js';
import { getThemeConfig } from '../services/themeService.js';
import { getUIText } from '../services/localizationService.js';
import { highlightElementUpdate, formatDynamicText } from './uiUtils.js';
import {
    getPanelState,
    setPanelState,
    getCurrentTheme,
    getLastKnownDashboardUpdates,
    setLastKnownDashboardUpdates,
    getLastKnownGameStateIndicators,
    updateDashboardItemMetaEntry,
    getDashboardItemMeta,
    getEffectiveMaxIntegrity,
    getEffectiveMaxWillpower,
    updateCurrentRunStat,
} from '../core/state.js';
import { SCROLL_INDICATOR_TOLERANCE } from '../core/config.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { attachTooltip } from './tooltipManager.js';

// --- Module State ---

/**
 * @private
 * @description Tracks items that recently changed and are out of view to manage scroll indicators.
 */
const _recentlyChangedOutOfViewItems = {
    left: { up: new Set(), down: new Set() },
    right: { up: new Set(), down: new Set() },
};

// --- Private Helpers ---

/**
 * Handles scroll events on sidebars to update visibility of changed items and their indicators.
 * @param {'left' | 'right'} panelSide - The sidebar that was scrolled.
 * @private
 */
function _handleSidebarScroll(panelSide) {
    if (document.body.classList.contains("landing-page-active")) {
        const upIndicator = panelSide === 'left' ? leftPanelScrollIndicatorUp : rightPanelScrollIndicatorUp;
        const downIndicator = panelSide === 'left' ? leftPanelScrollIndicatorDown : rightPanelScrollIndicatorDown;
        if (upIndicator) upIndicator.style.display = 'none';
        if (downIndicator) downIndicator.style.display = 'none';
        return;
    }

    const sidebar = panelSide === 'left' ? leftPanel : rightPanel;
    if (!sidebar) return;

    let itemsMadeVisible = false;

    _recentlyChangedOutOfViewItems[panelSide].up.forEach(itemId => {
        const itemElement = document.getElementById(itemId);
        if (itemElement) {
            const sidebarRect = sidebar.getBoundingClientRect();
            const itemRect = itemElement.getBoundingClientRect();
            if (itemRect.top >= sidebarRect.top - SCROLL_INDICATOR_TOLERANCE) { // Item is now visible or below top edge
                _recentlyChangedOutOfViewItems[panelSide].up.delete(itemId);
                itemsMadeVisible = true;
            }
        } else {
            _recentlyChangedOutOfViewItems[panelSide].up.delete(itemId); // Element not found, remove
            itemsMadeVisible = true;
        }
    });

    _recentlyChangedOutOfViewItems[panelSide].down.forEach(itemId => {
        const itemElement = document.getElementById(itemId);
        if (itemElement) {
            const sidebarRect = sidebar.getBoundingClientRect();
            const itemRect = itemElement.getBoundingClientRect();
            if (itemRect.bottom <= sidebarRect.bottom + SCROLL_INDICATOR_TOLERANCE) { // Item is now visible or above bottom edge
                _recentlyChangedOutOfViewItems[panelSide].down.delete(itemId);
                itemsMadeVisible = true;
            }
        } else {
            _recentlyChangedOutOfViewItems[panelSide].down.delete(itemId); // Element not found, remove
            itemsMadeVisible = true;
        }
    });

    if (itemsMadeVisible) {
        updateScrollIndicators(panelSide);
    }
}

/**
 * Adds a recently changed item to scroll tracking if it's out of view.
 * @param {HTMLElement} itemContainer - The container element of the changed item (e.g., .info-item).
 * @param {'left' | 'right'} panelSide - Which sidebar the item belongs to.
 * @private
 */
function _addChangedItemToScrollTracking(itemContainer, panelSide) {
    if (!itemContainer || !itemContainer.id || document.body.classList.contains("landing-page-active")) {
        return;
    }

    const parentSidebar = panelSide === 'left' ? leftPanel : rightPanel;
    if (!parentSidebar || !parentSidebar.contains(itemContainer)) return;

    const sidebarRect = parentSidebar.getBoundingClientRect();
    const elRect = itemContainer.getBoundingClientRect();
    let changed = false;

    // Check if element is scrolled out of view upwards
    if (elRect.bottom < sidebarRect.top + SCROLL_INDICATOR_TOLERANCE) { // Entirely above viewport
        _recentlyChangedOutOfViewItems[panelSide].down.delete(itemContainer.id); // Not below
        if (!_recentlyChangedOutOfViewItems[panelSide].up.has(itemContainer.id)) {
            _recentlyChangedOutOfViewItems[panelSide].up.add(itemContainer.id);
            changed = true;
        }
    }
    // Check if element is scrolled out of view downwards
    else if (elRect.top > sidebarRect.bottom - SCROLL_INDICATOR_TOLERANCE) { // Entirely below viewport
        _recentlyChangedOutOfViewItems[panelSide].up.delete(itemContainer.id); // Not above
        if (!_recentlyChangedOutOfViewItems[panelSide].down.has(itemContainer.id)) {
            _recentlyChangedOutOfViewItems[panelSide].down.add(itemContainer.id);
            changed = true;
        }
    }
    // If it became visible or was already visible
    else {
        if (_recentlyChangedOutOfViewItems[panelSide].up.delete(itemContainer.id)) changed = true;
        if (_recentlyChangedOutOfViewItems[panelSide].down.delete(itemContainer.id)) changed = true;
    }

    if (changed) {
        updateScrollIndicators(panelSide);
    }
}

/**
 * Creates a single dashboard item element.
 * @param {object} itemConfig - Configuration for the item.
 * @param {string} themeId - Current theme ID for localization.
 * @returns {HTMLElement} The created item container element.
 * @private
 */
function _createPanelItemElement(itemConfig, themeId) {
    const itemContainer = document.createElement("div");
    itemContainer.id = `info-item-container-${itemConfig.id}`;
    itemContainer.classList.add(itemConfig.type === "meter" ? "info-item-meter" : "info-item");

    const commonFullWidthIds = [
        "objective", "current_quest", "location", "environment", "sensorConditions",
        "omen_details", "current_location_desc", "ambient_conditions", "blight_intensity",
        "case_primary_enigma", "flux_event_description", "active_disturbance_sensation",
        "current_attire_description",
    ];

    if (itemConfig.type === "text_long" || commonFullWidthIds.includes(itemConfig.id)) {
        itemContainer.classList.add("full-width");
    }

    const label = document.createElement("span");
    label.classList.add("label");
    label.textContent = getUIText(itemConfig.label_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
    itemContainer.appendChild(label);

    if (itemConfig.type === "meter") {
        const meterContainer = document.createElement("div");
        meterContainer.classList.add("meter-bar-container");
        const meterBar = document.createElement("div");
        meterBar.id = `meter-${itemConfig.id}`;
        meterBar.classList.add("meter-bar");
        meterContainer.appendChild(meterBar);
        itemContainer.appendChild(meterContainer);
        const valueOverlay = document.createElement("span");
        valueOverlay.id = `info-${itemConfig.id}`;
        valueOverlay.classList.add("value-overlay");
        itemContainer.appendChild(valueOverlay);
    } else { // text, text_long, status_level, status_text
        const valueSpan = document.createElement("span");
        valueSpan.id = `info-${itemConfig.id}`;
        valueSpan.classList.add("value");
        if (itemConfig.type === "text_long") {
            valueSpan.classList.add("objective-text"); // For potential specific styling
        }
        itemContainer.appendChild(valueSpan);
    }

    const themeConfig = getThemeConfig(themeId);
    const equipmentSlots = themeConfig?.equipment_slots || {};
    const slotKey = Object.keys(equipmentSlots).find(key => equipmentSlots[key].id === itemConfig.id);

    if (slotKey && equipmentSlots[slotKey].type !== 'money') {
        itemContainer.classList.add('equipment-slot-interactive');
        itemContainer.addEventListener('click', () => {
            log(LOG_LEVEL_DEBUG, `Equipment slot clicked: ${slotKey}`);
            document.dispatchEvent(new CustomEvent('equipmentSlotClicked', {
                detail: { slotKey: slotKey, themeId: themeId }
            }));
        });
    }

    if (itemConfig.tooltip_key) {
        const tooltipIcon = document.createElement('span');
        tooltipIcon.className = 'info-tooltip-trigger';
        tooltipIcon.setAttribute('role', 'button');
        tooltipIcon.setAttribute('tabindex', '0'); // For accessibility
        attachTooltip(tooltipIcon, itemConfig.tooltip_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
        itemContainer.appendChild(tooltipIcon);
    }

    return itemContainer;
}

/**
 * Sets initial default values for all dashboard items of a theme.
 * @param {string} themeId - The ID of the theme.
 * @private
 */
function _initializeDashboardDefaultTexts(themeId) {
    const themeConfigFull = getThemeConfig(themeId);
    if (!themeConfigFull || !themeConfigFull.dashboard_config) return;

    const dashboardConfig = themeConfigFull.dashboard_config;
    const allItemConfigs = [
        ...(dashboardConfig.left_panel || []),
        ...(dashboardConfig.right_panel || []),
    ].flatMap(panel => panel.items);

    allItemConfigs.forEach(itemConfig => {
        const valueElement = document.getElementById(`info-${itemConfig.id}`);
        const meterBarElement = document.getElementById(`meter-${itemConfig.id}`);
        let defaultValueText = itemConfig.default_value !== undefined ?
            String(itemConfig.default_value) :
            (itemConfig.default_value_key ? getUIText(itemConfig.default_value_key, {}, { explicitThemeContext: themeId, viewContext: 'game' }) : getUIText("unknown"));

        if (itemConfig.type === "meter") {
            if (valueElement || meterBarElement) {
                const defaultStatusText = itemConfig.default_status_key ? getUIText(itemConfig.default_status_key, {}, { explicitThemeContext: themeId, viewContext: 'game' }) : undefined;
                setMeterValue(meterBarElement, valueElement, defaultValueText, itemConfig, false, defaultStatusText);
            }
        } else if (itemConfig.type === "status_level") {
            if (valueElement && itemConfig.level_mappings) {
                const defaultAiValue = itemConfig.default_ai_value !== undefined ? String(itemConfig.default_ai_value) : "1";
                updateStatusLevelDisplay(valueElement, defaultAiValue, itemConfig, themeId, false);
            }
        } else if (itemConfig.type === "text" || itemConfig.type === "text_long" || itemConfig.type === "number_text") {
            if (valueElement) {
                const suffix = itemConfig.suffix || "";
                const newText = `${defaultValueText}${suffix}`;
                valueElement.innerHTML = formatDynamicText(newText);
            }
        } else if (itemConfig.type === "status_text" && valueElement) {
            if (valueElement) { // For status_text, the value IS the text
                valueElement.textContent = defaultValueText;
            }
        }
    });
    log(LOG_LEVEL_DEBUG, `Default texts initialized for dashboard of theme: ${themeId}`);
}

// --- Public API ---

/**
 * Initializes scroll event listeners for the dashboard side panels.
 * This should be called once when the application sets up UI managers.
 */
export function initDashboardManagerScrollEvents() {
    [leftPanel, rightPanel].forEach(panel => {
        if (panel) {
            panel.addEventListener('scroll', () => {
                const panelSide = panel.id === 'left-panel' ? 'left' : 'right';
                _handleSidebarScroll(panelSide);
            }, { passive: true });
        }
    });
    log(LOG_LEVEL_DEBUG, "DashboardManager scroll event listeners initialized.");
}

/**
 * Generates and renders dashboard panels for the given theme.
 * @param {string} themeId - The ID of the theme to generate panels for.
 */
export function generatePanelsForTheme(themeId) {
    const themeConfigFull = getThemeConfig(themeId);
    if (!themeConfigFull || !themeConfigFull.dashboard_config) {
        log(LOG_LEVEL_ERROR, `Dashboard config not found for theme: ${themeId}. Cannot generate panels.`);
        [leftPanel, rightPanel].forEach(panelContainer => {
            if (panelContainer) {
                Array.from(panelContainer.querySelectorAll('.panel-box'))
                    .filter(box => !box.closest('#landing-theme-description-container') && !box.closest('#landing-theme-details-container'))
                    .forEach(el => el.remove());
            }
        });
        return;
    }

    const dashboardConfig = themeConfigFull.dashboard_config;
    const setupSide = (panelContainer, panelConfigs) => {
        if (!panelContainer || !panelConfigs) return;

        Array.from(panelContainer.querySelectorAll('.panel-box'))
            .filter(box => !box.closest('#landing-theme-description-container') && !box.closest('#landing-theme-details-container'))
            .forEach(el => el.remove());

        const panelSideStr = panelContainer === leftPanel ? 'left' : 'right';
        if (_recentlyChangedOutOfViewItems[panelSideStr]) {
            _recentlyChangedOutOfViewItems[panelSideStr].up.clear();
            _recentlyChangedOutOfViewItems[panelSideStr].down.clear();
        }

        const scrollIndicatorDown = panelContainer.querySelector('.scroll-indicator-down');
        panelConfigs.forEach(panelConfig => {
            const panelBox = document.createElement("div");
            panelBox.id = panelConfig.id;
            panelBox.classList.add("panel-box");
            panelBox.style.display = "flex";
            panelBox.style.flexDirection = "column";

            if (panelConfig.type === "collapsible" || panelConfig.type === "hidden_until_active") {
                panelBox.classList.add("collapsible");
            }

            const header = document.createElement("div");
            header.classList.add("panel-box-header");
            const title = document.createElement("h3");
            title.classList.add("panel-box-title");
            title.textContent = getUIText(panelConfig.title_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
            header.appendChild(title);
            panelBox.appendChild(header);

            const content = document.createElement("div");
            content.classList.add("panel-box-content");
            panelConfig.items.forEach(itemConfig => {
                content.appendChild(_createPanelItemElement(itemConfig, themeId));
            });
            panelBox.appendChild(content);

            if (scrollIndicatorDown) {
                panelContainer.insertBefore(panelBox, scrollIndicatorDown);
            } else {
                panelContainer.appendChild(panelBox);
            }
        });
    };

    setupSide(leftPanel, dashboardConfig.left_panel);
    setupSide(rightPanel, dashboardConfig.right_panel);

    log(LOG_LEVEL_INFO, `Dashboard panels generated for theme: ${themeId}`);

    _initializeDashboardDefaultTexts(themeId);
    initializeCollapsiblePanelBoxes(themeId);
}

/**
 * Initializes collapsible panel box behavior (click/keydown on headers).
 * @param {string} themeId - The ID of the theme whose panels are being initialized.
 */
export function initializeCollapsiblePanelBoxes(themeId) {
    const themeConfigFull = getThemeConfig(themeId);
    if (!themeConfigFull || !themeConfigFull.dashboard_config) {
        log(LOG_LEVEL_WARN, `Dashboard config missing for theme ${themeId}. Cannot initialize panel boxes.`);
        return;
    }

    const dashboardConfig = themeConfigFull.dashboard_config;
    const allPanelConfigs = [...(dashboardConfig.left_panel || []), ...(dashboardConfig.right_panel || [])];

    allPanelConfigs.forEach(panelConfig => {
        const panelBox = document.getElementById(panelConfig.id);
        if (!panelBox) {
            log(LOG_LEVEL_DEBUG, `Panel box element with ID ${panelConfig.id} not found in DOM for theme ${themeId}.`);
            return;
        }

        let header = panelBox.querySelector(".panel-box-header");
        if (!header) {
            log(LOG_LEVEL_DEBUG, `Header not found in panel box ${panelConfig.id}.`);
            return;
        }

        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        header = newHeader;

        if (panelConfig.type === "collapsible" || panelConfig.type === "hidden_until_active") {
            header.addEventListener("click", () => {
                if (panelBox.style.display !== "none" || panelConfig.type === "collapsible") {
                    animatePanelExpansion(panelConfig.id, !panelBox.classList.contains("is-expanded"), panelConfig.type === "hidden_until_active");
                }
            });
            header.setAttribute("tabindex", "0");
            header.addEventListener("keydown", (e) => {
                if ((e.key === "Enter" || e.key === " ") && (panelBox.style.display !== "none" || panelConfig.type === "collapsible")) {
                    e.preventDefault();
                    animatePanelExpansion(panelConfig.id, !panelBox.classList.contains("is-expanded"), panelConfig.type === "hidden_until_active");
                }
            });
        }

        let initialExpandState = getPanelState(panelConfig.id);
        const isRestoringThisPanelSpecificSavedState = initialExpandState !== undefined;
        if (!isRestoringThisPanelSpecificSavedState) {
            const isGameViewCurrentlyActive = !document.body.classList.contains("landing-page-active");
            if (panelConfig.type === "collapsible" && isGameViewCurrentlyActive) {
                initialExpandState = true;
            } else {
                initialExpandState = panelConfig.initial_expanded || false;
            }
        }

        if (panelConfig.type === "static") {
            panelBox.style.display = "flex";
            panelBox.style.opacity = "1";
            animatePanelExpansion(panelConfig.id, true, false, true);
        } else if (panelConfig.type === "hidden_until_active") {
            const contentEl = panelBox.querySelector('.panel-box-content');
            if (initialExpandState) {
                panelBox.classList.add("is-expanded");
                if (contentEl) {
                    contentEl.style.maxHeight = contentEl.scrollHeight + "px";
                    contentEl.style.opacity = '1';
                    contentEl.style.paddingTop = '';
                    contentEl.style.paddingBottom = '';
                }
                header.setAttribute("aria-expanded", "true");
                if (contentEl) contentEl.setAttribute("aria-hidden", "false");
            } else {
                panelBox.classList.remove("is-expanded");
                if (contentEl) {
                    contentEl.style.maxHeight = '0';
                    contentEl.style.opacity = '0';
                    contentEl.style.paddingTop = '0';
                    contentEl.style.paddingBottom = '0';
                }
                header.setAttribute("aria-expanded", "false");
                if (contentEl) contentEl.setAttribute("aria-hidden", "true");
            }

            const gameStateIndicators = getLastKnownGameStateIndicators();
            const indicatorKey = panelConfig.indicator_key;
            const shouldBeVisible = !!(indicatorKey && gameStateIndicators && gameStateIndicators[indicatorKey] === true);

            if (shouldBeVisible) {
                panelBox.style.display = "flex";
                panelBox.style.opacity = "1";
                if (initialExpandState) {
                    animatePanelExpansion(panelConfig.id, true, true, true);
                }
            } else {
                panelBox.style.display = "none";
                panelBox.style.opacity = "0";
            }
        } else {
            panelBox.style.display = "flex";
            panelBox.style.opacity = "1";
            const delay = panelConfig.boot_delay && !isRestoringThisPanelSpecificSavedState ? panelConfig.boot_delay : 0;
            setTimeout(() => {
                animatePanelExpansion(panelConfig.id, initialExpandState, false, true);
            }, delay);
        }
    });

    log(LOG_LEVEL_INFO, `Collapsible panel boxes initialized for theme: ${themeId}`);
    requestAnimationFrame(() => {
        if (leftPanel && !document.body.classList.contains("landing-page-active")) {
            _handleSidebarScroll('left');
            updateScrollIndicators('left');
        }
        if (rightPanel && !document.body.classList.contains("landing-page-active")) {
            _handleSidebarScroll('right');
            updateScrollIndicators('right');
        }
    });
}

/**
 * Animates the expansion or collapse of a panel box and updates scroll tracking.
 * @param {string} panelBoxId - The ID of the panel box element.
 * @param {boolean} shouldExpand - True to expand, false to collapse.
 * @param {boolean} [manageVisibilityViaDisplay=false] - For hidden panels, also sets display:none.
 * @param {boolean} [isRestoringState=false] - True if this is part of restoring saved panel states.
 */
export function animatePanelExpansion(panelBoxId, shouldExpand, manageVisibilityViaDisplay = false, isRestoringState = false) {
    const box = document.getElementById(panelBoxId);
    if (!box) return;

    const header = box.querySelector(".panel-box-header");
    const content = box.querySelector(".panel-box-content");
    if (!header || !content) return;

    const wasExpanded = box.classList.contains("is-expanded");

    if (shouldExpand) {
        if (manageVisibilityViaDisplay && box.style.display === "none") {
            box.style.opacity = "0";
            box.style.display = "flex";
        }
        requestAnimationFrame(() => {
            box.classList.add("is-expanded");
            if (manageVisibilityViaDisplay) box.style.opacity = "1";
            header.setAttribute("aria-expanded", "true");
            content.setAttribute("aria-hidden", "false");
            content.style.maxHeight = content.scrollHeight + "px";
            content.style.opacity = "1";
            content.style.paddingTop = '';
            content.style.paddingBottom = '';

            if (!isRestoringState && !wasExpanded) {
                if (header.classList.contains('has-recent-update')) {
                    header.classList.remove('has-recent-update');
                }
                const itemsInPanel = content.querySelectorAll('.info-item.has-recent-update, .info-item-meter.has-recent-update');
                itemsInPanel.forEach(itemEl => {
                    const itemId = itemEl.id.replace('info-item-container-', '');
                    if (itemId) {
                        itemEl.classList.remove('has-recent-update');
                        updateDashboardItemMetaEntry(itemId, { hasRecentUpdate: false });
                        log(LOG_LEVEL_DEBUG, `Cleared 'has-recent-update' for item ${itemId} in panel ${panelBoxId}.`);
                    }
                });
            }

            const panelSide = leftPanel?.contains(box) ? 'left' : (rightPanel?.contains(box) ? 'right' : null);
            const onExpansionTransitionEnd = (event) => {
                if (event.target === content && event.propertyName === 'max-height') {
                    content.removeEventListener("transitionend", onExpansionTransitionEnd);
                    if (!document.body.classList.contains("landing-page-active")) {
                        content.style.maxHeight = '';
                    }
                    if (panelSide) _handleSidebarScroll(panelSide);
                }
            };
            content.addEventListener("transitionend", onExpansionTransitionEnd);

            const transitionDurationMs = parseFloat(getComputedStyle(content).transitionDuration) * 1000 || 300;
            setTimeout(() => {
                if (box.classList.contains("is-expanded") && !document.body.classList.contains("landing-page-active") && content.style.maxHeight !== '') {
                    content.style.maxHeight = '';
                }
                content.removeEventListener("transitionend", onExpansionTransitionEnd);
                if (panelSide) _handleSidebarScroll(panelSide);
            }, transitionDurationMs + 100);

            if (panelSide) _handleSidebarScroll(panelSide);
        });
    } else { // Collapse
        box.classList.remove("is-expanded");
        header.setAttribute("aria-expanded", "false");
        content.setAttribute("aria-hidden", "true");
        content.style.maxHeight = "0";
        content.style.opacity = "0";
        content.style.paddingTop = '0';
        content.style.paddingBottom = '0';

        if (manageVisibilityViaDisplay) {
            const onTransitionEnd = (event) => {
                if (event.target === content && !box.classList.contains("is-expanded")) {
                    box.style.display = "none";
                    content.removeEventListener("transitionend", onTransitionEnd);
                }
            };
            content.addEventListener("transitionend", onTransitionEnd);
            const duration = parseFloat(getComputedStyle(content).transitionDuration) * 1000 || 300;
            setTimeout(() => {
                if (!box.classList.contains("is-expanded")) box.style.display = "none";
            }, duration + 50);
        }

        const panelSide = leftPanel?.contains(box) ? 'left' : (rightPanel?.contains(box) ? 'right' : null);
        if (panelSide) {
            const itemsInPanel = box.querySelectorAll('.info-item, .info-item-meter');
            itemsInPanel.forEach(itemEl => {
                if (itemEl.id) {
                    _recentlyChangedOutOfViewItems[panelSide].up.delete(itemEl.id);
                    _recentlyChangedOutOfViewItems[panelSide].down.delete(itemEl.id);
                }
            });
            updateScrollIndicators(panelSide);
        }
    }

    if (!isRestoringState) {
        setPanelState(panelBoxId, shouldExpand);
    }
}

/**
 * Updates a specific dashboard item's display.
 * @param {string} itemId - The ID of the dashboard item.
 * @param {string|number} newValue - The new value for the item.
 * @param {boolean} [highlight=true] - Whether to visually highlight the update.
 */
export function updateDashboardItem(itemId, newValue, highlight = true) {
    if (newValue === null || newValue === undefined || String(newValue).trim() === "") {
        log(LOG_LEVEL_DEBUG, `Skipping dashboard update for item '${itemId}' due to empty/null value.`);
        return;
    }

    const currentThemeId = getCurrentTheme();
    if (!currentThemeId) return;

    const themeConfigFull = getThemeConfig(currentThemeId);
    if (!themeConfigFull?.dashboard_config) return;

    const sidePanelItems = [...(themeConfigFull.dashboard_config.left_panel || []), ...(themeConfigFull.dashboard_config.right_panel || [])]
        .flatMap(panel => panel.items);
    const topPanelItems = themeConfigFull.dashboard_config.top_panel || [];
    const allItemConfigs = [...topPanelItems, ...sidePanelItems];
    const itemConfig = allItemConfigs.find(item => item.id === itemId);

    if (!itemConfig) {
        log(LOG_LEVEL_WARN, `Dashboard item config not found for ID: ${itemId}`);
        return;
    }

    setLastKnownDashboardUpdates({ [itemId]: newValue });

    const isTopPanelItem = topPanelItems.some(item => item.id === itemId);
    if (isTopPanelItem) {
        if (itemConfig.maps_to_run_stat) {
            const parsedValue = parseInt(String(newValue), 10);
            if (!isNaN(parsedValue)) {
                if (itemConfig.type === 'meter') {
                    let maxVal = 100;
                    if (itemConfig.maps_to_run_stat === 'currentIntegrity') maxVal = getEffectiveMaxIntegrity();
                    else if (itemConfig.maps_to_run_stat === 'currentWillpower') maxVal = getEffectiveMaxWillpower();

                    let absoluteValue = Math.min(Math.round((parsedValue / 100) * maxVal), maxVal);
                    updateCurrentRunStat(itemConfig.maps_to_run_stat, absoluteValue);
                    log(LOG_LEVEL_DEBUG, `Updated run stat '${itemConfig.maps_to_run_stat}' to absolute value ${absoluteValue} from top panel update.`);
                } else {
                    updateCurrentRunStat(itemConfig.maps_to_run_stat, parsedValue);
                    log(LOG_LEVEL_DEBUG, `Updated run stat '${itemConfig.maps_to_run_stat}' to ${parsedValue} from top panel update.`);
                }
            }
        }
        return; // UI is handled by characterPanelManager
    }

    const valueElement = document.getElementById(`info-${itemId}`);
    const meterBarElement = document.getElementById(`meter-${itemId}`);
    const itemContainer = document.getElementById(`info-item-container-${itemId}`);

    if (itemConfig.type === "meter") {
        if (valueElement || meterBarElement) {
            const statusTextId = itemConfig.status_text_id;
            const newStatusText = statusTextId ? getLastKnownDashboardUpdates()[statusTextId] : undefined;
            setMeterValue(meterBarElement, valueElement, String(newValue), itemConfig, highlight, newStatusText);
        }
    } else if (itemConfig.type === "status_level") {
        updateStatusLevelDisplay(valueElement, String(newValue), itemConfig, currentThemeId, highlight);
    } else if (itemConfig.type === "text" || itemConfig.type === "text_long" || itemConfig.type === "number_text") {
        if (valueElement) {
            const suffix = itemConfig.suffix || "";
            const newText = `${newValue}${suffix}`;
            const formattedHtml = formatDynamicText(newText);
            if (valueElement.innerHTML !== formattedHtml) {
                valueElement.innerHTML = formattedHtml;
                if (highlight && itemContainer) highlightElementUpdate(itemContainer);
            }
        }
    } else if (itemConfig.type === "status_text" && valueElement) {
        if (valueElement.textContent !== String(newValue)) {
            valueElement.textContent = String(newValue);
            if (highlight && itemContainer && !itemConfig.meter_type) {
                highlightElementUpdate(itemContainer);
            }
        }
    }

    if (itemContainer && highlight) {
        const parentPanelBox = itemContainer.closest('.panel-box');
        if (parentPanelBox?.classList.contains('collapsible') && !parentPanelBox.classList.contains('is-expanded')) {
            log(LOG_LEVEL_DEBUG, `Item ${itemId} updated in collapsed panel ${parentPanelBox.id}. Auto-expanding.`);
            animatePanelExpansion(parentPanelBox.id, true, false, false);
        }
        if (parentPanelBox?.classList.contains('is-expanded') && !document.body.classList.contains("landing-page-active")) {
            const panelSide = leftPanel.contains(itemContainer) ? 'left' : (rightPanel.contains(itemContainer) ? 'right' : null);
            if (panelSide) _addChangedItemToScrollTracking(itemContainer, panelSide);
        }
    }
}

/**
 * Orchestrates updates for all dashboard items based on AI response.
 * @param {object} updatesFromAI - Object containing key-value pairs of dashboard updates.
 * @param {boolean} [highlightChanges=true] - Whether to highlight updated items.
 */
export function updateDashboard(updatesFromAI, highlightChanges = true) {
    const currentThemeId = getCurrentTheme();
    if (!updatesFromAI || Object.keys(updatesFromAI).length === 0 || !currentThemeId) {
        log(LOG_LEVEL_DEBUG, "dashboardManager.updateDashboard called with no updates, or no current theme.");
        return;
    }
    log(LOG_LEVEL_DEBUG, "dashboardManager.updateDashboard: Bulk updating dashboard with:", updatesFromAI);
    for (const key in updatesFromAI) {
        if (Object.prototype.hasOwnProperty.call(updatesFromAI, key)) {
            updateDashboardItem(key, updatesFromAI[key], highlightChanges);
        }
    }
}

/**
 * Sets the value and appearance of a meter bar and its associated text.
 * @param {HTMLElement|null} barEl - The meter bar element.
 * @param {HTMLElement|null} textEl - The text element displaying the meter's value/status.
 * @param {string} newPctStr - The new percentage value as a string.
 * @param {object} itemConfig - The configuration object for this meter item.
 * @param {boolean} [highlight=true] - Whether to highlight the update.
 * @param {string} [explicitStatusText] - Explicit status text for meters that have it.
 */
export function setMeterValue(barEl, textEl, newPctStr, itemConfig, highlight = true, explicitStatusText = undefined) {
    if (!barEl && !textEl) return;

    let updatedOccurred = false;
    const meterType = itemConfig.meter_type;
    let finalPct = 0;
    let newContentForTextEl = "";
    const parsedPct = parseInt(newPctStr, 10);

    if (!isNaN(parsedPct)) {
        finalPct = Math.max(0, Math.min(100, parsedPct));
    } else {
        const naText = getUIText("not_available_short");
        const unknownText = getUIText("unknown");
        if (newPctStr === "---" || newPctStr === naText || String(newPctStr).toLowerCase() === unknownText.toLowerCase()) {
            newContentForTextEl = newPctStr;
        } else {
            finalPct = (meterType === "shields" || meterType === "conceptual_cohesion" || meterType === "monster_defense" || meterType === "mana") ? 0 : 100;
        }
    }

    if (itemConfig.maps_to_run_stat && !isNaN(parsedPct)) {
        let maxStatValue = 100;
        if (itemConfig.maps_to_run_stat === 'currentIntegrity') maxStatValue = getEffectiveMaxIntegrity();
        else if (itemConfig.maps_to_run_stat === 'currentWillpower') maxStatValue = getEffectiveMaxWillpower();

        if (maxStatValue !== undefined) {
            const calculatedValue = Math.min(Math.round((finalPct / 100) * maxStatValue), maxStatValue);
            updateCurrentRunStat(itemConfig.maps_to_run_stat, calculatedValue);
            log(LOG_LEVEL_DEBUG, `Updated run stat '${itemConfig.maps_to_run_stat}' to ${calculatedValue} via dashboard meter update for item '${itemConfig.id}'.`);
            updatedOccurred = true;
        } else {
            const numericValue = parseInt(newPctStr, 10);
            if (!isNaN(numericValue)) {
                updateCurrentRunStat(itemConfig.maps_to_run_stat, numericValue);
                log(LOG_LEVEL_DEBUG, `Updated run stat '${itemConfig.maps_to_run_stat}' to ${numericValue} via dashboard meter update for item '${itemConfig.id}'.`);
                updatedOccurred = true;
            }
        }
    }

    let statusTextToUse = explicitStatusText;
    if (itemConfig.status_text_id && explicitStatusText === undefined) {
        statusTextToUse = getLastKnownDashboardUpdates()[itemConfig.status_text_id];
    }

    const isConceptualMeter = ["shields", "conceptual_cohesion", "monster_defense", "monster_health"].includes(meterType);
    if (isConceptualMeter) {
        const statusForDisplay = statusTextToUse || (finalPct > 0 ? getUIText("online") : getUIText("offline"));
        newContentForTextEl = `${statusForDisplay}: ${finalPct}%`;
        const offlineText = getUIText("offline").toLowerCase();
        const defaultText = (getUIText(itemConfig.default_status_key, {}, { explicitThemeContext: getCurrentTheme() }) || '').toLowerCase();
        if (finalPct === 0 && statusForDisplay.toLowerCase() !== offlineText && statusForDisplay.toLowerCase() !== defaultText) {
            newContentForTextEl = `${getUIText("offline")}: ${finalPct}%`;
        }
    } else if ((meterType === "mana" || meterType === "stamina") && statusTextToUse) {
        newContentForTextEl = `${statusTextToUse}: ${finalPct}%`;
    } else {
        newContentForTextEl = (newContentForTextEl === "" && !isNaN(parsedPct)) ? `${finalPct}%` : newContentForTextEl || `${finalPct}%`;
    }

    if (textEl && textEl.textContent !== newContentForTextEl) {
        textEl.textContent = newContentForTextEl;
        updatedOccurred = true;
    }

    if (barEl) {
        if (barEl.style.width !== `${finalPct}%`) {
            barEl.style.width = `${finalPct}%`;
            updatedOccurred = true;
        }
        const currentClasses = Array.from(barEl.classList).filter(cls => cls.startsWith("meter-") && cls !== "meter-bar");
        let newBarClasses = [];
        const isOfflineStatus = isConceptualMeter && (statusTextToUse && statusTextToUse.toLowerCase() === getUIText("offline").toLowerCase());

        if (isOfflineStatus || ["---", getUIText("not_available_short"), getUIText("unknown")].includes(newContentForTextEl)) {
            newBarClasses.push("meter-offline");
        } else {
            if (finalPct <= 10) newBarClasses.push("meter-critical");
            else if (finalPct <= 25) newBarClasses.push("meter-low");
            else if (finalPct <= 50) newBarClasses.push("meter-medium");
            else newBarClasses.push("meter-full");

            if (finalPct > 50) {
                const meterTypeToClassMap = { health: "meter-ok-health", shields: "meter-ok-shield", fuel: "meter-ok-fuel", stamina: "meter-ok-stamina", mana: "meter-ok-mana" };
                if (meterTypeToClassMap[meterType]) newBarClasses.push(meterTypeToClassMap[meterType]);
            }
        }
        if (newBarClasses.length !== currentClasses.length || !newBarClasses.every(cls => currentClasses.includes(cls))) {
            currentClasses.forEach(cls => barEl.classList.remove(cls));
            newBarClasses.forEach(cls => barEl.classList.add(cls));
            updatedOccurred = true;
        }
    }

    if (updatedOccurred && highlight) {
        const container = textEl?.closest(".info-item, .info-item-meter") || barEl?.closest(".info-item, .info-item-meter");
        if (container) highlightElementUpdate(container);
    }
}

/**
 * Updates the display of a status level item (e.g., threat level, blight exposure).
 * @param {HTMLElement} valueElement - The element displaying the status text.
 * @param {string} newValue - The new level value (e.g., "1", "2", "high", "low").
 * @param {object} itemConfig - The configuration for this item.
 * @param {string} themeId - The current theme ID for localization.
 * @param {boolean} [highlight=true] - Whether to visually highlight the update.
 */
export function updateStatusLevelDisplay(valueElement, newValue, itemConfig, themeId, highlight = true) {
    if (!valueElement || !itemConfig?.level_mappings) return;

    let updatedOccurred = false;
    if (itemConfig.maps_to_run_stat) {
        const numericValue = parseInt(newValue, 10);
        if (!isNaN(numericValue)) {
            updateCurrentRunStat(itemConfig.maps_to_run_stat, numericValue);
            log(LOG_LEVEL_DEBUG, `Updated run stat '${itemConfig.maps_to_run_stat}' to ${numericValue} via dashboard status_level update for item '${itemConfig.id}'.`);
            updatedOccurred = true;
        }
    }

    const levelConfig = itemConfig.level_mappings[String(newValue)];
    if (levelConfig?.display_text_key) {
        const newDisplayText = getUIText(levelConfig.display_text_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
        const newCssClass = levelConfig.css_class || "status-info";
        if (valueElement.textContent !== newDisplayText || !valueElement.classList.contains(newCssClass)) {
            valueElement.textContent = newDisplayText;
            Object.values(itemConfig.level_mappings).forEach(mapping => {
                if (mapping.css_class) valueElement.classList.remove(mapping.css_class);
            });
            valueElement.classList.add(newCssClass);
            updatedOccurred = true;
        }
    } else {
        if (valueElement.textContent !== getUIText("unknown")) {
            valueElement.textContent = getUIText("unknown");
            updatedOccurred = true;
        }
        Object.values(itemConfig.level_mappings).forEach(mapping => {
            if (mapping.css_class) valueElement.classList.remove(mapping.css_class);
        });
        if (!valueElement.classList.contains("status-info")) {
            valueElement.classList.add("status-info");
            updatedOccurred = true;
        }
        log(LOG_LEVEL_WARN, `Status level mapping not found for value "${newValue}" in theme "${themeId}" for item "${itemConfig.id}".`);
    }

    if (updatedOccurred && highlight) {
        const itemContainer = valueElement.closest(".info-item, .info-item-meter");
        if (itemContainer) highlightElementUpdate(itemContainer);
    }
}

/**
 * Updates the visibility of scroll indicators for a given panel side based on recently changed items.
 * @param {'left' | 'right'} panelSide - The side of the panel.
 */
export function updateScrollIndicators(panelSide) {
    const panelElement = panelSide === 'left' ? leftPanel : rightPanel;
    const upIndicator = panelSide === 'left' ? leftPanelScrollIndicatorUp : rightPanelScrollIndicatorUp;
    const downIndicator = panelSide === 'left' ? leftPanelScrollIndicatorDown : rightPanelScrollIndicatorDown;

    if (!panelElement || !upIndicator || !downIndicator) {
        log(LOG_LEVEL_DEBUG, `Panel elements for ${panelSide} side not found. Cannot update scroll indicators.`);
        if (upIndicator) upIndicator.style.display = 'none';
        if (downIndicator) downIndicator.style.display = 'none';
        return;
    }

    if (document.body.classList.contains("landing-page-active")) {
        upIndicator.style.display = 'none';
        downIndicator.style.display = 'none';
        return;
    }

    const isScrollable = panelElement.scrollHeight > panelElement.clientHeight + SCROLL_INDICATOR_TOLERANCE;
    const showUpForChange = _recentlyChangedOutOfViewItems[panelSide].up.size > 0;
    const showDownForChange = _recentlyChangedOutOfViewItems[panelSide].down.size > 0;
    const canScrollUp = panelElement.scrollTop > SCROLL_INDICATOR_TOLERANCE;
    const canScrollDown = panelElement.scrollHeight > panelElement.scrollTop + panelElement.clientHeight + SCROLL_INDICATOR_TOLERANCE;

    upIndicator.style.display = isScrollable && showUpForChange && canScrollUp ? 'flex' : 'none';
    downIndicator.style.display = isScrollable && showDownForChange && canScrollDown ? 'flex' : 'none';

    log(LOG_LEVEL_DEBUG, `Scroll indicators for ${panelSide} updated: Scrollable=${isScrollable}, UpChange=${showUpForChange}, DownChange=${showDownForChange}, CanScrollUp=${canScrollUp}, CanScrollDown=${canScrollDown}`);
}

/**
 * Clears all tracked recently changed items for scroll indicators.
 * Typically called when the view changes significantly (e.g., theme switch).
 */
export function clearAllChangedItemScrollTracking() {
    _recentlyChangedOutOfViewItems.left.up.clear();
    _recentlyChangedOutOfViewItems.left.down.clear();
    _recentlyChangedOutOfViewItems.right.up.clear();
    _recentlyChangedOutOfViewItems.right.down.clear();
    updateScrollIndicators('left');
    updateScrollIndicators('right');
    log(LOG_LEVEL_DEBUG, "All changed item scroll tracking cleared.");
}

/**
 * Resets the entire dashboard UI for a given theme.
 * @param {string} themeId - The ID of the theme to set up the dashboard for.
 */
export function resetDashboardUI(themeId) {
    log(LOG_LEVEL_INFO, `Resetting dashboard UI for theme: ${themeId}`);
    [leftPanel, rightPanel].forEach(panelContainer => {
        if (panelContainer) {
            Array.from(panelContainer.querySelectorAll('.panel-box'))
                .filter(box => !box.closest('#landing-theme-description-container') && !box.closest('#landing-theme-details-container'))
                .forEach(el => el.remove());
            log(LOG_LEVEL_DEBUG, `Cleared game-specific panels from ${panelContainer.id}`);
        }
    });
    clearAllChangedItemScrollTracking();
    log(LOG_LEVEL_DEBUG, "Dashboard scroll tracking state reset.");
    generatePanelsForTheme(themeId);
    log(LOG_LEVEL_INFO, `Dashboard UI reset and re-initialized for theme: ${themeId}`);
}

/**
 * Retrieves the last known raw dashboard updates for re-translation purposes or state persistence.
 * @returns {object} The last known dashboard updates object.
 */
export function getLastKnownDashboardUpdatesForTranslationsReapply() {
    return getLastKnownDashboardUpdates();
}

/**
 * Applies persisted dashboard item metadata (e.g., 'has-recent-update' dots) to the UI.
 * This is typically called after the dashboard is generated when resuming a game.
 */
export function applyPersistedItemMeta() {
    const itemMetaState = getDashboardItemMeta();
    if (!itemMetaState || Object.keys(itemMetaState).length === 0) {
        log(LOG_LEVEL_DEBUG, "No persisted dashboard item metadata to apply.");
        return;
    }
    log(LOG_LEVEL_INFO, "Applying persisted dashboard item metadata to UI elements.");
    for (const itemId in itemMetaState) {
        if (Object.prototype.hasOwnProperty.call(itemMetaState, itemId)) {
            const meta = itemMetaState[itemId];
            const itemContainer = document.getElementById(`info-item-container-${itemId}`);
            if (itemContainer) {
                if (meta?.hasRecentUpdate === true) {
                    itemContainer.classList.add('has-recent-update');
                    log(LOG_LEVEL_DEBUG, `Applied 'has-recent-update' to item: ${itemId}`);
                } else {
                    itemContainer.classList.remove('has-recent-update');
                }
            } else {
                log(LOG_LEVEL_WARN, `Item container 'info-item-container-${itemId}' not found in DOM. Cannot apply persisted meta.`);
            }
        }
    }
}

/**
 * Clears the 'has-recent-update' class (visual dot) from all dashboard item DOM elements.
 */
export function clearAllDashboardItemDotClasses() {
    const allItems = document.querySelectorAll('.info-item.has-recent-update, .info-item-meter.has-recent-update');
    allItems.forEach(itemEl => {
        itemEl.classList.remove('has-recent-update');
    });
    log(LOG_LEVEL_DEBUG, "Cleared 'has-recent-update' class from all dashboard DOM elements.");
}
