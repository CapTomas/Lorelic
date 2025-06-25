/**
 * @file Manages the dynamic generation, display, and updates of the character progression panel.
 * This includes character name, level, core attributes (Integrity, Willpower, etc.), and the XP bar.
 */

// --- IMPORTS ---
import * as dom from './domElements.js';
import * as state from '../core/state.js';
import * as apiService from '../core/apiService.js';
import * as modalManager from './modalManager.js';
import * as themeService from '../services/themeService.js';
import * as uiUtils from './uiUtils.js';
import { getUIText } from '../services/localizationService.js';
import { XP_LEVELS, MAX_PLAYER_LEVEL, MIN_LEVEL_FOR_STORE } from '../core/config.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_WARN, LOG_LEVEL_ERROR } from '../core/logger.js';
import { attachTooltip, hideCurrentTooltip } from './tooltipManager.js';

// --- DESTRUCTURED DOM ELEMENTS ---
const {
    characterProgressionPanel,
    xpBarContainer,
    xpBarFill,
    xpBarText,
} = dom;

// --- MODULE-LEVEL DEPENDENCIES ---
let _gameControllerRef = null;

// --- PRIVATE HELPERS ---

/**
 * Creates the static DOM structure for the character panel.
 * This is called once during initialization.
 * @private
 */
function _createBasePanelStructure() {
    if (!characterProgressionPanel) return;

    characterProgressionPanel.innerHTML = `
        <div class="character-info-left">
            <div id="cp-item-strain" class="attribute-item">
                <div id="char-panel-strain-icon" class="attribute-value status-icon"></div>
            </div>
            <div class="char-panel-identity-block">
                <span id="char-panel-identifier">Character</span>
                <span id="char-panel-level" data-lang-key="char_panel_placeholder_level">Level 1</span>
            </div>
        </div>
        <div id="character-attributes-grid" class="character-attributes-grid">
            <!-- Attribute items will be dynamically inserted here -->
        </div>
        <div class="character-info-right">
            <!-- Icon buttons will be dynamically inserted here -->
        </div>
    `;

    const strainIcon = document.getElementById('char-panel-strain-icon');
    if (strainIcon) {
        strainIcon.addEventListener('click', _showStrainDetailsModal);
    }

    const identityBlock = characterProgressionPanel.querySelector('.char-panel-identity-block');
    if (identityBlock) {
        identityBlock.addEventListener('click', () => {
            const themeId = state.getCurrentTheme();
            if (themeId) {
                showCharacterProgressModal(themeId);
            } else {
                log(LOG_LEVEL_WARN, "Character identity block clicked but no active theme found.");
            }
        });
    }
}

/**
 * Creates the icon buttons for Inventory, Character Progress, Lore, and Store.
 * @param {HTMLElement} container - The container to append the buttons to.
 * @private
 */
function _createIconButtons(container) {
    if (!container) return;

    const buttons = [
        { id: 'inventory', icon: 'icon_inventory.svg', tooltipKey: 'tooltip_inventory_button', handler: _showInventoryModal },
        {
            id: 'character_progress',
            icon: 'icon_character.svg',
            tooltipKey: 'tooltip_character_progress',
            handler: () => {
                const themeId = state.getCurrentTheme();
                if (themeId) {
                    showCharacterProgressModal(themeId);
                } else {
                    log(LOG_LEVEL_WARN, "Character progress button clicked but no active theme found.");
                }
            },
        },
        { id: 'lore', icon: 'icon_lore.svg', tooltipKey: 'tooltip_lore_button', handler: _showLoreModal },
        { id: 'store', icon: 'icon_store.svg', tooltipKey: 'tooltip_store_button', handler: _showStoreModal },
    ];

    buttons.forEach(btnInfo => {
        const button = document.createElement('button');
        button.id = `char-panel-${btnInfo.id}-button`;
        button.className = 'ui-button icon-button';

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'icon-wrapper';
        iconWrapper.style.webkitMaskImage = `url('images/app/${btnInfo.icon}')`;
        iconWrapper.style.maskImage = `url('images/app/${btnInfo.icon}')`;
        button.appendChild(iconWrapper);

        if (btnInfo.id === 'store') {
            const currentLevel = state.getPlayerLevel();
            if (currentLevel < MIN_LEVEL_FOR_STORE) {
                button.disabled = true;
                button.classList.add('disabled');
                const tooltipText = getUIText('tooltip_store_locked_level', { MIN_LEVEL: MIN_LEVEL_FOR_STORE });
                attachTooltip(button, null, {}, { rawText: tooltipText });
                button.setAttribute("aria-label", tooltipText);
            } else {
                const altText = getUIText(btnInfo.tooltipKey);
                attachTooltip(button, btnInfo.tooltipKey);
                button.setAttribute("aria-label", altText);
                button.addEventListener('click', btnInfo.handler);
            }
        } else {
            const altText = getUIText(btnInfo.tooltipKey);
            attachTooltip(button, btnInfo.tooltipKey);
            button.setAttribute("aria-label", altText);
            button.addEventListener('click', btnInfo.handler);
        }
        container.appendChild(button);
    });
}

