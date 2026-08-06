import { Condition } from './types';

export const ENCOUNTER_BUILDER_VIEW_TYPE = 'dh-encounter-builder-view';

/** Obsidian colour families available to condition chips (see .dh-cond-* rules). */
export const CONDITION_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;

/**
 * The three standard conditions defined by the Daggerheart SRD.
 * Descriptions are quoted from the SRD "Conditions" section.
 */
export const DAGGERHEART_CONDITIONS: Condition[] = [
    {
        name: 'Hidden',
        key: 'hidden',
        icon: 'eye-off',
        color: 'purple',
        description:
            "While you're out of sight from all enemies and they don't otherwise know your location, you gain the Hidden condition. Any rolls against a Hidden creature have disadvantage. After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden.",
    },
    {
        name: 'Restrained',
        key: 'restrained',
        icon: 'link',
        color: 'orange',
        description: "Restrained characters can't move, but you can still take actions from their current position.",
    },
    {
        name: 'Vulnerable',
        key: 'vulnerable',
        icon: 'shield-off',
        color: 'red',
        description: 'When a creature is Vulnerable, all rolls targeting them have advantage.',
    },
];

/**
 * Special conditions applied by specific adversary features. The SRD notes that
 * features may apply their own conditions, which "work as described in the
 * feature text" — these are those, collected so a GM can apply them in one click
 * instead of retyping them mid-session. Listed separately from the three
 * standard conditions above, which apply universally.
 */
export const DAGGERHEART_ADVERSARY_CONDITIONS: Condition[] = [
    {
        name: 'Poisoned',
        key: 'poisoned',
        icon: 'skull',
        color: 'green',
        description:
            'While Poisoned, the target must roll a d6 before they make an action roll. On a result of 4 or lower, they must mark a Stress.',
    },
    {
        name: 'Cursed',
        key: 'cursed',
        icon: 'ghost',
        color: 'purple',
        description:
            'While the target is Cursed, you can mark a Stress when that target rolls with Hope to make the roll be with Fear instead.',
    },
    {
        name: 'Ignited',
        key: 'ignited',
        icon: 'flame',
        color: 'orange',
        description: 'While Ignited, the target takes 1d4 magic damage when they make an action roll.',
    },
    {
        name: 'Exiled',
        key: 'exiled',
        icon: 'door-open',
        color: 'yellow',
        description:
            "While exiled, the target and their allies have Disadvantage during social situations within the Noble's domain.",
    },
    {
        name: 'Protected',
        key: 'protected',
        icon: 'shield',
        color: 'blue',
        description: 'While Protected, the target has resistance to all damage.',
    },
    {
        name: 'Entranced',
        key: 'entranced',
        icon: 'eye',
        color: 'pink',
        description: "While Entranced, the target can't act and is Vulnerable.",
    },
    {
        name: 'Enveloped',
        key: 'enveloped',
        icon: 'droplets',
        color: 'green',
        description:
            'While Enveloped, the target must mark an additional Stress every time they make an action roll. When the Ooze takes Severe damage, all Enveloped targets are freed and the condition is cleared.',
    },
    {
        name: 'Dazed',
        key: 'dazed',
        icon: 'swirl',
        color: 'yellow',
        description: "While Dazed, they can't use their Regeneration action but are immune to magic damage.",
    },
    {
        name: 'Rooted',
        key: 'rooted',
        icon: 'trees',
        color: 'green',
        description: 'While Rooted, the Treant has resistance to physical damage.',
    },
    {
        name: 'Marked',
        key: 'marked',
        icon: 'crosshair',
        color: 'red',
        description: 'While the target is Marked, their Evasion is halved.',
    },
    {
        name: 'Chilled',
        key: 'chilled',
        icon: 'snowflake',
        color: 'cyan',
        description: 'While the target is Chilled, they have disadvantage on attack rolls.',
    },
    {
        name: 'Trapped',
        key: 'trapped',
        icon: 'lasso',
        color: 'orange',
        description:
            'While trapped, the target is Restrained and Vulnerable until they break free, ending both conditions, with a successful Instinct Roll.',
    },
    {
        name: 'Guilty',
        key: 'guilty',
        icon: 'gavel',
        color: 'red',
        description:
            'When the Seraph succeeds on a standard attack against a Guilty target, they deal Severe damage instead of their standard damage.',
    },
];

// Custom Event Names
export const EVENT_REQUEST_CONDITION_MENU = 'dh-request-condition-menu';
export const EVENT_REMOVE_CONDITION = 'dh-remove-condition';
export const EVENT_REMOVE_INSTANCE = 'dh-remove-instance';
export const EVENT_EDIT_INSTANCE = 'dh-edit-instance';
export const EVENT_CREATE_COUNTDOWN = 'dh-create-countdown';
export const EVENT_RENAME_INSTANCE = 'dh-rename-instance';
/** A feature's "Spend a Fear" cost was clicked. Detail: { amount, context }. */
export const EVENT_SPEND_FEAR = 'dh-spend-fear';
/** A feature's summon phrase was clicked. Detail: { target, context }. */
export const EVENT_SUMMON = 'dh-summon';
