/**
 * @file Manages the UI for language selection and triggers updates
 * to application and narrative language settings across the entire application.
 */

// --- IMPORTS ---
import {
    languageToggleButton,
    playerActionInput,
    landingThemeLoreText,
    landingThemeInfoContent,
    themeGridContainer,
    playerIdentifierInput,
    startGameButton,
    sendActionButton,
    newGameButton,
    systemStatusIndicator,
    gmSpecificActivityIndicator,
} from './domElements.js';
import {
    getCurrentAppLanguage,
    getCurrentTheme,
    getCurrentLandingGridSelection,
    getCurrentUser,
    getCurrentAiPlaceholder,
} from '../core/state.js';
import { getUIText, setApplicationLanguage, setNarrativeLanguage } from '../services/localizationService.js';
import * as authService from '../services/authService.js';
import * as modelToggleManager from './modelToggleManager.js';
import * as characterPanelManager from './characterPanelManager.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { attachTooltip } from './tooltipManager.js';

// --- MODULE-LEVEL DEPENDENCIES ---
let _storyLogManagerRef = null;
let _landingPageManagerRef = null;
let _dashboardManagerRef = null;

// --- INITIALIZATION ---

/**
 * Initializes the LanguageManager with optional dependencies.
 * @param {object} [dependencies={}] - Object containing references to other modules.
 * @param {object} [dependencies.storyLogManager] - Reference to storyLogManager.
 * @param {object} [dependencies.landingPageManager] - Reference to landingPageManager.
 * @param {object} [dependencies.dashboardManager] - Reference to dashboardManager.
 */
export function initLanguageManager(dependencies = {}) {
    _storyLogManagerRef = dependencies.storyLogManager;
    _landingPageManagerRef = dependencies.landingPageManager;
    _dashboardManagerRef = dependencies.dashboardManager;
    updateLanguageToggleButtonAppearance();
    log(LOG_LEVEL_INFO, "LanguageManager initialized.");
}

// --- PUBLIC API ---

/**
 * Updates the appearance (text and tooltip) of the main language toggle button.
 * The button text shows the language it will switch TO.
 */
export function updateLanguageToggleButtonAppearance() {
    if (!languageToggleButton) {
        log(LOG_LEVEL_DEBUG, "Language toggle button not found in DOM.");
        return;
    }
    const currentLang = getCurrentAppLanguage();
    const otherLang = currentLang === 'en' ? 'cs' : 'en';
    const buttonText = getUIText('toggle_language', {}, { viewContext: 'landing', explicitLangForTextItself: otherLang });
    const ariaLabelKey = "toggle_language_aria";
    const ariaLabelText = getUIText(ariaLabelKey, {}, { viewContext: 'global' });

    languageToggleButton.textContent = buttonText;
    languageToggleButton.setAttribute("aria-label", ariaLabelText);
    attachTooltip(languageToggleButton, ariaLabelKey, {}, { viewContext: 'global' });
    log(LOG_LEVEL_DEBUG, `Language toggle button updated. Current: ${currentLang}, shows: ${buttonText}`);
}

/**
 * Handles the click event on the main language toggle button.
 * Switches both application and narrative languages, updates preferences, and refreshes the UI.
 */
export async function handleLanguageToggle() {
    if (!languageToggleButton || languageToggleButton.disabled) return;

    const currentLang = getCurrentAppLanguage();
    const newLang = currentLang === 'en' ? 'cs' : 'en';
    log(LOG_LEVEL_INFO, `User toggled language from ${currentLang} to ${newLang}.`);

    setApplicationLanguage(newLang);
    setNarrativeLanguage(newLang); // Synchronize narrative language

    const currentUser = getCurrentUser();
    if (currentUser?.token) {
        try {
            await authService.updateUserPreferences({
                preferred_app_language: newLang,
                preferred_narrative_language: newLang,
            });
            log(LOG_LEVEL_INFO, `Backend language preferences updated for user ${currentUser.email}.`);
        } catch (error) {
            log(LOG_LEVEL_ERROR, "Failed to update backend language preferences:", error.message);
            if (_storyLogManagerRef && getCurrentTheme()) {
                _storyLogManagerRef.addMessageToLog(getUIText("error_api_call_failed", { ERROR_MSG: "Could not save language preference." }), "system system-error");
            }
        }
    }

    applyGlobalUITranslations();

    if (_storyLogManagerRef && getCurrentTheme()) {
        const messageKey = newLang === "en" ? "system_lang_set_en" : "system_lang_set_cs";
        _storyLogManagerRef.addMessageToLog(getUIText(messageKey), "system");
    }
}

/**
 * Applies translations to all UI elements with data-lang-key attributes,
 * and updates elements whose content is language-dependent but not directly tagged.
 */
