import type { ITheme } from 'dddice-js';

// --- NEW: EFFECTS ENGINE & CALCULATION TYPES ---

/**
 * A universal modifier that can be applied to a CalculatedStat.
 * It carries all information about its origin and effect.
 * This is used INTERNALLY by the effects engine.
 */
export interface IModifier {
    sourceId: string;       // The unique ID of the source ActiveEffect
    sourceName: string;     // Human-readable source name for tooltips
    type: 'bonus' | 'penalty' | 'override' | '+' | '-' | '=';
    value: any; // Can be a number or a keyword object
    condition: {
        target: string;
        operator: string;
        value: any;
    } | null;
}

/**
 * Interface for a "smart" stat that calculates its value on demand.
 * This is the new, primary way all mutable stats are represented.
 */
export interface ICalculatedStat {
    base: number;
    overrideValue: number | null;
    locked?: boolean;

    addModifier(modifier: IModifier): void;
    removeModifiersBySource(sourceId: string): void;
    getValue(characterContext: Character): number;
    getBreakdown(characterContext: Character): {
        base: number;
        final: number;
        activeModifiers: IModifier[];
    };
}

export interface WeaponDamageComponents {
    baseDice: string; // e.g., "d6", "d10", "1d8"
    baseModifier: number; // e.g., 0, 3, -1
    damageType: string; // e.g., "phy", "mag"
    numberOfDice: ICalculatedStat;
    flatBonus: ICalculatedStat;
}

/**
 * A single, specific change to a single stat, as parsed from an effect string.
 * This is the direct OUTPUT of the Peggy parser and the INPUT for the effects manager.
 */
export interface Modification {
    target: string; // e.g., 'evasion', 'hp.max'
    targetScope: any; // Can be 'character' or a complex object for item targeting
    type: 'bonus' | 'penalty' | 'override' | '+' | '-' | '=';
    value: any; // Can be a number, a string (dice formula), or a keyword object
    condition: {
        target: string;
        operator: string;
        value: any;
    } | null;
}

/**
 * A live, active effect on a character sheet, created from a source.
 * It acts as a container for the modifications it provides.
 */
export interface ActiveEffect {
    id: string; // Unique instance ID for this effect on the character
    sourceName: string; // Human-readable source, e.g., "I am the Weapon"
    sourceId: string; // The ID of the compendium item it came from
    modifications: Modification[]; // The raw parsed modifications
    isEnabled: boolean; // User-controllable toggle
}

/**
 * A wrapper for character resources like HP and Stress, which have a calculated maximum.
 * MODIFIED to use ICalculatedStat.
 */
export interface CharacterResource {
    current: number;
    max: ICalculatedStat;
}


// --- STATBLOCK & ENCOUNTER TYPES --- (Unchanged)
export interface StatblockAttack { name: string; range: string; damage: string; modifier: string | number; }
export interface StatblockExperience { [key: string]: number; }
export interface StatblockHpStress { hp: number; stress: number; minor_hp?: number | null; major_hp?: number | null; severe_hp?: number | null; }
export interface StatblockFeature { name: string; type: string; parsedCost?: string; countdown?: string | null; description: string; effects?: string[]; }
export interface ConditionDefinition {
    name: string;
    description: string;
    isCustom?: boolean;
    effects?: string[];
}
export interface Condition extends ConditionDefinition {
    instanceId: string;
}
export interface StatblockData { name: string; category: 'adversary' | 'environment'; image?: string; tier?: number | string; type?: string; description?: string; attack?: StatblockAttack; difficulty?: number | string; experience?: StatblockExperience | string; motives_tactics?: string[] | string; impulses?: string; potential_adversaries?: string; hp_stress: StatblockHpStress; features?: StatblockFeature[]; sourceFile?: string; isCustom?: boolean; effects?: string[]; }
export interface AdversaryInstance extends StatblockData { id: string; groupId: string; currentHp: number; currentStress: number; displayName: string; conditions?: Condition[]; }
export interface SavedEncounter { id: string; name: string; adversaries: AdversaryInstance[]; adversaryGroupOrder: string[]; }
export interface Countdown { id: string; name: string; value: number; }

