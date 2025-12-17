Okay, I've woven those updates into the fabric of the `leveling.md` document. The changes focus on making inventory and currency session-specific, while empowering the AI to generate unique items for the current run. Starting gear selection will still be based on the character's persistent level, ensuring a thematic start to each new session.

Here's the revised document:

--- START OF FILE leveling.md ---

---

## **Lorelic: Core Mechanics & Systems Design**

**Document Version:** 1.3 (Revised)

**Philosophy:** This document outlines the foundational mechanics governing character existence, progression, interaction, and the resolution of challenges within the Lorelic engine. These systems are designed to be theme-agnostic, providing a robust yet flexible framework adaptable to diverse narrative settings. The core design emphasizes player agency expressed through narrative choices, with underlying mechanics providing consistent context for the AI Game Master to interpret and respond, ensuring that the world feels reactive, and progression feels meaningful across multiple playthroughs of a theme.

---

### **I. Foundational Attributes**

Every player character, significant entity, or even vessel is defined by four core attributes. These attributes govern their fundamental capacities and interactions with the game world. Integrity and Willpower are dynamic pools, while Aptitude and Resilience are passive modifiers.

1.  **Integrity (INT)**
    *   **Base Value:** 100 at Level 1.
    *   **Concept:** Represents the entity's capacity to maintain wholeness—be it physical, mental, conceptual, or structural—when faced with adversarial forces, environmental hazards, or existential pressures.
    *   **Loss:** Can stem from physical injury, psychic damage, reality fragmentation, ship hull breaches, or severe bureaucratic entanglement, depending on the theme.
    *   **Consequence of Zero:** Reaching zero Integrity signifies the entity is broken, incapacitated, destroyed, or otherwise narratively "taken out of action" according to the theme's context.
    *   **Protection:** Items such as armor, shields, or wards primarily bolster Integrity by providing a buffer or increasing its effective maximum (see Equipment section).

2.  **Willpower (WIL)**
    *   **Base Value:** 50 at Level 1.
    *   **Concept:** A finite reservoir of focused energy, mental fortitude, resolve, or sheer audacity.
    *   **Expenditure:** Actively expended by the player to fuel potent abilities, perform strenuous or extraordinary actions (physical, mental, or conceptual), channel unique energies (alchemical, psychic, shanty-powered), or resist insidious influences.
    *   **Recovery:** Recovers through rest, thematic consumables (e.g., potions, tea, grog, data-pills), or moments of profound thematic resonance (e.g., successful problem-solving, inspiring leadership).

3.  **Aptitude (APT)**
    *   **Base Value:** 10 at Level 1.
    *   **Concept:** A measure of inherent talent, honed skill, precision, insight, and effectiveness in executing deliberate actions. This is a passive modifier that influences the *quality and degree of success* of actions.
    *   **Effect:** Aptitude enhances the positive impact of actions. A higher Aptitude leads to more effective outcomes, overcoming greater difficulties, or achieving more nuanced results. *AI Interpretation: The AI considers Aptitude as a key factor in determining how well an action succeeds (e.g., `Base Action Magnitude + ((Character_Aptitude - 10) / 5)` can be a conceptual guide for the AI).*

4.  **Resilience (RES)**
    *   **Base Value:** 10 at Level 1.
    *   **Concept:** A defensive modifier reflecting inner grit, inherent toughness (physical, mental, or conceptual), and the ability to passively endure or mitigate hostile effects.
    *   **Effect:** Higher Resilience can reduce the impact of negative consequences, increase chances to resist debilitating conditions (e.g., fear, corruption, curses, confusion), or maintain composure under pressure. *AI Interpretation: Resilience helps diminish the severity of adverse effects (e.g., `Incoming Negative Magnitude + ((Character_Resilience- 10) / 5)` can be a conceptual guide for the AI).*

---

### **II. Character Progression**

Progression is marked by gaining Experience Points (XP) through overcoming challenges and completing Objectives. This progression (character level, attributes, traits) is **persistent for each theme per user**, until the character for that theme is explicitly reset.

1.  **Experience & Levels:**
    *   Characters start at Level 1.
    *   XP is awarded for completing Minor, Standard, Major, and Epic Objectives, as well as overcoming significant challenges (see Section V).
    *   The cumulative XP required for each level is predefined (as per the "Character Progression & Challenge Benchmarks" reference table).

2.  **Level-Up Benefits:**
    *   **Attribute Point:** The character gains **1 Attribute Point** to allocate, enhancing one of the following:
        *   Max Integrity by an additional **10 points**.
        *   Max Willpower by an additional **5 points**.
        *   Aptitude by **1 point**.
        *   Resilience by **1 point**.
    *   **Trait Selection:** The character is presented with **three randomly selected Traits** relevant to their current theme. They may choose **one** to permanently add to their repertoire. Chosen traits are **persistent for that theme character** until a full character reset for that theme. This allows for emergent character builds and a more personalized progression across multiple game runs within the same theme.

