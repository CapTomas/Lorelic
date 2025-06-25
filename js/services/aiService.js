/**
 * @file Constructs prompts for the AI and manages the interaction flow
 * for main game turns and specialized calls like "Mull Over Shard".
 */

// --- IMPORTS ---
import { RECENT_INTERACTION_WINDOW_SIZE } from '../core/config.js';
import { log, LOG_LEVEL_DEBUG, LOG_LEVEL_ERROR, LOG_LEVEL_INFO, LOG_LEVEL_WARN, getLogLevel } from '../core/logger.js';
import * as state from '../core/state.js';
import * as apiService from '../core/apiService.js';
import * as themeService from '../services/themeService.js';
import * as localizationService from '../services/localizationService.js';
import * as storyLogManager from '../ui/storyLogManager.js';


// --- CONSTANTS ---
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.95,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
};

const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

// --- PRIVATE HELPERS ---

/**
 * Validates if prompt text is loaded and usable.
 * @param {string|null|undefined} text - The prompt text to check.
 * @returns {boolean} True if the text is valid.
 * @private
 */
const _isValidPromptText = (text) => text && !text.startsWith("ERROR:") && !text.startsWith("HELPER_FILE_NOT_FOUND:");

/**
 * Builds the string payload for currently equipped items.
 * @returns {string} The formatted string of equipped items.
 * @private
 */
function _buildEquippedItemsPayload() {
  const equippedItems = state.getEquippedItems();
  if (Object.keys(equippedItems).length === 0) {
    return "The character has no notable equipment.";
  }

  const lang = state.getCurrentNarrativeLanguage();
  const intro = state.getIsInitialGameLoad()
    ? "The character begins with the following equipment based on their current level. This gear is fixed for the start of the game and should be reflected in the dashboard. Do not change it unless the player acquires new items.\n"
    : "The character is currently equipped with the following:\n";

  const itemsList = Object.values(equippedItems).map(item => {
    if (!item?.name) return '';
    const itemName = item.name[lang] || item.name.en || 'Unknown Item';
    const itemEffect = item.itemEffectDescription?.[lang] || item.itemEffectDescription?.en || 'No effect description.';
    return `- ${itemName} (${itemEffect})`;
  }).filter(Boolean).join('\n');

  return intro + itemsList;
}

/**
 * Generates descriptive strings for dashboard panels to be used in the AI prompt.
 * @param {string} themeId - The ID of the current theme.
 * @param {string} narrativeLang - The current narrative language.
 * @returns {{topPanel: string, sidePanels: string, indicators: string}} The description strings.
 * @private
 */
function _generateDashboardDescriptions(themeId, narrativeLang) {
  const themeConfig = themeService.getThemeConfig(themeId);
  if (!themeConfig?.dashboard_config) return { topPanel: '', sidePanels: '', indicators: '' };

  const dashboardConfig = themeConfig.dashboard_config;
  const equipmentSlotIds = Object.values(themeService.getThemeEquipmentSlots(themeId) || {}).map(slot => slot.id);

  const createDescription = (item) => {
    let desc = `// "${item.id}": "${item.type} (${item.short_description || 'No description available.'})"`;
    if (item.must_translate) desc += ` This value MUST be in ${narrativeLang.toUpperCase()}.`;
    return desc;
  };

  const topPanel = (dashboardConfig.top_panel || []).map(createDescription).join(',\n');
  const sidePanelItems = [...(dashboardConfig.left_panel || []), ...(dashboardConfig.right_panel || [])].flatMap(p => p.items || []);
  const sidePanels = sidePanelItems.filter(item => !equipmentSlotIds.includes(item.id)).map(createDescription).join(',\n');

  let indicators = (dashboardConfig.game_state_indicators || []).map(indicator =>
    `"${indicator.id}": "boolean (${indicator.short_description || "No description."} Default: ${indicator.default_value})",`
  ).join('\n');
  if (!indicators.includes('"activity_status"')) {
    indicators += `\n"activity_status": "string (MUST reflect the ongoing primary activity described in the narrative, IN THE NARRATIVE LANGUAGE.)",`;
  }

  return { topPanel, sidePanels, indicators: indicators.trim().replace(/,$/, '') };
}

