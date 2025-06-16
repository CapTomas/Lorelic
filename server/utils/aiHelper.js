// server/utils/aiHelper.js
import fetch from 'node-fetch';
import logger from './logger.js';

const SUMMARIZATION_MODEL_NAME = process.env.SUMMARIZATION_MODEL_NAME || "gemini-1.5-flash-latest";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NPM_PACKAGE_VERSION = process.env.npm_package_version || '1.0.0';

const MAX_RETRIES_SILENT_AI = 1;
const RETRY_DELAY_MS_SILENT_AI = 5000;

/**
 * Makes a generation request to the Gemini API.
 * This is a generalized version of the proxy logic in server.js,
 * designed for internal backend use (silent calls).
 * @param {Array<Object>} contents - The history/content for the AI.
 * @param {Object} systemInstruction - The system prompt.
 * @param {string} modelName - The specific Gemini model to use.
 * @param {string} taskDescription - For logging purposes (e.g., "Player Summary", "Lore Evolution").
 * @returns {Promise<string|null>} The AI-generated text content, or null on failure.
 */
async function callSilentGeminiAPI(contents, systemInstruction, modelName, taskDescription) {
  if (!GEMINI_API_KEY) {
    logger.error(`[SilentAI/${taskDescription}] GEMINI_API_KEY is not set. Cannot perform task.`);
    return null;
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: 0.5,
      topP: 0.95,
      maxOutputTokens: 4096,
      responseMimeType: "text/plain",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  logger.info(`[SilentAI/${taskDescription}] Initiating call to model ${modelName}.`);
  logger.debug(`[SilentAI/${taskDescription}] Payload (system instruction snippet):`, systemInstruction.parts[0].text.substring(0, 200) + "...");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), process.env.SILENT_GEMINI_TIMEOUT || 60000);

  try {
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Lorelic-Server-SilentAI/${NPM_PACKAGE_VERSION}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    };

    const response = await fetch(GOOGLE_API_URL, fetchOptions);
    clearTimeout(timeoutId);
    const responseText = await response.text();

    if (!response.ok) {
      let errorData;
      try { errorData = JSON.parse(responseText); } catch (e) { errorData = { error: { message: responseText } }; }
      logger.error(`[SilentAI/${taskDescription}] Error from Gemini API (Status: ${response.status}):`, errorData?.error?.message || responseText);
      return null;
    }

    let extractedText = responseText;
    try {
        const jsonData = JSON.parse(responseText);
        if (jsonData.candidates && jsonData.candidates[0]?.content?.parts?.[0]?.text) {
            extractedText = jsonData.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        logger.debug(`[SilentAI/${taskDescription}] Response was not JSON, assuming plain text.`);
    }

    if (!extractedText || extractedText.trim() === "") {
      logger.warn(`[SilentAI/${taskDescription}] Received empty or whitespace-only response from model ${modelName}.`);
      return null;
    }

    logger.info(`[SilentAI/${taskDescription}] Successfully received response from model ${modelName}.`);
    return extractedText.trim();

  } catch (error) {
    clearTimeout(timeoutId);
    logger.error(`[SilentAI/${taskDescription}] Error calling Gemini API:`, { message: error.message, name: error.name });
    if (error.name === 'AbortError') {
      logger.warn(`[SilentAI/${taskDescription}] Request to AI service timed out.`);
    }
    return null;
  }
}

/**
 * Generates a player-centric summary from a chunk of game history.
 * @param {Array<Object>} historyChunk - The segment of game history to summarize.
 * @param {string} currentNarrativeLanguage - The language for the summary.
 * @returns {Promise<string|null>} The summary snippet or null.
 */
