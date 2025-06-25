/**
 * @file Central orchestrator for the game flow. Manages transitions between
 * landing page and game view, starting new games, processing player actions,
 * and changing themes.
 */

// --- Core Application Logic & Services ---
import * as state from '../core/state.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { MAX_PLAYER_LEVEL, BOON_DEFINITIONS, MIN_LEVEL_FOR_STORE, XP_LEVELS } from '../core/config.js';

// --- Business Logic Services ---
import * as apiService from '../core/apiService.js';
import * as authService from '../services/authService.js';
import * as themeService from '../services/themeService.js';
import * as aiService from '../services/aiService.js';
import * as localizationService from '../services/localizationService.js';

// --- UI Management ---
import * as dom from '../ui/domElements.js';
import * as uiUtils from '../ui/uiUtils.js';
import * as storyLogManager from '../ui/storyLogManager.js';
import * as modalManager from '../ui/modalManager.js';
import * as landingPageManager from '../ui/landingPageManager.js';
import * as dashboardManager from '../ui/dashboardManager.js';
import * as characterPanelManager from '../ui/characterPanelManager.js';
import * as worldShardsModalManager from '../ui/worldShardsModalManager.js';
import * as suggestedActionsManager from '../ui/suggestedActionsManager.js';
import * as modelToggleManager from '../ui/modelToggleManager.js';

let _deferredInitialActionText = null;
let _userThemeControlsManagerRef = null;
let _boonSelectionContext = { step: 'none' };

// =================================================================================================
// SECTION: Private Game State & Character Setup Helpers
// =================================================================================================

/**
 * Loads the UserThemeProgress for the current user and theme, or initializes a default one.
 * @param {string} themeId - The ID of the theme.
 * @private
 */
async function _loadOrCreateUserThemeProgress(themeId) {
    const currentUser = state.getCurrentUser();
    let progressData;

    if (currentUser?.token) {
        try {
            log(LOG_LEVEL_DEBUG, `Fetching UserThemeProgress for user ${currentUser.email}, theme ${themeId}.`);
            const response = await apiService.fetchUserThemeProgress(currentUser.token, themeId);
            progressData = response.userThemeProgress;
        } catch (error) {
            log(LOG_LEVEL_ERROR, `Error fetching UserThemeProgress for ${themeId}. Initializing default.`, error.message);
        }
    }

    if (!progressData) {
        log(LOG_LEVEL_INFO, `No progress found or user is anonymous. Initializing default progress for theme ${themeId}.`);
        progressData = {
            userId: currentUser?.id,
            themeId: themeId,
            level: 1,
            currentXP: 0,
            maxIntegrityBonus: 0,
            maxWillpowerBonus: 0,
            aptitudeBonus: 0,
            resilienceBonus: 0,
            acquiredTraitKeys: [],
        };
    }

    state.setCurrentUserThemeProgress(progressData);
    log(LOG_LEVEL_DEBUG, `UserThemeProgress set in state for theme ${themeId}.`);
}

/**
 * Initializes current run stats (Integrity, Willpower) based on effective maximums.
 * @private
 */
async function _initializeCurrentRunStats() {
    state.setCurrentRunStats({
        currentIntegrity: state.getEffectiveMaxIntegrity(),
        currentWillpower: state.getEffectiveMaxWillpower(),
        strainLevel: 1,
        conditions: [],
    });
    log(LOG_LEVEL_DEBUG, `Current run stats initialized: IG ${state.getEffectiveMaxIntegrity()}, WP ${state.getEffectiveMaxWillpower()}`);
}

/**
 * Equips starting gear based on the player's level for the given theme.
 * @param {string} themeId - The ID of the theme.
 * @private
 */
async function _equipStartingGear(themeId) {
    const themeConfig = themeService.getThemeConfig(themeId);
    if (!themeConfig?.equipment_slots) {
        log(LOG_LEVEL_WARN, `No equipment slots defined for theme ${themeId}. Skipping starting gear.`);
        return;
    }

    const playerLevel = state.getPlayerLevel();
    const lang = localizationService.getApplicationLanguage();
    const equipmentSlots = themeConfig.equipment_slots;
    const startingGear = {};

    log(LOG_LEVEL_INFO, `Equipping starting gear for theme ${themeId} at level ${playerLevel}.`);

    for (const slotKey in equipmentSlots) {
        const slotConfig = equipmentSlots[slotKey];
        if (slotConfig.type === 'money') continue;

        const items = await themeService.fetchAndCacheItemData(themeId, slotKey);
        if (items?.length > 0) {
            const suitableItems = items.filter(item => item.level <= playerLevel);
            if (suitableItems.length > 0) {
                const bestItem = suitableItems.reduce((best, current) => (current.level > best.level ? current : best), suitableItems[0]);
                startingGear[slotKey] = bestItem;

                const itemName = bestItem.name?.[lang] || bestItem.name?.['en'] || 'Unknown Item';
                const effectDescription = bestItem.itemEffectDescription?.[lang] || bestItem.itemEffectDescription?.['en'] || localizationService.getUIText('unknown');
                const fullItemDescription = `<span class="equipped-item-name">${itemName}</span><br><em class="equipped-item-effect">${effectDescription}</em>`;
                dashboardManager.updateDashboardItem(slotConfig.id, fullItemDescription, false);
                log(LOG_LEVEL_DEBUG, `Equipped level ${bestItem.level} item '${itemName}' in slot '${slotKey}'.`);
            }
        }
    }

    state.setEquippedItems(startingGear);
    state.setCurrentInventory([]); // Starting inventory is empty
    log(LOG_LEVEL_INFO, 'Starting gear setup complete.');
}

/**
 * Displays a special, animated notification in the story log when a World Shard is unlocked.
 * The notification has a border that "wipes away" and then the entire element fades out.
 * @param {string} title - The title of the unlocked shard.
 * @private
 */
function _showAnimatedShardUnlock(title) {
    if (!dom.storyLog || !dom.storyLogViewport) return;

    const messageText = localizationService.getUIText('notification_world_shard_unlocked', { TITLE: title });
    const BORDER_ANIMATION_DURATION = 4000; // ms
    const FADE_OUT_DURATION = 1000; // ms
    const FADE_OUT_DELAY = 500; // ms, a brief pause after border disappears

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-message system-emphasized shard-unlock-notification';
    msgDiv.innerHTML = `<p>${messageText}</p>`;

    // Set CSS custom properties to sync JS timing with CSS animations
    msgDiv.style.setProperty('--border-wipe-duration', `${BORDER_ANIMATION_DURATION}ms`);
    msgDiv.style.setProperty('--fade-out-duration', `${FADE_OUT_DURATION}ms`);
    msgDiv.style.setProperty('--fade-out-delay', `${FADE_OUT_DELAY}ms`);

    dom.storyLog.appendChild(msgDiv);

    // Scroll to bottom to ensure the notification is visible
    requestAnimationFrame(() => {
        dom.storyLogViewport.scrollTop = dom.storyLogViewport.scrollHeight;
    });

    // Since animationend doesn't fire for pseudo-elements, we use timeouts synced with the CSS.
    // Timeout to start the fade-out after the border wipe animation completes.
    setTimeout(() => {
        if (dom.storyLog.contains(msgDiv)) {
            msgDiv.classList.add('is-fading-out');
        }
    }, BORDER_ANIMATION_DURATION + FADE_OUT_DELAY);

    // Timeout to remove the element from the DOM after the fade-out completes.
    setTimeout(() => {
        if (dom.storyLog.contains(msgDiv)) {
            dom.storyLog.removeChild(msgDiv);
        }
    }, BORDER_ANIMATION_DURATION + FADE_OUT_DELAY + FADE_OUT_DURATION);
}

// =================================================================================================
// SECTION: XP, Boons, and Initial Traits
// =================================================================================================