/**
 * Shows a modal with details about the character's current strain level.
 * @private
 */
function _showStrainDetailsModal() {
    const themeId = state.getCurrentTheme();
    const themeConfig = themeService.getThemeConfig(themeId);
    if (!themeConfig) return;

    const strainLevel = state.getCurrentStrainLevel();
    const strainItemConfig = themeConfig.dashboard_config?.top_panel?.find(item => item.id === 'strain_level');
    if (!strainItemConfig) return;

    const levelConfig = strainItemConfig.level_mappings?.[String(strainLevel)];
    if (!levelConfig) return;

    const titleKey = "modal_title_strain_status";
    const messageText = getUIText(levelConfig.display_text_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
    const tooltipText = getUIText(strainItemConfig.tooltip_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });

    modalManager.showCustomModal({
        type: 'alert',
        titleKey: titleKey,
        htmlContent: `<p><strong>${messageText}</strong></p><p>${tooltipText}</p>`,
    });
}

/**
 * Shows a modal displaying the character's inventory.
 * @private
 */
function _showInventoryModal() {
    if (_gameControllerRef && typeof _gameControllerRef.showInventoryModal === 'function') {
        _gameControllerRef.showInventoryModal();
    } else {
        log(LOG_LEVEL_ERROR, "GameController or showInventoryModal method not available.");
    }
}

/**
 * Shows a placeholder modal for the Store.
 * @private
 */
function _showStoreModal() {
    if (_gameControllerRef) {
        const themeId = state.getCurrentTheme();
        if (themeId) {
            _gameControllerRef.showStoreModal(themeId);
        } else {
            log(LOG_LEVEL_WARN, "_showStoreModal called but no active theme is set.");
        }
    }
}

/**
 * Shows a modal with the current Evolved World Lore and any unlocked World Fragments.
 * @private
 */
