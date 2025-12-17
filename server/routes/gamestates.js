// server/routes/gamestates.js
import express from 'express';
import prisma from '../db.js';
import logger from '../utils/logger.js';
import { protect } from '../middleware/authMiddleware.js';
import { generatePlayerSummarySnippet, evolveWorldLore, integrateShardIntoLore } from '../utils/aiHelper.js';
import { MODEL_FREE } from '../middleware/usageLimiter.js';
import { getResolvedBaseThemeLore, getResolvedThemeName } from '../utils/themeDataManager.js';

const router = express.Router();

// --- Constants for Living Chronicle ---
const RECENT_INTERACTION_WINDOW_SIZE = 10; // For sending to main AI
const RAW_HISTORY_BUFFER_MAX_SIZE = 25;    // Max raw turns in DB before summarization
const SUMMARIZATION_CHUNK_SIZE = 15;       // Oldest turns to summarize from buffer

// --- GameState Validation Middleware ---
const validateGameStatePayload = (req, res, next) => {
  const {
    theme_id, player_identifier, game_history_delta,
    last_dashboard_updates, last_game_state_indicators, current_prompt_type,
    current_narrative_language, last_suggested_actions, panel_states,
    dashboard_item_meta, user_theme_progress, is_boon_selection_pending,
    session_inventory, equipped_items,
  } = req.body;
  const errors = [];
  if (!theme_id || typeof theme_id !== 'string' || theme_id.trim() === '') { errors.push('theme_id is required and must be a non-empty string.'); }
  if (!player_identifier || typeof player_identifier !== 'string' || player_identifier.trim() === '') { errors.push('player_identifier is required and must be a non-empty string.'); }
  // Validate game_history_delta instead of game_history
  if (typeof game_history_delta === 'undefined' || !Array.isArray(game_history_delta)) { errors.push('game_history_delta is required and must be an array.'); }
  if (typeof last_dashboard_updates === 'undefined' || typeof last_dashboard_updates !== 'object' || last_dashboard_updates === null) { errors.push('last_dashboard_updates is required and must be an object.'); }
  if (typeof last_game_state_indicators === 'undefined' || typeof last_game_state_indicators !== 'object' || last_game_state_indicators === null) { errors.push('last_game_state_indicators is required and must be an object.'); }
  if (!current_prompt_type || typeof current_prompt_type !== 'string' || current_prompt_type.trim() === '') { errors.push('current_prompt_type is required and must be a non-empty string.'); }
  if (!current_narrative_language || typeof current_narrative_language !== 'string' || current_narrative_language.trim() === '') { errors.push('current_narrative_language is required and must be a non-empty string.'); }
  if (typeof last_suggested_actions === 'undefined' || !Array.isArray(last_suggested_actions)) { errors.push('last_suggested_actions is required and must be an array.'); }
  if (typeof panel_states === 'undefined' || typeof panel_states !== 'object' || panel_states === null) { errors.push('panel_states is required and must be an object.'); }
  if (req.body.dashboard_item_meta !== undefined && (typeof req.body.dashboard_item_meta !== 'object' || req.body.dashboard_item_meta === null)) { errors.push('dashboard_item_meta must be an object if provided.'); }
  if (req.body.actions_before_boon_selection !== undefined && req.body.actions_before_boon_selection !== null && !Array.isArray(req.body.actions_before_boon_selection)) {
    errors.push('actions_before_boon_selection must be an array or null if provided.');
  }
  if (user_theme_progress !== undefined) {
    if (typeof user_theme_progress !== 'object' || user_theme_progress === null) {
      errors.push('user_theme_progress must be an object if provided.');
    } else {
      if (user_theme_progress.level !== undefined && (typeof user_theme_progress.level !== 'number' || user_theme_progress.level < 1)) {
        errors.push('user_theme_progress.level must be a positive number if present.');
      }
      if (user_theme_progress.currentXP !== undefined && (typeof user_theme_progress.currentXP !== 'number' || user_theme_progress.currentXP < 0)) {
        errors.push('user_theme_progress.currentXP must be a non-negative number if present.');
      }
      if (user_theme_progress.acquiredTraitKeys !== undefined && !Array.isArray(user_theme_progress.acquiredTraitKeys)) {
        errors.push('user_theme_progress.acquiredTraitKeys must be an array if present.');
      }
    }
  }
  if (typeof is_boon_selection_pending === 'undefined' || typeof is_boon_selection_pending !== 'boolean') {
    errors.push('is_boon_selection_pending is required and must be a boolean.');
  }
  if (session_inventory !== undefined && !Array.isArray(session_inventory)) {
    errors.push('session_inventory must be an array if provided.');
  }
  if (equipped_items !== undefined && (typeof equipped_items !== 'object' || equipped_items === null || Array.isArray(equipped_items))) {
    errors.push('equipped_items must be an object if provided.');
  }
  // Validate the delta's contents
  if (game_history_delta && Array.isArray(game_history_delta)) {
    for (const turn of game_history_delta) {
      if (typeof turn !== 'object' || turn === null || !turn.role || !turn.parts || !Array.isArray(turn.parts)) {
        errors.push('Each item in game_history_delta must be an object with "role" and "parts" (array).'); break;
      }
    }
  }
  if (errors.length > 0) {
    logger.warn(`GameState payload validation failed for user ${req.user?.id}:`, errors);
    return res.status(400).json({ error: { message: 'Invalid game state payload.', code: 'INVALID_PAYLOAD', details: errors } });
  }
  next();
};

