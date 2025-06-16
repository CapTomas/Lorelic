/**
 * @file Handles UI changes directly related to the user's authentication state
 * (e.g., visibility of login/logout/profile buttons, email confirmation messages, password reset page display).
 */
// --- IMPORTS ---
import {
    loginButton,
    userProfileButton,
    themeGridContainer,
    storyLogViewport,
    playerInputControlPanel,
    suggestedActionsWrapper,
    leftPanel,
    rightPanel,
    applicationHeader,
} from './domElements.js';
import * as state from '../core/state.js';
import { getUIText, setApplicationLanguage, setNarrativeLanguage } from '../services/localizationService.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_DEBUG, LOG_LEVEL_ERROR, LOG_LEVEL_WARN } from '../core/logger.js';
import * as modelToggleManager from './modelToggleManager.js';
import * as uiUtils from './uiUtils.js';
import { attachTooltip, hideCurrentTooltip } from './tooltipManager.js';


// --- MODULE-LEVEL DEPENDENCIES ---
let _authService = null;
let _modalManager = null;
let _gameControllerRef = null;
let _userThemeControlsManagerRef = null;
let _landingPageManagerRef = null;
let _languageManagerRef = null;
let _billingManagerRef = null;
// --- INITIALIZATION ---
/**
 * Initializes the AuthUiManager with necessary dependencies.
 * @param {object} dependencies - Object containing references to other modules.
 * @param {object} dependencies.authService - Reference to authService.
 * @param {object} dependencies.modalManager - Reference to modalManager.
 * @param {object} [dependencies.gameController] - Optional reference to gameController.
 * @param {object} [dependencies.userThemeControlsManager] - Optional reference to userThemeControlsManager.
 * @param {object} [dependencies.landingPageManager] - Optional reference to landingPageManager.
 * @param {object} [dependencies.languageManager] - Optional reference to languageManager.
 */
export function initAuthUiManager(dependencies) {
    if (!dependencies.authService || !dependencies.modalManager) {
        log(LOG_LEVEL_ERROR, "AuthUiManager initialization failed: Missing required dependencies (authService, modalManager).");
        return;
    }
    _authService = dependencies.authService;
    _modalManager = dependencies.modalManager;
    _gameControllerRef = dependencies.gameController;
    _userThemeControlsManagerRef = dependencies.userThemeControlsManager;
    _landingPageManagerRef = dependencies.landingPageManager;
    _languageManagerRef = dependencies.languageManager;
    _billingManagerRef = dependencies.billingManager;
    if (!_languageManagerRef) {
        log(LOG_LEVEL_WARN, "AuthUiManager initialized without languageManager. Language switching on pref change will not work.");
    }
    if (!_billingManagerRef) {
        log(LOG_LEVEL_WARN, "AuthUiManager initialized without billingManager. Subscription management will be disabled.");
    }
    log(LOG_LEVEL_INFO, "AuthUiManager initialized with all dependencies.");
}
// --- PUBLIC FUNCTIONS ---
/**
 * Updates the main authentication-related UI elements based on the current user's login status.
 */
export function updateAuthUIState() {
    const currentUser = state.getCurrentUser();
    const isLoggedIn = !!currentUser;
    if (loginButton) loginButton.style.display = isLoggedIn ? "none" : "inline-flex";
    if (userProfileButton) userProfileButton.style.display = isLoggedIn ? "inline-flex" : "none";
    log(LOG_LEVEL_DEBUG, `Auth UI updated. User is ${isLoggedIn ? 'logged in' : 'logged out'}.`);
    uiUtils.updatePlayerActionInputMaxLength();
}
/**
 * Shows an authentication modal (login or register).
 * This function orchestrates the form display, submission handling, and post-auth UI updates.
 * @param {'login'|'register'} [initialMode='login'] - The mode to open the modal in.
 */
