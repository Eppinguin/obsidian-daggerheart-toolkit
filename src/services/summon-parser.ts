import type { StatblockData } from '../types';

/**
 * A creature a feature can bring into play, read out of the feature's own text.
 *
 * Summoning is written as prose in the SRD ("Summon three Jagged Knife
 * Lackeys", "spend a Fear to summon 1d4 Vampires"), never as structured data.
 * Rather than ask GMs to maintain a parallel list, the phrasing is parsed where
 * it already exists, so every SRD statblock and every imported one gains the
 * button without being touched.
 */
export interface SummonTarget {
    /** Creature name as written in the feature, singular where we could tell. */
    name: string;
    /**
     * How many to add. A fixed count when the text gives one; null when the
     * text rolls for it (1d4) or scales with the table ("equal to the number of
     * PCs"), which the GM resolves.
     */
    count: number | null;
    /** The dice expression when the count is rolled, e.g. "1d4+1". */
    countDice?: string;
    /** Verbatim phrase this came from, shown as the button's tooltip. */
    sourceText: string;
    /** The compendium entry this resolved to, when one matched. */
    match?: StatblockData;
    /**
     * The text names a kind rather than a creature ("Tier 1 adversaries",
     * "Minions"). There is nothing to add automatically, so the control opens
     * the picker with the phrase as its starting search.
     */
    isGeneric?: boolean;
}

/** Words that follow "summon" but are not part of a creature's name. */
const NUMBER_WORDS: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
};

/**
 * Verbs that introduce a creature entering play. "Grow" and "return" are here
 * because the SRD uses them for what is mechanically a summon (the Dryad grows
 * saplings; the Spectral Captain returns fallen allies to the battle).
 *
 * Those two are also ordinary English elsewhere in feature text ("grow two
 * heads", "life force is returned to the forest"), so a phrase they introduce
 * only counts when the name that follows is capitalised — see `looksLikeName`.
 */
const SUMMON_VERBS = 'summon|grow|call forth|conjure|raise|return';

/** The verbs above that need a capitalised name before they count as a summon. */
const WEAK_VERBS = /^(?:grow|return|raise)\b/i;

/**
 * Trailing clauses that describe what happens after the creatures arrive. They
 * are cut from the captured name so "Bladed Guards, who appear at Far range"
 * resolves to "Bladed Guards".
 */
const TRAILING_CLAUSE =
    /\s*(?:,|\.|;|\band\b|\bwho\b|\bwhich\b|\bthat\b|\bunder\b|\brelevant\b|\bdrawn\b|\bto the\b|\bequal to\b|\bat\b|\bwithin\b|\bin\b|\bfrom\b|\bappear|\bimmediately\b|\bfor\b).*$/i;

/**
 * Wording the SRD puts before a name that the compendium entry omits. Applied
 * repeatedly, because these stack: "up to 1d4+1 defeated Spectral allies".
 */
const LEADING_FILLER =
    /^(?:up to\s+|(?:a\s+)?number of\s+|twice the\s+|\d+d\d+(?:\s*[+-]\s*\d+)?\s+|\d+\s+|additional\s+|more\s+|new\s+|other\s+|defeated\s+|tier\s+[\dx]+(?:\s+or\s+below)?\s+)/i;

/**
 * Generic nouns the SRD uses when the GM is meant to choose the creature.
 * A phrase that reduces to one of these has no specific target to add.
 */
const GENERIC_NOUNS =
    /^(?:adversaries|adversary|allies|ally|creatures?|enemies|enemy|minions?|troops?|reinforcements?|heads?|others?)$/i;

/**
 * Pull every summonable creature out of one feature's text.
 *
 * Deliberately conservative: a phrase only becomes a button when a creature
 * name can actually be read out of it. Text that summons something the GM has
 * to choose ("a Minor Chaos Adversary", "Tier 1 adversaries") still yields a
 * target, but one that will not resolve to a compendium entry and so opens the
 * picker instead of adding blindly.
 */
