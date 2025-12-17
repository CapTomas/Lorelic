// server/routes/worldShards.js
import express from 'express';
import prisma from '../db.js';
import logger from '../utils/logger.js';
import { protect, checkPaidTier } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/v1/themes/:themeId/worldshards
 * @desc    Fetch all World Shards for the authenticated user and specified theme.
 * @access  Private (Paid Tier)
 */
router.get('/themes/:themeId/worldshards', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;

  if (!themeId) {
    return res.status(400).json({ error: { message: 'themeId parameter is required.', code: 'MISSING_THEMEID_PARAM' } });
  }

  logger.info(`Fetching World Shards for user ${userId}, theme ${themeId}`);

  try {
    const shards = await prisma.userThemePersistedLore.findMany({
      where: {
        userId: userId,
        themeId: themeId,
      },
      orderBy: {
        unlockedAt: 'asc',
      },
    });

    res.status(200).json({
      message: 'World Shards fetched successfully.',
      worldShards: shards,
    });
  } catch (error) {
    logger.error(`Error fetching World Shards for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to fetch World Shards.', code: 'WORLD_SHARDS_FETCH_ERROR' } });
  }
});

/**
 * @route   DELETE /api/v1/themes/:themeId/worldshards/reset
 * @desc    "Reset World" - deletes all Shards and the GameState for a user/theme to reset lore.
 * @access  Private (Paid Tier)
 */
router.delete('/themes/:themeId/worldshards/reset', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;

  if (!themeId) {
    return res.status(400).json({ error: { message: 'themeId parameter is required.', code: 'MISSING_THEMEID_PARAM_RESET' } });
  }

  logger.info(`Resetting World (Shards and GameState) for user ${userId}, theme ${themeId}`);

  try {
    const [shardDeleteResult, gameStateDeleteResult] = await prisma.$transaction([
      prisma.userThemePersistedLore.deleteMany({
        where: {
          userId: userId,
          themeId: themeId,
        },
      }),
      prisma.gameState.deleteMany({
        where: {
          userId: userId,
          theme_id: themeId,
        },
      }),
    ]);

    logger.info(`World reset for user ${userId}, theme ${themeId}. Shards deleted: ${shardDeleteResult.count}, GameStates deleted: ${gameStateDeleteResult.count}.`);

    res.status(200).json({ message: `World reset: ${shardDeleteResult.count} Fragment(s) shattered and the current game state for theme ${themeId} was cleared.` });
  } catch (error) {
    logger.error(`Error resetting World for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to reset World.', code: 'WORLD_RESET_ERROR' } });
  }
});

export default router;
