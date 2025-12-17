// server/routes/user.js
import express from 'express';
import prisma from '../db.js';
import logger from '../utils/logger.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateTokenExpiry } from '../utils/tokenUtils.js';
import { protect, checkPaidTier } from '../middleware/authMiddleware.js';
import { USER_TIERS, constructApiUsageResponse } from '../middleware/usageLimiter.js';
const router = express.Router();
const SALT_ROUNDS = 10;
// --- Preference Endpoints ---
/**
 * @route   GET /api/v1/users/me/preferences
 * @desc    Fetch current user's preferences
 * @access  Private (requires token)
 */
router.get('/me/preferences', protect, async (req, res) => {
  try {
    logger.info(`Fetching preferences for user: ${req.user.email} (ID: ${req.user.id})`);
    res.status(200).json({
      message: "Preferences fetched successfully.",
      preferences: {
        username: req.user.username,
        story_preference: req.user.story_preference,
        newsletter_opt_in: req.user.newsletter_opt_in,
        preferred_app_language: req.user.preferred_app_language,
        preferred_narrative_language: req.user.preferred_narrative_language,
        preferred_model_name: req.user.preferred_model_name,
        trial_started_at: req.user.trial_started_at,
        trial_expires_at: req.user.trial_expires_at,
      }
    });
  } catch (error) {
    logger.error(`Error fetching preferences for user ${req.user?.id}:`, error);
    res.status(500).json({ error: { message: 'Server error fetching preferences.', code: 'PREFERENCES_FETCH_ERROR' } });
  }
});
/**
 * @route   PUT /api/v1/users/me/preferences
 * @desc    Update current user's preferences
 * @access  Private (requires token)
 */
router.put('/me/preferences', protect, async (req, res) => {
  const { preferred_app_language, preferred_narrative_language, preferred_model_name, story_preference, newsletter_opt_in } = req.body;
  const userId = req.user.id;
  const userTier = req.user.tier || 'free';
  const tierConfig = USER_TIERS[userTier] || USER_TIERS.free;
  const allowedLanguages = ['en', 'cs'];
  const allowedStoryPreferences = ['explorer', 'strategist', 'weaver', 'chaos', null];
  const updateData = {};
  if (preferred_app_language !== undefined) {
    if (!allowedLanguages.includes(preferred_app_language)) {
      return res.status(400).json({ error: { message: `Invalid preferred_app_language. Allowed: ${allowedLanguages.join(', ')}`, code: 'INVALID_PREFERENCE_VALUE' } });
    }
    updateData.preferred_app_language = preferred_app_language;
  }
  if (preferred_narrative_language !== undefined) {
    if (!allowedLanguages.includes(preferred_narrative_language)) {
      return res.status(400).json({ error: { message: `Invalid preferred_narrative_language. Allowed: ${allowedLanguages.join(', ')}`, code: 'INVALID_PREFERENCE_VALUE' } });
    }
    updateData.preferred_narrative_language = preferred_narrative_language;
  }
  if (preferred_model_name !== undefined) {
    if (!tierConfig.allowedModels[preferred_model_name]) {
      return res.status(400).json({ error: { message: `Your current tier does not permit the use of the '${preferred_model_name}' model.`, code: 'MODEL_NOT_ALLOWED_FOR_TIER' } });
    }
    updateData.preferred_model_name = preferred_model_name;
  }
  if (story_preference !== undefined) {
    if (!allowedStoryPreferences.includes(story_preference)) {
        return res.status(400).json({ error: { message: `Invalid story_preference.`, code: 'INVALID_PREFERENCE_VALUE' } });
    }
    updateData.story_preference = story_preference;
  }
  if (newsletter_opt_in !== undefined) {
    if (typeof newsletter_opt_in !== 'boolean') {
        return res.status(400).json({ error: { message: `Invalid newsletter_opt_in, must be boolean.`, code: 'INVALID_PREFERENCE_VALUE' } });
    }
    updateData.newsletter_opt_in = newsletter_opt_in;
  }
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: { message: 'No preference data provided to update.', code: 'NO_PREFERENCE_DATA' } });
  }
    try {
    logger.info(`Updating preferences for user: ${req.user.email} (ID: ${userId}) with data:`, updateData);
    const updatedUserRaw = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
            id: true, email: true, username: true, story_preference: true, newsletter_opt_in: true,
            preferred_app_language: true, preferred_narrative_language: true, preferred_model_name: true,
            email_confirmed: true, created_at: true, updated_at: true, tier: true, apiUsage: true,
            trial_started_at: true, trial_expires_at: true,
        }
    });
    const userForResponse = {
        ...updatedUserRaw,
        api_usage: constructApiUsageResponse(updatedUserRaw),
    };
    res.status(200).json({
        message: 'Preferences updated successfully.',
        user: userForResponse
    });
  } catch (error) {
    logger.error(`Error updating preferences for user ${userId}:`, error);
    res.status(500).json({ error: { message: 'Server error updating preferences.', code: 'PREFERENCES_UPDATE_ERROR' } });
  }
});
/**
 * @route   PUT /api/v1/users/me/password
 * @desc    Change current user's password
 * @access  Private (requires token)
 */