/**
 * Injects text values from a source object into placeholders like `${key}_suffix`.
 * @param {string} text The text to process.
 * @param {string} suffix The placeholder suffix (e.g., 'master_texts').
 * @param {object|null} sourceObject The object containing key-value pairs of text.
 * @returns {string} The processed text.
 * @private
 */
function _injectTextFromObject(text, suffix, sourceObject) {
  if (!sourceObject) return text;
  const regex = new RegExp(`\\$\\{([a-zA-Z0-9_]+)_${suffix}\\}`, 'g');
  return text.replace(regex, (match, key) => {
    if (sourceObject[key]) return sourceObject[key];
    log(LOG_LEVEL_WARN, `Core text key '${key}' not found for suffix '${suffix}'.`);
    return `// Core text key "${key}" not found.`;
  });
}

/**
 * Injects random lines from helper text files into the prompt.
 * @param {string} text - The prompt text containing placeholders.
 * @param {string} themeId - The current theme ID.
 * @returns {string} The prompt text with placeholders replaced.
 * @private
 */
function _injectRandomLineHelpers(text, themeId) {
  return text.replace(/{{HELPER_RANDOM_LINE:([a-zA-Z0-9_]+)}}/g, (match, helperKey) => {
    const helperContent = themeService.getLoadedPromptText(themeId, helperKey) || themeService.getLoadedPromptText("master", helperKey);
    if (_isValidPromptText(helperContent)) {
      const lines = helperContent.split("\n").map(s => s.trim()).filter(Boolean);
      return lines.length > 0 ? lines[Math.floor(Math.random() * lines.length)] : match;
    }
    log(LOG_LEVEL_WARN, `Helper file for key '${helperKey}' not found or empty.`);
    return match;
  });
}

/**
 * Injects JSON content into prompt placeholders.
 * @param {string} text - The prompt text.
 * @param {string} placeholderKey - The key for the placeholder (e.g., 'core_mechanics').
 * @param {object|null} jsonContent - The parsed JSON object to inject.
 * @returns {string} The updated prompt text.
 * @private
 */
function _injectJsonPayload(text, placeholderKey, jsonContent) {
  if (!jsonContent) return text;
  const regex = new RegExp(`\\$\\{([a-zA-Z0-9_]+)_${placeholderKey}_payload\\}`, 'g');
  return text.replace(regex, (match, key) => {
    if (jsonContent[key]) return JSON.stringify(jsonContent[key], null, 2);
    log(LOG_LEVEL_WARN, `Mechanics payload key '${key}' not found in ${placeholderKey}.`);
    return `// Mechanics key "${key}" not found.`;
  });
}

/**
 * Cleans the AI's response, attempting to parse a valid JSON object even if it's wrapped in markdown.
 * @param {string} aiResponseString - The raw string from the AI.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If a valid JSON object cannot be parsed.
 * @private
 */
function _parseJsonResponse(aiResponseString) {
  try {
    return JSON.parse(aiResponseString);
  } catch (initialError) {
    log(LOG_LEVEL_WARN, "Initial JSON.parse failed. Attempting cleanup...", initialError.message);
    const markdownMatch = aiResponseString.match(/```(?:json)?\s*([\s\S]*?)\s*```/s);
    if (markdownMatch?.[1]) {
      try {
        return JSON.parse(markdownMatch[1].trim());
      } catch (e) { /* Fall through */ }
    }
    const firstBrace = aiResponseString.indexOf("{");
    const lastBrace = aiResponseString.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(aiResponseString.substring(firstBrace, lastBrace + 1));
      } catch (e) { /* Fall through */ }
    }
    throw initialError;
  }
}