/**
 * Handles XP gain and checks for level-ups, triggering the boon selection flow if necessary.
 * @param {number} xpAwarded - The amount of XP awarded this turn.
 * @private
 */
async function _handleExperienceAndLevelUp(xpAwarded) {
    if (xpAwarded <= 0) return;

    const progress = state.getCurrentUserThemeProgress();
    if (!progress) {
        log(LOG_LEVEL_ERROR, "Cannot process XP: currentUserThemeProgress is null.");
        return;
    }

    progress.currentXP += xpAwarded;
    characterPanelManager.animateXpGain(xpAwarded);

    const currentLevel = progress.level;
    if (currentLevel >= MAX_PLAYER_LEVEL) {
        log(LOG_LEVEL_INFO, `Player at max level (${MAX_PLAYER_LEVEL}). Total XP: ${progress.currentXP}`);
    } else {
        const xpForNextLevel = XP_LEVELS[currentLevel];
        if (progress.currentXP >= xpForNextLevel) {
            state.setLastAiSuggestedActions(state.getCurrentSuggestedActions());
            state.setIsBoonSelectionPending(true);
            storyLogManager.addMessageToLog(localizationService.getUIText("system_level_up", { NEW_LEVEL: currentLevel + 1 }), "system system-emphasized");
            log(LOG_LEVEL_INFO, `Level up condition met for level ${currentLevel + 1}.`);

            state.setCurrentUserThemeProgress(progress);
            await authService.saveCurrentGameState();
            _presentPrimaryBoonChoices();
        }
    }

    state.setCurrentUserThemeProgress(progress);
    characterPanelManager.updateCharacterPanel();
}

/**
 * Presents the primary Boon selection choices to the player.
 * @private
 */
function _presentPrimaryBoonChoices() {
    _boonSelectionContext.step = 'primary';
    const headerText = localizationService.getUIText("system_boon_selection_prompt");
    const boonChoices = [
        { text: localizationService.getUIText(BOON_DEFINITIONS.MAX_INTEGRITY_INCREASE.descriptionKey, { VALUE: BOON_DEFINITIONS.MAX_INTEGRITY_INCREASE.value }), isBoonChoice: true, boonId: 'PRIMARY_MAX_IG' },
        { text: localizationService.getUIText(BOON_DEFINITIONS.MAX_WILLPOWER_INCREASE.descriptionKey, { VALUE: BOON_DEFINITIONS.MAX_WILLPOWER_INCREASE.value }), isBoonChoice: true, boonId: 'PRIMARY_MAX_WP' },
        { text: localizationService.getUIText('boon_primary_choose_attribute'), isBoonChoice: true, boonId: 'PRIMARY_ATTR_ENH' },
        { text: localizationService.getUIText('boon_primary_choose_trait'), isBoonChoice: true, boonId: 'PRIMARY_NEW_TRAIT' }
    ];

    suggestedActionsManager.displaySuggestedActions(boonChoices, { headerText });
    if (dom.playerActionInput) {
        dom.playerActionInput.placeholder = localizationService.getUIText("placeholder_boon_selection");
        state.setCurrentAiPlaceholder(dom.playerActionInput.placeholder);
    }
    uiUtils.setGMActivityIndicator(false);
    uiUtils.setPlayerInputEnabled(false);
}

/**
 * Presents secondary Boon choices (attributes or traits) after a primary selection.
 * @param {'attribute'|'trait'} type - The type of secondary choice to present.
 * @private
 */
function _presentSecondaryBoonChoices(type) {
    let secondaryChoices = [];
    const headerText = localizationService.getUIText("system_boon_selection_prompt");

    if (type === 'attribute') {
        _boonSelectionContext.step = 'secondary_attribute';
        secondaryChoices.push({ text: localizationService.getUIText(BOON_DEFINITIONS.APTITUDE_INCREASE.descriptionKey, { VALUE: BOON_DEFINITIONS.APTITUDE_INCREASE.value }), isBoonChoice: true, boonId: 'SECONDARY_APTITUDE' });
        secondaryChoices.push({ text: localizationService.getUIText(BOON_DEFINITIONS.RESILIENCE_INCREASE.descriptionKey, { VALUE: BOON_DEFINITIONS.RESILIENCE_INCREASE.value }), isBoonChoice: true, boonId: 'SECONDARY_RESILIENCE' });
    } else if (type === 'trait') {
        _boonSelectionContext.step = 'secondary_trait';
        const themeId = state.getCurrentTheme();
        const allThemeTraits = themeService.getThemeTraits(themeId);
        const acquiredTraitKeys = state.getAcquiredTraitKeys();

        if (!allThemeTraits) {
            log(LOG_LEVEL_ERROR, `Cannot offer trait boon: No traits defined for theme ${themeId}.`);
            storyLogManager.addMessageToLog("SYSTEM ERROR: Trait definitions for this theme are missing. Please choose another Boon.", "system-error");
            _presentPrimaryBoonChoices();
            return;
        }

        const availableTraitKeys = Object.keys(allThemeTraits).filter(key => !acquiredTraitKeys.includes(key));
        if (availableTraitKeys.length === 0) {
            storyLogManager.addMessageToLog("No new traits available. Please choose another Boon.", "system-error");
            _presentPrimaryBoonChoices();
            return;
        }

        const lang = state.getCurrentAppLanguage();
        const traitsToOffer = availableTraitKeys.sort(() => 0.5 - Math.random()).slice(0, 3);
        traitsToOffer.forEach(traitKey => {
            const traitData = allThemeTraits[traitKey];
            const localizedTrait = traitData?.[lang] || traitData?.['en'];
            if (localizedTrait) {
                secondaryChoices.push({
                    text: `${localizedTrait.name}: ${localizedTrait.description}`,
                    displayText: localizedTrait.name,
                    descriptionForTooltip: localizedTrait.description,
                    isBoonChoice: true,
                    boonId: `TRAIT_${traitKey.toUpperCase()}`
                });
            }
        });
    }

    suggestedActionsManager.displaySuggestedActions(secondaryChoices, { headerText });
    uiUtils.setPlayerInputEnabled(false);
}

/**
 * Handles the player's Boon selection and triggers finalization.
 * @param {string} boonId - The ID of the selected Boon.
 * @param {string} boonDisplayText - The display text of the boon, for logging.
 * @private
 */
async function _handleBoonSelection(boonId, boonDisplayText) {
    log(LOG_LEVEL_INFO, `Handling boon selection (Step: ${_boonSelectionContext.step}) for choice: ${boonId}`);
    const step = _boonSelectionContext.step;

    if (step === 'primary') {
        switch (boonId) {
            case 'PRIMARY_MAX_IG':
                return _applyBoonAndFinalize({ boonType: "MAX_ATTRIBUTE_INCREASE", targetAttribute: "maxIntegrityBonus", value: BOON_DEFINITIONS.MAX_INTEGRITY_INCREASE.value });
            case 'PRIMARY_MAX_WP':
                return _applyBoonAndFinalize({ boonType: "MAX_ATTRIBUTE_INCREASE", targetAttribute: "maxWillpowerBonus", value: BOON_DEFINITIONS.MAX_WILLPOWER_INCREASE.value });
            case 'PRIMARY_ATTR_ENH':
                return _presentSecondaryBoonChoices('attribute');
            case 'PRIMARY_NEW_TRAIT':
                return _presentSecondaryBoonChoices('trait');
        }
    } else if (step === 'secondary_attribute') {
        let payload;
        if (boonId === 'SECONDARY_APTITUDE') payload = { boonType: "ATTRIBUTE_ENHANCEMENT", targetAttribute: "aptitudeBonus", value: BOON_DEFINITIONS.APTITUDE_INCREASE.value };
        if (boonId === 'SECONDARY_RESILIENCE') payload = { boonType: "ATTRIBUTE_ENHANCEMENT", targetAttribute: "resilienceBonus", value: BOON_DEFINITIONS.RESILIENCE_INCREASE.value };
        if (payload) return _applyBoonAndFinalize(payload);
    } else if (step === 'secondary_trait' && boonId.startsWith('TRAIT_')) {
        const traitKey = boonId.replace('TRAIT_', '').toLowerCase();
        return _applyBoonAndFinalize({ boonType: "NEW_TRAIT", value: traitKey });
    }
}

