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
import * as uiUtils from '../ui/uiUtils.js';
import * as suggestedActionsManager from '../ui/suggestedActionsManager.js';



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
 * Selects the correct language string from a potentially bilingual lore object.
 * @param {object|string} lore - The lore data from state.
 * @returns {string} The monolingual lore string.
 * @private
 */
function _selectLocalizedLore(lore) {
    if (typeof lore === 'object' && lore !== null) {
        const narrativeLang = state.getCurrentNarrativeLanguage();
        return lore[narrativeLang] || lore['en'] || ''; // Fallback to English if current lang not present
    }
    if (typeof lore === 'string') {
        return lore; // Handle legacy format
    }
    return '';
}

/**
 * Validates if prompt text is loaded and usable.
 * @param {string|null|undefined} text - The prompt text to check.
 * @returns {boolean} True if the text is valid.
 * @private
 */
const _isValidPromptText = (text) => text && !text.startsWith("ERROR:") && !text.startsWith("HELPER_FILE_NOT_FOUND:");

/**
 * Builds the JSON payload for the character's acquired traits.
 * This payload includes the name and description for the current narrative language.
 * @returns {string} The formatted JSON string of acquired traits.
 * @private
 */
function _buildAcquiredTraitsPayload() {
  const currentThemeId = state.getCurrentTheme();
  if (!currentThemeId) return "{}";

  const allThemeTraits = themeService.getThemeTraits(currentThemeId);
  if (!allThemeTraits) return "{}";

  const acquiredTraitKeys = state.getAcquiredTraitKeys();
  if (acquiredTraitKeys.length === 0) return "{}";

  const narrativeLang = state.getCurrentNarrativeLanguage();
  const traitsPayload = {};

  acquiredTraitKeys.forEach(key => {
    const traitData = allThemeTraits[key];
    if (traitData) {
      const localizedTraitData = traitData[narrativeLang] ?? traitData['en'];
      if (localizedTraitData) {
        traitsPayload[key] = {
          name: localizedTraitData.name,
          description: localizedTraitData.description
        };
      }
    }
  });

  return JSON.stringify(traitsPayload, null, 2);
}

/**
 * Builds the string payload for currently equipped items.
 * This now provides a filtered JSON of equipped items, containing only the
 * data relevant to the current narrative language.
 * @returns {string} The formatted JSON string of equipped items.
 * @private
 */