export function showAuthModal(initialMode = 'login') {
    log(LOG_LEVEL_DEBUG, `Showing auth modal in '${initialMode}' mode.`);
    let currentAuthMode = initialMode;
    const renderAndDisplayForm = () => {
        const isLogin = currentAuthMode === 'login';
        const titleKey = isLogin ? "modal_title_login" : "modal_title_register";
        const confirmTextKey = isLogin ? "button_login" : "button_register";
        // --- Form Fields Definition ---
        let formFields = [
            { id: "authEmail", labelKey: "label_email", type: "email", placeholderKey: "placeholder_email", required: true },
            { id: "authPassword", labelKey: "label_password", type: "password", placeholderKey: isLogin ? "placeholder_password" : "placeholder_password_register", required: true },
        ];
        if (!isLogin) {
            formFields.splice(1, 0, { id: "authUsername", labelKey: "label_username", type: "text", placeholderKey: "placeholder_username", required: true });
            formFields.push(
                {
                    id: "storyPreference",
                    labelKey: "label_story_preference",
                    type: "select",
                    options: [
                        { value: "", textKey: "option_story_preference_default", descriptionKey: "" },
                        { value: "explorer", textKey: "option_story_preference_explorer", descriptionKey: "desc_story_preference_explorer" },
                        { value: "strategist", textKey: "option_story_preference_strategist", descriptionKey: "desc_story_preference_strategist" },
                        { value: "weaver", textKey: "option_story_preference_weaver", descriptionKey: "desc_story_preference_weaver" },
                        { value: "chaos", textKey: "option_story_preference_chaos", descriptionKey: "desc_story_preference_chaos" },
                    ],
                },
                {
                    id: "newsletterOptIn",
                    labelKey: "label_profile_newsletter_select",
                    type: "select",
                    options: [
                        { value: 'true', textKey: 'newsletter_option_subscribed' },
                        { value: 'false', textKey: 'newsletter_option_unsubscribed' },
                    ],
                    value: 'true',
                }
            );
        }
        // --- Auth Links Creation ---
        const linksContainer = document.createElement('div');
        linksContainer.className = 'auth-modal-links';
        if (isLogin) {
            const forgotPasswordLink = document.createElement('a');
            forgotPasswordLink.href = '#';
            forgotPasswordLink.textContent = getUIText("button_forgot_password");
            forgotPasswordLink.className = 'forgot-password-link';
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                _modalManager.hideCustomModal();
                showForgotPasswordRequestModal();
            });
            linksContainer.appendChild(forgotPasswordLink);
        }
        const switchAuthModeLink = document.createElement('a');
        switchAuthModeLink.href = '#';
        const switchLinkTextKey = isLogin ? "modal_switch_to_register" : "modal_switch_to_login";
        switchAuthModeLink.textContent = getUIText(switchLinkTextKey);
        switchAuthModeLink.className = 'switch-auth-mode-link';
        switchAuthModeLink.addEventListener('click', (e) => {
            e.preventDefault();
            currentAuthMode = isLogin ? 'register' : 'login';
            _modalManager.hideCustomModal();
            renderAndDisplayForm();
        });
        linksContainer.appendChild(switchAuthModeLink);
        // --- Modal Configuration & Display ---
        _modalManager.showCustomModal({
            type: "form",
            titleKey: titleKey,
            formFields: formFields,
            htmlContent: linksContainer,
            confirmTextKey: confirmTextKey,
            onSubmit: async (formData) => {
                const { authEmail, authPassword, authUsername, storyPreference, newsletterOptIn } = formData;
                try {
                    if (isLogin) {
                        const themeActiveBeforeLogin = state.getCurrentTheme();
                        const userData = await _authService.handleLogin(authEmail, authPassword);
                        updateAuthUIState();
                        modelToggleManager.updateModelToggleButtonAppearance();
                        if (_userThemeControlsManagerRef && _landingPageManagerRef) {
                            log(LOG_LEVEL_INFO, "Login successful, fetching user-specific theme data and updating UI.");
                            await _userThemeControlsManagerRef.loadUserThemeInteractions();
                            await _landingPageManagerRef.fetchShapedWorldStatusAndUpdateGrid();
                        }
                        const resultData = { ...userData, themeActiveBeforeLoginIfAnon: themeActiveBeforeLogin };
                        return { success: true, data: resultData };
                    } else { // Register
                        const preferences = {
                            username: authUsername,
                            storyPreference: storyPreference,
                            newsletterOptIn: newsletterOptIn === 'true',
                            appLanguage: state.getCurrentAppLanguage(),
                            narrativeLanguage: state.getCurrentNarrativeLanguage(),
                            modelName: state.getCurrentModelName(),
                        };
                        const registrationData = await _authService.handleRegistration(authEmail, authPassword, preferences);
                        return { success: true, actionAfterClose: 'showRegistrationSuccessAlert', data: registrationData };
                    }
                } catch (error) {
                    if (error.code === "EMAIL_NOT_CONFIRMED") {
                        _modalManager.hideCustomModal();
                        showEmailNotConfirmedModal(error.data?.email || authEmail);
                        const handledError = new Error("Email not confirmed, specific modal shown.");
                        handledError.handledByCaller = true;
                        throw handledError;
                    }
                    throw error;
                }
            },
        }).then(async result => { // Post-Submission Logic
            if (result?.success) {
                if (result.actionAfterClose === 'showRegistrationSuccessAlert') {
                    const registeredEmail = result.data?.user?.email || '';
                    _modalManager.showCustomModal({
                        type: "alert",
                        titleKey: "alert_registration_success_title",
                        messageKey: "alert_registration_success_check_email_message",
                        replacements: { USER_EMAIL: registeredEmail },
                    });
                } else if (currentAuthMode === 'login') {
                    const themeWasActive = result.data?.themeActiveBeforeLoginIfAnon;
                    if (themeWasActive && _gameControllerRef?.switchToLanding) {
                        await _gameControllerRef.switchToLanding();
                    } else if (document.body.classList.contains('landing-page-active') && _landingPageManagerRef) {
                        await _landingPageManagerRef.fetchShapedWorldStatusAndUpdateGrid();
                    }
                }
            }
        }).catch(error => {
            if (error?.handledByCaller) {
                log(LOG_LEVEL_DEBUG, "Auth modal submission flow diverted (e.g., email not confirmed).");
            } else {
                log(LOG_LEVEL_ERROR, "Error from showAuthModal promise chain:", error);
            }
        });
    };
    renderAndDisplayForm(); // Initial call
}
/**
 * Alias for showing the authentication modal in login mode.
 */