/**
 * Finalizes the boon application by calling the API and updating the UI after an animation frame.
 * @param {object} payload - The boon payload for the API.
 * @private
 */
function _applyBoonAndFinalize(payload) {
    characterPanelManager.triggerIconAnimation('character_progress');

    // Schedule the blocking work after the next browser paint to ensure animation is smooth.
    requestAnimationFrame(() => {
        setTimeout(async () => {
            uiUtils.setGMActivityIndicator(true);
            storyLogManager.showLoadingIndicator();
            try {
                const currentUser = state.getCurrentUser();
                const themeId = state.getCurrentTheme();
                if (!currentUser?.token || !themeId) throw new Error("User or theme context lost during Boon finalization.");

                const response = await apiService.applyBoonSelection(currentUser.token, themeId, payload);
                state.setCurrentUserThemeProgress(response.userThemeProgress);
                state.setIsBoonSelectionPending(false);
                _boonSelectionContext.step = 'none';
                await _initializeCurrentRunStats();
                characterPanelManager.updateCharacterPanel();

                const restoredActions = state.getLastAiSuggestedActions();
                state.setCurrentSuggestedActions(restoredActions || []);
                suggestedActionsManager.displaySuggestedActions(state.getCurrentSuggestedActions());

                uiUtils.setPlayerInputEnabled(true);
                if (dom.playerActionInput) {
                    dom.playerActionInput.placeholder = state.getCurrentAiPlaceholder() || localizationService.getUIText("placeholder_command");
                    dom.playerActionInput.focus();
                }

                await authService.saveCurrentGameState(true);
            } catch (error) {
                log(LOG_LEVEL_ERROR, "Error applying Boon:", error);
                storyLogManager.addMessageToLog(localizationService.getUIText("error_api_call_failed", { ERROR_MSG: error.message || "Failed to apply Boon." }), "system system-error");
                _presentPrimaryBoonChoices();
            } finally {
                uiUtils.setGMActivityIndicator(false);
                storyLogManager.removeLoadingIndicator();
            }
        }, 20);
    });
}

/**
 * Presents the initial trait selection choices to a new character.
 * @private
 */
function _presentInitialTraitChoices() {
    const headerText = localizationService.getUIText("system_initial_trait_selection_prompt");
    const themeId = state.getCurrentTheme();
    const allTraits = themeService.getThemeTraits(themeId);

    if (!allTraits) {
        log(LOG_LEVEL_ERROR, `No traits found for theme ${themeId}. Skipping initial trait selection.`);
        processPlayerAction(_deferredInitialActionText, true);
        return;
    }

    const lang = state.getCurrentAppLanguage();
    const traitKeys = Object.keys(allTraits);
    const traitsToOffer = traitKeys.sort(() => 0.5 - Math.random()).slice(0, 3);
    const traitChoices = traitsToOffer.map(key => {
        const localizedTrait = allTraits[key]?.[lang] || allTraits[key]?.['en'];
        return {
            text: `${localizedTrait.name}: ${localizedTrait.description}`,
            displayText: localizedTrait.name,
            descriptionForTooltip: localizedTrait.description,
            isTraitChoice: true,
            traitKey: key
        };
    });

    suggestedActionsManager.displaySuggestedActions(traitChoices, { headerText });
    if (dom.playerActionInput) {
        dom.playerActionInput.placeholder = localizationService.getUIText("placeholder_boon_selection");
        state.setCurrentAiPlaceholder(dom.playerActionInput.placeholder);
    }
    uiUtils.setGMActivityIndicator(false);
    uiUtils.setPlayerInputEnabled(false);
}

/**
 * Handles the player's initial trait selection and starts the game narrative.
 * @param {string} traitKey - The key of the selected trait.
 * @private
 */
function _handleInitialTraitSelection(traitKey) {
    const progress = state.getCurrentUserThemeProgress();
    if (!progress) {
        log(LOG_LEVEL_ERROR, "Cannot set initial trait: UserThemeProgress is not initialized.");
        return;
    }

    progress.acquiredTraitKeys = [traitKey];
    state.setCurrentUserThemeProgress(progress);
    state.setIsInitialTraitSelectionPending(false);
    log(LOG_LEVEL_INFO, `Initial trait '${traitKey}' selected. Proceeding to start game narrative.`);

    characterPanelManager.triggerIconAnimation('character_progress');

    requestAnimationFrame(() => {
        setTimeout(async () => {
            uiUtils.setGMActivityIndicator(true);
            storyLogManager.showLoadingIndicator();
            uiUtils.setPlayerInputEnabled(true);
            if (_deferredInitialActionText) {
                await processPlayerAction(_deferredInitialActionText, true);
                _deferredInitialActionText = null;
            } else {
                log(LOG_LEVEL_ERROR, "Deferred initial action text was missing after trait selection.");
                uiUtils.setGMActivityIndicator(false);
                storyLogManager.removeLoadingIndicator();
            }
        }, 20);
    });
}


// =================================================================================================
// SECTION: Inventory Management
// =================================================================================================

/**
 * Creates the detailed view for a single inventory item, including its stats and action button.
 * @param {object} item - The item object from state.
 * @param {boolean} isEquipped - True if the item is currently equipped.
 * @returns {HTMLElement|null} The DOM element for the item details.
 * @private
 */
function _createInventoryItemDetailElement(item, isEquipped) {
    const themeId = state.getCurrentTheme();
    if (!item || !themeId) return null;

    const lang = localizationService.getApplicationLanguage();
    const detailContainer = document.createElement('div');
    detailContainer.className = 'inventory-item-details';

    const description = document.createElement('p');
    description.className = 'inventory-item-description';
    description.textContent = item.description?.[lang] || item.description?.['en'] || '';
    if (description.textContent) {
        detailContainer.appendChild(description);
    }

    const collapsibleContent = document.createElement('div');
    collapsibleContent.className = 'inventory-item-collapsible-content';

    const attributes = item.attributes?.[lang] || item.attributes?.['en'];
    if (attributes && Object.keys(attributes).length > 0) {
        const attributesContainer = document.createElement('div');
        attributesContainer.className = 'inventory-item-stats-grid';
        for (const [key, value] of Object.entries(attributes)) {
            const statItem = document.createElement('div');
            statItem.className = 'stat-item';
            statItem.innerHTML = `<span class="stat-label">${key}</span><span class="stat-value">${value}</span>`;
            attributesContainer.appendChild(statItem);
        }
        collapsibleContent.appendChild(attributesContainer);
    }

    const abilities = item.abilities?.[lang] || item.abilities?.['en'];
    if (abilities?.length > 0) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'inventory-item-abilities';
        const abilitiesList = abilities.map(abilityText => `<li>${abilityText}</li>`).join('');
        abilitiesContainer.innerHTML = `<h5>${localizationService.getUIText('label_abilities')}</h5><ul>${abilitiesList}</ul>`;
        collapsibleContent.appendChild(abilitiesContainer);
    }

    if (collapsibleContent.hasChildNodes()) {
        detailContainer.appendChild(collapsibleContent);
    }

    const metaContainer = document.createElement('div');
    metaContainer.className = 'inventory-item-meta';
    const actionButton = document.createElement('button');
    actionButton.className = 'ui-button small inventory-action-button';
    if (isEquipped) {
        actionButton.textContent = localizationService.getUIText('button_unequip');
        actionButton.dataset.slotKey = item.itemType;
        actionButton.addEventListener('click', () => _handleUnequipItem(item.itemType));
    } else {
        actionButton.textContent = localizationService.getUIText('button_equip');
        actionButton.addEventListener('click', () => _handleEquipItem(item.id));
    }
    metaContainer.appendChild(actionButton);

    const priceInfo = document.createElement('div');
    priceInfo.className = 'price-info';
    if (item.sellPrice) priceInfo.innerHTML = `<span>${localizationService.getUIText('label_sell_price')}: ${item.sellPrice}</span>`;
    if (priceInfo.innerHTML) metaContainer.appendChild(priceInfo);
    detailContainer.appendChild(metaContainer);

    return detailContainer;
}