/**
 * Constructs the system prompt for the AI based on the current game state and active prompt type.
 * @param {string} [worldShardsPayloadForInitial="[]"] - JSON string of active world shards for initial prompt.
 * @returns {string} The fully constructed system prompt string.
 * @throws {Error} If a critical prompt file is missing.
 */
export function getSystemPrompt(worldShardsPayloadForInitial = "[]") {
  const currentThemeId = state.getCurrentTheme();
  if (!currentThemeId) throw new Error("Active theme is missing for prompt generation.");

  const themeConfig = themeService.getThemeConfig(currentThemeId);
  const narrativeLang = state.getCurrentNarrativeLanguage();

  // 1. Determine the base prompt template
  const isInitialLoad = state.getIsInitialGameLoad();
  const isGeneratingItem = state.getLastKnownGameStateIndicators()?.generate_item_reward;
  let basePromptKey = isInitialLoad ? "master_initial" : (isGeneratingItem ? "master_items" : state.getCurrentPromptType());
  let basePromptText = themeService.getLoadedPromptText(currentThemeId, basePromptKey);
  if (!_isValidPromptText(basePromptText)) {
    basePromptText = themeService.getLoadedPromptText("master", basePromptKey.startsWith('master_') ? basePromptKey : 'master_default');
  }
  if (!_isValidPromptText(basePromptText)) throw new Error(`Critical prompt file missing for key "${basePromptKey}"`);
  let processedPromptText = basePromptText;

  // 2. Inject complex templates (which may contain simple placeholders)
  const coreMechanics = JSON.parse(themeService.getLoadedPromptText('master', 'core_mechanics') || '{}');
  const masterCoreTexts = JSON.parse(themeService.getLoadedPromptText('master', 'core_texts') || '{}');
  const themeCoreTexts = JSON.parse(themeService.getLoadedPromptText(currentThemeId, 'core_texts') || '{}');
  processedPromptText = _injectJsonPayload(processedPromptText, 'mechanics', coreMechanics);
  processedPromptText = _injectTextFromObject(processedPromptText, 'master_texts', masterCoreTexts);
  processedPromptText = _injectTextFromObject(processedPromptText, 'theme_texts', themeCoreTexts);
  processedPromptText = _injectRandomLineHelpers(processedPromptText, currentThemeId);

  // 3. Define all simple value replacements
  const userPreference = state.getCurrentUser()?.story_preference;
    let userPreferenceDescription = 'User has not set a story preference.';
    if (userPreference) {
      const descriptionKey = `desc_story_preference_${userPreference}`;
      // Prompts are built in English, so fetch the 'en' description.
      const descriptionText = localizationService.getUIText(descriptionKey, {}, { explicitLangForTextItself: 'en', viewContext: 'global' });
      if (descriptionText && descriptionText !== descriptionKey) {
          userPreferenceDescription = descriptionText;
      } else {
          log(LOG_LEVEL_WARN, `Could not find a description for story preference key: ${descriptionKey}`);
      }
    }
  const descriptions = _generateDashboardDescriptions(currentThemeId, narrativeLang);
  const themeInstructionsKey = `theme_instructions_${basePromptKey.replace('master_', '')}_${currentThemeId}`;
  let themeInstructions = localizationService.getUIText(themeInstructionsKey, {}, { explicitThemeContext: currentThemeId });
  if (themeInstructions === themeInstructionsKey) themeInstructions = "No specific instructions provided.";

  const valueReplacements = {
    'narrativeLanguageInstruction': themeService.getThemeNarrativeLangPromptPart(currentThemeId, narrativeLang),
    'currentNameForPrompt': state.getPlayerIdentifier() || localizationService.getUIText("unknown"),
    'currentNarrativeLanguage\\.toUpperCase\\(\\)': narrativeLang.toUpperCase(),
    'theme_name': localizationService.getUIText(themeConfig.name_key, {}, { explicitThemeContext: currentThemeId }),
    'theme_lore': localizationService.getUIText(themeConfig.lore_key, {}, { explicitThemeContext: currentThemeId }),
    'theme_category': localizationService.getUIText(themeConfig.category_key || '', {}, { explicitThemeContext: currentThemeId }),
    'theme_style': localizationService.getUIText(themeConfig.style_key || '', {}, { explicitThemeContext: currentThemeId }),
    'theme_tone': localizationService.getUIText(themeConfig.tone_key || '', {}, { explicitThemeContext: currentThemeId }),
    'theme_inspiration': localizationService.getUIText(themeConfig.inspiration_key || '', {}, { explicitThemeContext: currentThemeId }),
    'theme_concept': localizationService.getUIText(themeConfig.concept_key || '', {}, { explicitThemeContext: currentThemeId }),
    'theme_specific_instructions': themeInstructions,
    'story_preference_user_description': userPreferenceDescription,
    'generated_top_panel_description': descriptions.topPanel,
    'generated_dashboard_description': descriptions.sidePanels,
    'generated_game_state_indicators': descriptions.indicators,
    'game_history_lore': state.getLastKnownEvolvedWorldLore() || localizationService.getUIText(themeConfig.lore_key, {}, { explicitThemeContext: currentThemeId }),
    'game_history_summary': state.getLastKnownCumulativePlayerSummary() || "No major long-term events have been summarized yet.",
    'world_shards_json_payload': isInitialLoad ? worldShardsPayloadForInitial : "[]",
  };

  if (masterCoreTexts?.runtimeValues) {
    valueReplacements['runtimeValues_master_texts'] = masterCoreTexts.runtimeValues;
  }

  if (basePromptKey === "master_initial") {
    const startsContent = themeService.getLoadedPromptText(currentThemeId, "starts") || themeService.getLoadedPromptText("master", "starts");
    const fallbackName = localizationService.getUIText(themeConfig.name_key, {}, { explicitThemeContext: currentThemeId });
    let selectedStarts = [`Generic ${fallbackName} scenario 1`, `Generic ${fallbackName} scenario 2`, `Generic ${fallbackName} scenario 3`];
    if (_isValidPromptText(startsContent)) {
      const allStarts = startsContent.split("\n").map(s => s.trim()).filter(Boolean);
      if (allStarts.length > 0) {
        selectedStarts = allStarts.sort(() => 0.5 - Math.random()).slice(0, 3);
        while (selectedStarts.length < 3) selectedStarts.push(`Generic ${fallbackName} scenario ${selectedStarts.length + 1}`);
      }
    }
    valueReplacements['startIdea1'] = selectedStarts[0];
    valueReplacements['startIdea2'] = selectedStarts[1];
    valueReplacements['startIdea3'] = selectedStarts[2];
  }

  // 4. Perform multi-pass replacement to resolve nested placeholders
  let previousText;
  let iterations = 0;
  const runtimeSubstitutions = {
    'playerLevel': String(state.getPlayerLevel()),
    'effectiveMaxIntegrity': String(state.getEffectiveMaxIntegrity()),
    'effectiveMaxWillpower': String(state.getEffectiveMaxWillpower()),
    'effectiveAptitude': String(state.getEffectiveAptitude()),
    'effectiveResilience': String(state.getEffectiveResilience()),
    'acquiredTraitsJSON': JSON.stringify(state.getAcquiredTraitKeys()),
    'equippedItemsPayload': _buildEquippedItemsPayload(),
    'currentStrainLevel': String(state.getCurrentStrainLevel()),
    'activeConditionsJSON': JSON.stringify(state.getActiveConditions()),
    'currentNarrativeLanguage.toUpperCase()': narrativeLang.toUpperCase(),
  };

  do {
    previousText = processedPromptText;
    // First, replace the larger blocks
    for (const [key, value] of Object.entries(valueReplacements)) {
      processedPromptText = processedPromptText.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
    }
    // Then, replace the simple runtime values that might be inside the larger blocks
    for (const [key, value] of Object.entries(runtimeSubstitutions)) {
      processedPromptText = processedPromptText.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
    }
    iterations++;
  } while (processedPromptText !== previousText && iterations < 5);

  if (iterations === 5) {
    log(LOG_LEVEL_WARN, "Prompt replacement reached max iterations. Possible circular dependency.");
  }

  return processedPromptText;
}