export const showLoginModal = () => showAuthModal('login');
/**
 * Displays the user profile modal with details and preferences.
 */
export async function showUserProfileModal() {
    const currentUser = state.getCurrentUser();
    if (!currentUser) {
        log(LOG_LEVEL_WARN, "showUserProfileModal called but no user is logged in.");
        return;
    }
    const profileContent = document.createElement('div');
    profileContent.className = 'profile-modal-content';
    const renderProfile = () => {
        profileContent.innerHTML = ''; // Clear for re-rendering
        // --- User Details (Static) ---
        const dl = document.createElement('dl');
        const dtEmail = document.createElement('dt');
        dtEmail.textContent = getUIText("label_profile_email");
        const ddEmail = document.createElement('dd');
        ddEmail.appendChild(document.createTextNode(currentUser.email + " "));
        const emailStatusSpan = document.createElement('span');
        emailStatusSpan.className = 'email-status';
        if (currentUser.email_confirmed) {
            emailStatusSpan.textContent = `(${getUIText("profile_email_confirmed_status")})`;
            emailStatusSpan.classList.add('confirmed');
        } else {
            emailStatusSpan.textContent = `(${getUIText("profile_email_unconfirmed_status")})`;
            emailStatusSpan.classList.add('unconfirmed');
            const resendLink = document.createElement('a');
            resendLink.href = '#';
            resendLink.textContent = getUIText("button_resend_confirmation_email");
            resendLink.className = 'resend-confirmation-link';
            resendLink.style.marginLeft = 'var(--spacing-xs)';
            resendLink.addEventListener('click', async (e) => {
                e.preventDefault();
                resendLink.textContent = getUIText("system_processing_short");
                resendLink.style.pointerEvents = 'none';
                try {
                    await _authService.handleResendConfirmation();
                    _modalManager.hideCustomModal();
                    _modalManager.showCustomModal({
                        type: "alert",
                        titleKey: "alert_confirmation_email_resent_title",
                        messageKey: "alert_confirmation_email_resent_message",
                    });
                } catch (error) {
                    _modalManager.displayModalError(error.message || getUIText("error_api_call_failed", { ERROR_MSG: "Failed to resend." }), profileContent);
                    resendLink.textContent = getUIText("button_resend_confirmation_email");
                    resendLink.style.pointerEvents = 'auto';
                }
            });
            ddEmail.appendChild(document.createTextNode(" - "));
            ddEmail.appendChild(resendLink);
        }
        ddEmail.appendChild(emailStatusSpan);
        dl.appendChild(dtEmail);
        dl.appendChild(ddEmail);
        if (currentUser.username) {
            const dtUsername = document.createElement('dt');
            dtUsername.textContent = getUIText("label_profile_username");
            const ddUsername = document.createElement('dd');
            ddUsername.textContent = currentUser.username;
            dl.appendChild(dtUsername);
            dl.appendChild(ddUsername);
        }
        if (currentUser.tier) {
            const dtTier = document.createElement('dt');
            dtTier.textContent = getUIText("modal_title_manage_subscription");
            const ddTier = document.createElement('dd');
            const tierContainer = document.createElement('div');
            tierContainer.className = 'tier-and-manage-button';
            const tierNameSpan = document.createElement('span');
            tierNameSpan.className = 'user-tier-display';
            tierNameSpan.textContent = getUIText(`tier_${currentUser.tier}_name`);
            tierNameSpan.classList.add(`tier-${currentUser.tier}`);
            tierContainer.appendChild(tierNameSpan);
            if (_billingManagerRef) {
                const manageSubButton = document.createElement('button');
                manageSubButton.className = 'ui-button small';
                manageSubButton.textContent = getUIText("button_manage_plan");
                attachTooltip(manageSubButton, 'tooltip_manage_subscription');
                manageSubButton.addEventListener('click', () => {
                    hideCurrentTooltip();
                    _modalManager.hideCustomModal();
                    _billingManagerRef.showTierSelectionModal();
                });
                tierContainer.appendChild(manageSubButton);
            }
            ddTier.appendChild(tierContainer);
            dl.appendChild(dtTier);
            dl.appendChild(ddTier);
        }
        if (currentUser.created_at) {
            const dtJoined = document.createElement('dt');
            dtJoined.textContent = getUIText("label_profile_joined_date");
            const ddJoined = document.createElement('dd');
            try {
                ddJoined.textContent = new Date(currentUser.created_at).toLocaleDateString(state.getCurrentAppLanguage(), { year: 'numeric', month: 'long', day: 'numeric' });
            } catch (e) {
                ddJoined.textContent = new Date(currentUser.created_at).toISOString().split('T')[0];
            }
            dl.appendChild(dtJoined);
            dl.appendChild(ddJoined);
        }
        profileContent.appendChild(dl);
        // --- Preferences Form ---
        const prefsTitle = document.createElement('h4');
        prefsTitle.textContent = getUIText("label_profile_preferences_title");
        prefsTitle.className = 'profile-section-title';
        profileContent.appendChild(prefsTitle);
        const formContainer = document.createElement('div');
        formContainer.className = 'modal-form-container';
        profileContent.appendChild(formContainer);
        const createSelectField = (id, labelKey, currentValue, options, onUpdate) => {
            const group = document.createElement('div');
            group.className = 'modal-form-group';
            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = getUIText(labelKey);
            const select = document.createElement('select');
            select.id = id;
            select.className = 'modal-input';
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = getUIText(opt.textKey);
                if (opt.descriptionKey) option.dataset.description = getUIText(opt.descriptionKey);
                select.appendChild(option);
            });
            select.value = currentValue;
            select.addEventListener('change', async (e) => {
                const newValue = e.target.value;
                select.disabled = true;
                try {
                    await onUpdate(newValue);
                } catch (error) {
                    log(LOG_LEVEL_ERROR, `Failed to update preference for ${labelKey}:`, error);
                    select.value = currentValue; // Revert on failure
                    _modalManager.displayModalError(error.message, group);
                } finally {
                    if (document.body.contains(select)) select.disabled = false;
                }
            });
            group.appendChild(label);
            group.appendChild(select);
            return { group, select };
        };
        formContainer.appendChild(createSelectField('prefLanguage', 'label_profile_language_select', state.getCurrentAppLanguage(), [
            { value: 'en', textKey: 'option_language_en' },
            { value: 'cs', textKey: 'option_language_cs' },
        ], async (newValue) => {
            setApplicationLanguage(newValue);
            setNarrativeLanguage(newValue);
            await _authService.updateUserPreferences({
                preferred_app_language: newValue,
                preferred_narrative_language: newValue,
            });
            if (_languageManagerRef) _languageManagerRef.applyGlobalUITranslations();
            renderProfile();
        }).group);
        formContainer.appendChild(createSelectField('prefModel', 'label_profile_model_select', state.getCurrentModelName(), [
            { value: 'gemini-1.5-flash-latest', textKey: 'option_model_free' },
            { value: 'gemini-2.5-flash-preview-04-17', textKey: 'option_model_pro' },
        ], async (newValue) => {
            await _authService.updateUserPreferences({ preferred_model_name: newValue });
            modelToggleManager.updateModelToggleButtonAppearance();
        }).group);
        const storyPrefField = createSelectField('prefStory', 'label_story_preference', currentUser.story_preference || 'explorer', [
            { value: "explorer", textKey: "option_story_preference_explorer", descriptionKey: "desc_story_preference_explorer" },
            { value: "strategist", textKey: "option_story_preference_strategist", descriptionKey: "desc_story_preference_strategist" },
            { value: "weaver", textKey: "option_story_preference_weaver", descriptionKey: "desc_story_preference_weaver" },
            { value: "chaos", textKey: "option_story_preference_chaos", descriptionKey: "desc_story_preference_chaos" },
        ], async (newValue) => {
            await _authService.updateUserPreferences({ story_preference: newValue });
            state.setCurrentUser({ ...state.getCurrentUser(), story_preference: newValue });
        });
        const storyPrefDesc = document.createElement('div');
        storyPrefDesc.className = 'select-description';
        const updateStoryDesc = () => { storyPrefDesc.textContent = storyPrefField.select.options[storyPrefField.select.selectedIndex]?.dataset.description || ''; };
        storyPrefField.select.addEventListener('change', updateStoryDesc);
        storyPrefField.group.appendChild(storyPrefDesc);
        updateStoryDesc();
        formContainer.appendChild(storyPrefField.group);
        formContainer.appendChild(createSelectField('prefNewsletter', 'label_profile_newsletter_select', String(currentUser.newsletter_opt_in), [
            { value: 'true', textKey: 'newsletter_option_subscribed' },
            { value: 'false', textKey: 'newsletter_option_unsubscribed' },
        ], async (newValue) => {
            const newOptIn = newValue === 'true';
            await _authService.updateUserPreferences({ newsletter_opt_in: newOptIn });
            state.setCurrentUser({ ...state.getCurrentUser(), newsletter_opt_in: newOptIn });
        }).group);
        // --- Bottom Actions ---
        profileContent.appendChild(document.createElement('hr'));
        const bottomActionsContainer = document.createElement('div');
        bottomActionsContainer.className = 'profile-actions-container';
        const changePasswordButton = document.createElement('button');
        changePasswordButton.className = 'ui-button';
        changePasswordButton.textContent = getUIText("button_profile_change_password");
        changePasswordButton.addEventListener('click', () => {
            _modalManager.hideCustomModal();
            showChangePasswordModal();
        });
        bottomActionsContainer.appendChild(changePasswordButton);
        profileContent.appendChild(bottomActionsContainer);
    };
    renderProfile();
    _modalManager.showCustomModal({
        type: "custom",
        titleKey: "modal_title_user_profile",
        htmlContent: profileContent,
        modalClass: 'profile-modal',
        customActions: [
            {
                textKey: "button_profile_logout",
                className: "ui-button primary logout-button",
                onClick: async () => {
                    _authService.handleLogout();
                    _modalManager.hideCustomModal();
                    updateAuthUIState();
                    modelToggleManager.updateModelToggleButtonAppearance();
                    if (_gameControllerRef) await _gameControllerRef.switchToLanding();
                },
            },
            {
                textKey: "modal_ok_button",
                className: "ui-button",
                onClick: () => _modalManager.hideCustomModal(),
            },
        ],
    });
}
/**
 * Shows a modal for changing the user's password.
 */