/**
 * Builds the complete HTML content for the inventory modal.
 * @returns {Promise<HTMLElement|null>} A promise resolving to the modal content element.
 * @private
 */
async function _buildInventoryModalContent() {
    const themeId = state.getCurrentTheme();
    if (!themeId) return null;

    const themeConfig = themeService.getThemeConfig(themeId);
    if (!themeConfig?.equipment_slots) return null;

    const lang = localizationService.getApplicationLanguage();
    const modalContent = document.createElement('div');
    modalContent.className = 'inventory-modal-content';

    const createSection = (titleKey, items, isEquippedSection) => {
        const section = document.createElement('div');
        section.className = 'inventory-section';
        const title = document.createElement('h4');
        title.textContent = localizationService.getUIText(titleKey);
        section.appendChild(title);

        if (items.length > 0) {
            const list = document.createElement('ul');
            list.className = 'inventory-list detailed';
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.className = isEquippedSection ? 'inventory-item-detailed equipped-item-slot' : 'inventory-item-detailed backpack-item';
                listItem.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    if (item.id) listItem.classList.toggle('is-expanded'); // Only expandable if there's an item
                });

                const itemHeader = document.createElement('div');
                itemHeader.className = 'inventory-slot-header';
                const slotLabel = document.createElement('span');
                slotLabel.className = 'inventory-item-slot-label';
                slotLabel.textContent = item.slotName;
                const itemName = document.createElement('span');
                itemName.className = 'inventory-item-name';
                itemName.textContent = item.id ? (item.name?.[lang] || item.name?.['en']) : localizationService.getUIText('inventory_slot_empty');
                if (!item.id) itemName.classList.add('empty');

                itemHeader.appendChild(slotLabel);
                itemHeader.appendChild(itemName);
                listItem.appendChild(itemHeader);

                if (item.id) {
                    const itemDetails = _createInventoryItemDetailElement(item, isEquippedSection);
                    if (itemDetails) listItem.appendChild(itemDetails);
                }
                list.appendChild(listItem);
            });
            section.appendChild(list);
        } else {
            const emptyMessage = document.createElement('p');
            emptyMessage.textContent = localizationService.getUIText('inventory_backpack_empty');
            section.appendChild(emptyMessage);
        }
        return section;
    };

    const allDashboardItems = [...(themeConfig.dashboard_config.left_panel || []), ...(themeConfig.dashboard_config.right_panel || [])].flatMap(p => p.items);
    const equippedItems = state.getEquippedItems();
    const equippedItemsData = Object.entries(themeConfig.equipment_slots)
        .filter(([, slotConfig]) => slotConfig.type !== 'money')
        .map(([slotKey, slotConfig]) => {
            const item = equippedItems[slotKey];
            const itemDashboardConfig = allDashboardItems.find(i => i.id === slotConfig.id);
            const slotName = itemDashboardConfig ? localizationService.getUIText(itemDashboardConfig.label_key, {}, { explicitThemeContext: themeId }) : 'Unknown Slot';
            return { ...item, slotName };
        });

    modalContent.appendChild(createSection('modal_title_equipped_items', equippedItemsData, true));
    modalContent.appendChild(createSection('modal_title_backpack', state.getCurrentInventory(), false));

    return modalContent;
}

/**
 * Equips an item from the inventory.
 * @param {string} itemId - The ID of the item to equip.
 * @private
 */
async function _handleEquipItem(itemId) {
    const themeId = state.getCurrentTheme();
    const inventory = state.getCurrentInventory();
    const itemToEquip = inventory.find(i => i.id === itemId);

    if (!itemToEquip || !themeId) return;

    log(LOG_LEVEL_INFO, `Equipping item: ${itemToEquip.name?.en || itemToEquip.id}`);

    const newEquippedItems = { ...state.getEquippedItems() };
    const newInventory = inventory.filter(i => i.id !== itemId);
    const slotKey = itemToEquip.itemType;
    const currentlyEquippedItem = newEquippedItems[slotKey];

    if (currentlyEquippedItem) {
        newInventory.push(currentlyEquippedItem);
    }
    newEquippedItems[slotKey] = itemToEquip;
    state.setEquippedItems(newEquippedItems);
    state.setCurrentInventory(newInventory);

    // Update UI
    const slotConfig = themeService.getThemeConfig(themeId)?.equipment_slots?.[slotKey];
    if (slotConfig) {
        const lang = localizationService.getApplicationLanguage();
        const itemName = itemToEquip.name?.[lang] || itemToEquip.name?.['en'] || 'Unknown Item';
        const effectDescription = itemToEquip.itemEffectDescription?.[lang] || itemToEquip.itemEffectDescription?.['en'] || localizationService.getUIText('unknown');
        const fullItemDescription = `<span class="equipped-item-name">${itemName}</span><br><em class="equipped-item-effect">${effectDescription}</em>`;
        dashboardManager.updateDashboardItem(slotConfig.id, fullItemDescription, true);
    }

    const newModalContent = await _buildInventoryModalContent();
    if (dom.customModalMessage && newModalContent) {
        dom.customModalMessage.innerHTML = '';
        dom.customModalMessage.appendChild(newModalContent);
    }

    await authService.saveCurrentGameState(true);
}

/**
 * Unequips an item, moving it to the backpack.
 * @param {string} slotKey - The equipment slot key of the item to unequip.
 * @private
 */
async function _handleUnequipItem(slotKey) {
    const themeId = state.getCurrentTheme();
    const equippedItems = state.getEquippedItems();
    const itemToUnequip = equippedItems[slotKey];

    if (!itemToUnequip || !themeId) return;

    log(LOG_LEVEL_INFO, `Unequipping item from slot ${slotKey}: ${itemToUnequip.name?.en || itemToUnequip.id}`);

    const newInventory = [...state.getCurrentInventory(), itemToUnequip];
    const newEquippedItems = { ...equippedItems };
    delete newEquippedItems[slotKey];
    state.setEquippedItems(newEquippedItems);
    state.setCurrentInventory(newInventory);

    // Update UI
    const themeConfig = themeService.getThemeConfig(themeId);
    const slotConfig = themeConfig?.equipment_slots?.[slotKey];
    if (slotConfig) {
        const dashboardItems = [...(themeConfig.dashboard_config.left_panel || []), ...(themeConfig.dashboard_config.right_panel || [])].flatMap(p => p.items);
        const itemDashboardConfig = dashboardItems.find(i => i.id === slotConfig.id);
        if (itemDashboardConfig?.default_value_key) {
            const defaultValue = localizationService.getUIText(itemDashboardConfig.default_value_key, {}, { explicitThemeContext: themeId });
            dashboardManager.updateDashboardItem(slotConfig.id, defaultValue, true);
        }
    }

    const newModalContent = await _buildInventoryModalContent();
    if (dom.customModalMessage && newModalContent) {
        dom.customModalMessage.innerHTML = '';
        dom.customModalMessage.appendChild(newModalContent);
    }

    await authService.saveCurrentGameState(true);
}

// =================================================================================================
// SECTION: Core Game Flow & Action Processing
// =================================================================================================

/**
 * Initializes the GameController with necessary dependencies.
 * @param {object} dependencies - Object containing references to other modules.
 */