async function _showLoreModal() {
    const themeId = state.getCurrentTheme();
    const currentUser = state.getCurrentUser();
    const themeConfig = themeService.getThemeConfig(themeId);
    if (!themeConfig) return;
    const themeDisplayName = getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeId });
    const modalContent = document.createElement('div');
    modalContent.className = 'lore-modal-content';
    modalContent.textContent = getUIText('system_processing_short'); // Loading indicator
    modalManager.showCustomModal({
        type: 'custom',
        titleKey: 'modal_title_world_lore',
        replacements: { THEME_NAME: themeDisplayName },
        htmlContent: modalContent,
        customActions: [{ textKey: 'modal_ok_button', className: 'ui-button primary', onClick: () => modalManager.hideCustomModal() }],
    });
    try {
        const baseLore = getUIText(themeConfig.lore_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
        const evolvedLore = state.getLastKnownEvolvedWorldLore();
        const loreToDisplay = evolvedLore || baseLore;

        let shards = [];
        if (currentUser && currentUser.token) {
            const shardsResponse = await apiService.fetchWorldShards(currentUser.token, themeId);
            shards = shardsResponse.worldShards || [];
        }
        modalContent.innerHTML = ''; // Clear loading text

        // Evolved Lore Section
        const loreSection = document.createElement('div');
        loreSection.className = 'lore-section';
        const loreTitle = document.createElement('h4');
        loreTitle.className = 'lore-section-title';
        loreTitle.textContent = getUIText('lore_modal_base_lore_title');
        const loreText = document.createElement('p');
        loreText.className = 'lore-text-content';
        loreText.innerHTML = uiUtils.formatDynamicText(loreToDisplay);
        uiUtils.activateShardTooltips(loreText); // Activate tooltips on the new content

        loreSection.appendChild(loreTitle);
        loreSection.appendChild(loreText);
        modalContent.appendChild(loreSection);

        // World Fragments Section
        const fragmentsSection = document.createElement('div');
        fragmentsSection.className = 'lore-section';
        const fragmentsTitle = document.createElement('h4');
        fragmentsTitle.className = 'lore-section-title';
        fragmentsTitle.textContent = getUIText('lore_modal_fragments_title');
        fragmentsSection.appendChild(fragmentsTitle);
        if (shards.length > 0) {
            const list = document.createElement('ul');
            list.className = 'lore-fragments-list';
            shards.sort((a, b) => new Date(a.unlockedAt) - new Date(b.unlockedAt));
            shards.forEach(shard => {
                const listItem = document.createElement('li');
                listItem.className = 'shard-item-readonly';
                const titleDiv = document.createElement('div');
                titleDiv.className = 'shard-title';
                titleDiv.textContent = shard.loreFragmentTitle;
                if (!shard.isActiveForNewGames) {
                    titleDiv.style.opacity = '0.6';
                    const inactiveIndicator = document.createElement('span');
                    inactiveIndicator.textContent = ' (Inactive)';
                    inactiveIndicator.style.fontStyle = 'italic';
                    titleDiv.appendChild(inactiveIndicator);
                }
                const contentDiv = document.createElement('div');
                contentDiv.className = 'shard-content';
                contentDiv.textContent = shard.loreFragmentContent;
                listItem.appendChild(titleDiv);
                listItem.appendChild(contentDiv);
                list.appendChild(listItem);
            });
            fragmentsSection.appendChild(list);
        } else {
            const noFragmentsP = document.createElement('p');
            noFragmentsP.textContent = getUIText('lore_modal_no_fragments_unlocked');
            fragmentsSection.appendChild(noFragmentsP);
        }
        modalContent.appendChild(fragmentsSection);
    } catch (error) {
        log(LOG_LEVEL_ERROR, "Failed to load lore/shards for modal:", error);
        modalManager.displayModalError(getUIText("error_api_call_failed", { ERROR_MSG: error.message }), modalContent);
    }
}


// --- PUBLIC API ---

/**
 * Initializes the CharacterPanelManager.
 * @param {object} [dependencies={}] - Optional dependencies, including `gameController`.
 */
export function initCharacterPanelManager(dependencies = {}) {
    _gameControllerRef = dependencies.gameController;
    _createBasePanelStructure();
    showCharacterPanel(false);
    showXPBar(false);
    log(LOG_LEVEL_INFO, "CharacterPanelManager initialized. Panel and XP bar hidden.");
}

/**
 * Dynamically builds the character attributes grid based on the theme's configuration.
 * @param {string} themeId - The ID of the current theme.
 */