// --- RAW COMPENDIUM JSON TYPES --- (Unchanged)
export interface JsonFeat { name: string; text: string; effects?: string[]; }
export interface JsonAncestry { name: string; description: string; feats: JsonFeat[]; isCustom?: boolean; effects?: string[]; }
export interface JsonCommunity { name: string; description: string; note: string; feats: JsonFeat[]; isCustom?: boolean; effects?: string[]; }
export interface JsonSubclass { name: string; description: string; spellcast_trait?: string; foundations: JsonFeat[]; specializations: JsonFeat[]; masteries: JsonFeat[]; isCustom?: boolean; effects?: string[]; }
export interface JsonClass {
    name: string;
    description: string;
    domain_1: string;
    domain_2: string;
    evasion: string;
    hp: string;
    items: string;
    hope_feat_name: string;
    hope_feat_text: string;
    subclass_1: string;
    subclass_2: string;
    class_feats: JsonFeat[];
    backgrounds: { question: string; }[];
    connections: { question: string; }[];
    isCustom?: boolean;
    suggested_traits?: string;
    suggested_primary?: string;
    suggested_secondary?: string;
    suggested_armor?: string;
    extras?: string;
    effects?: string[];
}
export interface JsonAbility { name: string; level: string; domain: string; type: string; recall: string; text: string; isCustom?: boolean; effects?: string[]; }
export interface JsonArmor { name: string; tier: string; base_thresholds: string; base_score: string; feat_name?: string; feat_text?: string; isCustom?: boolean; _type?: 'armor'; effects?: string[]; }
export interface JsonWeapon { name: string; primary_or_secondary: string; tier: string; physical_or_magical: string; trait: string; range: string; damage: string; burden: string; feat_name?: string; feat_text?: string; isCustom?: boolean; _type?: 'weapon'; effects?: string[]; }
export interface JsonItem { roll?: string; name: string; description: string; isCustom?: boolean; _type?: 'item'; effects?: string[]; }
export interface JsonConsumable { roll: string; name: string; description: string; isCustom?: boolean; _type?: 'consumable'; effects?: string[]; }

// --- CONSOLIDATED COMPENDIUM EDITOR TYPES --- (Unchanged)
export const ALL_COMPENDIUM_TYPES = [
    'Class', 'Subclass', 'Ancestry', 'Community',
    'Ability',
    'Weapon', 'Armor', 'Item', 'Consumable',
    'Adversary', 'Environment'
] as const;
export type CompendiumType = typeof ALL_COMPENDIUM_TYPES[number];

export type AllCompendiumData =
    | JsonClass
    | JsonSubclass
    | JsonAncestry
    | JsonCommunity
    | JsonAbility
    | JsonWeapon
    | JsonArmor
    | JsonItem
    | JsonConsumable
    | StatblockData;

// --- PROCESSED/APPLICATION-LEVEL TYPES --- (Unchanged, unless they used old CalculatedStat)
export interface CompendiumFeature { name: string; description: string; effects?: string[]; }
export interface DomainCard { _type: 'domainCard'; id: string; name: string; level: number; domain: string; type: string; recall: number; description: string; isCustom?: boolean; effects?: string[]; }

export interface TokenTrackerState {
    id: string;
    name?: string;
    tokens: number;
    max: number;
}

export interface InherentFeature {
    id: string;
    name: string;
    description: string;
    source: 'Class' | 'Subclass' | 'Ancestry' | 'Community';
    effects?: string[];
}
export interface Beastform {
    name: string;
    examples: string;
    tier: number;
    attributes: { trait: 'Strength' | 'Finesse' | 'Instinct' | 'Presence' | 'Knowledge' | 'Agility' | 'Evasion'; bonus: number }[];
    attack: {
        range: string;
        trait: string;
        dice: string;
        type: string;
    };
    advantages: string;
    features: { name: string; description: string }[];
    effects?: string[];
}
export interface Stances {
    name: string;
    tier: number;
    description: string;
    effects?: string[];
}

// Base Item types with _type property
export type ArmorItem = JsonArmor & { _type: 'armor'; };
export type WeaponItem = JsonWeapon & { _type: 'weapon'; };
export type GenericItem = JsonItem & { _type: 'item'; };
export type ConsumableItem = JsonConsumable & { _type: 'consumable'; };

export type CompendiumItem = (ArmorItem | WeaponItem | GenericItem | ConsumableItem) & { isCustom?: boolean };


// --- CHARACTER DATA MODEL ---
// This section contains the most significant changes.

export interface AvatarTransform {
    scale: number;
    x: number;
    y: number;
}

export interface Character {
    id: string;
    'dg-character': boolean;
    _type: 'character';
    name: string;
    nameAlternate?: string | null;
    notes?: string;
    pronouns: { _type: 'pronouns'; subject: string; object: string; };
    level: number;
    ancestryId: string;
    communityId: string;
    classId: string;
    subclassId: string;
    multiclassClassId?: string | null;
    multiclassSubclassId?: string | null;
    multiclassDomainId?: string | null;
    spellCastTrait?: string | null;

    // --- MODIFIED: All calculable stats now use ICalculatedStat ---
    proficiency: ICalculatedStat;
    evasion: ICalculatedStat;
    damageThresholds: {
        major: ICalculatedStat;
        severe: ICalculatedStat;
    };

    // --- MODIFIED: Resources now use CharacterResource with ICalculatedStat ---
    hitPoints: CharacterResource;
    stress: CharacterResource;
    hope: CharacterResource;
    armorSlots: CharacterResource;

    // Optional temporary resources, still using a simple structure as they are not affected by the main engine.
    temporaryHitPoints?: DynamicResource;
    temporaryStress?: DynamicResource;
    temporaryArmorSlots?: DynamicResource;

    traits: {
        Strength: ICalculatedStat;
        Agility: ICalculatedStat;
        Finesse: ICalculatedStat;
        Instinct: ICalculatedStat;
        Presence: ICalculatedStat;
        Knowledge: ICalculatedStat;
    };
    unarmedDamage: WeaponDamageComponents;

