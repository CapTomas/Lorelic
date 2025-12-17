// server/routes/themeInteractions.js
import express from 'express';
import prisma from '../db.js';
import logger from '../utils/logger.js';
import { protect } from '../middleware/authMiddleware.js';
// You might want to import THEMES_MANIFEST from a shared location if you validate theme_id against it.
// For now, we'll assume theme_id is a string provided by the client.

const router = express.Router();

/**
 * @route   GET /api/v1/themes/interactions
 * @desc    Fetch all theme interactions (playing/liked IDs) for the authenticated user.
 * @access  Private
 */
router.get('/interactions', protect, async (req, res) => {
  const userId = req.user.id;
  logger.info(`Fetching theme interactions for user ${userId}`);

  try {
    const interactions = await prisma.userThemeInteraction.findMany({
      where: { userId: userId },
      select: {
        theme_id: true,
        is_playing: true,
        is_liked: true,
      },
    });

    const playingThemeIds = interactions
      .filter(interaction => interaction.is_playing)
      .map(interaction => interaction.theme_id);

    const likedThemeIds = interactions
      .filter(interaction => interaction.is_liked)
      .map(interaction => interaction.theme_id);

    res.status(200).json({
      message: 'Theme interactions fetched successfully.',
      interactions: {
        playingThemeIds,
        likedThemeIds,
      },
    });

  } catch (error) {
    logger.error(`Error fetching theme interactions for user ${userId}:`, error);
    res.status(500).json({ error: { message: 'Failed to fetch theme interactions.', code: 'THEME_INTERACTIONS_FETCH_ERROR' } });
  }
});

/**
 * @route   POST /api/v1/themes/:themeId/interactions
 * @desc    Update is_playing or is_liked status for a specific theme by the authenticated user.
 * @access  Private
 */
router.post('/:themeId/interactions', protect, async (req, res) => {
  const userId = req.user.id;
  const { themeId } = req.params;
  const { is_liked, is_playing } = req.body; // Booleans

  logger.info(`Updating theme interaction for user ${userId}, theme ${themeId} with data:`, req.body);

  if (typeof is_liked === 'undefined' && typeof is_playing === 'undefined') {
    return res.status(400).json({ error: { message: 'At least one of "is_liked" or "is_playing" must be provided in the request body.', code: 'MISSING_INTERACTION_FLAG' } });
  }

  if ((typeof is_liked !== 'undefined' && typeof is_liked !== 'boolean') ||
      (typeof is_playing !== 'undefined' && typeof is_playing !== 'boolean')) {
    return res.status(400).json({ error: { message: '"is_liked" and "is_playing" must be boolean values if provided.', code: 'INVALID_INTERACTION_FLAG_TYPE' } });
  }

  // Optional: Validate themeId against a known list of themes (e.g., from THEMES_MANIFEST)
  // if (!THEMES_MANIFEST.some(theme => theme.id === themeId)) {
  //   return res.status(404).json({ error: { message: `Theme with ID "${themeId}" not found.`, code: 'THEME_NOT_FOUND' } });
  // }

  const updateData = {};
  if (typeof is_liked !== 'undefined') {
    updateData.is_liked = is_liked;
  }
  if (typeof is_playing !== 'undefined') {
    updateData.is_playing = is_playing;
  }


  try {
    const interaction = await prisma.userThemeInteraction.upsert({
      where: {
        userId_theme_id: { userId, theme_id: themeId },
      },
      create: {
        userId,
        theme_id: themeId,
        is_liked: typeof is_liked === 'boolean' ? is_liked : false,
        is_playing: typeof is_playing === 'boolean' ? is_playing : false,
        last_played_at: (typeof is_playing === 'boolean' && is_playing === true) ? new Date() : null,
      },
      update: {
        ...updateData,
        ...(typeof is_playing === 'boolean' && is_playing === true && { last_played_at: new Date() }),
      },
    });

    logger.info(`Theme interaction for user ${userId}, theme ${themeId} updated successfully.`);
    res.status(200).json({ message: 'Theme interaction updated.', interaction });

  } catch (error) {
    logger.error(`Error updating theme interaction for user ${userId}, theme ${themeId}:`, error);
    res.status(500).json({ error: { message: 'Failed to update theme interaction.', code: 'THEME_INTERACTION_UPDATE_ERROR' } });
  }
});

export default router;