export function buildCharacterPanel(themeId) {
    const themeConfig = themeService.getThemeConfig(themeId);
    const grid = document.getElementById('character-attributes-grid');
    const rightContainer = dom.characterProgressionPanel.querySelector('.character-info-right');
    if (!grid || !rightContainer) {
        log(LOG_LEVEL_ERROR, "Character panel grid or right container not found. Cannot build panel.");
        return;
    }

    grid.innerHTML = '';
    rightContainer.innerHTML = '';
    const topPanelConfig = themeConfig?.dashboard_config?.top_panel || [];

    topPanelConfig.forEach(itemConfig => {
        if (itemConfig.id === 'strain_level') return; // Strain is handled separately.
        const itemContainer = document.createElement('div');
        itemContainer.id = `cp-item-${itemConfig.id}`;
        itemContainer.className = 'attribute-item';

        const label = document.createElement('span');
        label.className = 'attribute-label';
        label.textContent = getUIText(itemConfig.label_key);
        itemContainer.appendChild(label);

        if (itemConfig.type === 'meter') {
            const meterContainer = document.createElement('div');
            meterContainer.className = 'attribute-meter-container';
            const meterBar = document.createElement('div');
            meterBar.id = `char-panel-${itemConfig.id}-meter`;
            meterBar.className = 'attribute-meter-bar';
            meterContainer.appendChild(meterBar);
            itemContainer.appendChild(meterContainer);
            const valueDisplay = document.createElement('span');
            valueDisplay.id = `char-panel-${itemConfig.id}-value`;
            valueDisplay.className = 'attribute-value';
            itemContainer.appendChild(valueDisplay);
        } else if (itemConfig.type === 'number') {
            const valueDisplay = document.createElement('span');
            valueDisplay.id = `char-panel-${itemConfig.id}-value`;
            valueDisplay.className = 'attribute-value';
            itemContainer.appendChild(valueDisplay);
        }

        if (itemConfig.tooltip_key) {
            const tooltipIcon = document.createElement('span');
            tooltipIcon.className = 'info-tooltip-trigger';
            tooltipIcon.setAttribute('role', 'button');
            tooltipIcon.setAttribute('tabindex', '0');
            attachTooltip(tooltipIcon, itemConfig.tooltip_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
            itemContainer.appendChild(tooltipIcon);
        }
        grid.appendChild(itemContainer);
    });

    _createIconButtons(rightContainer);
}

/**
 * Shows a modal displaying the character's persistent progress for a specific theme.
 * @param {string} themeId - The ID of the theme for which to show progress.
 */
export async function showCharacterProgressModal(themeId) {
    const themeConfig = themeService.getThemeConfig(themeId);
    const progress = state.getCurrentTheme() === themeId ?
        state.getCurrentUserThemeProgress() :
        state.getLandingSelectedThemeProgress();
    const currentUser = state.getCurrentUser();

    if (!themeConfig || !progress || !currentUser) {
        log(LOG_LEVEL_ERROR, "Could not show character progress modal. Missing themeConfig, progress data, or user.");
        return;
    }

    let allThemeTraits = themeService.getThemeTraits(themeId);
    if (!allThemeTraits) {
        log(LOG_LEVEL_INFO, `Traits for ${themeId} not cached. Fetching for progress modal...`);
        await themeService.fetchAndCachePromptFile(themeId, 'traits');
        allThemeTraits = themeService.getThemeTraits(themeId); // Re-attempt
    }

    const lang = state.getCurrentAppLanguage();
    const themeDisplayName = getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeId });
    const content = document.createElement('div');
    content.className = 'character-progress-modal-content';

    // Character Name Section
    const nameChangeSection = document.createElement('div');
    nameChangeSection.className = 'progress-name-section';
    const nameDisplayContainer = document.createElement('div');
    nameDisplayContainer.className = 'name-display-container';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'name-label';
    nameLabel.textContent = getUIText('label_profile_character_name');
    const currentNameSpan = document.createElement('span');
    currentNameSpan.className = 'current-character-name';
    currentNameSpan.textContent = progress.characterName || `(${getUIText('unknown')})`;
    const changeNameButton = document.createElement('button');
    changeNameButton.className = 'ui-button small';
    changeNameButton.textContent = getUIText('button_change_name');
    attachTooltip(changeNameButton, 'tooltip_change_name');
    changeNameButton.addEventListener('click', async () => {
        const newNameResult = await modalManager.showCustomModal({
            type: 'prompt',
            titleKey: 'modal_title_change_character_name',
            inputPlaceholderKey: 'placeholder_character_name',
            defaultValue: progress.characterName || '',
            confirmTextKey: 'button_confirm_name_change',
        });
        if (newNameResult !== null && newNameResult.trim() && newNameResult.trim() !== (progress.characterName || '')) {
            try {
                const newName = newNameResult.trim();
                const response = await apiService.updateUserThemeProgress(currentUser.token, themeId, { characterName: newName });
                if (state.getCurrentTheme() === themeId) {
                    state.setCurrentUserThemeProgress(response.userThemeProgress);
                    state.setPlayerIdentifier(newName);
                    updateCharacterPanel(true);
                } else {
                    state.setLandingSelectedThemeProgress(response.userThemeProgress);
                }
                currentNameSpan.textContent = newName;
                progress.characterName = newName; // Update local object for subsequent clicks in same modal
                modalManager.displayModalError(getUIText('alert_character_name_changed_success', { CHARACTER_NAME: newName }));
            } catch (error) {
                log(LOG_LEVEL_ERROR, 'Failed to update character name', error);
                modalManager.displayModalError(getUIText('error_api_call_failed', { ERROR_MSG: error.message }));
            }
        } else if (newNameResult !== null) {
            log(LOG_LEVEL_DEBUG, "Character name change cancelled or name was unchanged.");
        }
    });
    nameDisplayContainer.appendChild(nameLabel);
    nameDisplayContainer.appendChild(currentNameSpan);
    nameDisplayContainer.appendChild(changeNameButton);
    nameChangeSection.appendChild(nameDisplayContainer);
    content.appendChild(nameChangeSection);

    // Stats List
    const statsList = document.createElement('dl');
    statsList.className = 'progress-stats-list';
    const createStatItem = (labelKey, value) => {
        const dt = document.createElement('dt');
        dt.textContent = getUIText(labelKey);
        const dd = document.createElement('dd');
        dd.textContent = value;
        statsList.append(dt, dd);
    };
    const xpForNextLevel = progress.level < XP_LEVELS.length ? XP_LEVELS[progress.level] : 'MAX';
    createStatItem('label_char_progress_level', progress.level || 1);
    createStatItem('label_char_progress_xp', `${progress.currentXP || 0} / ${xpForNextLevel}`);
    createStatItem('label_char_progress_integrity', `${themeConfig.base_attributes.integrity} (+${progress.maxIntegrityBonus || 0})`);
    createStatItem('label_char_progress_willpower', `${themeConfig.base_attributes.willpower} (+${progress.maxWillpowerBonus || 0})`);
    createStatItem('label_char_progress_aptitude', `${themeConfig.base_attributes.aptitude} (+${progress.aptitudeBonus || 0})`);
    createStatItem('label_char_progress_resilience', `${themeConfig.base_attributes.resilience} (+${progress.resilienceBonus || 0})`);
    content.appendChild(statsList);

    // Traits List
    const traitsSection = document.createElement('div');
    traitsSection.className = 'progress-traits-section';
    const traitsTitle = document.createElement('h4');
    traitsTitle.textContent = getUIText('label_char_progress_traits');
    traitsSection.appendChild(traitsTitle);
    const acquiredTraits = Array.isArray(progress.acquiredTraitKeys) ? progress.acquiredTraitKeys : [];
    if (acquiredTraits.length > 0 && allThemeTraits) {
        const list = document.createElement('ul');
        list.className = 'traits-list';
        acquiredTraits.forEach(traitKey => {
            const traitDefinition = allThemeTraits[traitKey];
            const localizedTrait = traitDefinition?.[lang] || traitDefinition?.['en'];
            if (localizedTrait) {
                const listItem = document.createElement('li');
                listItem.className = 'trait-item';
                listItem.innerHTML = `<span class="trait-name">${localizedTrait.name}</span><span class="trait-description">${localizedTrait.description}</span>`;
                list.appendChild(listItem);
            } else {
                log(LOG_LEVEL_WARN, `Data for acquired trait key '${traitKey}' not found.`);
            }
        });
        traitsSection.appendChild(list);
    } else {
        const noTraitsP = document.createElement('p');
        noTraitsP.textContent = getUIText('label_char_progress_no_traits');
        traitsSection.appendChild(noTraitsP);
    }
    content.appendChild(traitsSection);

    // Danger Zone
    const dangerZone = document.createElement('div');
    dangerZone.className = 'danger-zone';
    const dangerTitle = document.createElement('h4');
    dangerTitle.className = 'danger-zone-title';
    dangerTitle.textContent = getUIText('title_danger_zone');
    const resetButton = document.createElement('button');
    resetButton.className = 'ui-button danger';
    resetButton.textContent = getUIText('button_reset_character');
    attachTooltip(resetButton, 'tooltip_reset_character');
    resetButton.addEventListener('click', () => {
        hideCurrentTooltip();
        if (_gameControllerRef) {
            _gameControllerRef.initiateCharacterResetFlow(themeId);
        }
    });
    dangerZone.append(dangerTitle, resetButton);
    content.appendChild(dangerZone);

    modalManager.showCustomModal({
        type: 'custom',
        titleKey: 'modal_title_character_progress',
        replacements: { THEME_NAME: themeDisplayName },
        htmlContent: content,
        customActions: [{ textKey: 'modal_ok_button', className: 'ui-button primary', onClick: () => modalManager.hideCustomModal() }],
    });
}

