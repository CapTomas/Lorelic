/**
 * @file Provides robust dice rolling utility for D&D style notations.
 * Supports standard rolls (e.g., '2d6'), modifiers ('1d20+5'),
 * advantage ('a2d20'), disadvantage ('d2d20'), and success checking.
 */
import logger from './logger.js';

/**
 * Parses a dice notation string.
 * Handles notations like: d20, 1d20, 3d6+2, a2d20, d2d20-1.
 * @private
 * @param {string} notation - The dice string to parse.
 * @returns {object|null} A parsed object or null if invalid.
 */
function _parseNotation(notation) {
    if (typeof notation !== 'string' || !notation.trim()) {
        return null;
    }
    // Regex breakdown:
    // ^(a|d)? - Optional 'a' (advantage) or 'd' (disadvantage) at the start.
    // (\d*) - Optional number of dice (e.g., the '3' in '3d6').
    // d - The literal character 'd'.
    // (\d+) - The number of sides on the die.
    // ([+-]\d+)?$ - Optional modifier at the end (e.g., '+5', '-2').
    const diceRegex = /^(a|d)?(\d*)d(\d+)([+-]\d+)?$/i;
    const match = notation.toLowerCase().match(diceRegex);
    if (!match) {
        logger.warn(`[DiceRoller] Invalid dice notation provided: ${notation}`);
        return null;
    }
    const count = match[2] ? parseInt(match[2], 10) : 1;
    // For advantage/disadvantage, the dice count must be 2.
    if (match[1] && count !== 2) {
        logger.warn(`[DiceRoller] Advantage/Disadvantage notation requires 2 dice (e.g., a2d20). Received: ${notation}`);
        return null;
    }
    return {
        advDis: match[1] || null, // 'a' or 'd'
        count: count,
        sides: parseInt(match[3], 10),
        modifier: match[4] ? parseInt(match[4], 10) : 0,
    };
}

/**
 * Rolls a single die with a given number of sides.
 * @private
 * @param {number} sides - Number of sides.
 * @returns {number} The result of the roll.
 */
function _rollDie(sides) {
    if (sides < 1) return 1;
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Executes a single parsed dice roll instruction and checks for success.
 * @private
 * @param {object} rollConfig - The dice roll configuration object ({ notation, target, comparison }).
 * @returns {object} An object containing the individual rolls, modifier, result, and success status.
 */
function _executeSingleRoll(rollConfig) {
    const parsed = _parseNotation(rollConfig.notation);
    if (!parsed) {
        return { notation: rollConfig.notation, error: 'Invalid dice notation' };
    }

    const rolls = [];
    for (let i = 0; i < parsed.count; i++) {
        rolls.push(_rollDie(parsed.sides));
    }

    let result;
    if (parsed.advDis === 'a') {
        result = Math.max(...rolls) + parsed.modifier;
    } else if (parsed.advDis === 'd') {
        result = Math.min(...rolls) + parsed.modifier;
    } else {
        result = rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier;
    }

    let success = false;
    const comparison = rollConfig.comparison || '>=';
    // Ensure target is always treated as a number for calculations and response.
    const target = (rollConfig.target !== undefined && rollConfig.target !== null) ? parseInt(String(rollConfig.target), 10) : undefined;

    if (typeof target === 'number' && !isNaN(target)) {
        switch (comparison) {
            case '>=': success = result >= target; break;
            case '<=': success = result <= target; break;
            case '>':  success = result > target; break;
            case '<':  success = result < target; break;
            default:   success = result >= target; // Default comparison
        }
    }

    return {
        notation: rollConfig.notation,
        sides: parsed.sides,
        rolls,
        modifier: parsed.modifier,
        result,
        success,
        target: (typeof target === 'number' && !isNaN(target)) ? target : undefined, // Return a clean number or undefined
        comparison,
    };
}

/**
 * Takes an array of dice roll configurations, executes each roll, and returns the structured results.
 * @param {Array<object>} rollConfigs - An array of objects, each like { notation, target, comparison }.
 * @returns {object[]} An array of result objects for each configuration.
 */
export function executeRolls(rollConfigs) {
    if (!Array.isArray(rollConfigs)) {
        logger.error('[DiceRoller] executeRolls received a non-array input:', rollConfigs);
        return [{ error: 'Invalid input: Expected an array of dice roll configurations.' }];
    }
    logger.info(`[DiceRoller] Executing rolls for configs:`, rollConfigs);

    return rollConfigs.map(config => {
        if (typeof config !== 'object' || !config.notation) {
            return { notation: config, error: 'Invalid roll configuration, must be an object with a notation property.' };
        }
        return _executeSingleRoll(config);
    });
}
