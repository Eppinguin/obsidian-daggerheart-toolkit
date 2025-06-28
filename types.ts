import type { ITheme } from 'dddice-js';

// --- STATBLOCK & ENCOUNTER TYPES ---
export interface StatblockAttack { name: string; range: string; damage: string; modifier: string | number; }
export interface StatblockExperience { [key: string]: number; }
export interface StatblockHpStress { hp: number; stress: number; minor_hp?: number | null; major_hp?: number | null; severe_hp?: number | null; }
export interface StatblockFeature { name: string; type: string; parsedCost?: string; countdown?: string | null; description: string; }
export interface Condition { name: string; description: string; }
export interface StatblockData { name: string; category: 'adversary' | 'environment'; image?: string; tier?: number | string; type?: string; description?: string; attack?: StatblockAttack; difficulty?: number | string; experience?: StatblockExperience | string; motives_tactics?: string[] | string; impulses?: string; potential_adversaries?: string; hp_stress: StatblockHpStress; features?: StatblockFeature[]; sourceFile?: string; isCustom?: boolean; }
export interface AdversaryInstance extends StatblockData { id: string; groupId: string; currentHp: number; currentStress: number; displayName: string; conditions?: Condition[]; }
export interface SavedEncounter { id: string; name: string; adversaries: AdversaryInstance[]; adversaryGroupOrder: string[]; }
export interface Countdown { id: string; name: string; value: number; }

// --- COMPENDIUM DATA TYPES ---
export interface CompendiumFeature { name: string; description: string; }
export interface CompendiumAncestry { _type: 'ancestry'; id: string; name: string; description: string; primaryFeature: CompendiumFeature; secondaryFeature: CompendiumFeature; }
export interface CompendiumCommunity { _type: 'community'; id: string; name: string; description: string; feature: CompendiumFeature; }
export interface CompendiumSubclass { _type: 'subclass'; id: string; name: string; description: string; spellTrait: string | null; foundationFeatures: CompendiumFeature[]; specializationFeatures: CompendiumFeature[]; masteryFeatures: CompendiumFeature[]; }

export interface CompendiumClass {
    _type: 'class';
    id: string;
    name: string;
    description: string;
    domains: string[];
    initialEvasion: number;
    initialHitPoints: number;
    hopeFeature: CompendiumFeature;
    features: CompendiumFeature[];
    subclasses: { _type: 'reference', _key: 'role/subclass', value: string }[];
    initialInventory: (ArmorItem | WeaponItem | GenericItem)[];
    _narrative?: {
        description: string;
        backgrounds: { question: string }[];
        connections: { question: string }[];
    };
}
export interface DomainCard { _type: 'domainCard'; id: string; name: string; level: number; domain: string; type: string; recallCost: number; description: string; }
export interface Feature { _type: 'feature'; id: string; name: string; description: string; notes: string[]; modifiers: any | null; }
export interface ArmorItem { _type: 'armor'; id: string; name: string; description?: string; baseThresholds: { major: number; severe: number; }; baseScore: number; features?: string[]; tier: number; }
export interface WeaponItem { _type: 'weapon'; id: string; name: string; description?: string; trait: string; range: string; damageDice: string; damageType: string; features?: string[]; burden: 'One-Handed' | 'Two-Handed'; tier: number; }
export interface GenericItem { _type: 'item'; id: string; name: string; description?: string; }
export type CompendiumItem = ArmorItem | WeaponItem | GenericItem;

// --- CHARACTER DATA MODEL ---
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
    evasion: number;
    traits: { Strength: Trait; Agility: Trait; Finesse: Trait; Instinct: Trait; Presence: Trait; Knowledge: Trait; };
    hitPoints: DynamicResource;
    stress: DynamicResource;
    hope: DynamicResource;
    armorSlots: DynamicResource;
    damageThresholds: DamageThresholds;
    gold: Gold;
    experiences: Experience[];
    features: (Feature | DomainCard)[];
    inventory: InventoryItem[];
    equippedArmorId: string | null;
    equippedWeaponIds: string[];
    background?: { question: string; answer: string; }[];
    connections?: { question: string; answer: string; }[];
    conditions: Condition[];
}

export interface Trait { _type: 'trait'; value: number; locked: boolean; }
export interface DynamicResource { _type: 'dynamicResource'; max: number; current: number; }
export interface DamageThresholds { _type: 'damageThresholds'; major: number; severe: number; }
export interface Gold { _type: 'gold'; handfuls: number; bags: number; chests: number; }
export interface Experience { _type: 'experience'; id: string; name: string; value: number; description: string | null; }
export type InventoryItem = (ArmorItem | WeaponItem | GenericItem) & { instanceId: string; quantity: number; };

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
    compendiumFolder: string;
    savedEncounters: SavedEncounter[];
    useSrdAdversaries: boolean;
    useSrdEnvironments: boolean;
    userCompendiumFile: string;
    showDescriptionOnCards: boolean;
    showFeatureDetailsOnCards: boolean;
    enableFearTracker: boolean;
    fearCounter: number;
    enableCountdownTracker: boolean;
    countdowns: Countdown[];
    enableEncounterBudget: boolean;
    encounterBudgetConfig: EncounterBudgetConfig;
    isCompendiumVisible: boolean;

    // Dice Rolling Settings
    diceProvider: 'dice-roller' | 'dddice';
    enableDiceRoller: boolean;
    useGraphicalDice: boolean;
    dddice: DddiceSettings;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    compendiumFolder: '',
    savedEncounters: [],
    useSrdAdversaries: true,
    useSrdEnvironments: true,
    userCompendiumFile: 'User-Adversaries.json',
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: false,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    enableEncounterBudget: false,
    isCompendiumVisible: true,
    encounterBudgetConfig: { playerCount: 4, isEasier: false, isHarder: false, isDamageBoosted: false, useLowerTier: false },

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