/**
 * Shows or hides the character progression panel.
 * @param {boolean} show - True to show, false to hide.
 */
export function showCharacterPanel(show) {
    if (characterProgressionPanel) {
        characterProgressionPanel.style.display = show ? 'flex' : 'none';
        log(LOG_LEVEL_DEBUG, `Character panel display set to: ${show ? 'flex' : 'none'}`);
    } else {
        log(LOG_LEVEL_WARN, "Character progression panel DOM element not found.");
    }
}

/**
 * Shows or hides the XP bar.
 * @param {boolean} show - True to show, false to hide.
 */
export function showXPBar(show) {
    if (xpBarContainer) {
        xpBarContainer.style.display = show ? 'flex' : 'none';
        log(LOG_LEVEL_DEBUG, `XP bar display set to: ${show ? 'flex' : 'none'}`);
    } else {
        log(LOG_LEVEL_WARN, "XP bar container DOM element not found.");
    }
}

/**
 * Animates the XP bar and text to show experience gain.
 * @param {number} xpGained - The amount of experience points gained.
 */
export function animateXpGain(xpGained) {
    if (!xpBarContainer || !xpBarText || xpGained <= 0) return;

    const popup = document.createElement('div');
    popup.className = 'xp-gain-popup';
    popup.textContent = `+${xpGained} XP`;
    document.body.appendChild(popup);

    const textRect = xpBarText.getBoundingClientRect();
    popup.style.left = `${textRect.left + (textRect.width / 2) - 10}px`;
    popup.style.top = `${textRect.top - 10}px`;

    setTimeout(() => {
        if (document.body.contains(popup)) document.body.removeChild(popup);
    }, 5000);

    xpBarText.classList.add('updated');
    setTimeout(() => {
        if (document.body.contains(xpBarText)) xpBarText.classList.remove('updated');
    }, 6000);
}