export function initGameController(dependencies) {
    _userThemeControlsManagerRef = dependencies.userThemeControlsManager;
    document.addEventListener('equipmentSlotClicked', () => showInventoryModal());
    log(LOG_LEVEL_INFO, "GameController initialized.");
}

/**
 * Handles the character's defeat when integrity reaches zero.
 * @private
 */
async function _handleCharacterDefeat() {
    const themeId = state.getCurrentTheme();
    if (!themeId) return;

    log(LOG_LEVEL_INFO, `Character defeat detected for theme ${themeId}.`);
    state.setIsRunActive(false);

    await new Promise(resolve => setTimeout(resolve, 500));

    const defeatMessageKey = `system_character_defeat_${themeId}`;
    let defeatMessage = localizationService.getUIText(defeatMessageKey, {}, { explicitThemeContext: themeId });
    if (defeatMessage === defeatMessageKey) {
        defeatMessage = localizationService.getUIText('system_character_defeat_generic');
    }
    storyLogManager.addMessageToLog(defeatMessage, "system system-error system-emphasized");

    uiUtils.setPlayerInputEnabled(false);
    const newGameButtonTextKey = `button_new_hunt_${themeId}`; // Example of theme-specific key
    let newGameText = localizationService.getUIText(newGameButtonTextKey, {}, { explicitThemeContext: themeId });
    if (newGameText === newGameButtonTextKey) { // Fallback
        newGameText = localizationService.getUIText('button_new_game');
    }
    suggestedActionsManager.displaySuggestedActions([{ text: newGameText, isDefeatAction: true }]);

    if (_userThemeControlsManagerRef) {
        await _userThemeControlsManagerRef.setThemeAsNotPlaying(themeId);
    }
    const currentUser = state.getCurrentUser();
    if (currentUser?.token) {
        try {
            await apiService.deleteGameState(currentUser.token, themeId);
            log(LOG_LEVEL_INFO, `Game state for theme ${themeId} deleted from backend after defeat.`);
        } catch (error) {
            log(LOG_LEVEL_WARN, `Failed to delete game state for theme ${themeId} after defeat.`, error);
        }
    }
}

/**
 * Sets up the UI and state for a new game session.
 * @param {string} themeId - The ID of the theme to start.
 * @private
 */
async function _setupNewGameEnvironment(themeId) {
    log(LOG_LEVEL_INFO, `Setting up new game environment for theme: ${themeId}.`);
    state.setIsRunActive(true);
    state.setCurrentTheme(themeId);
    const dataLoaded = await themeService.ensureThemeDataLoaded(themeId);
    if (!dataLoaded) {
        modalManager.showCustomModal({ type: "alert", titleKey: "alert_title_error", messageKey: "error_theme_data_load_failed", replacements: { THEME_ID: themeId } });
        await switchToLanding();
        return;
    }
    // Preload all necessary text files and data
    await Promise.all([
        themeService.getAllPromptsForTheme(themeId),
        themeService.getAllPromptsForTheme("master"),
        themeService.fetchAndCachePromptFile(themeId, 'traits')
    ]);
    state.clearVolatileGameState();
    state.setIsInitialGameLoad(true);
    state.setCurrentPromptType("initial");
    storyLogManager.clearStoryLogDOM();
    if (!state.getCurrentUser()) {
        storyLogManager.addMessageToLog(localizationService.getUIText("system_anonymous_progress_warning"), "system system-warning");
    }
    suggestedActionsManager.clearSuggestedActions();
    dashboardManager.resetDashboardUI(themeId);
    characterPanelManager.buildCharacterPanel(themeId);
    await _loadOrCreateUserThemeProgress(themeId);
    await _initializeCurrentRunStats();
    await _equipStartingGear(themeId);
    characterPanelManager.updateCharacterPanel(false);
    characterPanelManager.showCharacterPanel(true);
    characterPanelManager.showXPBar(true);
    landingPageManager.switchToGameView(themeId);
    uiUtils.updatePlayerActionInputMaxLength();
    if (_userThemeControlsManagerRef) {
        await _userThemeControlsManagerRef.setThemeAsPlaying(themeId);
    }
    const progress = state.getCurrentUserThemeProgress();
    if (progress?.characterName) {
        log(LOG_LEVEL_INFO, `Found existing character name '${progress.characterName}'. Starting game.`);
        state.setPlayerIdentifier(progress.characterName);
        if (dom.nameInputSection) dom.nameInputSection.style.display = "none";
        if (dom.actionInputSection) dom.actionInputSection.style.display = "flex";
        if (dom.playerActionInput) {
            dom.playerActionInput.placeholder = localizationService.getUIText("placeholder_command");
            dom.playerActionInput.value = "";
            dom.playerActionInput.dispatchEvent(new Event("input", { bubbles: true }));
            dom.playerActionInput.focus();
        }
        const themeDisplayName = themeService.getThemeConfig(themeId)?.name_key || themeId;
        const useEvolvedWorld = state.getCurrentNewGameSettings()?.useEvolvedWorld || false;
        const initialActionText = `Start game as "${progress.characterName}". Theme: ${localizationService.getUIText(themeDisplayName, {}, { explicitThemeContext: themeId })}. Evolved World: ${useEvolvedWorld}.`;
        state.clearCurrentNewGameSettings();
        await processPlayerAction(initialActionText, true);
    } else {
        const themeConfig = themeService.getThemeConfig(themeId);
        const defaultName = themeConfig?.default_identifier_key ? localizationService.getUIText(themeConfig.default_identifier_key, {}, { explicitThemeContext: themeId }) : localizationService.getUIText('unknown');
        state.setPlayerIdentifier(defaultName);
        characterPanelManager.updateCharacterPanel(false);
        state.setPlayerIdentifier("");
        if (dom.nameInputSection) dom.nameInputSection.style.display = "flex";
        if (dom.actionInputSection) dom.actionInputSection.style.display = "none";
        if (dom.playerIdentifierInput) {
            dom.playerIdentifierInput.value = "";
            dom.playerIdentifierInput.placeholder = localizationService.getUIText("placeholder_name_login");
            dom.playerIdentifierInput.focus();
        }
        storyLogManager.addMessageToLog(localizationService.getUIText("alert_identifier_required"), "system");
    }
}

/**
 * Processes the player's action, sends it to the AI, and updates the UI.
 * @param {string} actionText - The text of the player's action.
 * @param {boolean} [isGameStartingAction=false] - True if this is the automatic "Start game as..." action.
 */
