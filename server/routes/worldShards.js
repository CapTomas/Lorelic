// server/routes/worldShards.js
import express from 'express';
import prisma from '../db.js';
import logger from '../utils/logger.js';
import { protect, checkPaidTier } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/v1/themes/:themeId/worldshards
 * @desc    Fetch all World Shards for the authenticated user and specified theme.
 * @access  Private
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
        unlockedAt: 'asc', // Or perhaps loreFragmentTitle
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
 * @route   PUT /api/v1/worldshards/:shardId/status
 * @desc    Update isActiveForNewGames status for a specific Shard ID.
 * @access  Private
 */
router.put('/worldshards/:shardId/status', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  const { shardId } = req.params;
  const { isActiveForNewGames } = req.body;

  if (typeof isActiveForNewGames !== 'boolean') {
    return res.status(400).json({ error: { message: '"isActiveForNewGames" must be a boolean value.', code: 'INVALID_STATUS_FLAG_TYPE' } });
  }

  logger.info(`Updating World Shard ${shardId} status for user ${userId} to isActiveForNewGames: ${isActiveForNewGames}`);
  try {
    const shardToUpdate = await prisma.userThemePersistedLore.findUnique({
      where: { id: shardId },
    });

    if (!shardToUpdate) {
      return res.status(404).json({ error: { message: 'World Shard not found.', code: 'WORLD_SHARD_NOT_FOUND' } });
    }

    if (shardToUpdate.userId !== userId) {
      logger.warn(`User ${userId} attempt to update shard ${shardId} owned by ${shardToUpdate.userId}.`);
      return res.status(403).json({ error: { message: 'Not authorized to update this World Shard.', code: 'WORLD_SHARD_UPDATE_FORBIDDEN' } });
    }

    const updatedShard = await prisma.userThemePersistedLore.update({
      where: {
        id: shardId,
      },
      data: {
        isActiveForNewGames: isActiveForNewGames,
      },
    });
    res.status(200).json({ message: 'World Shard status updated.', worldShard: updatedShard });
  } catch (error) {
    logger.error(`Error updating World Shard ${shardId} status for user ${userId}:`, error);
    res.status(500).json({ error: { message: 'Failed to update World Shard status.', code: 'WORLD_SHARD_STATUS_UPDATE_ERROR' } });
  }
});

/**
 * @route   DELETE /api/v1/worldshards/:shardId
 * @desc    "Shatter" (delete) a specific World Shard.
 * @access  Private
 */
router.delete('/worldshards/:shardId', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  const { shardId } = req.params;

  logger.info(`Attempting to delete World Shard ${shardId} for user ${userId}`);
  try {
    const shardToDelete = await prisma.userThemePersistedLore.findUnique({
      where: { id: shardId },
    });

    if (!shardToDelete) {
      return res.status(404).json({ error: { message: 'World Shard not found, nothing to delete.', code: 'WORLD_SHARD_NOT_FOUND_FOR_DELETE' } });
    }

    if (shardToDelete.userId !== userId) {
      logger.warn(`User ${userId} attempt to delete shard ${shardId} owned by ${shardToDelete.userId}.`);
      return res.status(403).json({ error: { message: 'Not authorized to delete this World Shard.', code: 'WORLD_SHARD_DELETE_FORBIDDEN' } });
    }

    await prisma.userThemePersistedLore.delete({
      where: {
        id: shardId,
      },
    });
    res.status(200).json({ message: 'World Shard shattered successfully.' });
  } catch (error) {
    if (error.code === 'P2025') { // Record to delete not found
        logger.info(`Attempt to delete non-existent shard ${shardId} by user ${userId} (already handled).`);
        return res.status(404).json({ error: { message: 'World Shard not found, nothing to delete.', code: 'WORLD_SHARD_NOT_FOUND_FOR_DELETE' } });
    }
    logger.error(`Error deleting World Shard ${shardId} for user ${userId}:`, error);
    res.status(500).json({ error: { message: 'Failed to shatter World Shard.', code: 'WORLD_SHARD_DELETE_ERROR' } });
  }
});

/**
 * @route   DELETE /api/v1/themes/:themeId/worldshards/reset
 * @desc    "Reset World" - delete all Shards for a user/theme.
 * @access  Private
 */
router.delete('/themes/:themeId/worldshards/reset', protect, checkPaidTier, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;

  if (!themeId) {
    return res.status(400).json({ error: { message: 'themeId parameter is required.', code: 'MISSING_THEMEID_PARAM_RESET' } });
  }

  logger.info(`Resetting all World Shards for user ${userId}, theme ${themeId}`);
  try {
    const deleteResult = await prisma.userThemePersistedLore.deleteMany({
      where: {
        userId: userId,
        themeId: themeId,
      },
    });
    res.status(200).json({ message: `World reset: ${deleteResult.count} Shard(s) shattered for theme ${themeId}.` });
  } catch (error) {
    logger.error(`Error resetting World Shards for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to reset World Shards.', code: 'WORLD_SHARDS_RESET_ERROR' } });
  }
});

export default router;
