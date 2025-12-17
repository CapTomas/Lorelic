/**
 * @file Provides a generic system for displaying various types of modals
 * (alert, confirm, prompt, form) and orchestrates specific modal views like authentication.
 */

import {
  customModalOverlay,
  customModal,
  customModalTitle,
  customModalMessage,
  customModalInputContainer,
  customModalInput,
  customModalActions,
} from './domElements.js';
import { getUIText } from '../services/localizationService.js';
import { log, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_DEBUG } from '../core/logger.js';
import { getCurrentTheme } from '../core/state.js';

// --- MODULE STATE ---

let _activeOverlayClickListener = null;
let _addedModalClass = null;
let currentModalResolve = null;

const customModalFormContainer = document.createElement('div');
customModalFormContainer.id = 'custom-modal-form-container';

// --- PUBLIC API ---

/**
 * Hides the currently active custom modal.
 * Clears content, removes listeners, and then fades out the overlay.
 */
export function hideCustomModal() {
  if (!customModalOverlay) {
    return;
  }
  if (_addedModalClass && customModal) {
    customModal.classList.remove(_addedModalClass);
    _addedModalClass = null;
  }
  // Clear dynamic content from the modal structure.
  if (customModalTitle) customModalTitle.textContent = '';
  if (customModalMessage) customModalMessage.innerHTML = '';
  if (customModalActions) customModalActions.innerHTML = '';
  if (customModalInput) customModalInput.value = '';
  // Ensure standalone containers are also reset.
  if (customModalInputContainer && customModalInputContainer.style.display !== 'none') {
    if (!customModalMessage || !customModalMessage.contains(customModalInputContainer)) {
      customModalInputContainer.style.display = 'none';
    }
  }
  if (customModalFormContainer && customModalFormContainer.innerHTML !== '') {
    if (!customModalMessage || !customModalMessage.contains(customModalFormContainer)) {
      customModalFormContainer.innerHTML = '';
    }
  }
  const errorDisplay = customModalMessage ? customModalMessage.querySelector('.modal-error-display') : null;
  if (errorDisplay) {
    errorDisplay.remove();
  }
  // Remove the overlay click listener to prevent memory leaks.
  if (_activeOverlayClickListener) {
    customModalOverlay.removeEventListener('click', _activeOverlayClickListener);
    _activeOverlayClickListener = null;
  }
  // Start fade-out animation.
  customModalOverlay.classList.remove('active');
  log(LOG_LEVEL_DEBUG, 'Custom modal content cleared and fade-out initiated.');
  currentModalResolve = null;
}

/**
 * Displays an error message within the modal's message area or a specified container.
 * @param {string} messageText - The error message to display.
 * @param {HTMLElement} [containerElement=customModalMessage] - The container to append the error to.
 */
export function displayModalError(messageText, containerElement = customModalMessage) {
  if (!containerElement) {
    log(LOG_LEVEL_WARN, 'displayModalError: containerElement is null or undefined for message:', messageText);
    return;
  }

  const existingError = containerElement.querySelector('.modal-error-display');
  if (existingError) {
    existingError.remove();
  }

  const errorDisplay = document.createElement('p');
  errorDisplay.className = 'modal-error-display';
  errorDisplay.style.color = 'var(--color-meter-critical)';
  errorDisplay.style.marginTop = 'var(--spacing-sm)';
  errorDisplay.style.marginBottom = 'var(--spacing-sm)';
  errorDisplay.textContent = messageText;

  if (containerElement === customModalMessage) {
    containerElement.insertBefore(errorDisplay, containerElement.firstChild);
  } else {
    containerElement.appendChild(errorDisplay);
  }
}