export async function showChangePasswordModal() {
    log(LOG_LEVEL_DEBUG, "Showing change password modal.");
    _modalManager.showCustomModal({
        type: "form",
        titleKey: "modal_title_change_password",
        formFields: [
            { id: "currentPassword", labelKey: "label_current_password", type: "password", placeholderKey: "placeholder_current_password", required: true },
            { id: "newPassword", labelKey: "label_new_password", type: "password", placeholderKey: "placeholder_new_password", required: true },
            { id: "confirmNewPassword", labelKey: "label_confirm_new_password", type: "password", placeholderKey: "placeholder_confirm_new_password", required: true },
        ],
        confirmTextKey: "button_profile_change_password",
        onSubmit: async (formData) => {
            const { currentPassword, newPassword, confirmNewPassword } = formData;
            if (newPassword.length < 8) throw new Error(getUIText("alert_new_password_too_short"));
            if (newPassword !== confirmNewPassword) throw new Error(getUIText("alert_passwords_do_not_match"));
            if (currentPassword === newPassword) throw new Error(getUIText("alert_new_password_same_as_old"));
            await _authService.handleChangePassword(currentPassword, newPassword);
            return { success: true, actionAfterClose: 'showPasswordChangeSuccessAlert' };
        },
    }).then(result => {
        if (result?.success && result.actionAfterClose === 'showPasswordChangeSuccessAlert') {
            _modalManager.showCustomModal({
                type: "alert",
                titleKey: "alert_password_change_success_title",
                messageKey: "alert_password_change_success_message",
            });
        }
    }).catch(error => {
        log(LOG_LEVEL_DEBUG, "Change password modal onSubmit error handled, or modal cancelled.");
    });
}
/**
 * Displays a modal informing the user their email is not confirmed, with a resend option.
 * @param {string} unconfirmedEmail The email address that needs confirmation.
 */