/**
 * @route   POST /api/v1/gamestates
 * @desc    Create or Update a game state. Handles Living Chronicle summarization, World Shard unlocking, and XP processing.
 * @access  Private
 */
router.post('/', protect, validateGameStatePayload, async (req, res) => {
  const {
    theme_id, player_identifier, game_history_delta,
    last_dashboard_updates, last_game_state_indicators, current_prompt_type,
    current_narrative_language, last_suggested_actions, panel_states,
    new_persistent_lore_unlock,
    user_theme_progress: clientUserThemeProgress,
    is_boon_selection_pending,
    session_inventory, equipped_items,
  } = req.body;
  const userId = req.user.id;
  const determinedModelName = req.user.preferred_model_name || MODEL_FREE;
  const gameStateClientPayload = {
    player_identifier, last_dashboard_updates, last_game_state_indicators,
    current_prompt_type, current_narrative_language, last_suggested_actions,
    panel_states, model_name_used: determinedModelName,
    dashboard_item_meta: req.body.dashboard_item_meta || {},
    is_boon_selection_pending,
    actions_before_boon_selection: req.body.actions_before_boon_selection || null,
    session_inventory: session_inventory || [],
    equipped_items: equipped_items || {},
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      let existingGameState = await tx.gameState.findUnique({
        where: { userId_theme_id: { userId, theme_id } },
      });

      let combinedHistory;
      let finalCumulativePlayerSummary;
      let finalCurrentWorldLore;
      let newlyEvolvedLore = null; // Variable to hold the new lore if it's generated

      if (existingGameState) {
        const existingHistory = Array.isArray(existingGameState.game_history) ? existingGameState.game_history : [];
        combinedHistory = existingHistory.concat(game_history_delta);
        finalCumulativePlayerSummary = existingGameState.game_history_summary || "";
        finalCurrentWorldLore = existingGameState.game_history_lore;
      } else {
        combinedHistory = game_history_delta;
        finalCumulativePlayerSummary = "";
        finalCurrentWorldLore = null;
      }

      if (!finalCurrentWorldLore) {
          finalCurrentWorldLore = await getResolvedBaseThemeLore(theme_id, current_narrative_language);
          logger.info(`[LivingChronicle] Initializing world lore for user ${userId}, theme ${theme_id}.`);
      }

      // Handle World Shard Unlocking and Lore Evolution first
      if (new_persistent_lore_unlock && typeof new_persistent_lore_unlock === 'object') {
        const isPremiumOrTrial = (req.user.tier === 'pro' || req.user.tier === 'ultra' || (req.user.tier === 'free' && req.user.trial_expires_at && new Date(req.user.trial_expires_at) > new Date()));
        if (isPremiumOrTrial) {
            const { key_suggestion, title, content, unlock_condition_description } = new_persistent_lore_unlock;
            if (key_suggestion && title && content && unlock_condition_description) {
                const SUPPORTED_LANGUAGES = ['en', 'cs']; // Scalable: Add future languages here (e.g., 'de', 'fr')
                const currentLoreByLang = {};
                // Attempt to parse existing lore as a bilingual object
                if (finalCurrentWorldLore) {
                    try {
                        const parsedLore = JSON.parse(finalCurrentWorldLore);
                        if (typeof parsedLore === 'object' && parsedLore !== null) {
                            SUPPORTED_LANGUAGES.forEach(lang => {
                                if (parsedLore[lang]) currentLoreByLang[lang] = parsedLore[lang];
                            });
                        }
                    } catch (e) {
                        // If it's not a JSON object, it's a legacy string. Assign it to the current language.
                        currentLoreByLang[current_narrative_language] = finalCurrentWorldLore;
                    }
                }
                logger.info(`[WorldShard] Evolving lore for all supported languages for user ${userId}, theme ${theme_id} with shard '${title}'`);
                // Create an array of promises to evolve lore for each supported language
                const loreEvolutionPromises = SUPPORTED_LANGUAGES.map(async (lang) => {
                    const baseLoreForLang = await getResolvedBaseThemeLore(theme_id, lang);
                    const currentLore = currentLoreByLang[lang] || baseLoreForLang;
                    const themeNameForLang = await getResolvedThemeName(theme_id, lang);
                    return integrateShardIntoLore(currentLore, { title, content }, themeNameForLang, lang);
                });
                const evolvedLores = await Promise.all(loreEvolutionPromises);
                const newLoreObject = {};
                SUPPORTED_LANGUAGES.forEach((lang, index) => {
                    const baseLoreForLang = currentLoreByLang[lang] || ''; // Fallback to what we had
                    newLoreObject[lang] = evolvedLores[index] || baseLoreForLang; // Use new lore if successful, otherwise keep old
                });
                finalCurrentWorldLore = JSON.stringify(newLoreObject);
                newlyEvolvedLore = newLoreObject;
                logger.info(`[WorldShard] Lore successfully evolved and structured for all languages.`);
                try {
                  await tx.userThemePersistedLore.create({
                    data: { userId: userId, themeId: theme_id, loreFragmentKey: key_suggestion, loreFragmentTitle: title, loreFragmentContent: content, unlockConditionDescription: unlock_condition_description }
                  });
                  logger.info(`[WorldShard] Successfully created new world shard for user ${userId}, theme ${theme_id}, key '${key_suggestion}'`);
                } catch (shardError) {
                  if (shardError.code === 'P2002') {
                    logger.warn(`[WorldShard] Failed to create shard for user ${userId}, theme ${theme_id}, key '${key_suggestion}' due to unique constraint (likely duplicate key from AI). Shard not created.`);
                  } else {
                    logger.error(`[WorldShard] Error creating new world shard during GameState save for user ${userId}, theme ${theme_id}, key '${key_suggestion}':`, shardError);
                    throw new Error(`Failed to create world shard: ${shardError.message}`);
                  }
                }
            } else {
              logger.warn(`[WorldShard] Received 'new_persistent_lore_unlock' signal but required fields were missing. User: ${userId}, Theme: ${theme_id}. Unlock data:`, new_persistent_lore_unlock);
            }
        } else {
            logger.warn(`[WorldShard] User ${userId} (Tier: ${req.user.tier}) attempted to unlock a shard, but this is a premium feature. Ignoring.`);
        }
      }

      if (
        combinedHistory.length >= RAW_HISTORY_BUFFER_MAX_SIZE &&
        (!existingGameState || !existingGameState.summarization_in_progress)
      ) {
        logger.info(`[LivingChronicle] History buffer full (${combinedHistory.length} turns). Starting summarization for user ${userId}, theme ${theme_id}.`);
        const stateToUpdate = await tx.gameState.upsert({
            where: { userId_theme_id: { userId, theme_id } },
            update: { ...gameStateClientPayload, game_history: combinedHistory, summarization_in_progress: true, game_history_lore: finalCurrentWorldLore },
            create: { userId, theme_id, ...gameStateClientPayload, game_history: combinedHistory, summarization_in_progress: true, game_history_summary: finalCumulativePlayerSummary, game_history_lore: finalCurrentWorldLore },
        });

        const baseLoreForSummarization = await getResolvedBaseThemeLore(theme_id, current_narrative_language);
        const themeNameForSummarization = await getResolvedThemeName(theme_id, current_narrative_language);

        processSummarization(
            stateToUpdate.id, userId, theme_id,
            [...combinedHistory],
            finalCumulativePlayerSummary,
            finalCurrentWorldLore,
            current_narrative_language,
            baseLoreForSummarization,
            themeNameForSummarization
        ).catch(err => {
            logger.error(`[LivingChronicle] Background summarization process failed catastrophically for gsID ${stateToUpdate.id}:`, err);
            prisma.gameState.update({
                where: { id: stateToUpdate.id }, data: { summarization_in_progress: false }
            }).catch(resetErr => logger.error(`[LivingChronicle] CRITICAL FALLBACK: Failed to reset summarization_in_progress for gsID ${stateToUpdate.id}:`, resetErr));
        });
      } else {
         await tx.gameState.upsert({
            where: { userId_theme_id: { userId, theme_id } },
            update: { ...gameStateClientPayload, game_history: combinedHistory, game_history_lore: finalCurrentWorldLore },
            create: { userId, theme_id, ...gameStateClientPayload, game_history: combinedHistory, game_history_summary: finalCumulativePlayerSummary, game_history_lore: finalCurrentWorldLore, summarization_in_progress: false },
         });
      }

      if (clientUserThemeProgress && typeof clientUserThemeProgress === 'object') {
        const acquiredTraitKeysForDB = Array.isArray(clientUserThemeProgress.acquiredTraitKeys)
                                         ? clientUserThemeProgress.acquiredTraitKeys
                                         : [];
        await tx.userThemeProgress.upsert({
          where: { userId_themeId: { userId: userId, themeId: theme_id } },
          create: {
            userId: userId,
            themeId: theme_id,
            characterName: player_identifier,
            level: clientUserThemeProgress.level || 1,
            currentXP: clientUserThemeProgress.currentXP || 0,
            maxIntegrityBonus: clientUserThemeProgress.maxIntegrityBonus || 0,
            maxWillpowerBonus: clientUserThemeProgress.maxWillpowerBonus || 0,
            aptitudeBonus: clientUserThemeProgress.aptitudeBonus || 0,
            resilienceBonus: clientUserThemeProgress.resilienceBonus || 0,
            acquiredTraitKeys: acquiredTraitKeysForDB,
          },
          update: {
            level: clientUserThemeProgress.level,
            currentXP: clientUserThemeProgress.currentXP,
            acquiredTraitKeys: acquiredTraitKeysForDB,
          },
        });
        logger.info(`[UserThemeProgress] Upserted for user ${userId}, theme ${theme_id} using full client payload: Level ${clientUserThemeProgress.level}, XP ${clientUserThemeProgress.currentXP}.`);
      } else {
        const existingProgress = await tx.userThemeProgress.findUnique({ where: { userId_themeId: { userId: userId, themeId: theme_id } } });
        if (!existingProgress) {
          await tx.userThemeProgress.create({
            data: { userId: userId, themeId: theme_id, characterName: player_identifier, level: 1, currentXP: 0, maxIntegrityBonus: 0, maxWillpowerBonus: 0, aptitudeBonus: 0, resilienceBonus: 0, acquiredTraitKeys: [] }
          });
          logger.info(`[UserThemeProgress] Initialized default progress for user ${userId}, theme ${theme_id}.`);
        }
      }

      const finalProgressCheck = await tx.userThemeProgress.findUnique({ where: { userId_themeId: { userId: userId, themeId: theme_id } } });
      if (finalProgressCheck && !finalProgressCheck.characterName) {
        await tx.userThemeProgress.update({
          where: { userId_themeId: { userId: userId, themeId: theme_id } },
          data: { characterName: player_identifier }
        });
        logger.info(`[UserThemeProgress] Backfilled missing character name for user ${userId}, theme ${theme_id}.`);
      }

      const upsertedInteraction = await tx.userThemeInteraction.upsert({
        where: { userId_theme_id: { userId, theme_id } },
        create: { userId, theme_id, is_playing: true, last_played_at: new Date(), is_liked: false },
        update: { is_playing: true, last_played_at: new Date() },
      });

      return { interaction: upsertedInteraction, evolved_lore: newlyEvolvedLore };
    });

    logger.info(`GameState & UserThemeInteraction for user ${userId}, theme ${theme_id} saved/updated.`);
    const responsePayload = { message: 'Game state saved.', interaction: result.interaction };
    if (result.evolved_lore) {
      responsePayload.evolved_lore = result.evolved_lore;
    }
    res.status(200).json(responsePayload);
  } catch (error) {
    logger.error(`Transaction error saving game state for user ${userId}, theme ${theme_id}:`, error);
    if (error.message.startsWith('Failed to create world shard:')) {
        return res.status(500).json({ error: { message: error.message, code: 'WORLD_SHARD_CREATION_FAILED_IN_TX' } });
    }
    if (error.code === 'P2002' && error.meta?.target?.includes('userId_theme_id')) {
        return res.status(409).json({ error: { message: 'Conflict saving game state, likely a concurrent update. Please try again.', code: 'GAME_STATE_SAVE_CONFLICT' } });
    }
    res.status(500).json({ error: { message: 'Failed to save game state due to a server error.', code: 'GAME_STATE_SAVE_TRANSACTION_ERROR' } });
  }
});

