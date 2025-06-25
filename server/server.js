import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import logger from './utils/logger.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import gameStateRoutes from './routes/gamestates.js';
import themeInteractionRoutes from './routes/themeInteractions.js';
import worldShardRoutes from './routes/worldShards.js';
import { executeRolls } from './utils/diceRoller.js';
import { protect, authenticateOptionally } from './middleware/authMiddleware.js';
import { limitApiUsage } from './middleware/usageLimiter.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  }));
} else {
  app.use(morgan('dev'));
}
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Higher limit for dev
  message: { error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
  standardHeaders: true,
  legacyHeaders: false,
};
const requestCounts = new Map();
/**
 * Middleware for basic in-memory rate limiting.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 */
const rateLimitMiddleware = (req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }
  const clientId = req.ip;
  const now = Date.now();
  const windowStart = now - rateLimitConfig.windowMs;
  let clientTimestamps = requestCounts.get(clientId) || [];
  clientTimestamps = clientTimestamps.filter(time => time > windowStart);
  if (clientTimestamps.length >= rateLimitConfig.max) {
    logger.warn(`Rate limit exceeded for IP: ${clientId} on path ${req.path}`);
    return res.status(429).json(rateLimitConfig.message);
  }
  clientTimestamps.push(now);
  requestCounts.set(clientId, clientTimestamps);
  res.setHeader('X-RateLimit-Limit', rateLimitConfig.max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, rateLimitConfig.max - clientTimestamps.length));
  res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + rateLimitConfig.windowMs) / 1000));
  next();
};
app.use(rateLimitMiddleware);
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true,
}));
logger.info('Setting up API routes...');
app.get('/api/health', (req, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  };
  logger.debug('Health check requested');
  res.status(200).json(healthCheck);
});
app.get('/api/test', (req, res) => {
  logger.debug('GET /api/test hit');
  res.json({
    message: 'Lorelic Backend API is responding!',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});
/**
 * Validates the request body for the Gemini API proxy endpoint.
 * Ensures 'contents' field is present and is an array.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 */
const validateGeminiRequest = (req, res, next) => {
  const { contents, modelName } = req.body;
  if (!contents) {
    logger.warn('Missing "contents" in request body for /api/v1/gemini/generate');
    return res.status(400).json({
      error: { message: 'Missing "contents" in request body', code: 'MISSING_CONTENTS' },
    });
  }
  if (!Array.isArray(contents)) {
    logger.warn('Invalid "contents" format - must be array');
    return res.status(400).json({
      error: { message: '"contents" must be an array', code: 'INVALID_CONTENTS_FORMAT' },
    });
  }
  if (!modelName || typeof modelName !== 'string') {
    logger.warn('Missing or invalid "modelName" in request body');
    return res.status(400).json({
      error: { message: '"modelName" is required and must be a string.', code: 'MISSING_MODEL_NAME' }
    });
  }
  next();
};
/**
 * Maps Gemini API error status codes and messages to more user-friendly messages.
 * @param {number} status - The HTTP status code from Gemini API.
 * @param {string} message - The error message from Gemini API.
 * @returns {string} A user-friendly error message.
 */
function mapGeminiError(status, message) {
  const errorMappings = {
    400: 'Invalid request format or parameters sent to AI service.',
    401: 'Authentication failed with the AI service. Please check server API key.',
    403: 'Access denied by AI service or API quota exceeded.',
    429: 'Too many requests sent to the AI service. Please try again later.',
    500: 'The AI service is temporarily unavailable. Please try again later.',
    503: 'The AI service is currently under maintenance or overloaded.',
  };
  return errorMappings[status] || message || 'An unknown error occurred with the AI service.';
}
app.post('/api/v1/gemini/generate', authenticateOptionally, limitApiUsage, validateGeminiRequest, async (req, res) => {
    logger.info(`POST /api/v1/gemini/generate - Request from User ID: ${req.user?.id || 'Anonymous'}, IP: ${req.ip}`);
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        logger.error('GEMINI_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: { message: 'API key not configured on server.', code: 'MISSING_API_KEY' } });
    }
    const { contents, generationConfig, safetySettings, systemInstruction, modelName } = req.body;
    if (generationConfig && generationConfig.responseMimeType) {
      delete generationConfig.responseMimeType;
    }
    const effectiveModelName = modelName || 'gemini-1.5-flash-latest';
    const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModelName}:generateContent?key=${geminiApiKey}`;
    // Define the tool for the AI to use
    const tools = [{
        functionDeclarations: [{
            name: "rollDice",
            description: "Rolls one or more dice based on standard D&D notation (e.g., '1d20', '3d6+2', 'a2d20' for advantage). Returns the individual rolls and the final result for each notation provided.",
            parameters: {
                type: "OBJECT",
                properties: {
                    notations: {
                        type: "ARRAY",
                        description: "An array of strings, where each string is a dice roll notation.",
                        items: { type: "STRING" }
                    }
                },
                required: ["notations"]
            }
        }]
    }];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), process.env.GEMINI_TIMEOUT || 45000);
    try {
        let conversationHistory = [...contents];
        let finalResponseData = null;
        let lastDiceRollResults = null;
        const MAX_TURNS = 5; // Safety break for tool-use loops
        for (let turn = 0; turn < MAX_TURNS; turn++) {
            const payload = {
                contents: conversationHistory,
                tools: tools,
                ...(generationConfig && { generationConfig }),
                ...(safetySettings && { safetySettings }),
                ...(systemInstruction && { systemInstruction }),
            };
            logger.debug(`[Turn ${turn + 1}] Proxying request to Gemini. Model: ${effectiveModelName}, User: ${req.user?.id || 'Anonymous'}`);
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': `Lorelic-Server/${process.env.npm_package_version || '1.0.0'}` },
                body: JSON.stringify(payload),
                signal: controller.signal,
            };
            const googleResponse = await fetch(GOOGLE_API_URL, fetchOptions);
            const responseText = await googleResponse.text();
            let currentTurnResponseData;
            try {
                currentTurnResponseData = JSON.parse(responseText);
            } catch (parseError) {
                logger.error('Failed to parse Gemini JSON response:', { rawTextSnippet: responseText.substring(0, 500) });
                return res.status(502).json({ error: { message: 'Invalid JSON response from AI service.', code: 'INVALID_AI_RESPONSE_FORMAT' } });
            }
            if (!googleResponse.ok) {
                logger.error(`Error from Gemini API (Status: ${googleResponse.status})`, currentTurnResponseData);
                const mappedErrorMessage = mapGeminiError(googleResponse.status, currentTurnResponseData?.error?.message);
                return res.status(googleResponse.status).json({ error: { message: mappedErrorMessage, code: currentTurnResponseData?.error?.code || `EXTERNAL_API_ERROR_${googleResponse.status}` } });
            }
            const candidate = currentTurnResponseData.candidates?.[0];
            if (!candidate) {
                logger.warn('Unexpected Gemini response structure (no candidates)', currentTurnResponseData);
                return res.status(502).json({ error: { message: 'Unexpected response format from AI service (no candidates).', code: 'INVALID_AI_RESPONSE_STRUCTURE' } });
            }
            if (candidate.content?.parts?.[0]?.text) {
                logger.info(`[Turn ${turn + 1}] Received final text response from AI.`);
                finalResponseData = currentTurnResponseData;
                break; // Exit loop, we have our final answer
            }
            if (candidate.content?.parts?.[0]?.functionCall) {
                logger.info(`[Turn ${turn + 1}] Received function call from AI.`);
                const functionCall = candidate.content.parts[0].functionCall;
                // Add the AI's function call to history for the next turn
                conversationHistory.push(candidate.content);
                if (functionCall.name === 'rollDice') {
                    const notations = functionCall.args?.notations || [];
                    const diceResults = executeRolls(notations);
                    lastDiceRollResults = diceResults; // Store the results for the final response
                    // Add the function execution result to history
                    conversationHistory.push({
                        role: "tool",
                        parts: [{
                            functionResponse: {
                                name: "rollDice",
                                response: {
                                    content: JSON.stringify(diceResults),
                                }
                            }
                        }]
                    });
                    logger.debug(`[Turn ${turn + 1}] Executed rollDice function. Results:`, diceResults);
                } else {
                    logger.warn(`[Turn ${turn + 1}] AI called an unknown function: ${functionCall.name}`);
                    // To prevent loops, we'll break and respond with an error.
                    return res.status(501).json({ error: { message: `AI requested an unsupported function: ${functionCall.name}`, code: 'UNSUPPORTED_FUNCTION_CALL' } });
                }
                continue; // Continue to the next turn of the conversation
            }
            // If we get here, the response was valid but didn't contain text or a function call we can handle.
            logger.warn(`[Turn ${turn + 1}] AI response was valid but contained no actionable content. Breaking loop.`);
            finalResponseData = currentTurnResponseData; // Send what we got
            break;
        }
        clearTimeout(timeoutId);
        if (!finalResponseData) {
            logger.error('AI conversation loop finished without a final response.');
            return res.status(500).json({ error: { message: 'AI failed to produce a final response after function calls.', code: 'AI_CONVERSATION_TIMEOUT' } });
        }
        // Attach dice roll results if they exist from the conversation
        if (lastDiceRollResults) {
            finalResponseData.dice_roll_results = lastDiceRollResults;
            logger.debug('Attaching dice roll results to the final response.');
        }
        // Increment usage and get new counts only after the final successful turn
        if (req.incrementUsage) {
            const updatedUsage = await req.incrementUsage();
            finalResponseData.api_usage = updatedUsage; // Attach usage data to the response
        }
        logger.info(`Successfully processed Gemini request for model ${effectiveModelName}, User ID: ${req.user?.id || 'Anonymous'}`);
        res.status(200).json(finalResponseData);
    } catch (error) {
        clearTimeout(timeoutId);
        logger.error('Error in multi-turn Gemini API call:', { message: error.message, name: error.name });
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: { message: 'Request to AI service timed out.', code: 'AI_REQUEST_TIMEOUT' } });
        }
        res.status(500).json({ error: { message: 'Failed to communicate with external AI service.', code: 'EXTERNAL_API_COMMUNICATION_ERROR' } });
    }
});
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/gamestates', gameStateRoutes);
app.use('/api/v1/themes', themeInteractionRoutes);
app.use('/api/v1', worldShardRoutes);
app.get(/^\/(?!api\/)(?!.*\.\w{2,5}$).*$/, (req, res) => {
  logger.debug(`SPA Fallback: Serving index.html for GET ${req.path}`);
  res.sendFile(path.join(__dirname, '..', 'index.html'), (err) => {
    if (err) {
      logger.error('Error serving index.html via SPA fallback:', { path: req.path, message: err.message });
      if (!res.headersSent) {
        res.status(500).send('Error loading application content.');
      }
    }
  });
});
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: {
      message: 'The requested resource was not found on this server.',
      code: 'ROUTE_NOT_FOUND',
      path: req.path,
      method: req.method,
    },
  });
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled application error:', {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : 'Stack trace hidden in production',
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'An unexpected internal server error occurred.'
        : err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_SERVER_ERROR',
    },
  });
});
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception. Shutting down application:', error);
  process.exit(1);
});
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server listening on http://localhost:${PORT}`);
  logger.info(`📱 Frontend accessible at http://localhost:${PORT}`);
  logger.info(`📊 Log level: ${logger.getLogLevel()}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('⚠️  Server is running in development mode. Rate limits are more permissive.');
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Port ${PORT} is already in use.`);
  } else {
    logger.error('❌ Server startup error:', error);
  }
  process.exit(1);
});
export default app;
