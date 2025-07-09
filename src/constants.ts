import { Condition } from './types';
import { Character } from './types';

export const ENCOUNTER_BUILDER_VIEW_TYPE = "dh-encounter-builder-view";

export const DAGGERHEART_CONDITIONS: Condition[] = [
    { name: "Hidden", description: "While you're out of sight from all enemies and they don't otherwise know your location, you gain the Hidden condition. Any rolls against a Hidden adversary have disadvantage. After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." },
    { name: "Restrained", description: "Restrained characters can't move, but you can still take actions from their current position." },
    { name: "Vulnerable", description: "When a adversary is Vulnerable, all rolls targeting them have advantage." }
];

// Custom Event Names
export const EVENT_REQUEST_CONDITION_MENU = 'dh-request-condition-menu';
export const EVENT_REMOVE_CONDITION = 'dh-remove-condition';
export const EVENT_REMOVE_INSTANCE = 'dh-remove-instance';
export const EVENT_EDIT_INSTANCE = 'dh-edit-instance';
export const EVENT_CREATE_COUNTDOWN = 'dh-create-countdown';
export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

export const TRAIT_NAMES: (keyof Character['traits'])[] = ['Strength', 'Agility', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];