function _buildEquippedItemsPayload() {
  const equippedItems = state.getEquippedItems();
  const narrativeLang = state.getCurrentNarrativeLanguage();

  if (Object.keys(equippedItems).length === 0) {
    return "{}";
  }

  const filteredPayload = {};

  for (const slotKey in equippedItems) {
    if (Object.prototype.hasOwnProperty.call(equippedItems, slotKey)) {
      const originalItem = equippedItems[slotKey];
      if (!originalItem) continue;

      const filteredItem = {
        id: originalItem.id,
        name: originalItem.name?.[narrativeLang] || originalItem.name?.['en'],
        itemType: originalItem.itemType,
        attributes: originalItem.attributes?.[narrativeLang] || originalItem.attributes?.['en'],
        abilities: originalItem.abilities?.[narrativeLang] || originalItem.abilities?.['en'],
        itemEffectDescription: originalItem.itemEffectDescription?.[narrativeLang] || originalItem.itemEffectDescription?.['en'],
        level: originalItem.level,
      };
      filteredPayload[slotKey] = filteredItem;
    }
  }

  return JSON.stringify(filteredPayload, null, 2);
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
  const pendingShard = state.getPendingShardForFinalization();

  // 1. Determine the base prompt template
  const isInitialLoad = state.getIsInitialGameLoad();
  const isGeneratingItem = state.getLastKnownGameStateIndicators()?.generate_item_reward;
  let basePromptKey = isInitialLoad ? "master_initial" : (isGeneratingItem ? "master_items" : state.getCurrentPromptType());

  // If a shard is pending finalization, we MUST use the default prompt to handle the lore evolution.
  if (pendingShard) {
    basePromptKey = 'master_default';
  }

  let basePromptText = themeService.getLoadedPromptText(currentThemeId, basePromptKey);
  if (!_isValidPromptText(basePromptText)) {
    const fallbackKey = basePromptKey.startsWith('master_') ? basePromptKey : 'master_default';
    basePromptText = themeService.getLoadedPromptText("master", fallbackKey);
    if (_isValidPromptText(basePromptText)) {
      basePromptKey = fallbackKey;
    }
  }
  if (!_isValidPromptText(basePromptText)) throw new Error(`Critical prompt file missing for key "${basePromptKey}"`);
  let processedPromptText = basePromptText;
  // 2. Inject complex templates (which may contain simple placeholders)
  const coreMechanics = JSON.parse(themeService.getLoadedPromptText('master', 'core_mechanics') || '{}');
  const masterCoreTexts = JSON.parse(themeService.getLoadedPromptText('master', 'core_texts') || '{}');
  const themeCoreTexts = JSON.parse(themeService.getLoadedPromptText(currentThemeId, 'core_texts') || '{}');
  const playerLevel = state.getPlayerLevel();
  const levelMechanics = coreMechanics?.levelingTable?.data?.[playerLevel - 1] || {};
  const columnDefinitions = coreMechanics?.levelingTable?.columnDefinitions || {};
  processedPromptText = _injectJsonPayload(processedPromptText, 'mechanics', coreMechanics);
  processedPromptText = _injectTextFromObject(processedPromptText, 'master_texts', masterCoreTexts);
  processedPromptText = _injectTextFromObject(processedPromptText, 'theme_texts', themeCoreTexts);
  processedPromptText = _injectRandomLineHelpers(processedPromptText, currentThemeId);
  // 3. Define all simple value replacements
  if (pendingShard) {
      const lastPlayerAction = state.getGameHistory().slice(-1)[0]?.parts[0]?.text || "No specific implication provided.";
      const finalizationInstruction = `
### CRITICAL OVERRIDE: WORLD SHARD FINALIZATION
You have previously proposed a World Shard. The player has now chosen how to interpret this discovery. Your task is to finalize this process.

- **Proposed Shard Title:** ${pendingShard.title}
- **Proposed Shard Content:** ${pendingShard.content}
- **Player's Chosen Interpretation:** "${lastPlayerAction}"

**YOUR TASKS FOR THIS TURN:**
1.  **Evolve the World Lore:** Your HIGHEST PRIORITY is to rewrite the 'Evolved World Lore' to integrate the player's chosen interpretation. This is a permanent change. The world has now changed based on their insight.
2.  **Regenerate the Unlock Object:** In your JSON response, you MUST include the \`new_persistent_lore_unlock\` object again, using the EXACT same data as the original proposal: \`key_suggestion: "${pendingShard.key_suggestion}", title: "${pendingShard.title}", content: "${pendingShard.content}", unlock_condition_description: "${pendingShard.unlock_condition_description}"\`. This is critical for saving.
3.  **Continue the Narrative:** Write a new main narrative that flows from this newly established truth.
`;

      // Inject this instruction at the top of the prompt's rules section.
      processedPromptText = processedPromptText.replace(
          '## MISSION',
          `## MISSION\n\n${finalizationInstruction}`
      );
  }
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
  const themeInstructionsKey = `theme_instructions_${basePromptKey}_${currentThemeId}`;
  let themeInstructions = localizationService.getUIText(themeInstructionsKey, {}, { explicitThemeContext: currentThemeId, explicitLangForTextItself: narrativeLang });
  if (themeInstructions === themeInstructionsKey) {themeInstructions = "No specific instructions provided.";}
  const history = state.getGameHistory();
  const lastModelTurn = history.slice().reverse().find(turn => turn.role === 'model');
  const lastUserTurn = history.slice().reverse().find(turn => turn.role === 'user');
  let lastNarrativeBeat = "This is the first turn of the game.";
  if (lastModelTurn) {
    try {
      const modelData = JSON.parse(lastModelTurn.parts[0].text);
      if (modelData.narrative) {
        lastNarrativeBeat = modelData.narrative;
      }
    } catch (e) {
      log(LOG_LEVEL_WARN, "Could not parse last model turn to extract narrative beat.", e);
      lastNarrativeBeat = "Error parsing previous turn's narrative.";
    }
  }
  const lastPlayerAction = lastUserTurn ? lastUserTurn.parts[0].text : "No previous player action.";
  const lastDashboardUpdates = state.getLastKnownDashboardUpdates();
  const lastGameStateIndicators = state.getLastKnownGameStateIndicators();
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
    'game_history_lore': _selectLocalizedLore(state.getLastKnownEvolvedWorldLore()) || localizationService.getUIText(themeConfig.lore_key, {}, { explicitThemeContext: currentThemeId }),
    'game_history_summary': state.getLastKnownCumulativePlayerSummary() || "No major long-term events have been summarized yet.",
    'world_shards_json_payload': isInitialLoad ? worldShardsPayloadForInitial : "[]",
    'player_level_benchmarks_json': JSON.stringify(levelMechanics, null, 2),
    'level_benchmarks_column_definitions_json': JSON.stringify(columnDefinitions, null, 2),
    'last_dashboard_updates_json': JSON.stringify(lastDashboardUpdates, null, 2),
    'last_game_state_indicators_json': JSON.stringify(lastGameStateIndicators, null, 2),
    'last_narrative_beat': lastNarrativeBeat,
    'last_player_action': lastPlayerAction,
  };
  Object.assign(valueReplacements, lastDashboardUpdates);
  Object.assign(valueReplacements, lastGameStateIndicators);
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
    'currentIntegrity': String(state.getCurrentRunStats().currentIntegrity),
    'currentWillpower': String(state.getCurrentRunStats().currentWillpower),
    'effectiveMaxIntegrity': String(state.getEffectiveMaxIntegrity()),
    'effectiveMaxWillpower': String(state.getEffectiveMaxWillpower()),
    'effectiveAptitude': String(state.getEffectiveAptitude()),
    'effectiveResilience': String(state.getEffectiveResilience()),
    'acquiredTraitsJSON': _buildAcquiredTraitsPayload(),
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
  log(LOG_LEVEL_INFO, `Processing player action: "${playerActionText.substring(0, 50)}..."`);
  try {
    const systemPromptText = getSystemPrompt(worldShardsPayloadForInitial);
    if (getLogLevel() === 'debug') console.log("--- SYSTEM PROMPT ---", systemPromptText);
    const isInitialLoad = state.getIsInitialGameLoad();
    const historyForAI = isInitialLoad
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
      is_initial_turn: isInitialLoad,
    };
    const selectedAction = state.getSelectedSuggestedAction();
    const isForceRollToggled = state.getIsForceRollToggled();
    // --- Dice Roll Logic Implementation ---
    if (isForceRollToggled) {
        // Priority 1: Force Roll button is active.
        payload.force_dice_roll = true;
        log(LOG_LEVEL_INFO, 'Attaching user-forced dice roll request to payload.');
    } else if (selectedAction) {
        // Priority 2 & 3: A suggested action was clicked. Check if it was modified.
        const selectedActionText = (typeof selectedAction === 'object' && selectedAction.text) ? selectedAction.text : selectedAction;
        if (playerActionText.trim() === selectedActionText.trim()) {
            // Player clicked a suggested action and did not modify the text.
            if (typeof selectedAction === 'object' && selectedAction.dice_roll) {
                const diceRollData = selectedAction.dice_roll;
                let rollConfigsToSend = null;

                // Case 1: The dice_roll object contains the rollConfigs array.
                if (Array.isArray(diceRollData.rollConfigs) && diceRollData.rollConfigs.length > 0) {
                    rollConfigsToSend = diceRollData.rollConfigs;
                // Case 2: The dice_roll object IS the config object itself.
                } else if (diceRollData.notation && typeof diceRollData.target === 'number') {
                    rollConfigsToSend = [diceRollData]; // Wrap it in an array for the backend.
                }

                if (rollConfigsToSend) {
                    payload.dice_roll_request = rollConfigsToSend;
                    log(LOG_LEVEL_INFO, 'Attaching user-initiated dice roll request to payload:', payload.dice_roll_request);
                } else {
                    payload.suppress_ai_dice_roll = true;
                    log(LOG_LEVEL_WARN, 'Selected action had a dice_roll object but it was not in a valid format. Suppressing roll.', diceRollData);
                }
            } else {
                // The action has NO dice roll defined. Suppress AI from rolling.
                payload.suppress_ai_dice_roll = true;
                log(LOG_LEVEL_INFO, 'Suppressing AI discretionary roll for a selected non-rolling action.');
            }
        }
        // Priority 4 (else case): The input text was modified or is custom. Let the AI decide.
    }
    // Clear the latched action after it has been used for this turn's payload.
    state.setSelectedSuggestedAction(null);
    const token = state.getCurrentUser()?.token || null;
    const responseData = await apiService.callGeminiProxy(payload, token);
    // After a successful API call, if a forced roll was requested, reset the toggle
    if (isForceRollToggled) {
      state.setIsForceRollToggled(false);
      uiUtils.updateForceRollToggleButton();
    }
    // After a successful API call, check for updated usage stats in the response
    if (responseData.api_usage) {
      state.setCurrentUserApiUsage(responseData.api_usage);
      log(LOG_LEVEL_DEBUG, 'Updated user API usage state from proxy response:', responseData.api_usage);
    }
    if (responseData.promptFeedback?.blockReason) {
      throw new Error(`Content blocked by AI: ${responseData.promptFeedback.blockReason}.`);
    }
    const parts = responseData.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw new Error("No valid candidate or parts found in AI response.");
    }
    // Combine all text parts to handle responses split into multiple chunks.
    const combinedAiText = parts.map(p => p.text || '').join('');
    if (!combinedAiText) {
        throw new Error("AI response parts were empty.");
    }
    const parsedAIResponse = _parseJsonResponse(combinedAiText);
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
    // This is a special block to pre-handle specific user-facing errors
    // to prevent a generic message from showing up in the gameController.
    if (error.code === 'DAILY_API_LIMIT_EXCEEDED' || error.code === 'MODEL_NOT_ALLOWED_FOR_TIER') {
      const messageKey = error.code === 'DAILY_API_LIMIT_EXCEEDED' ? "error_daily_api_limit_exceeded" : "error_model_not_allowed";
      storyLogManager.addMessageToLog(
        localizationService.getUIText(messageKey),
        "system system-error system-emphasized"
      );
      error.isHandled = true; // Mark error as handled to prevent double logging
    }
    state.setCurrentAiPlaceholder(localizationService.getUIText("placeholder_command"));
    throw error;
  }
}

