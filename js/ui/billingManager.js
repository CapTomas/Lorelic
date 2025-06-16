/**
 * @file Manages the UI for billing, subscriptions, and tier upgrades.
 */
import * as modalManager from './modalManager.js';
import * as authService from '../services/authService.js';
import * as modelToggleManager from './modelToggleManager.js';
import { getCurrentUser } from '../core/state.js';
import { getUIText } from '../services/localizationService.js';
import { log, LOG_LEVEL_INFO, LOG_LEVEL_ERROR, LOG_LEVEL_DEBUG } from '../core/logger.js';

/**
 * Defines the features available for each user tier.
 * @constant {object}
 */
const TIER_FEATURES = {
    free: ['feature_api_calls_flash'],
    pro: ['feature_api_calls_flash', 'feature_api_calls_pro', 'feature_longer_responses', 'feature_world_shards'],
    ultra: ['feature_api_calls_flash', 'feature_api_calls_pro', 'feature_api_calls_ultra', 'feature_longer_responses', 'feature_world_shards', 'feature_priority_access'],
};

let _landingPageManagerRef = null;
let _authUiManagerRef = null;

/**
 * Initializes the BillingManager with necessary dependencies.
 * @param {object} dependencies - Object containing references to other modules.
 * @param {object} dependencies.authUiManager - Reference to authUiManager.
 * @param {object} dependencies.landingPageManager - Reference to landingPageManager.
 */
export function initBillingManager(dependencies = {}) {
    _authUiManagerRef = dependencies.authUiManager;
    _landingPageManagerRef = dependencies.landingPageManager;
    log(LOG_LEVEL_INFO, "BillingManager initialized.");
}

/**
 * Refreshes UI components that are sensitive to the user's tier after an upgrade or downgrade.
 * @private
 */
async function _refreshUIAfterTierChange() {
    // Always refresh the model toggle button, as it's always visible.
    modelToggleManager.updateModelToggleButtonAppearance();
    if (_landingPageManagerRef) {
        // This is the most important step. It fetches the latest backend data
        // reflecting the new tier's permissions and updates the central state.
        // It will also re-render the theme grid if the landing page is visible.
        await _landingPageManagerRef.fetchShapedWorldStatusAndUpdateGrid();
        // After the data state is correct, check if we also need to refresh
        // the action buttons for a selected theme on a visible landing page.
        if (document.body.classList.contains('landing-page-active')) {
            const currentSelection = _landingPageManagerRef.getCurrentLandingSelection?.();
            if (currentSelection) {
                // The grid itself was already re-rendered, but we need to ensure
                // the action buttons (like the shard button) are also updated.
                _landingPageManagerRef.renderLandingPageActionButtons(currentSelection);
            }
        }
    }
}

/**
 * Creates the HTML content for a single tier column in the selection modal.
 * @param {string} tierId - The ID of the tier (e.g., 'free', 'pro', 'ultra').
 * @param {boolean} isCurrentTier - Whether this is the user's current tier.
 * @returns {HTMLElement} The created tier column element.
 * @private
 */