---

### **III. Dynamic Gameplay Modifiers**

Beyond core attributes, several dynamic factors influence gameplay:

1.  **Traits:**
    *   Unique inherent qualities or learned skills defined per theme.
    *   Provide specific advantages: passive benefits, unique interactions, or crucial situational edges.
    *   Acquired primarily through leveling up. Traits are **persistent for the character within a specific theme** across multiple game sessions until that theme's character progress is reset.

2.  **Character Conditions:**
    *   Temporary states imposed by the environment, adversaries, or narrative events (e.g., "Broken Arm," "Blight-Fevered," "Sea-Cursed," "Temporarily a Teapot").
    *   Managed by the AI, these apply positive or negative effects to attributes, actions, or resource regeneration, interpreted thematically.
    *   Displayed on the dashboard for player awareness. These are **session-specific** and do not persist between game runs.

3.  **Strain Level (1-4):**
    *   Represents cumulative physical, mental, or existential toll within the current game session. Affects overall effectiveness.
    *   **Level 1 (Primed/Edged):** +10% to positive outgoing effect magnitudes (e.g., success efficacy, influence). Ability costs might be slightly reduced. *(Conceptual AI Multiplier: 1.1x)*
    *   **Level 2 (Balanced/Steady):** Normal operating effectiveness. *(Conceptual AI Multiplier: 1.0x)*
    *   **Level 3 (Faltering/Frayed):** -10% to positive outgoing effect magnitudes. Ability costs might be slightly increased. *(Conceptual AI Multiplier: 0.9x)*
    *   **Level 4 (Broken/Overwhelmed):** -20% to positive outgoing effect magnitudes. Significant penalties to actions, resource regeneration, or defensive capabilities. *(Conceptual AI Multiplier: 0.8x)*
    *   Strain changes based on narrative events, rest, or specific conditions. This is **session-specific**.

---

### **IV. Equipment, Inventory, & Economy**

The inventory and economy systems provide a dynamic loop for character enhancement and resource management. Items acquired and thematic currency are managed on a **per-session basis**. While starting gear selection is influenced by the character's persistent level, all collected equipment and funds are available for the current game run only and reset when a new run begins. This promotes dynamic adaptation and replayability within each theme.

1.  **Core Principles:**
    *   **Slot-Driven Dashboard:** Each theme's `config.json` defines `equipment_slots`. Each slot configuration includes:
        *   `id`: The dashboard item ID this slot's equipped item will control (e.g., "equipped_wardens_blade_effect", "silver_shards").
        *   `type`: Defines item behavior:
            *   `"static"`: For persistent gear like weapons or armor.
            *   `"consumable"`: For single-use or charges-based items like potions or limited-use gadgets.
            *   `"money"`: For thematic currency; the dashboard item typically displays a numerical value.
        *   `reward_trigger`: A string key for a boolean game state indicator (e.g., "wardens_blade_reward_trigger"). The AI sets this to `true` to signal a reward of this item type or currency.
    *   **Item Types & Slots:** An item's `itemType` (defined in its JSON data) must match an `equipment_slots` key (where `type` is "static" or "consumable") to be equippable in that slot.
    *   **Session Inventory:** All `static` and unconsumed `consumable` items acquired (starting gear, rewards, purchases) are stored in the `session_inventory` field of the `GameState` model for the current game session. This inventory is cleared when a new game run begins for the theme.

2.  **Item Structure:** All items adhere to the following JSON structure:
    ```json
    {
      "id": "string", // Unique item key (e.g., "gw_blade_pitted_dirk_l1")
      "name": { "en": "Localized Name", "cs": "Lokalizovaný název" },
      "description": { "en": "Localized flavor text.", "cs": "Lokalizovaný popis." },
      "itemType": "string", // Matches a key in theme's equipment_slots (e.g., "wardens_blade")
      "attributes": { // Theme-specific, localized, quantitative stats for AI context
        "en": { "Damage": 5, "Crit Chance": "Low" },
        "cs": { "Zranění": 5, "Šance na Kritik": "Nízká" }
      },
      "abilities": { // Theme-specific, localized, qualitative effects for AI narrative prompts
        "en": ["Causes Minor Bleeding", "Slightly Unwieldy"],
        "cs": ["Způsobuje Drobné Krvácení", "Lehce Nemotorná"]
      },
      "itemEffectDescription": { // Concise, player-facing UI string combining key attributes/abilities
         "en": "5 Dmg, Minor Bleed, Unwieldy",
         "cs": "5 Zraň, Drobné Krvácení, Nemotorná"
      },
      "level": "number", // Character level at which this item might appear as starting gear or common reward
      "buyPrice": "number", // Cost in thematic currency
      "sellPrice": "number" // Value when sold (typically 20-30% of buyPrice)
    }
    ```

