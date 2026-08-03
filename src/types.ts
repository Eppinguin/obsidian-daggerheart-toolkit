import type { ITheme } from 'dddice-js';

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
    parsedCost?: string;
    countdown?: string | null;
    description: string;
}

export interface Condition {
    name: string;
    description: string;
    isCustom?: boolean;
}

export interface StatblockData {
    name: string;
    category: 'adversary' | 'environment';
    image?: string;
    tier?: number | string;
    type?: string;
    description?: string;
    attack?: StatblockAttack;
    difficulty?: number | string;
    experience?: StatblockExperience | string;
    motives_tactics?: string[] | string;
    impulses?: string;
    potential_adversaries?: string;
    hp_stress: StatblockHpStress;
    features?: StatblockFeature[];
    sourceFile?: string;
    isCustom?: boolean;
}

export interface AdversaryInstance extends StatblockData {
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
    adversaries: AdversaryInstance[];
    adversaryGroupOrder: string[];
}

export interface Countdown {
    id: string;
    name: string;
    value: number;
}

export type AllCompendiumData = StatblockData;

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

export interface EncounterBudgetConfig {
    playerCount: number;
    isEasier: boolean;
    isHarder: boolean;
    isDamageBoosted: boolean;
    useLowerTier: boolean;
}

export interface DaggerheartPluginSettings {
    compendiumFolder: string;
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
    isCompendiumVisible: boolean;
    encounterBudgetConfig: EncounterBudgetConfig;
    enableEncounterView: boolean;
    diceProvider: 'dice-roller' | 'dddice';
    enableDiceRoller: boolean;
    useGraphicalDice: boolean;
    dddice: DddiceSettings;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    compendiumFolder: '',
    useSrdAdversaries: true,
    useSrdEnvironments: true,
    userCompendiumFile: 'user-adversaries.json',
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: false,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    enableEncounterBudget: false,
    isCompendiumVisible: true,
    encounterBudgetConfig: {
        playerCount: 4,
        isEasier: false,
        isHarder: false,
        isDamageBoosted: false,
        useLowerTier: false,
    },
    enableEncounterView: true,
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