export async function processPlayerAction(actionText, isGameStartingAction = false) {
    log(LOG_LEVEL_INFO, `Processing player action: "${actionText.substring(0, 50)}..."`);
    if (state.getIsInitialTraitSelectionPending()) {
        const traitAction = state.getCurrentSuggestedActions().find(action => action?.isTraitChoice && action.text === actionText);
        if (traitAction) return _handleInitialTraitSelection(traitAction.traitKey);
        storyLogManager.addMessageToLog(localizationService.getUIText("error_invalid_boon_choice"), "system system-error");
        return _presentInitialTraitChoices();
    }
    if (state.getIsBoonSelectionPending()) {
        const boonAction = state.getCurrentSuggestedActions().find(action => action?.isBoonChoice && action.text === actionText);
        if (boonAction) return _handleBoonSelection(boonAction.boonId, boonAction.text);
        storyLogManager.addMessageToLog(localizationService.getUIText("error_invalid_boon_choice"), "system system-error");
        _boonSelectionContext.step.startsWith('secondary') ? _presentSecondaryBoonChoices(_boonSelectionContext.step.replace('secondary_', '')) : _presentPrimaryBoonChoices();
        return;
    }
    let worldShardsPayload = "[]";
    if (isGameStartingAction && state.getCurrentNewGameSettings()?.useEvolvedWorld) {
        const currentUser = state.getCurrentUser();
        const currentThemeId = state.getCurrentTheme();
        if (currentUser?.token && currentThemeId) {
            try {
                const response = await apiService.fetchWorldShards(currentUser.token, currentThemeId);
                const activeShards = response?.worldShards?.filter(s => s.isActiveForNewGames).map(s => ({
                    loreFragmentKey: s.loreFragmentKey,
                    loreFragmentTitle: s.loreFragmentTitle,
                    loreFragmentContent: s.loreFragmentContent,
                    unlockConditionDescription: s.unlockConditionDescription
                })) || [];
                if (activeShards.length > 0) worldShardsPayload = JSON.stringify(activeShards);
            } catch (error) {
                log(LOG_LEVEL_ERROR, "Failed to fetch world shards for initial turn:", error);
            }
        }
    }
    if (!isGameStartingAction) {
        storyLogManager.renderMessage(actionText, "player");
        state.addTurnToGameHistory({ role: "user", parts: [{ text: actionText }] });
        if (dom.playerActionInput) {
            dom.playerActionInput.value = "";
            dom.playerActionInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }
    uiUtils.setGMActivityIndicator(true);
    suggestedActionsManager.clearSuggestedActions();
    dashboardManager.clearAllDashboardItemDotClasses();
    storyLogManager.showLoadingIndicator();
    try {
        const fullAiResponse = await aiService.processAiTurn(actionText, worldShardsPayload);
                storyLogManager.removeLoadingIndicator();
        if (fullAiResponse) {
            // Render dice roll animation if results are present in the response
            if (fullAiResponse.dice_roll_results) {
                await storyLogManager.renderDiceRoll(fullAiResponse.dice_roll_results);
            }
            // Process response data
            const updatesFromAI = fullAiResponse.dashboard_updates || {};
            if (fullAiResponse.new_item_generated) {
                const newItem = fullAiResponse.new_item_generated;
                if (newItem?.id && newItem.itemType && newItem.name) {
                    state.setCurrentInventory([...state.getCurrentInventory(), newItem]);
                    characterPanelManager.triggerIconAnimation('inventory');
                    const lang = localizationService.getApplicationLanguage();
                    const itemName = newItem.name?.[lang] || newItem.name?.['en'] || "a mysterious item";
                    storyLogManager.addMessageToLog(`Acquired: ${itemName}`, "system system-emphasized");
                }
            }
            if (fullAiResponse.new_persistent_lore_unlock) {
                characterPanelManager.triggerIconAnimation('lore');
                const shardTitle = fullAiResponse.new_persistent_lore_unlock.title || 'A new truth';
                _showAnimatedShardUnlock(shardTitle);
            }
            state.setLastKnownDashboardUpdates(updatesFromAI);
            // Render UI
            storyLogManager.renderMessage(fullAiResponse.narrative, "gm");
            dashboardManager.updateDashboard(updatesFromAI);
            characterPanelManager.updateCharacterPanel();
            modelToggleManager.updateModelToggleButtonAppearance(); // Refresh API usage counters on button
            state.setCurrentSuggestedActions(fullAiResponse.suggested_actions);
            state.setLastKnownGameStateIndicators(fullAiResponse.game_state_indicators || {});
            state.setCurrentAiPlaceholder(fullAiResponse.input_placeholder || localizationService.getUIText("placeholder_command"));
            state.setCurrentTurnUnlockData(fullAiResponse.new_persistent_lore_unlock || null);
            if (state.getIsInitialGameLoad()) state.setIsInitialGameLoad(false);
            suggestedActionsManager.displaySuggestedActions(state.getCurrentSuggestedActions());
            handleGameStateIndicatorsChange(state.getLastKnownGameStateIndicators());
            if (dom.playerActionInput) dom.playerActionInput.placeholder = state.getCurrentAiPlaceholder() || localizationService.getUIText("placeholder_command");
            // Post-turn logic
            if (state.getCurrentRunStats().currentIntegrity <= 0 && !state.getCurrentSuggestedActions()?.[0]?.isDefeatAction) {
                await _handleCharacterDefeat();
                return;
            }
            if (fullAiResponse.xp_awarded > 0) {
                await _handleExperienceAndLevelUp(fullAiResponse.xp_awarded);
            }
            if (!state.getIsBoonSelectionPending()) {
                await authService.saveCurrentGameState();
            }
        }
    } catch (error) {
        log(LOG_LEVEL_ERROR, "Error during AI turn processing:", error);
        storyLogManager.removeLoadingIndicator();
        if (!error.isHandled) {
            storyLogManager.addMessageToLog(localizationService.getUIText("error_api_call_failed", { ERROR_MSG: error.message }), "system system-error");
        }
        if (dom.playerActionInput) dom.playerActionInput.placeholder = localizationService.getUIText("placeholder_command");
    } finally {
        if (!state.getIsBoonSelectionPending() && !state.getIsInitialTraitSelectionPending()) {
            uiUtils.setGMActivityIndicator(false);
        }
    }
}

/**
 * Handles the submission of a player identifier for a new game.
 * @param {string} identifier - The player's chosen identifier.
 */
export async function handleIdentifierSubmission(identifier) {
    if (!identifier?.trim()) {
        storyLogManager.addMessageToLog(localizationService.getUIText("alert_identifier_required"), "system system-error");
        if (dom.playerIdentifierInput) dom.playerIdentifierInput.focus();
        return;
    }

    log(LOG_LEVEL_INFO, `Player identifier submitted: ${identifier}`);
    state.setPlayerIdentifier(identifier);
    characterPanelManager.updateCharacterPanel(false);

    if (dom.nameInputSection) dom.nameInputSection.style.display = "none";
    if (dom.actionInputSection) dom.actionInputSection.style.display = "flex";
    if (dom.playerActionInput) {
        dom.playerActionInput.placeholder = localizationService.getUIText("placeholder_command");
        dom.playerActionInput.value = "";
        dom.playerActionInput.dispatchEvent(new Event("input", { bubbles: true }));
        dom.playerActionInput.focus();
    }

    const themeId = state.getCurrentTheme();
    const themeDisplayName = themeService.getThemeConfig(themeId)?.name_key || themeId;
    const useEvolvedWorld = state.getCurrentNewGameSettings()?.useEvolvedWorld || false;
    _deferredInitialActionText = `Start game as "${identifier}". Theme: ${localizationService.getUIText(themeDisplayName, {}, { explicitThemeContext: themeId })}. Evolved World: ${useEvolvedWorld}.`;
    state.clearCurrentNewGameSettings();

    const progress = state.getCurrentUserThemeProgress();
    if (progress && progress.level === 1 && progress.currentXP === 0 && progress.acquiredTraitKeys.length === 0) {
        state.setIsInitialTraitSelectionPending(true);
        _presentInitialTraitChoices();
    } else {
        await processPlayerAction(_deferredInitialActionText, true);
        _deferredInitialActionText = null;
    }
}


// =================================================================================================
// SECTION: Session & View Management
// =================================================================================================

/**
 * Initializes a new game session after user confirmation and world type choice.
 * @param {string} themeId - The ID of the theme to start.
 * @param {boolean} [skipConfirmation=false] - If true, skips the confirmation dialog.
 */
export async function initiateNewGameSessionFlow(themeId, skipConfirmation = false) {
    log(LOG_LEVEL_INFO, `New game flow for theme: ${themeId}. Skip confirmation: ${skipConfirmation}`);
    const currentUser = state.getCurrentUser();
    const themeIsActive = currentUser ? state.getPlayingThemes().includes(themeId) : (state.getCurrentTheme() === themeId && state.getGameHistory().length > 0);
    if (!skipConfirmation && themeIsActive) {
        const themeConfig = themeService.getThemeConfig(themeId);
        const themeDisplayName = themeConfig ? localizationService.getUIText(themeConfig.name_key, {}, { explicitThemeContext: themeId }) : themeId;
        const confirmed = await modalManager.showGenericConfirmModal({
            titleKey: "confirm_new_game_title_theme",
            messageKey: "confirm_new_game_message_theme",
            replacements: { THEME_NAME: themeDisplayName },
            explicitThemeContext: themeId
        });
        if (!confirmed) {
            log(LOG_LEVEL_INFO, "User cancelled starting new game.");
            return;
        }
    }
    let preservedLore = '';
    let preservedSummary = '';
    if (currentUser?.token) {
        try {
            // Instead of deleting the whole state, start a new session which preserves lore/summary on the backend.
            const sessionResponse = await apiService.startNewGameSession(currentUser.token, themeId);
            preservedLore = sessionResponse?.game_history_lore || '';
            preservedSummary = sessionResponse?.game_history_summary || '';
            log(LOG_LEVEL_INFO, 'New session started on backend. Preserved lore/summary retrieved.');
        } catch (error) {
            log(LOG_LEVEL_ERROR, `Could not start new session on backend for theme ${themeId}. Will proceed with a fresh local state.`, error.message);
            // Reset to empty strings to ensure a completely fresh start if the API fails.
            preservedLore = '';
            preservedSummary = '';
        }
    }
    const themeStatus = currentUser ? state.getShapedThemeData().get(themeId) : null;
    const useEvolvedWorld = !!(themeStatus?.hasShards && themeStatus?.activeShardCount > 0);
    state.setCurrentNewGameSettings({ useEvolvedWorld });
    // This clears volatile state, including lore and summary in the state object.
    await _setupNewGameEnvironment(themeId);
    // After the environment is set up, re-apply the preserved lore and summary if the user is logged in.
    if (currentUser?.token) {
        state.setLastKnownEvolvedWorldLore(preservedLore);
        state.setLastKnownCumulativePlayerSummary(preservedSummary);
        log(LOG_LEVEL_INFO, 'Preserved lore/summary re-applied to state after environment setup.');
    }
}

/**
 * Initiates the flow for resetting all progress for a character in a specific theme.
 * @param {string} themeId - The ID of the theme to reset.
 */
export async function initiateCharacterResetFlow(themeId) {
    log(LOG_LEVEL_INFO, `Initiating character reset for theme: ${themeId}.`);
    const themeNameKey = themeService.getThemeConfig(themeId)?.name_key || themeId;
    const localizedThemeName = localizationService.getUIText(themeNameKey, {}, { explicitThemeContext: themeId });

    const confirmed = await modalManager.showGenericConfirmModal({
        titleKey: "confirm_reset_character_title",
        messageKey: "confirm_reset_character_message",
        replacements: { THEME_NAME: localizedThemeName },
        explicitThemeContext: themeId
    });

    if (!confirmed) {
        log(LOG_LEVEL_INFO, "User cancelled character reset.");
        return;
    }

    modalManager.hideCustomModal();
    const currentUser = state.getCurrentUser();

    if (!currentUser?.token) {
        modalManager.showCustomModal({ type: "alert", titleKey: "alert_title_error", messageKey: "error_api_call_failed", replacements: { ERROR_MSG: "You must be logged in." } });
        return;
    }

    try {
        await apiService.resetCharacterProgress(currentUser.token, themeId);
        log(LOG_LEVEL_INFO, `Character reset successful for theme ${themeId}.`);

        modalManager.showCustomModal({
            type: "alert",
            titleKey: "alert_title_notice",
            messageKey: "alert_character_reset_success_message",
            replacements: { THEME_NAME: localizedThemeName }
        });

        // Refresh frontend state
        state.setPlayingThemes(state.getPlayingThemes().filter(id => id !== themeId));
        _userThemeControlsManagerRef.updateTopbarThemeIcons();
        await landingPageManager.fetchShapedWorldStatusAndUpdateGrid();
        if (state.getCurrentLandingGridSelection() === themeId) {
            await landingPageManager.handleThemeGridSelection(themeId, false);
        }
    } catch (error) {
        log(LOG_LEVEL_ERROR, `Failed to reset character for theme ${themeId}:`, error);
        modalManager.showCustomModal({ type: "alert", titleKey: "alert_title_error", messageKey: "error_api_call_failed", replacements: { ERROR_MSG: error.message } });
    }
}

/**
 * Resumes an existing game session for the given theme, or starts a new one if none exists.
 * @param {string} themeId - The ID of the theme to resume.
 */
export async function resumeGameSession(themeId) {
    log(LOG_LEVEL_INFO, `Resuming game session for theme: ${themeId}.`);
    state.setCurrentTheme(themeId);
    const dataLoaded = await themeService.ensureThemeDataLoaded(themeId);
    if (!dataLoaded) {
        modalManager.showCustomModal({ type: "alert", titleKey: "alert_title_error", messageKey: "error_theme_data_load_failed", replacements: { THEME_ID: themeId } });
        return switchToLanding();
    }
    await Promise.all([
        themeService.getAllPromptsForTheme(themeId),
        themeService.getAllPromptsForTheme("master"),
        themeService.fetchAndCachePromptFile(themeId, 'traits')
    ]);
    landingPageManager.switchToGameView(themeId);
    uiUtils.updatePlayerActionInputMaxLength();
    dashboardManager.generatePanelsForTheme(themeId);
    characterPanelManager.buildCharacterPanel(themeId);
    const currentUser = state.getCurrentUser();
    if (!currentUser?.token) {
        return initiateNewGameSessionFlow(themeId, true);
    }
    try {
        const loadedData = await apiService.loadGameState(currentUser.token, themeId);
        // Rehydrate State
        state.setCurrentUserThemeProgress(loadedData.userThemeProgress || null);
        await _loadOrCreateUserThemeProgress(themeId);
        await _initializeCurrentRunStats();
        dashboardManager.updateDashboard(loadedData.last_dashboard_updates || {}, false);
        state.setPlayerIdentifier(loadedData.userThemeProgress?.characterName || loadedData.player_identifier || currentUser.email);
        state.setEquippedItems(loadedData.equipped_items || {});
        state.setCurrentInventory(loadedData.session_inventory || []);
        state.setGameHistory(loadedData.game_history || []);
        state.setLastKnownGameStateIndicators(loadedData.last_game_state_indicators || {});
        state.setCurrentPromptType(loadedData.current_prompt_type || "default");
        state.setCurrentNarrativeLanguage(loadedData.current_narrative_language || state.getCurrentAppLanguage());
        state.setCurrentSuggestedActions(loadedData.last_suggested_actions || []);
        state.setLastAiSuggestedActions(loadedData.actions_before_boon_selection || null);
        state.setCurrentPanelStates(loadedData.panel_states || {});
        state.setDashboardItemMeta(loadedData.dashboard_item_meta || {});
        state.setLastKnownCumulativePlayerSummary(loadedData.game_history_summary || "");
        state.setLastKnownEvolvedWorldLore(loadedData.game_history_lore || await themeService.getResolvedBaseThemeLore(themeId, state.getCurrentNarrativeLanguage()));
        state.setIsBoonSelectionPending(!!loadedData.is_boon_selection_pending);
        state.setIsInitialGameLoad(false);
        // Repopulate UI
        storyLogManager.clearStoryLogDOM();
        state.getGameHistory().forEach(turn => {
            try {
                if (turn.role === "user") storyLogManager.renderMessage(turn.parts[0].text, "player");
                else if (turn.role === "model") storyLogManager.renderMessage(JSON.parse(turn.parts[0].text).narrative, "gm");
                else if (turn.role === "system_log") storyLogManager.renderMessage(turn.parts[0].text, turn.senderTypes || "system");
            } catch (e) {
                log(LOG_LEVEL_ERROR, "Error parsing history turn on resume:", e, turn.parts[0].text);
            }
        });
        characterPanelManager.updateCharacterPanel(false);
        characterPanelManager.showCharacterPanel(true);
        characterPanelManager.showXPBar(true);
        dashboardManager.applyPersistedItemMeta();
        handleGameStateIndicatorsChange(state.getLastKnownGameStateIndicators(), true);
        if (dom.nameInputSection) dom.nameInputSection.style.display = "none";
        if (dom.actionInputSection) dom.actionInputSection.style.display = "flex";
        if (state.getIsBoonSelectionPending()) {
            _presentPrimaryBoonChoices();
        } else {
            suggestedActionsManager.displaySuggestedActions(state.getCurrentSuggestedActions());
            if (dom.playerActionInput) dom.playerActionInput.focus();
        }
        log(LOG_LEVEL_INFO, `Session resumed for theme ${themeId}.`);
    } catch (error) {
        if (error.code === 'GAME_STATE_NOT_FOUND') {
            log(LOG_LEVEL_INFO, `No saved game for theme '${themeId}'. Starting new game.`);
            await initiateNewGameSessionFlow(themeId, true);
        } else {
            log(LOG_LEVEL_ERROR, `Error loading game state for ${themeId}:`, error);
            await initiateNewGameSessionFlow(themeId, true);
        }
    }
}

/**
 * Changes the active game theme, saving the current one if necessary.
 * @param {string} newThemeId - The ID of the theme to switch to.
 * @param {boolean} [forceNewGame=false] - If true, forces a new game start.
 */
export async function changeActiveTheme(newThemeId, forceNewGame = false) {
    log(LOG_LEVEL_INFO, `Changing active theme to: ${newThemeId}`);
    const currentThemeId = state.getCurrentTheme();

    if (currentThemeId === newThemeId && !forceNewGame) {
        log(LOG_LEVEL_INFO, `Theme ${newThemeId} is already active. Ensuring game view.`);
        landingPageManager.switchToGameView(newThemeId);
        return;
    }

    if (currentThemeId && state.getCurrentUser()?.token) {
        await authService.saveCurrentGameState();
    }

    try {
        const dataLoaded = await themeService.ensureThemeDataLoaded(newThemeId);
        if (!dataLoaded) throw new Error(`Failed to load critical data for theme ${newThemeId}.`);

        await themeService.getAllPromptsForTheme(newThemeId);
        await themeService.getAllPromptsForTheme("master");

        if (forceNewGame) {
            await initiateNewGameSessionFlow(newThemeId);
        } else {
            await resumeGameSession(newThemeId);
        }
    } catch (error) {
        log(LOG_LEVEL_ERROR, `Error in changeActiveTheme for ${newThemeId}:`, error);
        await switchToLanding(); // Fallback to landing on error
    } finally {
        if (_userThemeControlsManagerRef) {
            _userThemeControlsManagerRef.updateTopbarThemeIcons();
        }
        characterPanelManager.updateCharacterPanel(false);
        characterPanelManager.showCharacterPanel(state.getCurrentTheme() !== null);
        characterPanelManager.showXPBar(state.getCurrentTheme() !== null);
    }
}

/**
 * Handles changes in game state indicators from the AI to update the UI and game flow.
 * @param {object} newIndicators - The new set of game state indicators.
 * @param {boolean} [isInitialBoot=false] - True if this is part of initial game load.
 */
export function handleGameStateIndicatorsChange(newIndicators, isInitialBoot = false) {
    const themeId = state.getCurrentTheme();
    if (!newIndicators || !themeId) return;

    log(LOG_LEVEL_DEBUG, "Handling game state indicators change:", newIndicators);
    state.setLastKnownGameStateIndicators(newIndicators);

    const dashboardConfig = themeService.getThemeConfig(themeId)?.dashboard_config;
    if (!dashboardConfig) return;

    // Update visibility of conditional panels
    [...(dashboardConfig.left_panel || []), ...(dashboardConfig.right_panel || [])]
        .filter(p => p.type === "hidden_until_active" && p.indicator_key)
        .forEach(panelCfg => {
            const panelBox = document.getElementById(panelCfg.id);
            if (panelBox) {
                const indicatorValue = newIndicators[panelCfg.indicator_key];
                const shouldShow = indicatorValue === true || String(indicatorValue).toLowerCase() === 'true';
                const isVisible = panelBox.style.display !== "none";
                if (shouldShow && !isVisible) {
                    const delay = isInitialBoot && panelCfg.boot_delay ? panelCfg.boot_delay : 0;
                    setTimeout(() => dashboardManager.animatePanelExpansion(panelCfg.id, true, true, isInitialBoot), delay);
                } else if (!shouldShow && isVisible) {
                    dashboardManager.animatePanelExpansion(panelCfg.id, false, true, isInitialBoot);
                }
            }
        });

    // Determine the next prompt type based on priority
    let newPromptType = "default";
    let highestPriority = -1;
    dashboardConfig.game_state_indicators?.forEach(indicatorConfig => {
        if (newIndicators[indicatorConfig.id]) {
            const priority = indicatorConfig.priority || 0;
            if (priority > highestPriority) {
                let promptKey = indicatorConfig.id === 'generate_item_reward' ? 'master_items' : indicatorConfig.id;
                let themeForPrompt = indicatorConfig.id === 'generate_item_reward' ? 'master' : themeId;
                if (themeService.getLoadedPromptText(themeForPrompt, promptKey)) {
                    highestPriority = priority;
                    newPromptType = promptKey;
                }
            }
        }
    });

    if (state.getCurrentPromptType() !== newPromptType) {
        state.setCurrentPromptType(newPromptType);
        log(LOG_LEVEL_INFO, `Switched to prompt type: ${newPromptType}`);
    }

    requestAnimationFrame(() => {
        dashboardManager.updateScrollIndicators('left');
        dashboardManager.updateScrollIndicators('right');
    });
}

/**
 * Switches the UI to the landing page view, saving state if necessary.
 */
export async function switchToLanding() {
    log(LOG_LEVEL_INFO, "Switching to landing view.");
    if (state.getCurrentTheme() && state.getCurrentUser()?.token) {
        await authService.saveCurrentGameState();
    }
    state.clearVolatileGameState();
    storyLogManager.clearStoryLogDOM();
    state.setCurrentTheme(null);
    state.setIsInitialGameLoad(true);
    state.setIsBoonSelectionPending(false);
    state.setIsRunActive(true); // Default to active for landing page
    await landingPageManager.switchToLandingView();
    characterPanelManager.showCharacterPanel(false);
    characterPanelManager.showXPBar(false);
    if (_userThemeControlsManagerRef) _userThemeControlsManagerRef.updateTopbarThemeIcons();
    log(LOG_LEVEL_INFO, "Switched to landing view; game session state cleared.");
}

/**
 * Shows the Store modal for the current theme.
 */
export function showStoreModal() {
    const themeId = state.getCurrentTheme();
    if (!themeId) return;
    log(LOG_LEVEL_INFO, `Showing placeholder Store modal for theme: ${themeId}`);
    modalManager.showCustomModal({ type: 'alert', titleKey: 'modal_title_store', messageKey: 'store_not_implemented_message' });
}

/**
 * Shows the Inventory modal.
 */
export async function showInventoryModal() {
    const modalContent = await _buildInventoryModalContent();
    if (!modalContent) {
        log(LOG_LEVEL_ERROR, "Failed to build inventory modal content.");
        return;
    }
    modalManager.showCustomModal({
        type: 'custom',
        titleKey: 'modal_title_inventory',
        htmlContent: modalContent,
        customActions: [{ textKey: 'modal_ok_button', className: 'ui-button primary', onClick: () => modalManager.hideCustomModal() }]
    });
}

/**
 * Shows the World Shards configuration modal.
 * @param {string} themeId - The theme ID for which to show the modal.
 */
export function showConfigureShardsModal(themeId) {
    worldShardsModalManager.showConfigureShardsModal(themeId);
}

/**
 * Shows the Character Progress modal.
 * @param {string} themeId - The theme ID for which to show the modal.
 */
export function showCharacterProgressModal(themeId) {
    characterPanelManager.showCharacterProgressModal(themeId);
}