export async function showEmailNotConfirmedModal(unconfirmedEmail) {
    log(LOG_LEVEL_INFO, `Showing 'Email Not Confirmed' modal for: ${unconfirmedEmail}`);
    let resendCooldownActive = false;
    const customActions = [
        {
            textKey: "button_resend_confirmation_email",
            className: "ui-button primary",
            onClick: async (clickedButtonElement) => {
                if (resendCooldownActive) return;
                resendCooldownActive = true;
                clickedButtonElement.disabled = true;
                const originalButtonText = clickedButtonElement.textContent;
                clickedButtonElement.textContent = getUIText("system_processing_short");
                try {
                    const result = await _authService.handlePublicResendConfirmation(unconfirmedEmail);
                    const modalMessageArea = document.getElementById('custom-modal-message');
                    if (modalMessageArea) {
                        modalMessageArea.innerHTML = `<p style="color: var(--color-status-ok-text);">${result.message}</p>`;
                    }
                    clickedButtonElement.style.display = 'none';
                    const modalActionsArea = document.getElementById('custom-modal-actions');
                    let closeButton = modalActionsArea?.querySelector('.ui-button:not(.primary)');
                    if (!closeButton && modalActionsArea) closeButton = modalActionsArea.querySelector('.ui-button');
                    if (closeButton) {
                        closeButton.textContent = getUIText("modal_ok_button");
                        if (!closeButton.onclick) closeButton.addEventListener('click', () => _modalManager.hideCustomModal());
                    }
                } catch (resendError) {
                    log(LOG_LEVEL_ERROR, `Failed to resend confirmation email: ${resendError.message}`);
                    _modalManager.displayModalError(getUIText("error_api_call_failed", { ERROR_MSG: resendError.message || "Failed to resend email." }));
                    clickedButtonElement.disabled = false;
                    clickedButtonElement.textContent = originalButtonText;
                    setTimeout(() => {
                        resendCooldownActive = false;
                        if (document.body.contains(clickedButtonElement)) clickedButtonElement.disabled = false;
                    }, 30000); // 30-second cooldown
                }
            },
        },
        {
            textKey: "modal_cancel_button",
            className: "ui-button",
            onClick: () => _modalManager.hideCustomModal(),
        },
    ];
    _modalManager.showCustomModal({
        type: "custom",
        titleKey: "modal_title_email_not_confirmed",
        messageKey: "message_email_not_confirmed_instruction",
        replacements: { USER_EMAIL: unconfirmedEmail },
        customActions: customActions,
    });
}
/**
 * Displays a dedicated page view for email confirmation status.
 * @param {string} status - The status of the email confirmation (e.g., 'success', 'invalid_token').
 */
