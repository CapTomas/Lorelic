// server/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../db.js";
import logger from "../utils/logger.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  generateSecureToken,
  generateTokenExpiry,
} from "../utils/tokenUtils.js";
import { USER_TIERS, constructApiUsageResponse } from '../middleware/usageLimiter.js';
const router = express.Router();
const SALT_ROUNDS = 10;

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user and initiate email confirmation.
 * @access  Public
 */
router.post("/register", async (req, res) => {
  const {
    email,
    password,
    username,
    story_preference,
    newsletter_opt_in,
    preferred_app_language,
    preferred_narrative_language,
    preferred_model_name,
  } = req.body;
  if (!email || !password || !username) {
    logger.warn("Registration attempt with missing email, password, or username.");
    return res.status(400).json({
      error: {
        message: "Email, password, and username are required.",
        code: "MISSING_CREDENTIALS",
      },
    });
  }
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    logger.warn(`Registration attempt with invalid username format: ${username}`);
    return res.status(400).json({
      error: {
        message: "Username must be 3-20 characters and contain only letters, numbers, or underscores.",
        code: "INVALID_USERNAME_FORMAT",
      },
    });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logger.warn(`Registration attempt with invalid email format: ${email}`);
    return res.status(400).json({
      error: {
        message: "Invalid email format.",
        code: "INVALID_EMAIL_FORMAT",
      },
    });
  }
  if (password.length < 8) {
    logger.warn(`Registration attempt with weak password for email: ${email}`);
    return res.status(400).json({
      error: {
        message: "Password must be at least 8 characters long.",
        code: "WEAK_PASSWORD",
      },
    });
  }
  const allowedStoryPreferences = ['explorer', 'strategist', 'weaver', 'chaos', null, undefined];
  if (!allowedStoryPreferences.includes(story_preference)) {
      logger.warn(`Registration attempt with invalid story_preference: ${story_preference}`);
      return res.status(400).json({
          error: { message: 'Invalid story preference submitted.', code: 'INVALID_STORY_PREFERENCE' }
      });
  }
  if (newsletter_opt_in !== undefined && typeof newsletter_opt_in !== 'boolean') {
      logger.warn(`Registration attempt with invalid newsletter_opt_in type: ${typeof newsletter_opt_in}`);
      return res.status(400).json({
          error: { message: 'Newsletter opt-in must be a boolean value.', code: 'INVALID_NEWSLETTER_OPT_IN' }
      });
  }
  try {
    const existingUserByEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingUserByEmail) {
      logger.info(`Registration attempt for existing email: ${email}`);
      return res.status(409).json({
        error: {
          message: "User with this email already exists.",
          code: "USER_ALREADY_EXISTS",
        },
      });
    }
    const existingUserByUsername = await prisma.user.findUnique({
        where: { username: username },
    });
    if (existingUserByUsername) {
        logger.info(`Registration attempt for existing username: ${username}`);
        return res.status(409).json({
            error: {
                message: "This username is already taken. Please choose another.",
                code: "USERNAME_ALREADY_EXISTS",
            },
        });
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    logger.debug(`Password hashed for email: ${email}`);
    const confirmationToken = generateSecureToken();
    const confirmationTokenExpiresAt = generateTokenExpiry(24 * 60); // 24 hours
    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username: username,
        password_hash: hashedPassword,
        story_preference: story_preference,
        newsletter_opt_in: newsletter_opt_in || false,
        preferred_app_language: preferred_app_language || "en",
        preferred_narrative_language: preferred_narrative_language || "en",
        preferred_model_name: preferred_model_name || "gemini-1.5-flash-latest", // Default model
        email_confirmed: false,
        email_confirmation_token: confirmationToken,
        email_confirmation_expires_at: confirmationTokenExpiresAt,
        // apiUsage gets default value from schema
      },
    });
    logger.info(
      `User registered successfully: ${newUser.email} (ID: ${newUser.id})`
    );
    const confirmationLink = `${
      process.env.FRONTEND_URL || "http://localhost:" + (process.env.PORT || 3000)
    }/api/v1/auth/confirm-email/${confirmationToken}`;
    logger.info(
      `SIMULATED EMAIL: Confirmation link for ${newUser.email}: ${confirmationLink}`
    );
    res.status(201).json({
      message:
        "User registered successfully. Please check your email to confirm your account.",
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        story_preference: newUser.story_preference,
        newsletter_opt_in: newUser.newsletter_opt_in,
        preferred_app_language: newUser.preferred_app_language,
        preferred_narrative_language: newUser.preferred_narrative_language,
        preferred_model_name: newUser.preferred_model_name,
        created_at: newUser.created_at,
        email_confirmed: newUser.email_confirmed,
        tier: newUser.tier,
      },
    });
  } catch (error) {
    logger.error("Error during user registration:", {
      message: error.message,
      stack: error.stack,
      email: email,
    });
    res.status(500).json({
      error: {
        message: "Server error during registration. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
});
/**
 * @route   GET /api/v1/auth/confirm-email/:token
 * @desc    Confirm user's email address using a token.
 * @access  Public
 */
router.get("/confirm-email/:token", async (req, res) => {
  const { token } = req.params;
  if (!token) {
    logger.warn("Email confirmation attempt with no token.");
    return res
      .status(400)
      .redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }/email-confirmation-status?status=invalid_token`
      );
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email_confirmation_token: token },
    });
    if (!user) {
      logger.info(`Email confirmation attempt with invalid token: ${token}`);
      return res
        .status(400)
        .redirect(
          `${
            process.env.FRONTEND_URL || "http://localhost:3000"
          }/email-confirmation-status?status=invalid_token`
        );
    }
    if (user.email_confirmed) {
      logger.info(`Email already confirmed for user: ${user.email}`);
      return res
        .status(200)
        .redirect(
          `${
            process.env.FRONTEND_URL || "http://localhost:3000"
          }/email-confirmation-status?status=already_confirmed`
        );
    }
    if (
      user.email_confirmation_expires_at &&
      new Date() > new Date(user.email_confirmation_expires_at)
    ) {
      logger.info(`Expired confirmation token used for user: ${user.email}`);
      return res
        .status(400)
        .redirect(
          `${
            process.env.FRONTEND_URL || "http://localhost:3000"
          }/email-confirmation-status?status=expired_token`
        );
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email_confirmed: true,
        email_confirmation_token: null,
        email_confirmation_expires_at: null,
      },
    });
    logger.info(`Email confirmed successfully for user: ${user.email}`);
    return res
      .status(200)
      .redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }/email-confirmation-status?status=success`
      );
  } catch (error) {
    logger.error("Error during email confirmation:", {
      token,
      message: error.message,
      stack: error.stack,
    });
    return res
      .status(500)
      .redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }/email-confirmation-status?status=server_error`
      );
  }
});
/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and return JWT.
 * @access  Public
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    logger.warn("Login attempt with missing email or password.");
    return res.status(400).json({
      error: {
        message: "Email and password are required.",
        code: "MISSING_CREDENTIALS",
      },
    });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
          id: true,
          email: true,
          username: true,
          password_hash: true,
          email_confirmed: true,
          story_preference: true,
          newsletter_opt_in: true,
          preferred_app_language: true,
          preferred_narrative_language: true,
          preferred_model_name: true,
          created_at: true,
          tier: true,
          apiUsage: true,
      }
    });
    if (!user) {
      logger.info(`Login attempt for non-existent email: ${email}`);
      return res.status(401).json({
        error: {
          message: "Invalid credentials.",
          code: "INVALID_CREDENTIALS",
        },
      });
    }
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logger.info(`Login attempt with incorrect password for email: ${email}`);
      return res.status(401).json({
        error: {
          message: "Invalid credentials.",
          code: "INVALID_CREDENTIALS",
        },
      });
    }
    if (!user.email_confirmed) {
      logger.info(`Login attempt for unconfirmed email: ${email}.`);
      return res.status(403).json({
        error: {
          message: "Your email address is not confirmed. Please check your inbox or resend the confirmation email.",
          code: "EMAIL_NOT_CONFIRMED",
          email: user.email
        },
      });
    }
    const payload = {
      user: {
        id: user.id,
        email: user.email,
      },
    };
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "1d";
    if (!jwtSecret) {
      logger.error("JWT_SECRET is not defined in environment variables.");
      return res.status(500).json({
        error: {
          message: "Server configuration error for authentication.",
          code: "JWT_CONFIG_ERROR",
        },
      });
    }
    jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn }, (err, token) => {
      if (err) {
        logger.error("Error signing JWT:", err);
        return res.status(500).json({
          error: {
            message: "Server error during login. Could not generate token.",
            code: "TOKEN_SIGN_ERROR",
          },
        });
      }
      logger.info(
        `User logged in successfully: ${user.email} (ID: ${user.id})`
      );

      const userForResponse = {
          id: user.id,
          email: user.email,
          username: user.username,
          story_preference: user.story_preference,
          newsletter_opt_in: user.newsletter_opt_in,
          preferred_app_language: user.preferred_app_language,
          preferred_narrative_language: user.preferred_narrative_language,
          preferred_model_name: user.preferred_model_name,
          email_confirmed: user.email_confirmed,
          created_at: user.created_at,
          tier: user.tier,
          api_usage: constructApiUsageResponse(user),
      };

      res.status(200).json({
          message: 'Login successful.',
          token,
          user: userForResponse
      });
    });
  } catch (error) {
    logger.error("Error during user login:", {
      message: error.message,
      stack: error.stack,
      email: email,
    });
    res.status(500).json({
      error: {
        message: "Server error during login. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
});
/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current logged-in user's data.
 * @access  Private
 */
router.get("/me", protect, async (req, res) => {
  if (!req.user) {
    logger.error(
      "/me route accessed without req.user, though protect middleware should have caught it."
    );
    return res.status(401).json({
      error: { message: "Not authorized.", code: "UNEXPECTED_AUTH_FAILURE" },
    });
  }
  logger.info(
    `User data requested for /me by: ${req.user.email} (ID: ${req.user.id})`
  );

  const userForResponse = {
    ...req.user,
    api_usage: constructApiUsageResponse(req.user),
  };
  res.status(200).json({
    message: "Current user data fetched successfully.",
    user: userForResponse,
  });
});
/**
 * @route   POST /api/v1/auth/public-resend-confirmation
 * @desc    Publicly request to resend a confirmation email for an unconfirmed account.
 * @access  Public
 */
router.post("/public-resend-confirmation", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    logger.warn("Public resend confirmation attempt with no email provided.");
    return res.status(400).json({
      error: { message: "Email address is required.", code: "MISSING_EMAIL" },
    });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logger.warn(`Public resend confirmation attempt with invalid email format: ${email}`);
    return res.status(400).json({
      error: { message: "Invalid email format.", code: "INVALID_EMAIL_FORMAT" },
    });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (user && !user.email_confirmed) {
      const newConfirmationToken = generateSecureToken();
      const newConfirmationTokenExpiresAt = generateTokenExpiry(24 * 60);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          email_confirmation_token: newConfirmationToken,
          email_confirmation_expires_at: newConfirmationTokenExpiresAt,
        },
      });
      const confirmationLink = `${
        process.env.FRONTEND_URL || "http://localhost:" + (process.env.PORT || 3000)
      }/api/v1/auth/confirm-email/${newConfirmationToken}`;
      logger.info(
        `SIMULATED EMAIL (PUBLIC RESEND): Confirmation link for ${user.email}: ${confirmationLink}`
      );
      return res.status(200).json({
        message: "A new confirmation email has been sent to your email address. Please check your inbox (and spam folder).",
      });
    } else if (user && user.email_confirmed) {
      logger.info(`Public resend request for already confirmed email: ${email}.`);
      return res.status(200).json({
        message: "This email address has already been confirmed. You can try logging in.",
        code: "EMAIL_ALREADY_CONFIRMED_PUBLIC"
      });
    } else {
      logger.info(`Public resend request for non-existent email: ${email}. Sending generic response.`);
      return res.status(200).json({
        message: "If an account matching this email exists and requires confirmation, a new email has been sent. Please check your inbox (and spam folder).",
      });
    }
  } catch (error) {
    logger.error("Error during public resend confirmation email:", {
      email: email,
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: {
        message: "Server error processing your request. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
});
/**
 * @route   POST /api/v1/auth/resend-confirmation-email
 * @desc    Resend email confirmation link for an authenticated but unconfirmed user.
 * @access  Private
 */
router.post("/resend-confirmation-email", protect, async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      logger.error(
        `Authenticated user ID ${userId} not found for resending confirmation.`
      );
      return res
        .status(404)
        .json({
          error: { message: "User not found.", code: "USER_NOT_FOUND" },
        });
    }
    if (user.email_confirmed) {
      logger.info(
        `User ${user.email} requested resend, but email already confirmed.`
      );
      return res
        .status(400)
        .json({
          error: {
            message: "Email is already confirmed.",
            code: "EMAIL_ALREADY_CONFIRMED",
          },
        });
    }
    const newConfirmationToken = generateSecureToken();
    const newConfirmationTokenExpiresAt = generateTokenExpiry(24 * 60);
    await prisma.user.update({
      where: { id: userId },
      data: {
        email_confirmation_token: newConfirmationToken,
        email_confirmation_expires_at: newConfirmationTokenExpiresAt,
      },
    });
    const confirmationLink = `${
      process.env.FRONTEND_URL ||
      "http://localhost:" + (process.env.PORT || 3000)
    }/api/v1/auth/confirm-email/${newConfirmationToken}`;
    logger.info(
      `SIMULATED EMAIL (RESEND): Confirmation link for ${user.email}: ${confirmationLink}`
    );
    res
      .status(200)
      .json({ message: "Confirmation email resent. Please check your inbox." });
  } catch (error) {
    logger.error(
      `Error resending confirmation email for user ID ${userId}:`,
      error
    );
    res
      .status(500)
      .json({
        error: {
          message: "Server error resending confirmation email.",
          code: "RESEND_CONFIRMATION_ERROR",
        },
      });
  }
});
/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request a password reset link.
 * @access  Public
 */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    logger.warn("Forgot password attempt with no email provided.");
    return res.status(400).json({
      error: { message: "Email address is required.", code: "MISSING_EMAIL" },
    });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      logger.info(`Password reset requested for non-existent email: ${email}. Sending generic response.`);
      return res.status(200).json({
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }
    const resetToken = generateSecureToken(32);
    const resetTokenExpiresAt = generateTokenExpiry(15); // 15 minutes
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password_reset_token: resetToken,
        password_reset_expires_at: resetTokenExpiresAt,
      },
    });
    logger.info(`Password reset token generated for user: ${user.email}`);
    const resetLink = `${
      process.env.FRONTEND_URL || "http://localhost:" + (process.env.PORT || 3000)
    }/reset-password?token=${resetToken}`;
    logger.info(`SIMULATED EMAIL: Password reset link for ${user.email}: ${resetLink}`);
    res.status(200).json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    logger.error("Error during forgot password request:", {
      message: error.message,
      stack: error.stack,
      email: email,
    });
    res.status(500).json({
      error: {
        message: "Server error processing your request. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
});
/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset user's password using a token.
 * @access  Public
 */
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    logger.warn("Password reset attempt with missing token or new password.");
    return res.status(400).json({
      error: {
        message: "Token and new password are required.",
        code: "MISSING_RESET_FIELDS",
      },
    });
  }
  if (newPassword.length < 8) {
    logger.warn(`Password reset attempt with weak new password for token: ${token.substring(0,10)}...`);
    return res.status(400).json({
      error: {
        message: "Password must be at least 8 characters long.",
        code: "WEAK_PASSWORD",
      },
    });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { password_reset_token: token },
    });
    if (!user) {
      logger.info(`Password reset attempt with invalid token: ${token.substring(0,10)}...`);
      return res.status(400).json({
        error: { message: "Invalid or expired password reset token.", code: "INVALID_TOKEN" },
      });
    }
    if (
      !user.password_reset_expires_at ||
      new Date() > new Date(user.password_reset_expires_at)
    ) {
      logger.info(`Expired password reset token used for user: ${user.email}`);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password_reset_token: null,
          password_reset_expires_at: null,
        },
      });
      return res.status(400).json({
        error: { message: "Password reset token has expired.", code: "EXPIRED_TOKEN" },
      });
    }
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: hashedPassword,
        password_reset_token: null,
        password_reset_expires_at: null,
      },
    });
    logger.info(`Password reset successfully for user: ${user.email}`);
    logger.info(
      `SIMULATED EMAIL: Your password for Lorelic has been successfully changed for ${user.email}.`
    );
    res.status(200).json({ message: "Password reset successfully. You can now log in with your new password." });
  } catch (error) {
    logger.error("Error during password reset:", {
      message: error.message,
      stack: error.stack,
      tokenUsed: token ? token.substring(0,10) + '...' : 'N/A',
    });
    res.status(500).json({
      error: {
        message: "Server error resetting password. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
});
export default router;