/**
 * Triggers a visual animation on one of the character panel icon buttons.
 * @param {'inventory' | 'character_progress' | 'lore'} iconId - The ID of the icon to animate.
 */
export function triggerIconAnimation(iconId) {
    const button = document.getElementById(`char-panel-${iconId}-button`);
    if (!button) {
        log(LOG_LEVEL_WARN, `Could not find icon button with ID 'char-panel-${iconId}-button' to animate.`);
        return;
    }

    log(LOG_LEVEL_DEBUG, `Triggering animation for icon: ${iconId}`);
    const iconWrapper = button.querySelector('.icon-wrapper');
    if (iconWrapper && typeof iconWrapper.animate === 'function') {
        iconWrapper.animate([
            { transform: 'scale(1)', backgroundColor: 'var(--color-text-muted)' },
            { transform: 'scale(1.25)', backgroundColor: 'var(--color-accent-main)' },
            { transform: 'scale(1)', backgroundColor: 'var(--color-text-muted)' },
        ], {
            duration: 1200,
            iterations: 4,
            easing: 'ease-in-out',
        });
    } else {
        log(LOG_LEVEL_WARN, `Could not find .icon-wrapper or Web Animations API not supported.`);
    }
}

/**
 * Updates the character progression panel and XP bar with the latest data from the state.
 * @param {boolean} [highlight=true] - If true, updated values will flash to draw attention.
 */