/**
 * Asynchronous function to process summarization and lore evolution.
 * This runs in the background and updates the database directly.
 */
async function processSummarization(gameStateId, userIdForLog, theme_id, rawHistoryForSummarization, currentSummary, currentDbLore, narrativeLanguage, baseThemeLore, themeNameForPrompt) {
    logger.info(`[LivingChronicle] Starting summarization for gsID ${gameStateId}, user ${userIdForLog}, theme ${theme_id}. History chunk size: ${SUMMARIZATION_CHUNK_SIZE}`);
    const historyChunkToProcess = rawHistoryForSummarization.slice(0, SUMMARIZATION_CHUNK_SIZE);
    const remainingRawHistoryForDB = rawHistoryForSummarization.slice(SUMMARIZATION_CHUNK_SIZE);

    let newPlayerSummarySnippet = null;
    let newEvolvedLoreText = null;

    try {
        newPlayerSummarySnippet = await generatePlayerSummarySnippet(historyChunkToProcess, narrativeLanguage);
        if (!newPlayerSummarySnippet) {
            logger.warn(`[LivingChronicle/PlayerSummary] Failed to generate snippet for gsID ${gameStateId}. Will use existing summary.`);
        }

        const validBaseThemeLore = (typeof baseThemeLore === 'string' && baseThemeLore.trim() !== '') ? baseThemeLore : `Default base lore for ${themeNameForPrompt}.`;
        const loreInputForEvolution = (typeof currentDbLore === 'string' && currentDbLore.trim() !== '') ? currentDbLore : validBaseThemeLore;

        newEvolvedLoreText = await evolveWorldLore(historyChunkToProcess, loreInputForEvolution, validBaseThemeLore, themeNameForPrompt, narrativeLanguage);
        if (!newEvolvedLoreText) {
            logger.warn(`[LivingChronicle/LoreEvolution] Failed to evolve lore for gsID ${gameStateId}. Will use existing/base lore.`);
        }

        const finalCumulativeSummaryToSave = newPlayerSummarySnippet
            ? (currentSummary ? `${currentSummary}\n\n---\n\n${newPlayerSummarySnippet}` : newPlayerSummarySnippet)
            : currentSummary;

        const finalLoreToSave = newEvolvedLoreText || currentDbLore || validBaseThemeLore;

        await prisma.gameState.update({
            where: { id: gameStateId },
            data: {
                game_history: remainingRawHistoryForDB,
                game_history_summary: finalCumulativeSummaryToSave,
                game_history_lore: finalLoreToSave,
                summarization_in_progress: false,
            },
        });
        logger.info(`[LivingChronicle] Successfully completed summarization processing for gsID ${gameStateId}. New raw history length: ${remainingRawHistoryForDB.length}`);
    } catch (error) {
        logger.error(`[LivingChronicle] Critical error during summarization DB update or AI calls for gsID ${gameStateId}:`, error);
        await prisma.gameState.update({
            where: { id: gameStateId },
            data: { summarization_in_progress: false },
        }).catch(e => logger.error(`[LivingChronicle] CRITICAL: Failed to reset summarization_in_progress for gsID ${gameStateId} after error:`, e));
    }
}

