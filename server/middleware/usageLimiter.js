/**
 * @file Middleware for enforcing API usage limits based on user tier and model.
 * It handles both registered users (DB-based via a JSON field) and anonymous users (IP-based, in-memory).
 */
import prisma from '../db.js';
import logger from '../utils/logger.js';
// In-memory store for anonymous user usage, keyed by IP address.
const anonymousUsage = new Map();
/**
 * Defines API limits and allowed models for each user tier.
 * @constant {object}
 */
export const USER_TIERS = {
  anonymous: {
    allowedModels: {
      'gemini-1.5-flash-latest': { dailyLimit: 25 },
    },
  },
  free: {
    allowedModels: {
      'gemini-1.5-flash-latest': { dailyLimit: 100 },
    },
  },
  pro: {
    allowedModels: {
      'gemini-1.5-flash-latest': { dailyLimit: 100 },
      'gemini-2.5-flash-preview-04-17': { dailyLimit: 50 },
    },
  },
  ultra: {
    allowedModels: {
      'gemini-1.5-flash-latest': { dailyLimit: 100 },
      'gemini-2.5-flash-preview-04-17': { dailyLimit: 50 },
      'gemini-2.5-flash-preview-05-20': { dailyLimit: 50 },
    },
  },
};

/**
 * Helper function to construct the API usage object for the client.
 * @param {object} user - The user object from the database.
 * @returns {object} The constructed API usage object.
 */
export function constructApiUsageResponse(user) {
    const userTier = user.tier || 'free';
    const tierConfig = USER_TIERS[userTier] || USER_TIERS.free;
    const userApiUsage = (typeof user.apiUsage === 'object' && user.apiUsage !== null) ? user.apiUsage : {};
    const constructedApiUsage = {};
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    for (const modelName in tierConfig.allowedModels) {
        if (Object.prototype.hasOwnProperty.call(tierConfig.allowedModels, modelName)) {
            const modelLimits = tierConfig.allowedModels[modelName];
            const modelUsage = userApiUsage[modelName] || { daily: 0, lastDailyReset: new Date(0) };
            const currentDaily = new Date(modelUsage.lastDailyReset) < twentyFourHoursAgo ? 0 : modelUsage.daily;
            constructedApiUsage[modelName] = {
                daily: { count: currentDaily, limit: modelLimits.dailyLimit },
            };
        }
    }
    return constructedApiUsage;
}

/**
 * Checks if a user's API call is within their tier's limits for the requested model.
 * Attaches an `incrementUsage` function to the request object to be called on successful API response.
 * The `incrementUsage` function will return the new usage counts for the specific model used.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 */
export const limitApiUsage = async (req, res, next) => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ip = req.ip;
  const { modelName } = req.body;
  const user = req.user;
  if (user) {
    // --- Registered User Logic ---
    const tierConfig = USER_TIERS[user.tier] || USER_TIERS.free;
    const modelLimits = tierConfig.allowedModels[modelName];
    if (!modelLimits) {
      logger.warn(`User ${user.id} (Tier: ${user.tier}) tried to use disallowed model: ${modelName}.`);
      return res.status(403).json({
        error: {
          message: `Your current tier does not permit the use of the '${modelName}' model.`,
          code: 'MODEL_NOT_ALLOWED_FOR_TIER',
        },
      });
    }
    const apiUsage = typeof user.apiUsage === 'object' && user.apiUsage !== null ? user.apiUsage : {};
    const modelUsage = apiUsage[modelName] || { daily: 0, lastDailyReset: new Date(0) };
    const currentDaily = new Date(modelUsage.lastDailyReset) < twentyFourHoursAgo ? 0 : modelUsage.daily;
    if (currentDaily >= modelLimits.dailyLimit) {
      const message = `You have exceeded your daily API call limit for the '${modelName}' model.`;
      logger.warn(`Daily API limit for model ${modelName} exceeded for user ${user.id}. Daily: ${currentDaily}/${modelLimits.dailyLimit}`);
      return res.status(429).json({
        error: { message, code: 'DAILY_API_LIMIT_EXCEEDED' },
      });
    }
    req.incrementUsage = async () => {
      // Re-fetch user to get the absolute latest apiUsage to prevent race conditions
      const freshUser = await prisma.user.findUnique({ where: { id: user.id }, select: { apiUsage: true } });
      const freshApiUsage = typeof freshUser.apiUsage === 'object' && freshUser.apiUsage !== null ? freshUser.apiUsage : {};
      const usageForModel = freshApiUsage[modelName] || { daily: 0, lastDailyReset: new Date(0) };
      const newDailyCount = new Date(usageForModel.lastDailyReset) < twentyFourHoursAgo ? 1 : usageForModel.daily + 1;
      const updatedApiUsage = {
        ...freshApiUsage,
        [modelName]: {
          daily: newDailyCount,
          lastDailyReset: new Date(usageForModel.lastDailyReset) < twentyFourHoursAgo ? now : usageForModel.lastDailyReset,
        },
      };
      await prisma.user.update({
        where: { id: user.id },
        data: { apiUsage: updatedApiUsage },
      });
      // Construct a full response object for all models in the user's tier
      const tempUserForResponse = {
        tier: user.tier || 'free',
        apiUsage: updatedApiUsage,
      };
      return constructApiUsageResponse(tempUserForResponse);
    };
  } else {
    // --- Anonymous User Logic ---
    const tierConfig = USER_TIERS.anonymous;
    const modelLimits = tierConfig.allowedModels[modelName];
    if (!modelLimits) {
      logger.warn(`Anonymous IP ${ip} tried to use disallowed model: ${modelName}.`);
      return res.status(403).json({
        error: {
          message: `Anonymous users cannot use the '${modelName}' model. Please log in.`,
          code: 'MODEL_NOT_ALLOWED_FOR_ANON',
        },
      });
    }
    const ipRecord = anonymousUsage.get(ip) || {};
    const modelUsage = ipRecord[modelName] || { daily: 0, lastDailyReset: new Date(0) };
    const currentDaily = new Date(modelUsage.lastDailyReset) < twentyFourHoursAgo ? 0 : modelUsage.daily;
    if (currentDaily >= modelLimits.dailyLimit) {
      const message = 'You have exceeded your daily API call limit. Please register for more calls.';
      logger.warn(`Daily API limit for model ${modelName} exceeded for anonymous IP ${ip}. Daily: ${currentDaily}/${modelLimits.dailyLimit}`);
      return res.status(429).json({
        error: { message, code: 'DAILY_API_LIMIT_EXCEEDED' },
      });
    }
    req.incrementUsage = async () => {
      const recordToUpdate = anonymousUsage.get(ip) || {};
      const usageForModel = recordToUpdate[modelName] || { daily: 0, lastDailyReset: new Date(0) };
      const newDailyCount = new Date(usageForModel.lastDailyReset) < twentyFourHoursAgo ? 1 : usageForModel.daily + 1;
      recordToUpdate[modelName] = {
        daily: newDailyCount,
        lastDailyReset: new Date(usageForModel.lastDailyReset) < twentyFourHoursAgo ? now : usageForModel.lastDailyReset,
      };
      anonymousUsage.set(ip, recordToUpdate);
      // Construct a full response object for all models available to anonymous users
      const tempUserForResponse = {
        tier: 'anonymous',
        apiUsage: recordToUpdate,
      };
      return constructApiUsageResponse(tempUserForResponse);
    };
  }
  next();
};
