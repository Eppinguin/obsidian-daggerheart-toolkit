import type { ITheme } from 'dddice-js';

// --- STATBLOCK & ENCOUNTER TYPES ---
export interface StatblockAttack { name: string; range: string; damage: string; modifier: string | number; }
export interface StatblockExperience { [key: string]: number; }
export interface StatblockHpStress { hp: number; stress: number; minor_hp?: number | null; major_hp?: number | null; severe_hp?: number | null; }
export interface StatblockFeature { name: string; type: string; parsedCost?: string; countdown?: string | null; description: string; }
export interface Condition { name: string; description: string; isCustom?: boolean; }
export interface StatblockData { name: string; category: 'adversary' | 'environment'; image?: string; tier?: number | string; type?: string; description?: string; attack?: StatblockAttack; difficulty?: number | string; experience?: StatblockExperience | string; motives_tactics?: string[] | string; impulses?: string; potential_adversaries?: string; hp_stress: StatblockHpStress; features?: StatblockFeature[]; sourceFile?: string; isCustom?: boolean; }
export interface AdversaryInstance extends StatblockData { id: string; groupId: string; currentHp: number; currentStress: number; displayName: string; conditions?: Condition[]; }
export interface SavedEncounter { id: string; name: string; adversaries: AdversaryInstance[]; adversaryGroupOrder: string[]; }
export interface Countdown { id: string; name: string; value: number; }

// --- RAW COMPENDIUM JSON TYPES ---
export interface JsonFeat { name: string; text: string; }
export interface JsonAncestry { name: string; description: string; feats: JsonFeat[]; isCustom?: boolean; }
export interface JsonCommunity { name: string; description: string; note: string; feats: JsonFeat[]; isCustom?: boolean; }
export interface JsonSubclass { name: string; description: string; spellcast_trait?: string; foundations: JsonFeat[]; specializations: JsonFeat[]; masteries: JsonFeat[]; isCustom?: boolean; }
export interface JsonClass { name: string; description: string; domain_1: string; domain_2: string; evasion: string; hp: string; items: string; hope_feat_name: string; hope_feat_text: string; subclass_1: string; subclass_2: string; class_feats: JsonFeat[]; backgrounds: { question: string; }[]; connections: { question: string; }[]; isCustom?: boolean; }
export interface JsonAbility { name: string; level: string; domain: string; type: string; recall: string; text: string; isCustom?: boolean; }
export interface JsonArmor { name: string; tier: string; base_thresholds: string; base_score: string; feat_name?: string; feat_text?: string; isCustom?: boolean; _type?: 'armor'; }
export interface JsonWeapon { name: string; primary_or_secondary: string; tier: string; physical_or_magical: string; trait: string; range: string; damage: string; burden: string; feat_name?: string; feat_text?: string; isCustom?: boolean; _type?: 'weapon'; }
export interface JsonItem { roll?: string; name: string; description: string; isCustom?: boolean; _type?: 'item'; }
export interface JsonConsumable { roll: string; name: string; description: string; isCustom?: boolean; _type?: 'consumable'; }

// --- CONSOLIDATED COMPENDIUM EDITOR TYPES ---
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

// --- PROCESSED/APPLICATION-LEVEL TYPES ---
export interface CompendiumFeature { name: string; description: string; }
export interface DomainCard { _type: 'domainCard'; id: string; name: string; level: number; domain: string; type: string; recall: number; description: string; isCustom?: boolean; }

// Base Item types with _type property
export type ArmorItem = JsonArmor & { _type: 'armor'; };
export type WeaponItem = JsonWeapon & { _type: 'weapon'; };
export type GenericItem = JsonItem & { _type: 'item'; };
export type ConsumableItem = JsonConsumable & { _type: 'consumable'; };

export type CompendiumItem = (ArmorItem | WeaponItem | GenericItem | ConsumableItem) & { isCustom?: boolean };


