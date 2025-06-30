/**
 * @file Centralized configuration for user tiers, API call limits, and allowed models.
 * This file uses environment variables to allow for easy adjustments without code changes.
 */
import dotenv from 'dotenv';
dotenv.config();

/**
 * Defines the tiers for users, including their API call limits and allowed AI models.
 * - anonymous: For users who are not logged in.
 * - free: For standard, logged-in users.
 * - tier1: Placeholder for the first paid tier.
 * - tier2: Placeholder for the second paid tier.
 */
export const USER_TIERS = {
  anonymous: {
    hourlyLimit: parseInt(process.env.LIMIT_ANON_HOURLY, 10) || 10,
    dailyLimit: parseInt(process.env.LIMIT_ANON_DAILY, 10) || 30,
    allowedModels: [
      process.env.FREE_MODEL_NAME || 'gemini-2.5-flash-lite-preview-06-17',
    ],
  },
  free: {
    hourlyLimit: parseInt(process.env.LIMIT_FREE_HOURLY, 10) || 30,
    dailyLimit: parseInt(process.env.LIMIT_FREE_DAILY, 10) || 100,
    allowedModels: [
      process.env.FREE_MODEL_NAME || 'gemini-2.5-flash-lite-preview-06-17',
      process.env.PAID_MODEL_NAME || 'gemini-2.5-flash',
    ],
  },
  tier1: {
    hourlyLimit: parseInt(process.env.LIMIT_TIER1_HOURLY, 10) || 100,
    dailyLimit: parseInt(process.env.LIMIT_TIER1_DAILY, 10) || 500,
    allowedModels: [
      process.env.FREE_MODEL_NAME || 'gemini-2.5-flash-lite-preview-06-17',
      process.env.PAID_MODEL_NAME || 'gemini-2.5-flash',
      process.env.ULTRA_MODEL_NAME || 'gemini-2.5-flash',
    ],
  },
  tier2: {
    hourlyLimit: parseInt(process.env.LIMIT_TIER2_HOURLY, 10) || 300,
    dailyLimit: parseInt(process.env.LIMIT_TIER2_DAILY, 10) || 1500,
    allowedModels: [
      process.env.FREE_MODEL_NAME || 'gemini-2.5-flash-lite-preview-06-17',
      process.env.PAID_MODEL_NAME || 'gemini-2.5-flash',
      process.env.ULTRA_MODEL_NAME || 'gemini-2.5-flash',
    ],
  },
};

/**
 * Default model name for free users.
 */
export const FREE_MODEL_NAME = process.env.FREE_MODEL_NAME || 'gemini-2.5-flash-lite-preview-06-17';

/**
 * Default model name for paid/pro users.
 */
export const PAID_MODEL_NAME = process.env.PAID_MODEL_NAME || 'gemini-2.5-flash';