    gold: Gold;
    experiences: Experience[];
    features: InherentFeature[];
    loadout: DomainCard[];
    vault: DomainCard[];

    inventory: InventoryItem[];
    equippedArmorId: string | null;
    equippedWeaponIds: string[];
    background?: { question: string; answer: string; }[];
    connections?: { question: string; answer: string; }[];
    levelUpHistory: { [level: number]: LevelUpSelection };
    conditions: Condition[];
    trackers?: { [cardId: string]: TokenTrackerState[] };
    avatarUrl?: string | null;
    avatarTransform?: AvatarTransform;
    accentColor?: string;
    activeBeastformName?: string | null;
    equippedStances?: string[];
    activeStance?: string;

    // The central list of all active rules affecting this character.
    activeEffects: ActiveEffect[];
}

// --- MODIFIED: Sub-types for the character model ---

export interface DynamicResource { _type: 'dynamicResource'; max: number; current: number; }
export interface Gold { _type: 'gold'; handfuls: number; bags: number; chests: number; } // Gold is not a calculated stat
export interface Experience { _type: 'experience'; id: string; name: string; value: number; }


export interface LevelUpSelection {
    advancements: ({ id: string; choices: string[] } | null)[];
    domainCardId: string | null;
    newExperienceName?: string;
}

export type InventoryItem = {
    instanceId: string;
    quantity: number;
    name: string;
    description?: string;
    isCustom?: boolean;
    effects?: string[];
} & ({
    _type: 'armor';
    // MODIFIED: Armor stats now use ICalculatedStat
    baseThresholds: { major: ICalculatedStat; severe: ICalculatedStat; };
    baseScore: ICalculatedStat;
    features?: CompendiumFeature[];
    tier: number;
} | {
    _type: 'weapon';
    primaryOrSecondary: 'Primary' | 'Secondary';
    trait: string;
    range: string;
    damageComponents: WeaponDamageComponents;
    features?: CompendiumFeature[];
    burden: 'One-Handed' | 'Two-Handed';
    tier: number;
} | {
    _type: 'item';
} | {
    _type: 'consumable';
    roll: string;
});


// --- PLUGIN SETTINGS --- (Unchanged)
export interface DddiceRoom {
    slug: string;
    name: string;
}

export interface DddiceSettings {
    apiKey: string;
    room: string | null;
    theme: string | null;
    hopeTheme: string | null;
    fearTheme: string | null;
    renderInObsidian: boolean;
    rooms?: DddiceRoom[];
    themes?: ITheme[];
}

export interface EncounterBudgetConfig { playerCount: number; isEasier: boolean; isHarder: boolean; isDamageBoosted: boolean; useLowerTier: boolean; }

export interface DaggerheartPluginSettings {
    activeCharacterId: string | null;
    compendiumFolder: string;
    useSrdAdversaries: boolean;
    useSrdEnvironments: boolean;
    // User file settings
    userCompendiumFile: string; // For adversaries and environments
    userAbilitiesFile: string;
    userClassesFile: string;
    userSubclassesFile: string;
    userAncestriesFile: string;
    userCommunitiesFile: string;
    userArmorFile: string;
    userWeaponsFile: string;
    userItemsFile: string;
    userConsumablesFile: string;
    // UI Settings
    showDescriptionOnCards: boolean;
    showFeatureDetailsOnCards: boolean;
    enableFearTracker: boolean;
    fearCounter: number;
    enableCountdownTracker: boolean;
    countdowns: Countdown[];
    enableEncounterBudget: boolean;
    isCompendiumVisible: boolean;
    encounterBudgetConfig: EncounterBudgetConfig;
    enableEncounterView: boolean;
    enableCharacterSheet: boolean;
    // Dice Rolling Settings
    diceProvider: 'dice-roller' | 'dddice';
    enableDiceRoller: boolean;
    useGraphicalDice: boolean;
    dddice: DddiceSettings;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    activeCharacterId: null,
    compendiumFolder: '',
    useSrdAdversaries: true,
    useSrdEnvironments: true,
    userCompendiumFile: 'user-adversaries.json',
    userAbilitiesFile: 'user-abilities.json',
    userClassesFile: 'user-classes.json',
    userSubclassesFile: 'user-subclasses.json',
    userAncestriesFile: 'user-ancestries.json',
    userCommunitiesFile: 'user-communities.json',
    userArmorFile: 'user-armor.json',
    userWeaponsFile: 'user-weapons.json',
    userItemsFile: 'user-items.json',
    userConsumablesFile: 'user-consumables.json',
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: true,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    enableEncounterBudget: true,
    isCompendiumVisible: true,
    encounterBudgetConfig: { playerCount: 4, isEasier: false, isHarder: false, isDamageBoosted: false, useLowerTier: false },
    enableEncounterView: true,
    enableCharacterSheet: true,
    diceProvider: 'dice-roller',
    enableDiceRoller: false,
    useGraphicalDice: false,
    dddice: {
        apiKey: '',
        room: null,
        theme: null,
        hopeTheme: null,
        fearTheme: null,
        renderInObsidian: true,
    },
};