// --- CHARACTER DATA MODEL ---
// This model should store data in a processed, ready-to-use format (e.g., numbers instead of strings)
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
    proficiency: number;
    ancestryId: string;
    communityId: string;
    classId: string;
    subclassId: string;
    multiclassClassId?: string | null;
    multiclassSubclassId?: string | null;
    multiclassDomainId?: string | null;
    evasion: number;
    traits: { Strength: Trait; Agility: Trait; Finesse: Trait; Instinct: Trait; Presence: Trait; Knowledge: Trait; };
    hitPoints: DynamicResource;
    stress: DynamicResource;
    hope: DynamicResource;
    armorSlots: DynamicResource;
    damageThresholds: DamageThresholds;
    gold: Gold;
    experiences: Experience[];
    features: (DomainCard)[]; // This is the LOADOUT
    vault: (DomainCard)[]; // ADD THIS LINE for the VAULT
    inventory: InventoryItem[];
    equippedArmorId: string | null;
    equippedWeaponIds: string[];
    background?: { question: string; answer: string; }[];
    connections?: { question: string; answer: string; }[];
    levelUpHistory: { [level: number]: LevelUpSelection };
    conditions: Condition[];
    avatarUrl?: string | null;
    avatarTransform?: AvatarTransform;
}

export interface Trait { _type: 'trait'; value: number; locked: boolean; }
export interface DynamicResource { _type: 'dynamicResource'; max: number; current: number; }
export interface DamageThresholds { _type: 'damageThresholds'; major: number; severe: number; }
export interface Gold { _type: 'gold'; handfuls: number; bags: number; chests: number; }
export interface Experience { _type: 'experience'; id: string; name: string; value: number; }


export interface LevelUpSelection {
    advancements: ({ id: string; choices: string[] } | null)[];
    domainCardId: string | null;
    newExperienceName?: string;
}

// InventoryItem on the Character Sheet is the processed version of a CompendiumItem
export type InventoryItem = {
    instanceId: string;
    quantity: number;
    name: string;
    description?: string;
    isCustom?: boolean;
} & ({
    _type: 'armor';
    baseThresholds: { major: number; severe: number; };
    baseScore: number;
    features?: CompendiumFeature[];
    tier: number;
} | {
    _type: 'weapon';
    primaryOrSecondary: 'Primary' | 'Secondary';
    trait: string;
    range: string;
    damage: string;
    damageDice: string;
    damageType: string;
    features?: CompendiumFeature[];
    burden: 'One-Handed' | 'Two-Handed';
    tier: number;
} | {
    _type: 'item';
} | {
    _type: 'consumable';
    roll: string;
});


// --- PLUGIN SETTINGS ---
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
    rooms: DddiceRoom[];
    themes: ITheme[];
}

export interface EncounterBudgetConfig { playerCount: number; isEasier: boolean; isHarder: boolean; isDamageBoosted: boolean; useLowerTier: boolean; }

export interface DaggerheartPluginSettings {
    activeCharacterId: string | null;
    compendiumFolder: string;
    savedEncounters: SavedEncounter[];
    useSrdAdversaries: boolean;
    useSrdEnvironments: boolean;
    userCompendiumFile: string;
    userAbilitiesFile: string;
    userClassesFile: string;
    userSubclassesFile: string;
    userAncestriesFile: string;
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
    savedEncounters: [],
    useSrdAdversaries: true,
    useSrdEnvironments: true,
    userCompendiumFile: 'User-Adversaries.json',
    userAbilitiesFile: 'user-abilities.json',
    userClassesFile: 'user-classes.json',
    userSubclassesFile: 'user-subclasses.json',
    userAncestriesFile: 'user-ancestries.json',
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: false,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    enableEncounterBudget: false,
    isCompendiumVisible: true,
    encounterBudgetConfig: { playerCount: 4, isEasier: false, isHarder: false, isDamageBoosted: false, useLowerTier: false },
    enableEncounterView: true,
    enableCharacterSheet: true,

    // Dice Rolling Settings
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
        rooms: [],
        themes: [],
    },
};