/**
 * Shows a custom modal and returns a Promise that resolves with the user's interaction.
 * @param {object} options - Configuration for the modal.
 * @param {'alert'|'confirm'|'prompt'|'form'|'custom'} [options.type='alert'] - Type of modal.
 * @param {string} options.titleKey - Localization key for the modal title.
 * @param {string} [options.messageKey] - Localization key for a static message.
 * @param {string|HTMLElement} [options.htmlContent] - Raw HTML string or HTMLElement to inject into message area.
 * @param {Array<object>} [options.formFields] - Array of field configs for 'form' type.
 * @param {object} [options.replacements={}] - Replacements for localization keys.
 * @param {string} [options.confirmTextKey] - Localization key for confirm button.
 * @param {string} [options.cancelTextKey] - Localization key for cancel button.
 * @param {string} [options.inputPlaceholderKey] - Placeholder for 'prompt' type.
 * @param {string} [options.defaultValue=''] - Default value for 'prompt' type.
 * @param {string|null} [options.explicitThemeContext=null] - Theme context for localization.
 * @param {Function} [options.onSubmit] - Async callback for 'form' type. Receives formData.
 * @param {Array<object>} [options.customActions] - Custom buttons: { textKey, className, onClick(buttonElement) }.
 * @param {string} [options.modalClass] - An optional CSS class to add to the modal-box for custom styling.
 * @returns {Promise<any>} Resolves with input value (prompt), boolean (confirm), form data, or null (cancel/alert).
 */