export function displayEmailConfirmationStatusPage(status) {
    log(LOG_LEVEL_INFO, `Displaying email confirmation status page: ${status}`);
    // Hide main game/landing UI elements
    if (themeGridContainer) themeGridContainer.style.display = 'none';
    if (storyLogViewport) storyLogViewport.style.display = 'none';
    if (playerInputControlPanel) playerInputControlPanel.style.display = 'none';
    if (suggestedActionsWrapper) suggestedActionsWrapper.style.display = 'none';
    if (leftPanel) leftPanel.innerHTML = '';
    if (rightPanel) rightPanel.innerHTML = '';
    if (applicationHeader) applicationHeader.style.display = 'none';
    const centerColumn = document.getElementById('center-column');
    if (!centerColumn) {
        log(LOG_LEVEL_ERROR, "Center column element not found for email confirmation page.");
        return;
    }
    centerColumn.innerHTML = '';
    document.body.className = 'auth-page-active theme-landing';
    const container = document.createElement('div');
    container.className = 'email-confirmation-container';
    const title = document.createElement('h2');
    title.textContent = getUIText("email_confirmation_status_page_title");
    container.appendChild(title);
    let messageKey = "";
    let messageClass = "status-info";
    switch (status) {
        case "success": messageKey = "email_confirmation_success"; messageClass = "status-success"; break;
        case "invalid_token": messageKey = "email_confirmation_invalid_token"; messageClass = "status-error"; break;
        case "already_confirmed": messageKey = "email_confirmation_already_confirmed"; messageClass = "status-info"; break;
        case "expired_token": messageKey = "email_confirmation_expired_token"; messageClass = "status-error"; break;
        case "server_error": messageKey = "email_confirmation_server_error"; messageClass = "status-error"; break;
        default:
            messageKey = "email_confirmation_invalid_token"; messageClass = "status-error";
            log(LOG_LEVEL_WARN, "Unknown email confirmation status for display:", status);
    }
    const messageP = document.createElement('p');
    messageP.innerHTML = getUIText(messageKey).replace(/\n/g, "<br>");
    messageP.classList.add(messageClass);
    container.appendChild(messageP);
    const backButton = document.createElement('button');
    backButton.className = 'ui-button primary';
    backButton.textContent = (status === "success" || status === "already_confirmed") ? getUIText("button_login") : getUIText("button_new_game");
    backButton.addEventListener('click', () => {
        window.location.href = (status === "success" || status === "already_confirmed") ? '/?action=showLogin' : '/';
    });
    container.appendChild(backButton);
    centerColumn.appendChild(container);
}
/**
 * Displays a dedicated page view for resetting the password.
 * @param {string} token - The password reset token from the URL.
 * @param {Function} onPasswordResetSubmit - Async callback (authService.handleResetPassword).
 */