export async function generatePlayerSummarySnippet(historyChunk, currentNarrativeLanguage) {
  const contentForAI = [{ role: "user", parts: [{ text: JSON.stringify(historyChunk) }] }];
  const systemPrompt = `You are a concise summarizer for a text-based RPG. Analyze the provided game history chunk, which is an array of turns with "role" ('user' for player, 'model' for game master) and "parts" (text content).

  Your task is to generate a short summary focused **only** on the PLAYER's experience:
  - Significant actions they took
  - Key decisions they made
  - Important items acquired or lost
  - Critical information they learned
  - Major plot events they triggered
  - Meaningful interactions with other characters

  Ignore general narrative from the game master unless it is a **direct result** of the player's actions or choices. Be objective and factual about what the player did, learned, or caused.

  The output must be:
  - A brief paragraph or a few bullet points
  - Written in ${currentNarrativeLanguage.toUpperCase()}
  - Only the summary snippet (no preamble, explanations, or closing statements)

  Game History Chunk to Summarize:
${JSON.stringify(historyChunk, null, 2)}`;

  let attempt = 0;
  while (attempt <= MAX_RETRIES_SILENT_AI) {
    const summary = await callSilentGeminiAPI(contentForAI, { parts: [{ text: systemPrompt }] }, SUMMARIZATION_MODEL_NAME, "PlayerSummary");
    if (summary) return summary;
    attempt++;
    if (attempt <= MAX_RETRIES_SILENT_AI) {
      logger.warn(`[SilentAI/PlayerSummary] Retrying (${attempt}/${MAX_RETRIES_SILENT_AI}) after delay...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS_SILENT_AI));
    }
  }
  logger.error(`[SilentAI/PlayerSummary] Failed to generate summary after ${MAX_RETRIES_SILENT_AI + 1} attempts.`);
  return null;
}

/**
 * Evolves the world lore based on a chunk of game history and existing lore.
 * @param {Array<Object>} historyChunk - The segment of game history.
 * @param {string} currentEvolvedLore - The current full lore text.
 * @param {string} baseThemeLore - The original, static lore for the theme.
 * @param {string} themeName - The name of the theme.
 * @param {string} currentNarrativeLanguage - The language for the lore.
 * @returns {Promise<string|null>} The new, complete evolved lore or null.
 */
export async function evolveWorldLore(historyChunk, currentEvolvedLore, baseThemeLore, themeName, currentNarrativeLanguage) {
  const contentForAI = [{ role: "user", parts: [{ text: `Base Theme Lore for ${themeName}: ${baseThemeLore}\n\nCurrent Evolved Lore: ${currentEvolvedLore}\n\nRecent Game Events: ${JSON.stringify(historyChunk)}` }] }];
  const systemPrompt = `You are a world-building assistant for the text-based RPG "${themeName}".
  Your role is to evolve the game world's lore in response to recent player-driven events, ensuring their actions have meaningful, lasting effects.

  Provided Context:
  1. **Base Theme Lore** – The original, immutable foundation of the world.
  2. **Current Evolved Lore** – The current state of the world after previous updates. May be identical to the base if no changes have occurred yet.
  3. **Recent Game Events** – A chunk of game history including player actions and game master responses.

  Instructions:
  - Analyze the "Current Evolved Lore" and the "Recent Game Events".
  - Identify meaningful developments: changes to locations, character fates, faction shifts, revealed secrets, or lasting consequences of the player's actions.
  - Seamlessly integrate these into the "Current Evolved Lore" to produce a new, coherent, and enriched version of the world's state.
  - Avoid summarizing the events. Instead, evolve the world description as if it has naturally grown to reflect what occurred.
  - Preserve the tone, language, and spirit of the original "Base Theme Lore".
  - If no meaningful changes are warranted, return the "Current Evolved Lore" with only minor stylistic refinements if needed.
  - Output must be in ${currentNarrativeLanguage.toUpperCase()}.
  - Do not include any commentary, explanations, or section headers—output only the updated lore as a continuous piece of in-world writing.`;


  let attempt = 0;
  while (attempt <= MAX_RETRIES_SILENT_AI) {
    const newLore = await callSilentGeminiAPI(contentForAI, { parts: [{ text: systemPrompt }] }, SUMMARIZATION_MODEL_NAME, "LoreEvolution");
    if (newLore) return newLore;
    attempt++;
    if (attempt <= MAX_RETRIES_SILENT_AI) {
      logger.warn(`[SilentAI/LoreEvolution] Retrying (${attempt}/${MAX_RETRIES_SILENT_AI}) after delay...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS_SILENT_AI));
    }
  }
  logger.error(`[SilentAI/LoreEvolution] Failed to evolve lore after ${MAX_RETRIES_SILENT_AI + 1} attempts.`);
  return null;
}