export function showCustomModal(options) {
  return new Promise((resolve) => {
    currentModalResolve = resolve;
    const {
      type = 'alert', titleKey, messageKey, htmlContent, formFields,
      replacements = {}, confirmTextKey, cancelTextKey,
      inputPlaceholderKey, defaultValue = '', explicitThemeContext = null,
      onSubmit, customActions, modalClass,
    } = options;
    if (!customModalOverlay || !customModalTitle || !customModalMessage || !customModalActions) {
      log(LOG_LEVEL_ERROR, 'Custom modal core DOM elements not found! Cannot display modal.');
      if (currentModalResolve) {
        currentModalResolve(type === 'prompt' ? null : (type === 'confirm' || type === 'form') ? false : null);
      }
      return;
    }
    const modalThemeContext = explicitThemeContext || getCurrentTheme();
    let confirmBtnRef = null;
    let defaultConfirmKey = 'modal_ok_button';
    if (type === 'confirm' || type === 'form') defaultConfirmKey = 'modal_confirm_button';
    else if (type === 'prompt') defaultConfirmKey = 'modal_confirm_button';
    const handleConfirm = async () => {
      let modalShouldClose = true;
      let resolveValue;
      if (type === 'form' || (formFields && formFields.length > 0)) {
        const formData = {};
        let firstInvalidField = null;
        let isValid = true;
        customModalFormContainer.querySelectorAll('.modal-error-display').forEach(el => el.remove());
        formFields.forEach(field => {
          const inputElement = customModalFormContainer.querySelector(`#${field.id}`);
          if (inputElement) {
            formData[field.id] = (inputElement.type === 'checkbox') ? inputElement.checked : inputElement.value;
            if (field.required && typeof formData[field.id] === 'string' && !formData[field.id].trim()) {
              isValid = false;
              if (!firstInvalidField) firstInvalidField = inputElement;
            }
            if (field.type === 'email' && formData[field.id] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData[field.id])) {
              isValid = false;
              if (!firstInvalidField) firstInvalidField = inputElement;
              displayModalError(getUIText('alert_invalid_email_format'), inputElement.parentElement);
            }
          }
        });
        if (!isValid) {
          if (firstInvalidField) firstInvalidField.focus();
          log(LOG_LEVEL_WARN, 'Modal form validation failed.');
          if (!customModalFormContainer.querySelector('.modal-error-display[data-general-error="true"]')) {
            const generalErrorContainer = customModalFormContainer.closest('.modal-box').querySelector('.modal-message') || customModalFormContainer;
            displayModalError(getUIText('alert_fill_required_fields'), generalErrorContainer);
          }
          return;
        }
        if (onSubmit) {
          try {
            if (confirmBtnRef) {
              confirmBtnRef.disabled = true;
              confirmBtnRef.textContent = getUIText('system_processing_short');
            }
            const resultFromOnSubmit = await onSubmit(formData);
            if (typeof resultFromOnSubmit === 'object' && resultFromOnSubmit !== null) {
              resolveValue = resultFromOnSubmit;
              if (resultFromOnSubmit.keepOpen === true) {
                modalShouldClose = false;
              }
            } else {
              resolveValue = { success: resultFromOnSubmit !== false, data: resultFromOnSubmit };
            }
          } catch (error) {
            log(LOG_LEVEL_ERROR, 'Error in modal onSubmit:', error);
            displayModalError(error.message || getUIText('error_api_call_failed', { ERROR_MSG: 'Operation failed' }), customModalFormContainer);
            modalShouldClose = false;
            resolveValue = { success: false, error: error };
          } finally {
            if (confirmBtnRef && document.body.contains(confirmBtnRef)) {
              confirmBtnRef.disabled = false;
              confirmBtnRef.textContent = getUIText(confirmTextKey || defaultConfirmKey, {}, { explicitThemeContext: modalThemeContext });
            }
          }
        } else {
          resolveValue = formData;
        }
      } else if (type === 'prompt' && customModalInput) {
        resolveValue = customModalInput.value;
      } else if (type === 'confirm') {
        resolveValue = true;
      } else {
        resolveValue = null;
      }
      if (currentModalResolve) {
        currentModalResolve(resolveValue);
      }
      if (modalShouldClose) {
        hideCustomModal();
      }
    };
    if (_addedModalClass && customModal) {
        customModal.classList.remove(_addedModalClass);
        _addedModalClass = null;
    }
    if (modalClass && customModal) {
        customModal.classList.add(modalClass);
        _addedModalClass = modalClass;
    }
    customModalTitle.textContent = getUIText(titleKey || `modal_default_title_${type}`, replacements, { explicitThemeContext: modalThemeContext });
    customModalMessage.innerHTML = '';
    customModalFormContainer.innerHTML = '';
    if (customModalInputContainer) customModalInputContainer.style.display = 'none';
    if (messageKey) {
      const staticMessageP = document.createElement('p');
      staticMessageP.innerHTML = getUIText(messageKey, replacements, { explicitThemeContext: modalThemeContext }).replace(/\n/g, '<br>');
      customModalMessage.appendChild(staticMessageP);
    }
    if (htmlContent) {
      if (typeof htmlContent === 'string') {
        customModalMessage.insertAdjacentHTML('beforeend', htmlContent);
      } else if (htmlContent instanceof HTMLElement) {
        customModalMessage.appendChild(htmlContent);
      }
    }
    if (type === 'form' || (formFields && formFields.length > 0)) {
      customModalMessage.appendChild(customModalFormContainer);
      formFields.forEach(field => {
        const fieldGroup = document.createElement('div');
        fieldGroup.classList.add('modal-form-group');
        switch (field.type) {
          case 'checkbox': {
            fieldGroup.classList.add('modal-form-group-checkbox');
            const label = document.createElement('label');
            label.htmlFor = field.id;
            label.classList.add('modal-checkbox-label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = field.id;
            input.name = field.id;
            input.checked = field.value || false;
            label.appendChild(input);
            const labelText = document.createElement('span');
            labelText.textContent = getUIText(field.labelKey, {}, { explicitThemeContext: modalThemeContext });
            label.appendChild(labelText);
            fieldGroup.appendChild(label);
            break;
          }
          case 'select': {
            const label = document.createElement('label');
            label.htmlFor = field.id;
            label.textContent = getUIText(field.labelKey, {}, { explicitThemeContext: modalThemeContext });
            fieldGroup.appendChild(label);
            const select = document.createElement('select');
            select.id = field.id;
            select.name = field.id;
            select.classList.add('modal-input');
            if (field.options && Array.isArray(field.options)) {
              field.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = getUIText(opt.textKey, {}, { explicitThemeContext: modalThemeContext });
                if (opt.descriptionKey) {
                  option.dataset.description = getUIText(opt.descriptionKey, {}, { explicitThemeContext: modalThemeContext });
                }
                select.appendChild(option);
              });
            }
            fieldGroup.appendChild(select);
            const descContainer = document.createElement('div');
            descContainer.id = `${field.id}-description`;
            descContainer.className = 'select-description';
            descContainer.textContent = select.options[select.selectedIndex]?.dataset.description || '';
            select.addEventListener('change', () => {
              descContainer.textContent = select.options[select.selectedIndex]?.dataset.description || '';
            });
            fieldGroup.appendChild(descContainer);
            break;
          }
          default: {
            const label = document.createElement('label');
            label.htmlFor = field.id;
            label.textContent = getUIText(field.labelKey, {}, { explicitThemeContext: modalThemeContext });
            fieldGroup.appendChild(label);
            const input = document.createElement('input');
            input.type = field.type || 'text';
            input.id = field.id;
            input.name = field.id;
            if (field.placeholderKey) input.placeholder = getUIText(field.placeholderKey, {}, { explicitThemeContext: modalThemeContext });
            if (field.value) input.value = field.value;
            if (field.required) input.required = true;
            input.classList.add('modal-input');
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            });
            fieldGroup.appendChild(input);
            break;
          }
        }
        customModalFormContainer.appendChild(fieldGroup);
      });
    } else if (type === 'prompt') {
      if (customModalInputContainer && customModalInput) {
        customModalInputContainer.style.display = 'block';
        customModalMessage.appendChild(customModalInputContainer);
        customModalInput.value = defaultValue;
        customModalInput.placeholder = inputPlaceholderKey ? getUIText(inputPlaceholderKey, {}, { explicitThemeContext: modalThemeContext }) : '';
        customModalInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
          }
        });
      }
    }
    customModalActions.innerHTML = '';
    if (customActions && Array.isArray(customActions) && customActions.length > 0) {
      customActions.forEach(actionConfig => {
        const btn = document.createElement('button');
        btn.className = actionConfig.className || 'ui-button';
        btn.textContent = getUIText(actionConfig.textKey, {}, { explicitThemeContext: modalThemeContext });
        btn.addEventListener('click', async () => {
          if (actionConfig.onClick) {
            try {
              await actionConfig.onClick(btn);
            } catch (e) {
              log(LOG_LEVEL_ERROR, `Error in custom action button's onClick for ${actionConfig.textKey}:`, e);
              displayModalError(e.message || 'An unexpected error occurred in the action.');
            }
          }
        });
        customModalActions.appendChild(btn);
      });
    } else {
      const confirmBtn = document.createElement('button');
      confirmBtn.classList.add('ui-button', 'primary');
      confirmBtn.textContent = getUIText(confirmTextKey || defaultConfirmKey, {}, { explicitThemeContext: modalThemeContext });
      confirmBtnRef = confirmBtn;
      confirmBtn.addEventListener('click', handleConfirm);
      customModalActions.appendChild(confirmBtn);
      if (type === 'confirm' || type === 'prompt' || type === 'form' || (formFields && formFields.length > 0)) {
        const cancelBtn = document.createElement('button');
        cancelBtn.classList.add('ui-button');
        cancelBtn.textContent = getUIText(cancelTextKey || 'modal_cancel_button', {}, { explicitThemeContext: modalThemeContext });
        cancelBtn.addEventListener('click', () => {
          if (currentModalResolve) currentModalResolve(type === 'prompt' ? null : (type === 'form' ? null : false));
          hideCustomModal();
        });
        customModalActions.appendChild(cancelBtn);
      }
    }
    customModalOverlay.classList.add('active');
    if (_activeOverlayClickListener) {
      customModalOverlay.removeEventListener('click', _activeOverlayClickListener);
    }
    _activeOverlayClickListener = (event) => {
      if (event.target === customModalOverlay) {
        log(LOG_LEVEL_DEBUG, 'Modal overlay clicked, attempting to close modal.');
        if (currentModalResolve) {
          currentModalResolve(null);
        }
        hideCustomModal();
      }
    };
    customModalOverlay.addEventListener('click', _activeOverlayClickListener);
    if ((type === 'form' || (formFields && formFields.length > 0)) && customModalFormContainer.querySelector('input:not([type=hidden])')) {
      setTimeout(() => {
        const firstInput = customModalFormContainer.querySelector('input:not([type=hidden])');
        if (firstInput && document.body.contains(firstInput)) firstInput.focus();
      }, 50);
    } else if (type === 'prompt' && customModalInput) {
      setTimeout(() => {
        if (document.body.contains(customModalInput)) customModalInput.focus();
      }, 50);
    } else if (customModalActions.firstChild && typeof customModalActions.firstChild.focus === 'function') {
      setTimeout(() => {
        if (document.body.contains(customModalActions.firstChild)) customModalActions.firstChild.focus();
      }, 50);
    }
  });
}