router.put('/me/password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  if (!currentPassword || !newPassword) {
    logger.warn(`Password change attempt for user ID ${userId} with missing fields.`);
    return res.status(400).json({
      error: {
        message: 'Current password and new password are required.',
        code: 'MISSING_PASSWORD_FIELDS'
      }
    });
  }
  if (newPassword.length < 8) {
    logger.warn(`Password change attempt for user ID ${userId} with weak new password.`);
    return res.status(400).json({
      error: {
        message: 'New password must be at least 8 characters long.',
        code: 'WEAK_NEW_PASSWORD'
      }
    });
  }
  if (currentPassword === newPassword) {
    logger.warn(`Password change attempt for user ID ${userId} where new password is same as current.`);
    return res.status(400).json({
      error: {
        message: 'New password cannot be the same as the current password.',
        code: 'NEW_PASSWORD_SAME_AS_OLD'
      }
    });
  }
  try {
    const userWithPassword = await prisma.user.findUnique({
      where: { id: userId },
      select: { password_hash: true } // Only select the hash
    });
    if (!userWithPassword) {
      // This case should ideally not be reached if `protect` middleware works correctly
      logger.error(`User ID ${userId} not found in DB during password change, though authenticated.`);
      return res.status(404).json({ error: { message: 'User not found.', code: 'USER_NOT_FOUND' } });
    }
    const isMatch = await bcrypt.compare(currentPassword, userWithPassword.password_hash);
    if (!isMatch) {
      logger.info(`Password change attempt for user ID ${userId} with incorrect current password.`);
      return res.status(401).json({
        error: {
          message: 'Incorrect current password.',
          code: 'INVALID_CURRENT_PASSWORD'
        }
      });
    }
    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    logger.debug(`New password hashed for user ID: ${userId}`);
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedNewPassword },
    });
    logger.info(`Password changed successfully for user: ${req.user.email} (ID: ${userId})`);
    res.status(200).json({
      message: 'Password changed successfully.'
    });
  } catch (error) {
    logger.error(`Error during password change for user ID ${userId}:`, {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: {
        message: 'Server error during password change. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      }
    });
  }
});
/**
 * @route   POST /api/v1/users/me/downgrade-to-free
 * @desc    Downgrades a user's subscription to the free tier.
 * @access  Private
 */
router.post('/me/downgrade-to-free', protect, async (req, res) => {
    const userId = req.user.id;
    logger.info(`User ${userId} requested downgrade to 'free' tier.`);
    if (req.user.tier === 'free') {
        logger.warn(`User ${userId} attempted to downgrade to 'free' but is already on that tier.`);
        return res.status(400).json({ error: { message: 'You are already on the free plan.', code: 'ALREADY_ON_FREE_TIER' } });
    }
    try {
        // In a real application, this would interact with a payment provider like Stripe
        // to cancel the subscription, possibly at the end of the current billing period.
        // For this simulation, we'll just update the tier directly.
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                tier: 'free',
                // Also clear any simulated payment intent tokens
                password_reset_token: null,
                password_reset_expires_at: null,
            },
            select: {
                id: true, email: true, username: true, story_preference: true, newsletter_opt_in: true,
                preferred_app_language: true, preferred_narrative_language: true, preferred_model_name: true,
                email_confirmed: true, created_at: true, updated_at: true, tier: true, apiUsage: true,
                trial_started_at: true, trial_expires_at: true,
            }
        });
        logger.info(`User ${userId} successfully downgraded to 'free' tier.`);
        res.status(200).json({
            message: 'Subscription successfully changed to the free plan.',
            user: updatedUser
        });
    } catch (error) {
        logger.error(`Error downgrading user ${userId} to free tier:`, error);
        res.status(500).json({ error: { message: 'Failed to update subscription.', code: 'DOWNGRADE_FAILED' } });
    }
});
/**
 * @route   POST /api/v1/users/me/create-checkout-session
 * @desc    Simulates creating a payment provider checkout session.
 * @access  Private
 */