export function parseSummons(text: string): SummonTarget[] {
    if (!text) return [];

    const results: SummonTarget[] = [];
    const seen = new Set<string>();

    // "summon <quantity> <name>" — quantity is a dice expression, a number, a
    // number word, or absent entirely ("summon a Zombie Legion").
    const pattern = new RegExp(
        String.raw`\b(?:${SUMMON_VERBS})\s+` +
            String.raw`(?:(\d+d\d+(?:\s*[+-]\s*\d+)?)|(\d+)|(${Object.keys(NUMBER_WORDS).join('|')})\s)?` +
            // The name stops at punctuation, at a clause describing arrival, or at
            // a conjunction joining it to another summon ("summon a Minor Demon and
            // summon three Bladed Guards") — otherwise the first match swallows the
            // second creature and only one button appears.
            String.raw`\s*([^.;]{2,80}?)(?=[.;,]|\s+and\s+(?:${SUMMON_VERBS})\b|\s+or\s+(?:a|an|\d|two|three)\b|\s+who\b|\s+which\b|\s+under\b|\s+equal\b|\s+relevant\b|\s+drawn\b|\s+appear|\s+to the\b|$)`,
        'gi',
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const [full, dice, digits, word, rawName] = match;

        const name = cleanName(rawName);
        if (!name) continue;
        // "grow"/"return"/"raise" are only summons when they name something.
        if (WEAK_VERBS.test(full.trim()) && !looksLikeName(name)) continue;

        let count: number | null = null;
        let countDice: string | undefined;
        if (dice) {
            countDice = dice.replace(/\s+/g, '');
        } else if (digits) {
            count = Number(digits);
        } else if (word) {
            count = NUMBER_WORDS[word.toLowerCase()] ?? null;
        } else {
            // No quantity written at all: "summon a Zombie Legion" style, one.
            count = 1;
        }

        const key = `${name.toLowerCase()}|${count}|${countDice ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
            name,
            count,
            countDice,
            sourceText: full.trim(),
            isGeneric: GENERIC_NOUNS.test(name),
        });
    }

    return results;
}

/** Strip the filler and trailing clauses around a captured creature name. */
function cleanName(raw: string): string {
    let name = raw.trim().replace(TRAILING_CLAUSE, '');

    // The filler forms stack, so peel them off until nothing more matches.
    let previous: string;
    do {
        previous = name;
        name = name.replace(LEADING_FILLER, '').trim();
    } while (name !== previous);

    // Adverbs and prepositions that trail the name without belonging to it.
    name = name
        .replace(/\s+(?:again|too|as well|instead|nearby|there|here)$/i, '')
        .replace(/[.,;:*"'’”]+$/, '')
        .replace(/^[*"'‘“]+/, '')
        .trim();

    // A bare quantity phrase with no name attached is not a summon we can act on.
    if (!name || name.length < 3) return '';
    // Guard against the regex running away into an unrelated sentence.
    if (name.split(/\s+/).length > 6) return '';
    // Punctuation inside the phrase means we captured prose, not a name.
    if (/[?!*]/.test(name)) return '';
    return name;
}

/**
 * Whether a captured phrase reads as a creature name rather than ordinary
 * prose. Used to keep the loose verbs ("grow two heads") from producing
 * buttons: a real summon names something the statblock treats as a proper noun.
 */
function looksLikeName(name: string): boolean {
    return /^[A-Z]/.test(name);
}

/**
 * Find the compendium entry a parsed name refers to.
 *
 * Tries the name as written, then a naive singular, then a case-insensitive
 * contains match — the SRD writes "three Jagged Knife Lackeys" for an entry
 * filed as "Jagged Knife Lackey". Only adversaries are considered: summoning an
 * environment is not a thing the rules do.
 */
export function resolveSummon(name: string, compendium: StatblockData[]): StatblockData | undefined {
    const adversaries = compendium.filter((entry) => entry.category !== 'environment');
    const target = name.toLowerCase().trim();

    // Every spelling worth trying, in descending order of confidence: the name
    // as written, its singular forms, and those again with a trailing
    // collective noun the entry does not carry removed ("Treant Sapling
    // Minions" for the entry "Treant Sapling").
    const candidates: string[] = [];
    for (const form of [target, ...singularForms(target)]) {
        candidates.push(form);
        const bare = form.replace(/\s+(?:minion|horde|pack|group|squad|swarm|legion|troop|band)s?$/i, '').trim();
        if (bare && bare !== form) candidates.push(...singularForms(bare), bare);
    }
    const unique = Array.from(new Set(candidates.filter(Boolean)));

    // An exact hit on any spelling beats a partial hit on a better one.
    for (const candidate of unique) {
        const exact = adversaries.find((entry) => entry.name.toLowerCase() === candidate);
        if (exact) return exact;
    }

    // Failing that, match on a word boundary in either direction: the text may
    // be more specific than the entry ("Minor Chaos Adversary") or less so
    // ("Shock Troops" for the entry "Fallen Shock Troop"). Longest wins, so
    // "Minor Demon" beats "Demon".
    const partial = adversaries
        .filter((entry) => {
            const entryName = entry.name.toLowerCase();
            return unique.some(
                (candidate) => candidate.endsWith(` ${entryName}`) || entryName.endsWith(` ${candidate}`),
            );
        })
        .sort((a, b) => b.name.length - a.name.length);

    return partial[0];
}

/**
 * Candidate singulars for a possibly-plural name, best guess first.
 *
 * "-ies" is genuinely ambiguous without a dictionary — "allies" comes from
 * "ally" but "zombies" from "zombie" — so both are offered and the caller
 * settles it against the compendium rather than this function guessing.
 */
function singularForms(name: string): string[] {
    if (/(ss|us|is)$/.test(name)) return [name];

    const forms: string[] = [];
    if (name.endsWith('ies')) {
        forms.push(`${name.slice(0, -1)}`); // zombies -> zombie
        forms.push(`${name.slice(0, -3)}y`); // allies  -> ally
    } else if (/(ch|sh|x|z|s)es$/.test(name)) {
        forms.push(name.slice(0, -2));
    } else if (name.endsWith('s')) {
        forms.push(name.slice(0, -1));
    }
    forms.push(name);
    return Array.from(new Set(forms));
}

/**
 * Parse and resolve in one pass, dropping phrases that yield nothing useful.
 * A target with no compendium match is kept: the GM can still pick something,
 * which is the whole point for "summon Tier 1 adversaries" style text.
 *
 * Deduplication happens here rather than in `parseSummons` because two phrases
 * can be worded differently and still mean the same creature. The Cult Ritual
 * names its demon twice — once as narrative setup ("the ritual to summon a
 * demon") and once as the mechanic ("summon a Minor Demon") — and both resolve
 * to Minor Demon, which should be one button, not two.
 */
export function findSummonTargets(text: string, compendium: StatblockData[]): SummonTarget[] {
    const resolved = parseSummons(text).map((target) => ({
        ...target,
        match: resolveSummon(target.name, compendium),
    }));

    const seen = new Set<string>();
    const unique: SummonTarget[] = [];
    for (const target of resolved) {
        // Matched targets collapse on the entry they point at; unmatched ones
        // keep their own name, since that is all that distinguishes them.
        const identity = target.match
            ? `match:${target.match.name.toLowerCase()}`
            : `name:${target.name.toLowerCase()}`;
        const key = `${identity}|${target.count}|${target.countDice ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(target);
    }
    return unique;
}

/** Short label for the summon control, e.g. "Summon 3", "Summon 1d4". */
export function summonLabel(target: SummonTarget): string {
    if (target.countDice) return `Summon ${target.countDice}`;
    if (target.count && target.count > 1) return `Summon ${target.count}`;
    return 'Summon';
}