// --- Specific Modal Orchestrators ---

/**
 * Shows an authentication modal for either login or registration.
 * @param {'login'|'register'} [initialMode='login'] - The mode to open the modal in.
 * @param {Function} onAuthSuccess - Callback function invoked upon successful authentication. It receives an object with details about the auth action (e.g., { mode: 'login', ... }).
 */
export async function showAuthFormModal(initialMode = 'login', onAuthSuccess) {
  log(LOG_LEVEL_DEBUG, `Showing auth form modal in '${initialMode}' mode.`);
  let currentAuthMode = initialMode;

  const renderAndShow = () => {
    const isLogin = currentAuthMode === 'login';
    const titleKey = isLogin ? 'modal_title_login' : 'modal_title_register';
    const confirmTextKey = isLogin ? 'button_login' : 'button_register';

    let formFields = [
      { id: 'authEmail', labelKey: 'label_email', type: 'email', placeholderKey: 'placeholder_email', required: true },
      { id: 'authPassword', labelKey: 'label_password', type: 'password', placeholderKey: isLogin ? 'placeholder_password' : 'placeholder_password_register', required: true },
    ];

    if (!isLogin) {
      const registrationFields = [
        { id: 'authUsername', labelKey: 'label_username', type: 'text', placeholderKey: 'placeholder_username', required: true },
        {
          id: 'storyPreference',
          labelKey: 'label_story_preference',
          type: 'select',
          options: [
            { value: '', textKey: 'option_story_preference_default', descriptionKey: '' },
            { value: 'explorer', textKey: 'option_story_preference_explorer', descriptionKey: 'desc_story_preference_explorer' },
            { value: 'strategist', textKey: 'option_story_preference_strategist', descriptionKey: 'desc_story_preference_strategist' },
            { value: 'weaver', textKey: 'option_story_preference_weaver', descriptionKey: 'desc_story_preference_weaver' },
            { value: 'chaos', textKey: 'option_story_preference_chaos', descriptionKey: 'desc_story_preference_chaos' },
          ],
        },
        { id: 'newsletterOptIn', labelKey: 'label_newsletter_opt_in', type: 'checkbox', value: false },
      ];
      formFields.splice(1, 0, registrationFields[0]);
      formFields.push(registrationFields[1], registrationFields[2]);
    }

    const linksContainer = document.createElement('div');
    linksContainer.className = 'auth-modal-links';

    if (isLogin) {
      const forgotPasswordLink = document.createElement('a');
      forgotPasswordLink.href = '#';
      forgotPasswordLink.textContent = getUIText('button_forgot_password');
      forgotPasswordLink.className = 'forgot-password-link';
      forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        hideCustomModal();
        showForgotPasswordRequestModal(onAuthSuccess);
      });
      linksContainer.appendChild(forgotPasswordLink);
    }

    const switchAuthModeLink = document.createElement('a');
    switchAuthModeLink.href = '#';
    const switchLinkTextKey = isLogin ? 'modal_switch_to_register' : 'modal_switch_to_login';
    switchAuthModeLink.textContent = getUIText(switchLinkTextKey);
    switchAuthModeLink.className = 'switch-auth-mode-link';
    switchAuthModeLink.addEventListener('click', (e) => {
      e.preventDefault();
      currentAuthMode = isLogin ? 'register' : 'login';
      hideCustomModal();
      renderAndShow();
    });
    linksContainer.appendChild(switchAuthModeLink);

    showCustomModal({
      type: 'form',
      titleKey: titleKey,
      formFields: formFields,
      htmlContent: linksContainer,
      confirmTextKey: confirmTextKey,
      onSubmit: async (formData) => {
        const { authEmail, authPassword, authUsername, storyPreference, newsletterOptIn } = formData;
        try {
          let result;
          if (isLogin) {
            result = await onAuthSuccess({ mode: 'login', email: authEmail, password: authPassword });
          } else {
            result = await onAuthSuccess({
              mode: 'register',
              email: authEmail,
              password: authPassword,
              username: authUsername,
              storyPreference: storyPreference,
              newsletterOptIn: newsletterOptIn,
            });
          }
          return result;
        } catch (error) {
          log(LOG_LEVEL_ERROR, `${currentAuthMode} failed from modal onSubmit:`, error.message);
          throw error;
        }
      },
    }).then(result => {
      if (result?.success && result.actionAfterClose === 'showRegistrationSuccessAlert') {
        const registeredEmail = result.data?.user?.email || '';
        showCustomModal({
          type: 'alert',
          titleKey: 'alert_registration_success_title',
          messageKey: 'alert_registration_success_check_email_message',
          replacements: { USER_EMAIL: registeredEmail },
        });
      }
    }).catch(error => {
      log(LOG_LEVEL_ERROR, "Error from showAuthFormModal's main promise chain:", error);
    });
  };

  renderAndShow();
}