export function updateCharacterPanel(highlight = true) {
    if (!characterProgressionPanel || characterProgressionPanel.style.display === 'none') return;

    const themeId = state.getCurrentTheme();
    if (!themeId) return;

    const themeConfig = themeService.getThemeConfig(themeId);
    const topPanelConfig = themeConfig?.dashboard_config?.top_panel || [];

    // Update Identity Block
    let playerIdentifier = state.getPlayerIdentifier() || getUIText('char_panel_unnamed_protagonist');
    const level = state.getPlayerLevel();
    const idEl = document.getElementById('char-panel-identifier');
    const levelEl = document.getElementById('char-panel-level');

    if (idEl && idEl.textContent !== playerIdentifier) {
        idEl.textContent = playerIdentifier;
        if (highlight) uiUtils.flashElement(idEl);
    }
    const levelText = `${getUIText("char_panel_label_level")} ${level}`;
    if (levelEl && levelEl.textContent !== levelText) {
        levelEl.textContent = levelText;
        if (highlight) uiUtils.flashElement(levelEl);
    }

    // Update Attributes
    const runStats = state.getCurrentRunStats();
    topPanelConfig.forEach(itemConfig => {
        let itemValue;
        if (itemConfig.id === 'aptitude') itemValue = state.getEffectiveAptitude();
        else if (itemConfig.id === 'resilience') itemValue = state.getEffectiveResilience();
        else if (itemConfig.maps_to_run_stat) itemValue = runStats[itemConfig.maps_to_run_stat];
        if (itemValue === undefined) return;

        const valueEl = document.getElementById(`char-panel-${itemConfig.id}-value`);
        const meterEl = document.getElementById(`char-panel-${itemConfig.id}-meter`);

        if (itemConfig.type === 'meter') {
            let maxVal = 100;
            if (itemConfig.id === 'integrity') maxVal = state.getEffectiveMaxIntegrity();
            else if (itemConfig.id === 'willpower') maxVal = state.getEffectiveMaxWillpower();

            const percentage = maxVal > 0 ? (itemValue / maxVal) * 100 : 0;
            const newTextContent = `${itemValue}/${maxVal}`;

            if (valueEl && valueEl.textContent !== newTextContent) {
                valueEl.textContent = newTextContent;
                if (highlight) uiUtils.flashElement(valueEl);
            }
            if (meterEl) {
                meterEl.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
                meterEl.className = 'attribute-meter-bar'; // Reset classes
                if (percentage <= 25) meterEl.classList.add('meter-low');
                else if (percentage <= 50) meterEl.classList.add('meter-medium');
                else meterEl.classList.add('meter-full');

                if (percentage > 50) {
                    if (itemConfig.meter_type === 'health') meterEl.classList.add('integrity-full');
                    if (itemConfig.meter_type === 'stamina') meterEl.classList.add('willpower-full');
                }
            }
        } else if (itemConfig.type === 'number') {
            const newTextContent = String(itemValue);
            if (valueEl && valueEl.textContent !== newTextContent) {
                valueEl.textContent = newTextContent;
                if (highlight) uiUtils.flashElement(valueEl);
            }
        } else if (itemConfig.type === 'status_icon') {
            const iconEl = document.getElementById('char-panel-strain-icon');
            const levelConfig = itemConfig.level_mappings?.[String(itemValue)];
            if (iconEl && levelConfig) {
                const newClass = levelConfig.css_class || 'status-info';
                if (!iconEl.classList.contains(newClass)) {
                    iconEl.className = 'attribute-value status-icon ' + newClass;
                    if (highlight) uiUtils.flashElement(iconEl);
                }
                iconEl.style.webkitMaskImage = `url(${levelConfig.icon_path})`;
                iconEl.style.maskImage = `url(${levelConfig.icon_path})`;
                const tooltipText = getUIText(levelConfig.display_text_key, {}, { explicitThemeContext: themeId });
                attachTooltip(iconEl, null, {}, { rawText: tooltipText });
            }
        }
    });

    // Update XP Bar
    const userProgress = state.getCurrentUserThemeProgress();
    if (xpBarContainer && xpBarFill && xpBarText && userProgress) {
        const currentLevel = userProgress.level;
        const currentXP = userProgress.currentXP;
        const xpForNextLevel = currentLevel < MAX_PLAYER_LEVEL ? XP_LEVELS[currentLevel] : currentXP;
        const xpForCurrentLevel = XP_LEVELS[currentLevel - 1] || 0;
        const xpIntoCurrentLevel = currentXP - xpForCurrentLevel;
        const xpNeededForThisLevel = xpForNextLevel - xpForCurrentLevel;
        const xpPercentage = (currentLevel >= MAX_PLAYER_LEVEL || xpNeededForThisLevel <= 0) ?
            100 :
            (xpIntoCurrentLevel / xpNeededForThisLevel) * 100;

        xpBarFill.style.width = `${Math.max(0, Math.min(100, xpPercentage))}%`;
        const newXpText = (currentLevel >= MAX_PLAYER_LEVEL) ?
            getUIText("xp_bar_max_level") :
            `${getUIText("xp_bar_label_xp")} ${currentXP}/${xpForNextLevel}`;

        if (xpBarText.textContent !== newXpText) {
            xpBarText.textContent = newXpText;
        }
    }
}