/**
 * Constructs the system prompt for a "lore deep dive" on a World Shard.
 * @param {object} shardData - The data of the shard: { title, content }.
 * @returns {string} The fully constructed system prompt string.
 * @throws {Error} If the deep dive prompt template is missing.
 */
export function getSystemPromptForDeepDive(shardData) {
  const currentThemeId = state.getCurrentTheme();
  if (!currentThemeId) throw new Error("Active theme is missing for deep dive.");

  const basePromptText = themeService.getLoadedPromptText("master", "master_lore_deep_dive");
  if (!_isValidPromptText(basePromptText)) throw new Error("Deep dive prompt template missing.");

  const lastTurn = state.getGameHistory().slice(-2)[0] || {};
  let lastActionSnippet = "N/A";
  if (lastTurn.role === 'user' && lastTurn.parts?.[0]?.text) {
    lastActionSnippet = lastTurn.parts[0].text.substring(0, 150) + (lastTurn.parts[0].text.length > 150 ? "..." : "");
  }

  const themeConfig = themeService.getThemeConfig(currentThemeId);
  const replacements = {
    'theme_name': localizationService.getUIText(themeConfig.name_key, {}, { explicitThemeContext: currentThemeId }),
    'currentNarrativeLanguage\\.toUpperCase\\(\\)': state.getCurrentNarrativeLanguage().toUpperCase(),
    'lore_fragment_title': shardData.title,
    'lore_fragment_content': shardData.content,
    'game_history_lore': state.getLastKnownEvolvedWorldLore(),
    'game_history_summary_snippet': `Prior Player Action: ${lastActionSnippet}`
  };

  return Object.entries(replacements).reduce((acc, [key, value]) => acc.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value), basePromptText);
}