3.  **Item Effects & AI Interpretation:**
    *   **`attributes` (The Numbers):** Context for the AI to judge the magnitude of an outcome.
    *   **`abilities` (The Narrative Prompts):** Creative prompts for the AI to weave into the story.
    *   **`itemEffectDescription` (The UI Text):** Concise, localized string displayed on the dashboard item for the corresponding slot, making the equipped item's core effect tangible.

4.  **Item Compendium & Starting Gear:**
    *   Each theme has JSON data files (e.g., `themes/grim_warden/data/wardens_blade_items.json`) serving as an item compendium.
    *   Items are assigned a character `level`.
    *   When a new game begins, `gameController.js` uses the character's persistent level (`UserThemeProgress.level`) to randomly select appropriate starting gear from the compendium for each defined `static` or `consumable` equipment slot. These items are added to the current session's `session_inventory`.

5.  **Item & Currency Reward Generation (Config-Driven Backend Logic):**
    *   The AI Game Master facilitates item and currency rewards, which are granted on a **session-specific basis**.
    *
6.  **Item Consumption:**
    *   For items equipped in slots marked `type: "consumable"`:
        *   The AI's narrative description of the item being fully used is the trigger.
        *   The AI **must** update the relevant dashboard item (e.g., `equipped_alchemical_concoction_effect`) to an "empty" or "charges depleted" state.
        *   Client-side logic in `gameController.js` detects this state change and removes the item from `session_inventory` and `equipped_items` for the current session.

7.  **Inventory Interaction (UI):**
    *   A dedicated Inventory Modal will display items from the current `session_inventory`, grouped by `itemType`.
    *   Each item shows `name`, `attributes` (localized), and `description` (localized).
    *   "Equip" button: Updates `state.equippedItems`, updates the dashboard via `dashboardManager.updateDashboardFromEquippedItems()`, re-renders modal, triggers save.
    *   (Future) "Sell" button for `static` and unconsumed `consumable` items when interacting with the Store UI.

---

### **V. Challenges & Objectives**

Progression is driven by engaging with and overcoming thematic challenges and completing objectives.

1.  **Objective Types:** Defined by scope and typical XP reward (Minor, Standard, Major, Epic). Specific examples and XP values are outlined in the "Character Progression & Challenge Benchmarks" reference table, but the AI should dynamically generate objectives fitting the narrative.
2.  **Challenge Types:** Abstracted difficulties that can apply to combat, puzzles, social encounters, environmental hazards, etc.
    *   **Common Challenge (CC)**
    *   **Significant Challenge (SC)**
    *   **Apex Challenge (AC)**
    The "Character Progression & Challenge Benchmarks" table provides baseline numerical relationships for how these scale in terms of `Difficulty / Resistance` and `Setback Magnitude`.

---

### **VI. Action Resolution & AI Guidance**

The AI Game Master interprets player actions within the context of their attributes, traits, strain, conditions, and equipment.

1.  **Aptitude's Role:** Higher Aptitude should lead the AI to narrate more successful, impactful, or nuanced outcomes for player actions. The conceptual formula `Base Action Magnitude + ((Character_Aptitude - 10) / 5)` (adjusted by Strain) guides the AI's judgment of effectiveness.
2.  **Resilience's Role:** Higher Resilience should lead the AI to narrate mitigated negative consequences from challenges or environmental effects. The conceptual formula `Incoming Negative Magnitude + ((Character_Resilience - 10) / 5)` (adjusted by Strain) guides the AI's judgment.
3.  **"Player Efforts to Overcome Challenge":** A conceptual measure of how many significant, successful actions are typically needed to resolve a challenge.
4.  **"Setback Magnitude":** The "cost" of failure or opposition (e.g., Integrity loss, Willpower drain, new Complication).

---

### **VII. Thematic Interpretation - A Note for the AI Game Master**

This framework provides abstract mechanics. Your primary role as GM is to **translate these mechanics into the rich, specific vernacular and context of the active theme.**