router.post('/me/create-checkout-session', protect, async (req, res) => {
    const { tier } = req.body;
    const userId = req.user.id;
    const validTiers = ['pro', 'ultra'];
    if (!tier || !validTiers.includes(tier)) {
        logger.warn(`Invalid tier upgrade request for user ${userId}: ${tier}`);
        return res.status(400).json({ error: { message: 'Invalid tier specified.', code: 'INVALID_TIER' } });
    }
    if (req.user.tier === tier) {
        return res.status(400).json({ error: { message: 'User is already on this tier.', code: 'ALREADY_ON_TIER' } });
    }
    logger.info(`Simulating checkout session for user ${userId} to upgrade to tier '${tier}'.`);
    // In a real application, you would create a Stripe Checkout Session here.
    // The session would contain metadata like userId and the target tier.
    // The success_url would point to your frontend confirmation page.
    // For now, we simulate this flow.
    try {
        const dummySessionId = `sim_session_${crypto.randomBytes(16).toString('hex')}`;
        // Store the intent to upgrade in the DB to verify on success.
        // This prevents users from just calling the success URL without initiating a "payment".
        // Using password_reset_token for this simulation is a temporary hack.
        // A production app should use a dedicated table for payment intents or orders.
        await prisma.user.update({
            where: { id: userId },
            data: {
                password_reset_token: `upgrade_intent_${tier}_${dummySessionId}`,
                password_reset_expires_at: generateTokenExpiry(15), // Intent expires in 15 mins
            }
        });
        const successUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?payment_status=success&tier=${tier}&session_id=${dummySessionId}`;
        res.status(200).json({ redirectUrl: successUrl });
    } catch (error) {
        logger.error(`Error creating simulated checkout for user ${userId}:`, error);
        res.status(500).json({ error: { message: 'Failed to initiate upgrade process.', code: 'CHECKOUT_CREATION_FAILED' } });
    }
});
/**
 * @route   POST /api/v1/users/me/finalize-upgrade
 * @desc    Finalizes a tier upgrade after a simulated successful payment. In production, this would be a webhook.
 * @access  Private
 */
router.post('/me/finalize-upgrade', protect, async (req, res) => {
    const { tier, sessionId } = req.body;
    const userId = req.user.id;
    const validTiers = ['pro', 'ultra'];
    if (!tier || !validTiers.includes(tier) || !sessionId) {
        logger.warn(`Invalid finalize upgrade request for user ${userId}:`, req.body);
        return res.status(400).json({ error: { message: 'Invalid upgrade parameters.', code: 'INVALID_UPGRADE_PARAMS' } });
    }
    // In a real application, you would verify the session ID with the payment provider
    // to confirm the payment was successful. Here, we verify our simulated intent.
    const expectedIntent = `upgrade_intent_${tier}_${sessionId}`;
    const userWithIntent = await prisma.user.findUnique({ where: { id: userId } });
    if (
        !userWithIntent ||
        userWithIntent.password_reset_token !== expectedIntent ||
        (userWithIntent.password_reset_expires_at && new Date() > new Date(userWithIntent.password_reset_expires_at))
    ) {
        logger.error(`Upgrade finalization failed for user ${userId}. Intent mismatch or expired. Expected: ${expectedIntent}, Found: ${userWithIntent?.password_reset_token}`);
        return res.status(400).json({ error: { message: 'Invalid or expired upgrade session. Please try again.', code: 'INVALID_UPGRADE_SESSION' } });
    }
    try {
        logger.info(`Finalizing tier upgrade for user ${userId} to tier '${tier}'.`);
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                tier: tier,
                password_reset_token: null,
                password_reset_expires_at: null,
                // Nullify trial dates upon successful upgrade
                trial_started_at: null,
                trial_expires_at: null,
            },
            select: {
                id: true, email: true, username: true, story_preference: true, newsletter_opt_in: true,
                preferred_app_language: true, preferred_narrative_language: true, preferred_model_name: true,
                email_confirmed: true, created_at: true, updated_at: true, tier: true, apiUsage: true,
                trial_started_at: true, trial_expires_at: true,
            }
        });
        res.status(200).json({
            message: 'User tier upgraded successfully.',
            user: updatedUser
        });
    } catch (error) {
        logger.error(`Error finalizing upgrade for user ${userId}:`, error);
        res.status(500).json({ error: { message: 'Failed to finalize upgrade.', code: 'UPGRADE_FINALIZATION_FAILED' } });
    }
});
/**
 * @route   GET /api/v1/users/me/shaped-themes-summary
 * @desc    Fetch a summary of themes for which the user has World Shards, including counts of active shards.
 * @access  Private
 */
router.get('/me/shaped-themes-summary', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  logger.info(`Fetching shaped themes summary for user ${userId}`);
  try {
    // Get total shards per theme for this user
    const shardSummary = await prisma.userThemePersistedLore.groupBy({
      by: ['themeId'],
      where: {
        userId: userId,
      },
      _count: {
        _all: true, // Correct way to count all rows in the group
      },
    });
    // Get count of *active* shards per theme for this user
    const themesWithActiveShards = await prisma.userThemePersistedLore.groupBy({
        by: ['themeId'],
        where: {
            userId: userId,
            isActiveForNewGames: true,
        },
        _count: {
            _all: true, // Correct way to count rows matching the where clause
        }
    });
    // Create a map for easy lookup of active shard counts
    const activeCountsMap = new Map(themesWithActiveShards.map(item => [item.themeId, item._count._all]));
    // Combine the summaries
    const result = shardSummary.map(theme => ({
      themeId: theme.themeId,
      hasShards: theme._count._all > 0,
      totalShardCount: theme._count._all,
      activeShardCount: activeCountsMap.get(theme.themeId) || 0, // Default to 0 if no active shards
    }));
    res.status(200).json({
      message: 'Shaped themes summary fetched successfully.',
      shapedThemes: result,
    });
  } catch (error) {
    logger.error(`Error fetching shaped themes summary for user ${userId}:`, error);
    res.status(500).json({ error: { message: 'Failed to fetch shaped themes summary.', code: 'SHAPED_THEMES_SUMMARY_FETCH_ERROR' } });
  }
});
/**
 * @route   GET /api/v1/users/me/themes/:themeId/progress
 * @desc    Fetch user's persistent progress for a specific theme.
 * @access  Private
 */
router.get('/me/themes/:themeId/progress', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  if (!themeId) {
    logger.warn(`User theme progress request for user ${userId} with missing themeId.`);
    return res.status(400).json({ error: { message: 'Theme ID is required.', code: 'MISSING_THEME_ID' } });
  }
  logger.info(`Fetching UserThemeProgress for user ${userId}, theme ${themeId}`);
  try {
    const userThemeProgress = await prisma.userThemeProgress.findUnique({
      where: {
        userId_themeId: { // Corrected: Use camelCase 'themeId' as part of the compound key
          userId: userId,
          themeId: themeId, // Corrected: Use camelCase 'themeId' for the field name
        },
      },
    });
    if (!userThemeProgress) {
      logger.info(`No UserThemeProgress found for user ${userId}, theme ${themeId}. Returning default initial state.`);
      // If no progress record exists, it implies a new character for this theme.
      // Return a default structure consistent with the UserThemeProgress model.
      return res.status(200).json({ // 200 is fine, client can interpret this as "new character" for this theme
        message: 'No existing progress found for this theme. Default initial progress returned.',
        userThemeProgress: {
          userId: userId,
          themeId: themeId,
          characterName: null,
          level: 1,
          currentXP: 0,
          maxIntegrityBonus: 0,
          maxWillpowerBonus: 0,
          aptitudeBonus: 0,
          resilienceBonus: 0,
          acquiredTraitKeys: [], // Ensure it's an array
        }
      });
    }
    res.status(200).json({
      message: 'User theme progress fetched successfully.',
      userThemeProgress: userThemeProgress,
    });
  } catch (error) {
    logger.error(`Error fetching UserThemeProgress for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to fetch user theme progress.', code: 'USER_THEME_PROGRESS_FETCH_ERROR' } });
  }
});
/**
 * @route   POST /api/v1/users/me/themes/:themeId/boon
 * @desc    Apply a selected Boon to the user's theme progress.
 * @access  Private
 */