/**
 * Handles the "Mull Over Shard" action by making a specialized AI call for a deep dive,
 * then presents the narrative and resulting implications as interactive choices.
 * @param {object} shardData - The data of the World Shard to reflect upon.
 * @returns {Promise<object|null>} The parsed AI response object, or null on failure.
 */
export async function handleMullOverShardAction(shardData) {
  if (!shardData?.title || !shardData.content) {
    log(LOG_LEVEL_ERROR, "handleMullOverShardAction: Invalid shardData provided.", shardData);
    return null;
  }
  log(LOG_LEVEL_INFO, "Handling Mull Over Shard action for:", shardData.title);
  // Show loading state
  uiUtils.setGMActivityIndicator(true);
  storyLogManager.showLoadingIndicator();
  suggestedActionsManager.clearSuggestedActions(); // Clear old actions
  try {
    const systemPromptText = getSystemPromptForDeepDive(shardData);
    const payload = {
      contents: [{ role: 'user', parts: [{ text: "Reflect on this new discovery and its implications." }] }],
      generationConfig: { ...DEFAULT_GENERATION_CONFIG, temperature: 0.7, maxOutputTokens: 1024 }, // Slightly higher temp for more creative implications
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      systemInstruction: { parts: [{ text: systemPromptText }] },
      modelName: state.getCurrentModelName(),
    };
    const token = state.getCurrentUser()?.token || null;
    const responseData = await apiService.callGeminiProxy(payload, token);
    const aiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error("No valid candidate in Deep Dive AI response.");
    const parsedResponse = _parseJsonResponse(aiText);
    if (!parsedResponse?.deep_dive_narrative || !Array.isArray(parsedResponse.implications)) {
      throw new Error("Deep dive AI response missing 'deep_dive_narrative' or 'implications' field.");
    }
    storyLogManager.removeLoadingIndicator();
    // Add narrative to the log as a special message, prepended with a translated header.
    const headerRelicText = localizationService.getUIText('shard_deep_dive_header');
    const fullNarrative = `${headerRelicText}\n\n${parsedResponse.deep_dive_narrative}`;
    // Render the message directly to the UI, but do not add a 'system_log' entry to history.
    storyLogManager.renderMessage(fullNarrative, "system system-emphasized shard-deep-dive-narrative");
    // Save a single, definitive turn to history for this event.
    state.addTurnToGameHistory({
      role: "model",
      parts: [{ text: JSON.stringify({ narrative: fullNarrative, isDeepDive: true, relatedShardTitle: shardData.title }) }]
    });
    // Display implications as new suggested actions
    const implicationActions = parsedResponse.implications.map(impText => ({
        text: impText,
        isLoreImplication: true, // Custom flag to identify these actions if needed later
    }));
    const headerText = localizationService.getUIText('lore_implication_header', { SHARD_TITLE: shardData.title });
    suggestedActionsManager.displaySuggestedActions(implicationActions, { headerText });
    // Keep GM busy, but allow player to click the new actions
    uiUtils.setPlayerInputEnabled(false); // Disable free text input
    // The GM indicator stays on, but buttons are enabled.
    const suggestedActionButtons = document.querySelectorAll('#suggested-actions-wrapper .ui-button');
    suggestedActionButtons.forEach(btn => { btn.disabled = false; });
    // The game flow will now wait for the player to click an implication.
    // The click handler in suggestedActionsManager will populate the input,
    // and gameController.processPlayerAction will handle it as a normal turn.
    return parsedResponse; // Return the full object for potential future use
  } catch (error) {
    log(LOG_LEVEL_ERROR, "handleMullOverShardAction failed:", error.message);
    storyLogManager.removeLoadingIndicator();
    uiUtils.setGMActivityIndicator(false); // Restore full UI control on error
    storyLogManager.addMessageToLog(localizationService.getUIText("error_api_call_failed", { ERROR_MSG: error.message }), "system system-error");
    // We don't re-throw here because it's a non-critical flow. The user can just continue playing.
    return null;
  }
}