export function applyGlobalUITranslations() {
    const currentLang = getCurrentAppLanguage();
    log(LOG_LEVEL_INFO, `Applying global UI translations for language: ${currentLang}`);

    if (document.documentElement) {
        document.documentElement.lang = currentLang;
    }

    const translateElement = (element, key, replacements = {}, options = {}) => {
        if (element) element.textContent = getUIText(key, replacements, options);
    };

    // Translate all elements with data-lang-key for textContent
    document.querySelectorAll('[data-lang-key]').forEach(element => {
        const key = element.dataset.langKey;
        const viewContext = element.closest('.landing-page-active') ? 'landing' : (getCurrentTheme() ? 'game' : 'global');
        const explicitThemeContext = element.dataset.themeContext || (viewContext === 'game' ? getCurrentTheme() : null);
        translateElement(element, key, {}, { explicitThemeContext, viewContext });
    });

    // Translate all elements with data-lang-key-placeholder for placeholder attribute
    document.querySelectorAll('[data-lang-key-placeholder]').forEach(element => {
        const key = element.dataset.langKeyPlaceholder;
        const viewContext = element.closest('.landing-page-active') ? 'landing' : 'game';
        const explicitThemeContext = element.dataset.themeContext || (viewContext === 'game' ? getCurrentTheme() : null);
        if (element) {
            element.placeholder = getUIText(key, {}, { explicitThemeContext, viewContext });
        }
    });

    // Translate all elements with data-lang-key-aria for aria-label and tooltips
    document.querySelectorAll('[data-lang-key-aria]').forEach(element => {
        const key = element.dataset.langKeyAria;
        const viewContext = element.closest('.landing-page-active') ? 'landing' : 'global';
        const explicitThemeContext = element.dataset.themeContext || (viewContext === 'game' ? getCurrentTheme() : null);
        const ariaText = getUIText(key, {}, { explicitThemeContext, viewContext });
        element.setAttribute('aria-label', ariaText);
        attachTooltip(element, key, {}, { explicitThemeContext, viewContext });
    });

    // --- Update Specific UI Components ---
    updateLanguageToggleButtonAppearance();
    modelToggleManager.updateModelToggleButtonAppearance();

    if (systemStatusIndicator?.dataset.langKey) {
        translateElement(systemStatusIndicator, systemStatusIndicator.dataset.langKey);
    }
    if (gmSpecificActivityIndicator?.dataset.langKey) {
        translateElement(gmSpecificActivityIndicator, gmSpecificActivityIndicator.dataset.langKey);
    }

    // --- Context-Specific UI Updates ---
    if (document.body.classList.contains('landing-page-active')) {
        if (_landingPageManagerRef) {
            _landingPageManagerRef.renderThemeGrid();
            const selectedTheme = getCurrentLandingGridSelection();
            if (selectedTheme) {
                _landingPageManagerRef.updateLandingPagePanelsWithThemeInfo(selectedTheme, false);
                const selectedBtn = themeGridContainer?.querySelector(`.theme-grid-icon[data-theme="${selectedTheme}"]`);
                if (selectedBtn) selectedBtn.classList.add("active");
            } else {
                if (landingThemeLoreText) translateElement(landingThemeLoreText, "landing_select_theme_prompt_lore", {}, { viewContext: 'landing' });
                if (landingThemeInfoContent) landingThemeInfoContent.innerHTML = `<p>${getUIText("landing_select_theme_prompt_details", {}, { viewContext: 'landing' })}</p>`;
            }
        }
    } else if (getCurrentTheme()) { // Game view is active
        if (_dashboardManagerRef) {
            _dashboardManagerRef.generatePanelsForTheme(getCurrentTheme());
            _dashboardManagerRef.initializeCollapsiblePanelBoxes(getCurrentTheme());
            const lastUpdates = _dashboardManagerRef.getLastKnownDashboardUpdatesForTranslationsReapply ?
                _dashboardManagerRef.getLastKnownDashboardUpdatesForTranslationsReapply() : {};
            Object.keys(lastUpdates).forEach(key => {
                _dashboardManagerRef.updateDashboardItem(key, lastUpdates[key], false);
            });
        }

        if (playerIdentifierInput?.dataset.langKeyPlaceholder) {
            playerIdentifierInput.placeholder = getUIText(playerIdentifierInput.dataset.langKeyPlaceholder);
        }

        if (playerActionInput?.dataset.langKeyPlaceholder) {
            const currentPlaceholder = getCurrentAiPlaceholder();
            const defaultPlaceholderKey = playerActionInput.dataset.langKeyPlaceholder;
            const defaultPlaceholderText = getUIText(defaultPlaceholderKey);
            const otherLangDefaultText = getUIText(defaultPlaceholderKey, {}, { explicitLangForTextItself: currentLang === 'en' ? 'cs' : 'en' });
            // Only overwrite placeholder if it's the default text for either language
            if (!currentPlaceholder || currentPlaceholder === defaultPlaceholderText || currentPlaceholder === otherLangDefaultText) {
                playerActionInput.placeholder = defaultPlaceholderText;
            }
        }

        if (startGameButton?.dataset.langKey) translateElement(startGameButton, startGameButton.dataset.langKey);
        if (sendActionButton?.dataset.langKey) translateElement(sendActionButton, sendActionButton.dataset.langKey);
        if (newGameButton?.dataset.langKey) {
            const themeConfig = _dashboardManagerRef?.getThemeConfigForCurrentTheme?.();
            const newGameTermKey = themeConfig?.new_game_button_text_key || "button_new_game";
            translateElement(newGameButton, newGameTermKey, {}, { explicitThemeContext: getCurrentTheme() });
        }
    }

    if (characterPanelManager?.retranslateCharacterPanelLabels) {
        characterPanelManager.retranslateCharacterPanelLabels();
    }
    log(LOG_LEVEL_INFO, "Global UI translations applied.");
}