/**
 * Processes a player's turn: constructs the prompt, calls the AI, and updates state.
 * @param {string} playerActionText - The text of the player's action.
 * @param {string} [worldShardsPayloadForInitial="[]"] - Optional JSON string of world shards for the initial turn.
 * @returns {Promise<object|null>} The parsed AI response object, or null on critical failure.
 */
export async function processAiTurn(playerActionText, worldShardsPayloadForInitial = "[]") {
  log(LOG_LEVEL_INFO, `Processing AI turn for player action: "${playerActionText.substring(0, 50)}..."`);
  try {
    const systemPromptText = getSystemPrompt(worldShardsPayloadForInitial);
    if (getLogLevel() === 'debug') console.log("--- SYSTEM PROMPT ---", systemPromptText);
    const historyForAI = state.getIsInitialGameLoad()
      ? [{ role: 'user', parts: [{ text: playerActionText }] }]
      : state.getGameHistory()
        .filter(turn => turn.role === 'user' || turn.role === 'model')
        .map(turn => ({ role: turn.role, parts: turn.parts.map(part => ({ text: part.text })) }))
        .slice(-RECENT_INTERACTION_WINDOW_SIZE);
    const payload = {
      contents: historyForAI,
      generationConfig: DEFAULT_GENERATION_CONFIG,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      systemInstruction: { parts: [{ text: systemPromptText }] },
      modelName: state.getCurrentModelName(),
    };
    const token = state.getCurrentUser()?.token || null;
    const responseData = await apiService.callGeminiProxy(payload, token);
    // After a successful API call, check for updated usage stats in the response
    if (responseData.api_usage) {
      state.setCurrentUserApiUsage(responseData.api_usage);
      log(LOG_LEVEL_DEBUG, 'Updated user API usage state from proxy response:', responseData.api_usage);
    }
    if (responseData.promptFeedback?.blockReason) {
      throw new Error(`Content blocked by AI: ${responseData.promptFeedback.blockReason}.`);
    }
    const aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error("No valid candidate or text found in AI response.");
    const parsedAIResponse = _parseJsonResponse(aiText);
    if (!parsedAIResponse?.narrative || typeof parsedAIResponse.dashboard_updates !== 'object' || !Array.isArray(parsedAIResponse.suggested_actions)) {
      throw new Error("Invalid JSON structure from AI: missing core fields.");
    }
    // Attach dice roll results from the top-level server response to the parsed AI content
    if (responseData.dice_roll_results) {
        parsedAIResponse.dice_roll_results = responseData.dice_roll_results;
    }
    state.addTurnToGameHistory({ role: "model", parts: [{ text: JSON.stringify(parsedAIResponse) }] });
    state.setLastKnownDashboardUpdates(parsedAIResponse.dashboard_updates);
    state.setCurrentSuggestedActions(parsedAIResponse.suggested_actions);
    state.setLastKnownGameStateIndicators(parsedAIResponse.game_state_indicators || {});
    state.setCurrentAiPlaceholder(parsedAIResponse.input_placeholder || localizationService.getUIText("placeholder_command"));
    state.setCurrentTurnUnlockData(parsedAIResponse.new_persistent_lore_unlock || null);
    if (state.getIsInitialGameLoad()) state.setIsInitialGameLoad(false);
    return parsedAIResponse;
  } catch (error) {
    log(LOG_LEVEL_ERROR, "processAiTurn failed:", error);
    if (error.code === 'API_LIMIT_EXCEEDED') {
        storyLogManager.addMessageToLog(
            localizationService.getUIText("error_api_limit_exceeded"),
            "system system-error system-emphasized"
        );
    } else if (error.code === 'MODEL_NOT_ALLOWED_FOR_TIER') {
        storyLogManager.addMessageToLog(
            localizationService.getUIText("error_model_not_allowed"),
            "system system-error system-emphasized"
        );
    }
    state.setCurrentAiPlaceholder(localizationService.getUIText("placeholder_command"));
    throw error;
  }
}
/**
 * Handles the "Mull Over Shard" action by making a specialized AI call.
 * @param {object} shardData - The data of the World Shard to reflect upon.
 * @returns {Promise<string|null>} The narrative string from the AI, or null on failure.
 */