export function displayPasswordResetPage(token, onPasswordResetSubmit) {
    log(LOG_LEVEL_INFO, `Displaying password reset page for token: ${token.substring(0, 10)}...`);
    // Hide main game/landing UI elements
    if (themeGridContainer) themeGridContainer.style.display = 'none';
    if (storyLogViewport) storyLogViewport.style.display = 'none';
    if (playerInputControlPanel) playerInputControlPanel.style.display = 'none';
    if (suggestedActionsWrapper) suggestedActionsWrapper.style.display = 'none';
    if (leftPanel) leftPanel.innerHTML = '';
    if (rightPanel) rightPanel.innerHTML = '';
    if (applicationHeader) applicationHeader.style.display = 'none';
    const centerColumn = document.getElementById('center-column');
    if (!centerColumn) return;
    centerColumn.innerHTML = '';
    document.body.className = 'auth-page-active theme-landing';
    _modalManager.showCustomModal({
        type: "form",
        titleKey: "modal_title_reset_password",
        formFields: [
            { id: "newPasswordReset", labelKey: "label_new_password", type: "password", placeholderKey: "placeholder_new_password", required: true },
            { id: "confirmNewPasswordReset", labelKey: "label_confirm_new_password", type: "password", placeholderKey: "placeholder_confirm_new_password", required: true },
        ],
        confirmTextKey: "button_reset_password",
        onSubmit: async (formData) => {
            const newPassword = formData.newPasswordReset;
            if (newPassword.length < 8) throw new Error(getUIText("alert_new_password_too_short"));
            if (newPassword !== formData.confirmNewPasswordReset) throw new Error(getUIText("alert_passwords_do_not_match"));
            try {
                const result = await onPasswordResetSubmit(token, newPassword);
                return { success: true, actionAfterClose: 'showPasswordResetSuccessAlert', data: result };
            } catch (error) {
                let detailedErrorMessage = error.message;
                if (error.code === 'INVALID_TOKEN' || error.code === 'EXPIRED_TOKEN') {
                    detailedErrorMessage += ` ${getUIText("text_try_request_again")}`;
                }
                throw new Error(detailedErrorMessage);
            }
        },
    }).then(result => {
        if (result?.success && result.actionAfterClose === 'showPasswordResetSuccessAlert') {
            _modalManager.showCustomModal({
                type: "alert",
                titleKey: "alert_password_reset_success_title",
                messageText: result.data.message,
                customActions: [{
                    textKey: "button_login",
                    className: "ui-button primary",
                    onClick: () => { window.location.href = '/?action=showLogin'; },
                }],
            });
        }
    }).catch(error => {
        log(LOG_LEVEL_ERROR, "Error related to password reset modal display/promise:", error);
        if (!document.getElementById('custom-modal-overlay')?.classList.contains('active')) {
            window.location.href = '/';
        }
    });
}