function _createTierColumn(tierId, isCurrentTier) {
    const column = document.createElement('div');
    column.className = `tier-column ${isCurrentTier ? 'current-tier' : ''}`;
    column.id = `tier-${tierId}`;
    const tierName = document.createElement('h4');
    tierName.className = 'tier-name';
    tierName.textContent = getUIText(`tier_${tierId}_name`);
    column.appendChild(tierName);
    const tierPrice = document.createElement('div');
    tierPrice.className = 'tier-price';
    const priceText = getUIText(`billing_price_${tierId}`);
    if (tierId !== 'free') {
        tierPrice.innerHTML = `<span class="price">${priceText}</span><span class="suffix">${getUIText('billing_monthly_suffix')}</span>`;
    } else {
        tierPrice.innerHTML = `<span class="price">${priceText}</span>`;
    }
    column.appendChild(tierPrice);
    const featuresList = document.createElement('ul');
    featuresList.className = 'features-list';
    (TIER_FEATURES[tierId] || []).forEach(featureKey => {
        const li = document.createElement('li');
        li.textContent = getUIText(featureKey);
        featuresList.appendChild(li);
    });
    column.appendChild(featuresList);
    const actionButton = document.createElement('button');
    actionButton.className = 'ui-button';
    if (isCurrentTier) {
        actionButton.textContent = getUIText('button_current_plan');
        actionButton.disabled = true;
    } else if (tierId === 'free') {
        actionButton.textContent = getUIText('button_downgrade_plan');
        actionButton.addEventListener('click', async () => {
            log(LOG_LEVEL_INFO, `User clicked to downgrade to free`);
            actionButton.disabled = true;
            actionButton.textContent = getUIText('system_processing_short');
            try {
                await authService.handleDowngradeToFree();
                await _refreshUIAfterTierChange();
                modalManager.hideCustomModal();
                modalManager.showCustomModal({
                    type: 'alert',
                    titleKey: 'alert_downgrade_success_title',
                    messageKey: 'alert_downgrade_success_message',
                    replacements: { TIER_NAME: getUIText('tier_free_name') }
                });
                setTimeout(() => {
                    modalManager.hideCustomModal();
                    if (_authUiManagerRef?.showUserProfileModal) {
                        _authUiManagerRef.showUserProfileModal();
                    }
                }, 2500);
            } catch (error) {
                log(LOG_LEVEL_ERROR, `Downgrade to free failed: ${error.message}`);
                modalManager.displayModalError(error.message || getUIText('alert_downgrade_failed_message'));
                actionButton.disabled = false;
                actionButton.textContent = getUIText('button_downgrade_plan');
            }
        });
    } else {
        actionButton.textContent = getUIText('button_upgrade_plan');
        actionButton.classList.add('primary');
        actionButton.addEventListener('click', async () => {
            log(LOG_LEVEL_INFO, `User clicked to upgrade to ${tierId}`);
            actionButton.disabled = true;
            actionButton.textContent = getUIText('system_processing_short');
            try {
                await authService.handleTierUpgrade(tierId);
                // The page will redirect, so no need to re-enable the button.
            } catch (error) {
                log(LOG_LEVEL_ERROR, `Upgrade initiation failed: ${error.message}`);
                modalManager.displayModalError(error.message);
                actionButton.disabled = false;
                actionButton.textContent = getUIText('button_upgrade_plan');
            }
        });
    }
    column.appendChild(actionButton);
    return column;
}

/**
 * Displays the tier selection modal for the user to manage their subscription.
 */
export function showTierSelectionModal() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        log(LOG_LEVEL_ERROR, "Cannot show tier selection: user not logged in.");
        return;
    }
    const currentTier = currentUser.tier || 'free';
    const modalContent = document.createElement('div');
    modalContent.className = 'tier-selection-container';
    // In a real scenario, you might get tier definitions from an API.
    const tierOrder = ['free', 'pro', 'ultra'];
    tierOrder.forEach(tierId => {
        if (tierId !== 'anonymous') {
            const isCurrent = tierId === currentTier;
            modalContent.appendChild(_createTierColumn(tierId, isCurrent));
        }
    });
    modalManager.showCustomModal({
        type: 'custom',
        titleKey: 'modal_title_manage_subscription',
        htmlContent: modalContent,
        modalClass: 'tier-selection-modal',
        customActions: [{ textKey: 'modal_cancel_button', className: 'ui-button', onClick: () => modalManager.hideCustomModal() }],
    });
}

/**
 * Handles the post-upgrade flow after a successful "payment".
 * @param {string} tier - The tier the user upgraded to.
 * @param {string} sessionId - The session ID from the payment provider.
 */
export async function handleSuccessfulUpgrade(tier, sessionId) {
    log(LOG_LEVEL_INFO, `Handling successful upgrade to ${tier} with session ID ${sessionId}`);
    // Show a temporary "processing" modal
    modalManager.showCustomModal({
        type: 'alert',
        titleKey: 'system_processing_short',
        messageKey: 'alert_upgrade_success_message',
        replacements: { TIER_NAME: getUIText(`tier_${tier}_name`) }
    });
    try {
        await authService.handleUpgradeFinalization(tier, sessionId);
        log(LOG_LEVEL_DEBUG, "Upgrade finalized, updating UI.");
        await _refreshUIAfterTierChange();
        // Refresh UI elements that depend on user tier
        if (_authUiManagerRef) {
            // Give a moment for the user to see the success message
            setTimeout(() => {
                modalManager.hideCustomModal();
                _authUiManagerRef.showUserProfileModal(); // Re-open profile to show new tier
            }, 1500);
        }
    } catch (error) {
        log(LOG_LEVEL_ERROR, "Error during upgrade finalization:", error);
        modalManager.hideCustomModal();
        modalManager.showCustomModal({
            type: 'alert',
            titleKey: 'alert_upgrade_failed_title',
            messageKey: 'alert_upgrade_failed_message'
        });
    }
}