export async function handleMullOverShardAction(shardData) {
  if (!shardData?.title || !shardData.content) {
    log(LOG_LEVEL_ERROR, "handleMullOverShardAction: Invalid shardData provided.", shardData);
    return null;
  }
  log(LOG_LEVEL_INFO, "Handling Mull Over Shard action for:", shardData.title);

  try {
    const systemPromptText = getSystemPromptForDeepDive(shardData);
    const payload = {
      contents: [],
      generationConfig: { ...DEFAULT_GENERATION_CONFIG, temperature: 0.65, maxOutputTokens: 1024 },
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      systemInstruction: { parts: [{ text: systemPromptText }] },
      modelName: state.getCurrentModelName(),
    };

    const token = state.getCurrentUser()?.token || null;
    const responseData = await apiService.callGeminiProxy(payload, token);
    const aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error("No valid candidate in Deep Dive AI response.");

    const parsedResponse = _parseJsonResponse(aiText);
    if (!parsedResponse?.deep_dive_narrative) throw new Error("Deep dive AI response missing 'deep_dive_narrative' field.");

    state.addTurnToGameHistory({
      role: "model",
      parts: [{ text: JSON.stringify({ narrative: parsedResponse.deep_dive_narrative, isDeepDive: true, relatedShardTitle: shardData.title }) }]
    });

    return parsedResponse.deep_dive_narrative;
  } catch (error) {
    log(LOG_LEVEL_ERROR, "handleMullOverShardAction failed:", error.message);
    throw error;
  }
}