/**
 * Shows the "Forgot Password" request modal.
 * @param {Function} onAuthSuccess - The main auth success callback.
 */
export async function showForgotPasswordRequestModal(onAuthSuccess) {
  await showCustomModal({
    type: 'form',
    titleKey: 'modal_title_forgot_password',
    formFields: [
      { id: 'resetEmail', labelKey: 'label_email', type: 'email', placeholderKey: 'placeholder_email', required: true },
    ],
    confirmTextKey: 'button_send_reset_link',
    onSubmit: async (formData) => {
      const email = formData.resetEmail;
      const response = await onAuthSuccess({ mode: 'forgotPassword', email: email });
      return { success: true, message: response.message, actionAfterClose: 'showResetRequestSentAlert' };
    },
  }).then(result => {
    if (result?.actionAfterClose === 'showResetRequestSentAlert' && result.message) {
      showCustomModal({
        type: 'alert',
        titleKey: 'alert_reset_link_sent_title',
        messageText: result.message,
      });
    }
  }).catch(error => {
    log(LOG_LEVEL_DEBUG, 'Forgot password request modal onSubmit error handled, or modal cancelled.');
  });
}

/**
 * Shows a modal for changing the user's password.
 * @param {Function} onChangePasswordSubmit - Async function that takes (currentPassword, newPassword) and returns a promise.
 */