/**
 * @route   POST /api/v1/gamestates/:themeId/new-session
 * @desc    Starts a new game session, clearing session-specific data but preserving persistent lore.
 * @access  Private
 */
router.post('/:themeId/new-session', protect, async (req, res) => {
    const userId = req.user.id;
    const { themeId } = req.params;
    if (!themeId) {
        return res.status(400).json({ error: { message: 'themeId parameter is required.', code: 'MISSING_THEMEID_PARAM_NEW_SESSION' } });
    }
    logger.info(`Starting new session for user ${userId}, theme ${themeId}.`);
    try {
        const existingState = await prisma.gameState.findUnique({
            where: { userId_theme_id: { userId, theme_id: themeId } }
        });

        if (existingState) {
            const updatedState = await prisma.gameState.update({
                where: { id: existingState.id },
                data: {
                    game_history: [],
                    session_inventory: [],
                    equipped_items: {},
                    last_dashboard_updates: {},
                    last_game_state_indicators: {},
                    current_prompt_type: 'initial',
                    panel_states: {},
                    dashboard_item_meta: {},
                    is_boon_selection_pending: false,
                    actions_before_boon_selection: null,
                }
            });
            logger.info(`Session reset for user ${userId}, theme ${themeId}. Preserving evolved lore and summary.`);
            res.status(200).json({
                message: 'New session started, existing chronicle preserved.',
                game_history_lore: updatedState.game_history_lore,
                game_history_summary: updatedState.game_history_summary,
            });
        } else {
            logger.info(`No existing game state for user ${userId}, theme ${themeId}. New session will start fresh.`);
            res.status(200).json({
                message: 'No existing game state found. New session will start fresh.',
                game_history_lore: null,
                game_history_summary: null,
            });
        }
    } catch (error) {
        logger.error(`Error starting new session for user ${userId}, theme ${themeId}:`, error);
        res.status(500).json({ error: { message: 'Failed to start new session.', code: 'NEW_SESSION_ERROR' } });
    }
});