router.post('/me/themes/:themeId/boon', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  const { boonType, targetAttribute, value } = req.body;
  logger.info(`Applying Boon for user ${userId}, theme ${themeId}. Payload:`, req.body);
  if (!themeId) {
    return res.status(400).json({ error: { message: 'Theme ID is required.', code: 'MISSING_THEME_ID_BOON' } });
  }
  if (!boonType || !value) {
    return res.status(400).json({ error: { message: 'Boon type and value are required.', code: 'MISSING_BOON_PAYLOAD' } });
  }
  try {
    const userThemeProgress = await prisma.userThemeProgress.findUnique({
      where: {
        userId_themeId: { // Prisma's default naming for compound unique constraint index
          userId: userId,
          themeId: themeId,
        },
      },
    });
    if (!userThemeProgress) {
      logger.warn(`UserThemeProgress not found for user ${userId}, theme ${themeId} during Boon application.`);
      return res.status(404).json({ error: { message: 'User theme progress not found.', code: 'USER_THEME_PROGRESS_NOT_FOUND_BOON' } });
    }
    const updateData = {};
    let validBoon = false;
    if (boonType === "MAX_ATTRIBUTE_INCREASE") {
      const allowedTargets = ["maxIntegrityBonus", "maxWillpowerBonus"];
      if (allowedTargets.includes(targetAttribute) && typeof value === 'number' && value > 0) {
        updateData[targetAttribute] = (userThemeProgress[targetAttribute] || 0) + value;
        validBoon = true;
      } else {
        logger.warn(`Invalid targetAttribute or value for MAX_ATTRIBUTE_INCREASE: ${targetAttribute}, ${value}`);
      }
    } else if (boonType === "ATTRIBUTE_ENHANCEMENT") {
        const allowedTargets = ["aptitudeBonus", "resilienceBonus"];
        if(allowedTargets.includes(targetAttribute) && typeof value === 'number' && value > 0) {
            updateData[targetAttribute] = (userThemeProgress[targetAttribute] || 0) + value;
            validBoon = true;
        } else {
            logger.warn(`Invalid targetAttribute or value for ATTRIBUTE_ENHANCEMENT: ${targetAttribute}, ${value}`);
        }
    } else if (boonType === "NEW_TRAIT") {
        if(typeof value === 'string' && value.trim() !== '') {
            // Ensure acquiredTraitKeys is an array before pushing
            const currentTraits = Array.isArray(userThemeProgress.acquiredTraitKeys) ? userThemeProgress.acquiredTraitKeys : [];
            // Add the new trait, ensuring no duplicates
            const newTraits = [...new Set([...currentTraits, value])];
            updateData.acquiredTraitKeys = newTraits;
            validBoon = true;
        } else {
            logger.warn(`Invalid value for NEW_TRAIT: must be a non-empty string. Received: ${value}`);
        }
    }
    if (!validBoon) {
      return res.status(400).json({ error: { message: 'Invalid Boon details provided.', code: 'INVALID_BOON_DETAILS' } });
    }
    const updatePayload = {
      ...updateData,
      level: {
        increment: 1,
      },
    };
    const updatedProgress = await prisma.userThemeProgress.update({
      where: {
        userId_themeId: {
          userId: userId,
          themeId: themeId,
        },
      },
      data: updatePayload,
    });
    logger.info(`Boon applied successfully for user ${userId}, theme ${themeId}. Updated progress:`, updatedProgress);
    res.status(200).json({
      message: 'Boon applied successfully.',
      userThemeProgress: updatedProgress,
    });
  } catch (error) {
    logger.error(`Error applying Boon for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to apply Boon due to a server error.', code: 'BOON_APPLICATION_ERROR' } });
  }
});
/**
 * @route   DELETE /api/v1/users/me/themes/:themeId/character-reset
 * @desc    Completely resets a character's progress for a specific theme.
 *          This includes deleting UserThemeProgress, all World Shards (UserThemePersistedLore),
 *          and the GameState. It also marks the theme as not currently playing.
 * @access  Private
 */
router.delete('/me/themes/:themeId/character-reset', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  if (!themeId) {
    logger.warn(`Character reset request for user ${userId} with missing themeId.`);
    return res.status(400).json({ error: { message: 'Theme ID is required.', code: 'MISSING_THEME_ID' } });
  }
  logger.info(`Initiating complete character reset for user ${userId}, theme ${themeId}`);
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete UserThemeProgress
      await tx.userThemeProgress.deleteMany({
        where: { userId: userId, themeId: themeId },
      });
      logger.debug(`[TX] Deleted UserThemeProgress for user ${userId}, theme ${themeId}`);
      // 2. Delete all World Shards (UserThemePersistedLore)
      await tx.userThemePersistedLore.deleteMany({
        where: { userId: userId, themeId: themeId },
      });
      logger.debug(`[TX] Deleted UserThemePersistedLore for user ${userId}, theme ${themeId}`);
      // 3. Delete GameState
      await tx.gameState.deleteMany({
        where: { userId: userId, theme_id: themeId },
      });
      logger.debug(`[TX] Deleted GameState for user ${userId}, theme ${themeId}`);
      // 4. Update UserThemeInteraction to mark as not playing
      await tx.userThemeInteraction.updateMany({
        where: { userId: userId, theme_id: themeId },
        data: { is_playing: false },
      });
      logger.debug(`[TX] Updated UserThemeInteraction for user ${userId}, theme ${themeId}`);
    });
    logger.info(`Character reset successful for user ${userId}, theme ${themeId}.`);
    res.status(200).json({ message: 'Character reset successfully. All progress, fragments, and saved games for this theme have been removed.' });
  } catch (error) {
    logger.error(`Transaction error during character reset for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to reset character due to a server error.', code: 'CHARACTER_RESET_TRANSACTION_ERROR' } });
  }
});
/**
 * @route   PUT /api/v1/users/me/themes/:themeId/progress
 * @desc    Update user's persistent progress for a specific theme (e.g., character name).
 * @access  Private
 */