export async function showChangePasswordFormModal(onChangePasswordSubmit) {
  log(LOG_LEVEL_DEBUG, 'Showing change password form modal.');
  await showCustomModal({
    type: 'form',
    titleKey: 'modal_title_change_password',
    formFields: [
      { id: 'currentPassword', labelKey: 'label_current_password', type: 'password', placeholderKey: 'placeholder_current_password', required: true },
      { id: 'newPassword', labelKey: 'label_new_password', type: 'password', placeholderKey: 'placeholder_new_password', required: true },
      { id: 'confirmNewPassword', labelKey: 'label_confirm_new_password', type: 'password', placeholderKey: 'placeholder_confirm_new_password', required: true },
    ],
    confirmTextKey: 'button_profile_change_password',
    onSubmit: async (formData) => {
      const { currentPassword, newPassword, confirmNewPassword } = formData;
      if (newPassword.length < 8) {
        throw new Error(getUIText('alert_new_password_too_short'));
      }
      if (newPassword !== confirmNewPassword) {
        throw new Error(getUIText('alert_passwords_do_not_match'));
      }
      if (currentPassword === newPassword) {
        throw new Error(getUIText('alert_new_password_same_as_old'));
      }
      await onChangePasswordSubmit(currentPassword, newPassword);
      return { success: true, actionAfterClose: 'showPasswordChangeSuccessAlert' };
    },
  }).then(result => {
    if (result?.success && result.actionAfterClose === 'showPasswordChangeSuccessAlert') {
      showCustomModal({
        type: 'alert',
        titleKey: 'alert_password_change_success_title',
        messageKey: 'alert_password_change_success_message',
      });
    }
  }).catch(error => {
    log(LOG_LEVEL_DEBUG, 'Change password modal onSubmit error handled, or modal cancelled.');
  });
}

/**
 * Shows a generic confirmation modal.
 * @param {object} options - Options for the confirmation modal.
 * @param {string} options.titleKey - Localization key for the title.
 * @param {string} [options.messageKey] - Localization key for the message.
 * @param {string} [options.messageText] - Raw text for the message, overrides messageKey.
 * @param {object} [options.replacements={}] - Replacements for localization.
 * @param {string} [options.confirmTextKey="modal_confirm_button"] - Confirm button text key.
 * @param {string} [options.cancelTextKey="modal_cancel_button"] - Cancel button text key.
 * @param {string|null} [options.explicitThemeContext=null] - Theme context for localization.
 * @returns {Promise<boolean>} True if confirmed, false if cancelled.
 */
export async function showGenericConfirmModal({
  titleKey,
  messageKey,
  messageText,
  replacements = {},
  confirmTextKey = 'modal_confirm_button',
  cancelTextKey = 'modal_cancel_button',
  explicitThemeContext = null,
}) {
  log(LOG_LEVEL_DEBUG, `Showing generic confirm modal: ${titleKey} / ${messageKey || messageText}`);
  const result = await showCustomModal({
    type: 'confirm',
    titleKey,
    messageKey: messageKey,
    htmlContent: !messageKey && messageText ? `<p>${messageText.replace(/\n/g, '<br>')}</p>` : undefined,
    replacements,
    confirmTextKey,
    cancelTextKey,
    explicitThemeContext,
  });
  return !!result;
}