/**
 * Updates the static labels in the character panel based on the current language.
 */
export function retranslateCharacterPanelLabels() {
    if (!characterProgressionPanel) return;

    const themeId = state.getCurrentTheme();
    if (!themeId) return;

    const levelEl = document.getElementById('char-panel-level');
    if (levelEl) levelEl.textContent = `${getUIText("char_panel_label_level")} ${state.getPlayerLevel()}`;

    const themeConfig = themeService.getThemeConfig(themeId);
    const topPanelConfig = themeConfig?.dashboard_config?.top_panel || [];

    topPanelConfig.forEach(itemConfig => {
        const itemContainer = document.getElementById(`cp-item-${itemConfig.id}`);
        if (itemContainer) {
            const labelEl = itemContainer.querySelector('.attribute-label');
            if (labelEl) labelEl.textContent = getUIText(itemConfig.label_key);

            const tooltipTrigger = itemContainer.querySelector('.info-tooltip-trigger');
            if (tooltipTrigger && itemConfig.tooltip_key) {
                attachTooltip(tooltipTrigger, itemConfig.tooltip_key, {}, { explicitThemeContext: themeId, viewContext: 'game' });
            }
        }
    });

    const rightContainer = dom.characterProgressionPanel.querySelector('.character-info-right');
    if (rightContainer) {
        const buttons = [
            { id: 'lore', tooltipKey: 'tooltip_lore_button' },
            { id: 'inventory', tooltipKey: 'tooltip_inventory_button' },
            { id: 'character_progress', tooltipKey: 'tooltip_character_progress' },
        ];
        buttons.forEach(btn => {
            const el = rightContainer.querySelector(`#char-panel-${btn.id}-button`);
            if (el) attachTooltip(el, btn.tooltipKey);
        });
        const storeBtn = rightContainer.querySelector('#char-panel-store-button');
        if (storeBtn) {
            const currentLevel = state.getPlayerLevel();
            const tooltipKey = currentLevel < MIN_LEVEL_FOR_STORE ? 'tooltip_store_locked_level' : 'tooltip_store_button';
            const tooltipReplacements = { MIN_LEVEL: MIN_LEVEL_FOR_STORE };
            attachTooltip(storeBtn, tooltipKey, tooltipReplacements);
        }
    }

    log(LOG_LEVEL_DEBUG, "Character panel labels and tooltips re-translated.");
    updateCharacterPanel(false);
}