router.put('/me/themes/:themeId/progress', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  const { characterName } = req.body;
  logger.info(`Updating UserThemeProgress for user ${userId}, theme ${themeId} with payload:`, req.body);
  if (!themeId) {
    return res.status(400).json({ error: { message: 'Theme ID is required.', code: 'MISSING_THEME_ID' } });
  }
  const updateData = {};
  if (characterName !== undefined) {
    if (typeof characterName !== 'string' || characterName.trim().length < 1 || characterName.trim().length > 50) {
      return res.status(400).json({ error: { message: 'Character name must be a string between 1 and 50 characters.', code: 'INVALID_CHARACTER_NAME' } });
    }
    updateData.characterName = characterName.trim();
  }
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: { message: 'No valid data provided for update.', code: 'NO_UPDATE_DATA' } });
  }
  try {
    const updatedProgress = await prisma.userThemeProgress.update({
      where: {
        userId_themeId: {
          userId: userId,
          themeId: themeId,
        },
      },
      data: updateData,
    });
    // Also update the player_identifier in any existing GameState for consistency.
    await prisma.gameState.updateMany({
        where: {
            userId: userId,
            theme_id: themeId,
        },
        data: {
            player_identifier: updateData.characterName,
        }
    });
    logger.info(`UserThemeProgress updated successfully for user ${userId}, theme ${themeId}.`);
    res.status(200).json({
      message: 'User theme progress updated successfully.',
      userThemeProgress: updatedProgress,
    });
  } catch (error) {
    if (error.code === 'P2025') { // Record to update not found
      logger.warn(`Attempt to update non-existent UserThemeProgress for user ${userId}, theme ${themeId}.`);
      return res.status(404).json({ error: { message: 'User theme progress not found.', code: 'USER_THEME_PROGRESS_NOT_FOUND' } });
    }
    logger.error(`Error updating UserThemeProgress for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to update user theme progress.', code: 'USER_THEME_PROGRESS_UPDATE_ERROR' } });
  }
});
export default router;
