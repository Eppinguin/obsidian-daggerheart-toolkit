// types.ts

export interface StatblockAttack {
    name: string;
    range: string;
    damage: string;
    modifier: string | number;
}

export interface StatblockExperience {
    [key: string]: number; // e.g., conquest: 3, history: 2
}

export interface StatblockHpStress {
    hp: number;
    stress: number;
    minor_hp?: number | null;
    major_hp?: number | null;
    severe_hp?: number | null; // Retained for completeness, though not directly in new threshold display
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
    title?: string;
    tier?: number | string;
    type?: string; // e.g., SOLO, HORDE, etc.
    description?: string;
    attack?: StatblockAttack;
    difficulty?: number | string;
    experience?: StatblockExperience;
    motives_tactics?: string[];
    hp_stress: StatblockHpStress;
    features?: StatblockFeature[];
    sourceFile?: string; // Path to the source file for this statblock
    image?: string; // Optional image URL/path for the card header
}

export interface CreatureInstance extends StatblockData {
    id: string; // Unique ID for this instance, e.g., "brawny-zombie-1"
    currentHp: number;
    currentStress: number;
    displayName: string; // e.g., "Brawny Zombie #1"
}

export interface EncounterData {
    name: string;
    creatures: CreatureInstance[];
}

export interface DaggerheartPluginSettings {
    compendiumFolder: string;
}

export const DEFAULT_SETTINGS: DaggerheartPluginSettings = {
    compendiumFolder: '',
};