/**
 * @route   GET /api/v1/gamestates/:themeId
 * @desc    Get the game state, including evolved lore, summary, and user theme progress.
 * @access  Private
 */
router.get('/:themeId', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  if (!themeId || typeof themeId !== 'string' || themeId.trim() === '') {
    return res.status(400).json({ error: { message: 'Valid themeId parameter is required.', code: 'INVALID_THEMEID_PARAM' } });
  }
  try {
    const gameState = await prisma.gameState.findUnique({
      where: { userId_theme_id: { userId: userId, theme_id: themeId } },
    });
    let userThemeProgress = await prisma.userThemeProgress.findUnique({
        where: {
            userId_themeId: {
                userId: userId,
                themeId: themeId
            }
        }
    });
    if (!gameState) {
      logger.info(`No game state found for user ${userId}, theme ${themeId}.`);
      const baseLore = await getResolvedBaseThemeLore(themeId, req.user.preferred_narrative_language || 'en');
      return res.status(404).json({
        error: { message: 'Game state not found for this theme.', code: 'GAME_STATE_NOT_FOUND' },
        new_game_context: { base_lore: baseLore },
        userThemeProgress: userThemeProgress
      });
    }
    let effectiveEvolvedLore = gameState.game_history_lore;
    if (effectiveEvolvedLore === null || typeof effectiveEvolvedLore === 'undefined' || effectiveEvolvedLore.trim() === '') {
        effectiveEvolvedLore = await getResolvedBaseThemeLore(themeId, gameState.current_narrative_language);
        logger.info(`[LivingChronicle] Lore was empty/null for user ${userId}, theme ${themeId}. Using base lore.`);
    }
    const clientGameHistory = Array.isArray(gameState.game_history)
        ? gameState.game_history.slice(-RECENT_INTERACTION_WINDOW_SIZE)
        : [];
    logger.info(`GameState retrieved for user ${userId}, theme ${themeId}. Sending ${clientGameHistory.length} recent turns.`);
    const finalGameState = { ...gameState };
    // Prioritize the persistent character name from progress over the one saved in GameState
    if (userThemeProgress && userThemeProgress.characterName) {
      finalGameState.player_identifier = userThemeProgress.characterName;
    }
    res.status(200).json({
        ...finalGameState,
        game_history: clientGameHistory,
        game_history_lore: effectiveEvolvedLore,
        userThemeProgress: userThemeProgress
    });
  } catch (error) {
    logger.error(`Error retrieving game state for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to retrieve game state.', code: 'GAME_STATE_RETRIEVAL_ERROR' } });
  }
});


// --- DELETE route  ---
router.delete('/:themeId', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  if (!themeId || typeof themeId !== 'string' || themeId.trim() === '') {
    return res.status(400).json({ error: { message: 'Valid themeId parameter is required.', code: 'INVALID_THEMEID_PARAM' } });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingGameState = await tx.gameState.findUnique({
        where: { userId_theme_id: { userId, theme_id: themeId } },
        select: { id: true }
      });

      if (!existingGameState) {
        const notFoundError = new Error('GameState not found for deletion.');
        notFoundError.code = 'P2025'; // Prisma error code for record not found
        throw notFoundError;
      }

      await tx.gameState.delete({
        where: { userId_theme_id: { userId: userId, theme_id: themeId } },
      });

      await tx.userThemeInteraction.updateMany({
        where: { userId: userId, theme_id: themeId },
        data: { is_playing: false }, // Mark as not currently playing
      });

      return { success: true };
    });

    if (result.success) {
        logger.info(`GameState deleted for user ${userId}, theme ${themeId}, and UserThemeInteraction updated.`);
        res.status(200).json({ message: 'Game state deleted successfully.' });
    }
  } catch (error) {
    if (error.code === 'P2025') { // Record to delete not found
        logger.info(`Attempt to delete non-existent game state for user ${userId}, theme ${themeId}.`);
        return res.status(404).json({ error: { message: 'Game state not found, nothing to delete.', code: 'GAME_STATE_NOT_FOUND_FOR_DELETE' } });
    }
    logger.error(`Transaction error deleting game state for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to delete game state.', code: 'GAME_STATE_DELETE_TRANSACTION_ERROR' } });
  }
});

export default router;
