// server/utils/aiHelper.js
import fetch from 'node-fetch';
import logger from './logger.js';

const SUMMARIZATION_MODEL_NAME = process.env.SUMMARIZATION_MODEL_NAME || (process.env.MODEL_NAME_FREE || 'gemini-2.0-flash-exp');
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
 * Integrates a new lore shard into the existing world lore using an AI call.
 * This function has been enhanced to encourage bolder, more meaningful lore evolution.
 * @param {string} currentLore - The current full lore text.
 * @param {{title: string, content: string}} shardData - The title and content of the new shard.
 * @param {string} themeName - The name of the theme for the prompt context.
 * @param {string} currentNarrativeLanguage - The language for the lore.
 * @returns {Promise<string|null>} The new, complete evolved lore with special tags, or null.
 */
export async function integrateShardIntoLore(currentLore, shardData, themeName, currentNarrativeLanguage) {
  const contentForAI = [{
    role: "user",
    parts: [{
      text: `Current World Lore:\n${currentLore}\n\nNewly Unlocked Shard:\nTitle: ${shardData.title}\nContent: ${shardData.content}`
    }]
  }];
  const systemPrompt = `You are a World Historian for the text-based RPG "${themeName}".
Your task is to **meaningfully evolve** the 'Current World Lore' by weaving in the 'Newly Unlocked Shard'. The goal is to make the player feel their discovery has had a tangible impact on the world's story.

**Instructions:**
- **Be a Storyteller, Not a Surgeon:** Do not just add one sentence. You MUST rewrite, expand, or re-contextualize existing paragraphs to seamlessly and logically incorporate the new information. The change should feel significant and earned. If a paragraph about a "quiet forest" now needs to reflect the discovery of an "ancient, sentient tree," rewrite that paragraph to reflect its newfound mystery and importance.
- **Maintain Tone & Style:** The new, evolved lore must perfectly match the tone and style of the original.
- **Tag the Core Update:** You MUST wrap the new or most significantly altered sentences related to the shard's core idea in a special tag: \`<shard-update shard-title="${shardData.title}">...</shard-update>\`. The 'shard-title' attribute must be the exact title of the shard. This tag should encapsulate the heart of the change.
- **Handle Empty Lore:** If "Current World Lore" is empty or just contains base lore, treat the shard's content as a foundational event and write a new, compelling paragraph around it, wrapping the entire paragraph in the tag.
- **Output Raw Text:** Your entire response MUST be the full, updated lore text, and nothing else. No JSON, no explanations, no apologies. Just the raw, evolved text.
- **Language:** The output text must be in ${currentNarrativeLanguage.toUpperCase()}.

**Example of GOOD, impactful integration:**
- **Current Lore:** "The forests of Whisperwood are ancient and quiet, largely ignored by the nearby barony."
- **Shard:** Title: "The Silent Watchers", Content: "The oldest trees in Whisperwood are not truly asleep. They have witnessed the rise and fall of empires, and they remember."
- **Correct Output:** "The forests of Whisperwood, long thought by the barony to be merely ancient and quiet, are now understood to hold a deeper secret. <shard-update shard-title="The Silent Watchers">It's whispered that the oldest trees are not truly asleep, but are silent, conscious witnesses to history. They have watched empires turn to dust, and they remember everything.</shard-update> This revelation has made the locals both fearful and curious, with some now leaving offerings at the forest's edge."
- **Reasoning:** This is a good example because it doesn't just add the new info; it *changes the world's reaction to it*, making the discovery feel more impactful.`;
  // This is a specialized, silent call that should not be expensive. Using the summarization model.
  const modelToUse = SUMMARIZATION_MODEL_NAME;
  let attempt = 0;
  while (attempt <= MAX_RETRIES_SILENT_AI) {
    // Note: This helper uses a slightly different call signature than the main proxy, as it's a text-only response.
    const newLore = await callSilentGeminiAPI(contentForAI, { parts: [{ text: systemPrompt }] }, modelToUse, "ShardIntegration");
    if (newLore) return newLore;
    attempt++;
    if (attempt <= MAX_RETRIES_SILENT_AI) {
      logger.warn(`[SilentAI/ShardIntegration] Retrying (${attempt}/${MAX_RETRIES_SILENT_AI}) after delay...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS_SILENT_AI));
    }
  }
  logger.error(`[SilentAI/ShardIntegration] Failed to integrate shard after ${MAX_RETRIES_SILENT_AI + 1} attempts.`);
  return null;
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
