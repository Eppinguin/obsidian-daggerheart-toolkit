// types.ts

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
}

export interface CreatureInstance extends StatblockData {
    id: string;
    groupId: string;
    currentHp: number;
    currentStress: number;
    displayName: string;
}

export interface SavedEncounter {
    id: string;
    name: string;
    creatures: CreatureInstance[];
}

export interface DaggerheartPluginSettings {
    compendiumFolder: string;
    savedEncounters: SavedEncounter[];
    useSrdAdversaries: boolean;
    showDescriptionOnCards: boolean;
    showFeatureDetailsOnCards: boolean;
    enableFearTracker: boolean;
    fearCounter: number;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    compendiumFolder: '',
    savedEncounters: [],
    useSrdAdversaries: true,
    showDescriptionOnCards: false,
    showFeatureDetailsOnCards: true,
    enableFearTracker: false,
    fearCounter: 0
};
