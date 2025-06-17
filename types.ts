export interface StatblockAttack {
    name: string;
    range: string;
    damage: string;
    modifier: string | number;
}

export interface StatblockExperience {
    [key: string]: number;
}

export interface StatblockHpStress {
    hp: number;
    stress: number;
    minor_hp?: number | null;
    major_hp?: number | null;
    severe_hp?: number | null;
}

export interface StatblockFeature {
    name: string;
    type: string;
    cost?: string | number | null;
    countdown?: string | null;
    description: string;
}

export interface Condition {
    name: string;
    description: string;
}

export interface StatblockData {
    name: string;
    image?: string;
    tier?: number | string;
    type?: string;
    description?: string;
    attack?: StatblockAttack;
    difficulty?: number | string;
    experience?: StatblockExperience | string;
    motives_tactics?: string[] | string;
    hp_stress: StatblockHpStress;
    features?: StatblockFeature[];
    sourceFile?: string;
    isCustom?: boolean; // Flag for user-created adversaries
}

export interface CreatureInstance extends StatblockData {
    id: string;
    groupId: string;
    currentHp: number;
    currentStress: number;
    displayName: string;
    conditions?: Condition[];
}

export interface SavedEncounter {
    id: string;
    name: string;
    creatures: CreatureInstance[];
}

export interface Countdown {
    id: string;
    name: string;
    value: number;
}

export interface EncounterBudgetConfig {
    playerCount: number;
    isEasier: boolean;
    isHarder: boolean;
    isDamageBoosted: boolean;
    useLowerTier: boolean;
}

export interface DaggerheartPluginSettings {
    compendiumFolder: string;
    savedEncounters: SavedEncounter[];
    useSrdAdversaries: boolean;
    userCompendiumFile: string; // New setting for the user's JSON compendium
    showDescriptionOnCards: boolean;
    showFeatureDetailsOnCards: boolean;
    enableFearTracker: boolean;
    fearCounter: number;
    enableCountdownTracker: boolean;
    countdowns: Countdown[];
    enableDiceRoller: boolean;
    useGraphicalDice: boolean;
    enableEncounterBudget: boolean;
    encounterBudgetConfig: EncounterBudgetConfig;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    compendiumFolder: '',
    savedEncounters: [],
    useSrdAdversaries: true,
    userCompendiumFile: 'User-Adversaries.json',
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: false,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    enableDiceRoller: false,
    useGraphicalDice: false,
    enableEncounterBudget: false,
    encounterBudgetConfig: {
        playerCount: 4,
        isEasier: false,
        isHarder: false,
        isDamageBoosted: false,
        useLowerTier: false,
    },
};