*   **Integrity loss** is not just a number decreasing; it's a Warden's bone-jarring wound, a Salt Reaver's ship groaning under cannon fire, a Celestial Custodian's existential despair deepening, or an Echo Sleuth's perception fracturing.
*   **Willpower expenditure** is a Warden invoking an alchemical sign, a Salt Reaver rallying their crew with a defiant roar, a Custodian wrestling with paradoxical alien technology, or an Echo Sleuth focusing their mind to pierce an illusion.
*   **Aptitude** manifests as a Warden’s keen eye spotting a chink in monster's hide, a Reaver’s uncanny knack for navigating a storm, a Custodian’s bewildering success with a malfunctioning gadget, or a Sleuth’s sharp deduction unraveling a conceptual knot.
*   **Resilience** is a Warden shrugging off the Blight’s chill, a Reaver enduring a spectral curse, a Custodian maintaining composure amidst cosmic absurdity, or a Sleuth filtering the psychic static of Reverie.

The numbers and systems exist to provide a consistent framework for your creative narration. The player experiences the world through your descriptions; make them vivid, thematic, and reflective of the underlying mechanics.

---

### **Lorelic: Character Progression & Challenge Benchmarks**

**Key for Table Columns (Generalized Terminology):**

*   **Lvl, XP to Lvl Up, Cum. XP, Std. Objs to Lvl Up, Currency per Std. Obj., Avg. Tool Price, Std. Objs to Afford Tool:** "Currency" and "Tool" are generic placeholders for theme-specific equivalents (e.g., Doubloons, Credits, Reagents; Pirate Cutlass, Starship Scanner, Alchemical Kit). Currency values listed are guidelines for session-based rewards.
*   **Avg. XP [Objective Type]:** Approximate XP awarded for Minor, Standard, Major, or Epic Objectives. Calculated as:
    *   `Implied_Std_Obj_XP = XP to Lvl Up / Std. Objs to Lvl Up`
    *   `Avg. XP Minor Obj. = Implied_Std_Obj_XP * 0.3` (rounded)
    *   `Avg. XP Std. Obj. = Implied_Std_Obj_XP * 1.0` (rounded)
    *   `Avg. XP Major Obj. = Implied_Std_Obj_XP * 1.5` (rounded)
    *   `Avg. XP Epic Obj. = Implied_Std_Obj_XP * 2.5` (rounded)
*   **Base Player Integrity:** Player's Max Integrity from base value (100) and automatic per-level gains (100 + 10 * (Lvl-1)).
*   **Avg. Gear Integrity Bonus:** An assumed average Integrity bonus from thematic protective measures/gear appropriate for the character's level, acquired within the current session.
*   **Total Effective Integrity:** The sum of `Base Player Integrity` and `Avg. Gear Integrity Bonus`. This total value is used for calculating `... Setbacks to Overwhelm Player` columns.
*   **Base Player Willpower:** Player's Max Willpower from base value (50) and automatic per-level gains (50 + 5 * (Lvl-1)).
*   **Avg. Player Output Magnitude (Base):** The character's average base effectiveness or impact per significant action/ability use for this level, *before* Aptitude modifier and Strain effects. This could be damage in combat, persuasiveness in dialogue, efficiency in a task, or potency of a special ability.

**Challenge Benchmarks (Base Values):**
The following represent *base values before player's Aptitude/Resilience modifiers or dynamic Strain/Condition effects are applied*. Multipliers for Significant/Apex Challenges relative to Common are: Significant (Difficulty ~2.2x, Setback ~1.6x), Apex (Difficulty ~4.5x, Setback ~2.2x).

*   **CC Difficulty / Resistance:** Common Challenge's baseline toughness, complexity, or resistance to being overcome. *Calculated as: `Avg. Player Output Magnitude (Base) * Player Efforts to Overcome CC`.*
*   **Player Efforts to Overcome CC:** Avg. Player significant actions/uses of Output Magnitude needed to overcome a Common Challenge. (Values taken from your example table's intent).
*   **CC Setback Magnitude (Base):** Common Challenge's average base negative impact (e.g., Integrity loss, Willpower drain, progress reversal, increased complication) if the player fails an action or faces direct opposition. *Calculated as: `Total Effective Integrity / CC Setbacks to Overwhelm Player`.*
*   **CC Setbacks to Overwhelm Player:** Avg. number of Common Challenge setbacks needed to deplete `Total Effective Integrity`. (Values taken from your example table's intent).

*   **SC Difficulty / Resistance, Player Efforts to Overcome SC, SC Setback Magnitude (Base), SC Setbacks to Overwhelm Player:** Derived from CC values using multipliers (SC Diff = CC Diff * 2.2; SC Setback = CC Setback * 1.6).
*   **AC Difficulty / Resistance, Player Efforts to Overcome AC, AC Setback Magnitude (Base), AC Setbacks to Overwhelm Player:** Derived from CC values using multipliers (AC Diff = CC Diff * 4.5; AC Setback = CC Setback * 2.2).
*
--- END OF FILE leveling.md ---
