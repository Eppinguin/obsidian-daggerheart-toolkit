import type { ITheme } from 'dddice-js';
import type { ContentSource } from './services/content-source';

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
    /**
     * Presentation fields. All optional: Condition objects are persisted inside
     * SavedEncounter.adversaries, so a required field would break every
     * previously saved encounter. Conditions without them render as a neutral chip.
     */
    /** Stable kebab-case identifier. Derived from `name` when absent. */
    key?: string;
    /** Lucide icon id shown on the chip. */
    icon?: string;
    /** Obsidian colour family: red | orange | yellow | green | cyan | blue | purple | pink */
    color?: string;
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
    /**
     * Which daggerheart-statblock block within `sourceFile` this came from.
     * A note can hold several, so the index is what makes an in-place edit
     * target the right one. Stamped at load time, never persisted.
     */
    sourceBlockIndex?: number;
    isCustom?: boolean;
    /**
     * Registry id of the ContentSource this entry was loaded from. Stamped at
     * load time and stripped before every write, so it never reaches disk.
     */
    sourceId?: string;
    /**
     * Provenance recorded by the importer. shared/statblock-format.js has
     * written this since FORMAT_VERSION 1.2.0, so it is already present in
     * existing user files; it was simply never declared here.
     */
    source?: StatblockProvenance;
    /** Environment flavour, also written by the shared format runtime. */
    tone?: string;
}

export interface StatblockProvenance {
    site?: string;
    url?: string;
    author?: string;
    importedAt?: string;
}

export interface AdversaryInstance extends StatblockData {
    id: string;
    groupId: string;
    currentHp: number;
    currentStress: number;
    displayName: string;
    /**
     * Set when the GM has renamed this instance, which stops the automatic
     * "Name #N" numbering from overwriting it. Optional for back-compat.
     */
    hasCustomName?: boolean;
    conditions?: Condition[];
    _originalStats?: Partial<AdversaryInstance>;
}

/**
 * How much of a card is showing.
 *
 * `compact` is the rung that does the work during play: the statblock stays
 * readable while the feat prose — which is what makes a card three screens
 * tall — folds away to its headers.
 */
export type CardDensity = 'full' | 'compact' | 'collapsed';

export const CARD_DENSITY_CYCLE: CardDensity[] = ['full', 'compact', 'collapsed'];

export interface SavedEncounter {
    id: string;
    name: string;
    adversaries: AdversaryInstance[];
    adversaryGroupOrder: string[];
    /**
     * Fear for this encounter. Optional: falls back to the global
     * settings.fearCounter so encounters saved before the move to
     * per-encounter Fear keep their value.
     */
    fearCounter?: number;
    /**
     * Per-group card density, keyed by groupId. Absent groups read as 'full',
     * so encounters saved before this existed open fully expanded.
     *
     * Kept on the encounter rather than in the leaf's ephemeral state, which
     * was where it lived before: that state is discarded whenever the leaf is
     * recreated, so a layout the GM spent a minute arranging did not survive
     * reopening the view, let alone restarting Obsidian.
     */
    cardDensity?: Record<string, CardDensity>;
    /**
     * Features the GM has toggled away from the density default, keyed
     * `groupId::name`. Optional for back-compat.
     */
    toggledFeatures?: string[];
}

export interface Countdown {
    id: string;
    name: string;
    value: number;
    /**
     * What this countdown starts at, as written: a number ("6") or a dice
     * string ("1d6"). Kept as text because a randomized countdown rerolls to a
     * different number each cycle, so there is no single starting value to
     * store. Absent on countdowns created before this existed, and on ones the
     * GM never gave a start.
     */
    start?: string;
    /**
     * Whether this countdown resets and runs again after it triggers. Loops are
     * the only countdowns that owe the GM an action at zero; a one-shot is
     * simply finished.
     */
    loops?: boolean;
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
    /**
     * The four settings below predate the content-source registry. They are
     * kept as the migration input and mirrored back on every save, so an older
     * plugin build still finds its data after a downgrade.
     */
    useSrdAdversaries: boolean;
    useSrdEnvironments: boolean;
    userCompendiumFile: string;
    /** Content source registry. Absent on installs predating the source model. */
    contentSources?: ContentSource[];
    /** Where new and imported entries go. Falls back to the first writable source. */
    defaultWriteSourceId?: string;
    /**
     * One-shot marker for the orphaned-file rescue. Without it, a source the
     * user deliberately deleted would be re-registered on the next load.
     */
    sourcesRescued?: boolean;
    /** One-shot marker for sorting the registry into precedence order. */
    sourceOrderMigrated?: boolean;
    showDescriptionOnCards: boolean;
    showFeatureDetailsOnCards: boolean;
    enableFearTracker: boolean;
    fearCounter: number;
    enableCountdownTracker: boolean;
    countdowns: Countdown[];
    /** User-created conditions, remembered across sessions. Optional for back-compat. */
    customConditions?: Condition[];
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
    enableFearTracker: true,
    fearCounter: 0,
    enableCountdownTracker: true,
    countdowns: [],
    customConditions: [],
    enableEncounterBudget: true,
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
