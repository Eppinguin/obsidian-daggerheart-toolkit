import type { AdversaryInstance, StatblockAttack, StatblockFeature } from '../types';

export type Tier = 1 | 2 | 3 | 4;

type Role = 'bruiser' | 'horde' | 'leader' | 'minion' | 'ranged' | 'skulk' | 'solo' | 'standard' | 'support' | 'social';
type TableRole = Exclude<Role, 'social'>;

export type FeatureTextMode = 'damage-aware' | 'all-dice' | 'structured-only';

export interface ScalingOptions {
    minionDamage?: 'foundry-normalized' | 'preserve';
    featureTextMode?: FeatureTextMode;
}

interface TierDelta {
    difficulty: number;
    major: number;
    severe: number;
    hp: number;
    stress: number;
    attack: number;
}

type BoundaryTable = Record<2 | 3 | 4, TierDelta>;

/** RightKnight/Foundryborne additive boundary tables. Social intentionally uses bands instead. */
export const ROLE_BOUNDARY_DELTAS: Record<TableRole, BoundaryTable> = {
    bruiser: {
        2: { difficulty: 2, major: 5, severe: 10, hp: 1, stress: 2, attack: 2 },
        3: { difficulty: 2, major: 7, severe: 15, hp: 1, stress: 0, attack: 2 },
        4: { difficulty: 2, major: 12, severe: 25, hp: 1, stress: 0, attack: 2 },
    },
    horde: {
        2: { difficulty: 2, major: 5, severe: 8, hp: 2, stress: 0, attack: 0 },
        3: { difficulty: 2, major: 5, severe: 12, hp: 0, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 10, severe: 15, hp: 2, stress: 0, attack: 0 },
    },
    leader: {
        2: { difficulty: 2, major: 6, severe: 10, hp: 0, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 6, severe: 15, hp: 1, stress: 0, attack: 2 },
        4: { difficulty: 2, major: 12, severe: 25, hp: 1, stress: 1, attack: 3 },
    },
    minion: {
        2: { difficulty: 2, major: 0, severe: 0, hp: 0, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 0, severe: 0, hp: 0, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 0, severe: 0, hp: 0, stress: 0, attack: 1 },
    },
    ranged: {
        2: { difficulty: 2, major: 3, severe: 6, hp: 1, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 7, severe: 14, hp: 1, stress: 1, attack: 2 },
        4: { difficulty: 2, major: 5, severe: 10, hp: 1, stress: 1, attack: 1 },
    },
    skulk: {
        2: { difficulty: 2, major: 3, severe: 8, hp: 1, stress: 1, attack: 1 },
        3: { difficulty: 2, major: 8, severe: 12, hp: 1, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 8, severe: 10, hp: 1, stress: 1, attack: 1 },
    },
    solo: {
        2: { difficulty: 2, major: 5, severe: 10, hp: 0, stress: 1, attack: 2 },
        3: { difficulty: 2, major: 7, severe: 15, hp: 2, stress: 1, attack: 2 },
        4: { difficulty: 2, major: 12, severe: 25, hp: 0, stress: 1, attack: 3 },
    },
    standard: {
        2: { difficulty: 2, major: 3, severe: 8, hp: 0, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 7, severe: 15, hp: 1, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 10, severe: 15, hp: 0, stress: 1, attack: 1 },
    },
    support: {
        2: { difficulty: 2, major: 3, severe: 8, hp: 1, stress: 1, attack: 1 },
        3: { difficulty: 2, major: 7, severe: 12, hp: 0, stress: 0, attack: 1 },
        4: { difficulty: 2, major: 8, severe: 10, hp: 1, stress: 1, attack: 1 },
    },
};

interface StatBand {
    min: number;
    max: number;
}

type SocialStat = 'difficulty' | 'major' | 'severe' | 'hp' | 'stress' | 'attack';

/**
 * RightKnight v1.6 Social guidance; deviations are expected and remain deviations after scaling.
 * https://freshcutgrass.app/publications/rightknight-s-guide-to-making-custom-adversaries-miuwwac6
 */
const SOCIAL_STAT_BANDS: Record<Tier, Record<SocialStat, StatBand>> = {
    1: {
        difficulty: { min: 10, max: 12 },
        major: { min: 3, max: 5 },
        severe: { min: 6, max: 9 },
        hp: { min: 3, max: 3 },
        stress: { min: 2, max: 3 },
        attack: { min: -4, max: -1 },
    },
    2: {
        difficulty: { min: 13, max: 15 },
        major: { min: 5, max: 8 },
        severe: { min: 13, max: 18 },
        hp: { min: 3, max: 3 },
        stress: { min: 2, max: 3 },
        attack: { min: -3, max: 0 },
    },
    3: {
        difficulty: { min: 15, max: 17 },
        major: { min: 15, max: 20 },
        severe: { min: 27, max: 32 },
        hp: { min: 4, max: 4 },
        stress: { min: 2, max: 3 },
        attack: { min: -2, max: 2 },
    },
    4: {
        difficulty: { min: 17, max: 19 },
        major: { min: 25, max: 35 },
        severe: { min: 35, max: 50 },
        hp: { min: 4, max: 4 },
        stress: { min: 2, max: 3 },
        attack: { min: 2, max: 6 },
    },
};

/** RightKnight v1.6 standard-attack damage bands, kept per role. */
const ROLE_DAMAGE_BANDS: Record<Role, Record<Tier, StatBand>> = {
    bruiser: {
        1: { min: 8, max: 11 },
        2: { min: 12, max: 16 },
        3: { min: 18, max: 22 },
        4: { min: 30, max: 45 },
    },
    horde: {
        1: { min: 5, max: 8 },
        2: { min: 9, max: 13 },
        3: { min: 14, max: 19 },
        4: { min: 20, max: 30 },
    },
    leader: {
        1: { min: 6, max: 9 },
        2: { min: 12, max: 15 },
        3: { min: 15, max: 18 },
        4: { min: 25, max: 35 },
    },
    minion: {
        1: { min: 1, max: 3 },
        2: { min: 2, max: 4 },
        3: { min: 5, max: 8 },
        4: { min: 10, max: 12 },
    },
    ranged: {
        1: { min: 6, max: 9 },
        2: { min: 12, max: 16 },
        3: { min: 15, max: 18 },
        4: { min: 25, max: 35 },
    },
    skulk: {
        1: { min: 5, max: 8 },
        2: { min: 9, max: 13 },
        3: { min: 14, max: 18 },
        4: { min: 20, max: 35 },
    },
    solo: {
        1: { min: 8, max: 11 },
        2: { min: 15, max: 20 },
        3: { min: 20, max: 30 },
        4: { min: 30, max: 45 },
    },
    standard: {
        1: { min: 4, max: 6 },
        2: { min: 8, max: 12 },
        3: { min: 12, max: 17 },
        4: { min: 17, max: 28 },
    },
    support: {
        1: { min: 3, max: 5 },
        2: { min: 5, max: 12 },
        3: { min: 13, max: 16 },
        4: { min: 18, max: 25 },
    },
    social: {
        1: { min: 2, max: 4 },
        2: { min: 5, max: 12 },
        3: { min: 12, max: 17 },
        4: { min: 17, max: 28 },
    },
};

/** The guide offers a low-impact and a more combat-capable Social dice path. */
const SOCIAL_DAMAGE_BENCHMARKS: Record<'low' | 'combat', Record<Tier, number>> = {
    low: { 1: 4.5, 2: 5.5, 3: 13.5, 4: 18 },
    combat: { 1: 4.5, 2: 9, 3: 13.5, 4: 23 },
};

const MINION_PASSIVE_BANDS: Record<Tier, StatBand> = {
    1: { min: 3, max: 5 },
    2: { min: 5, max: 7 },
    3: { min: 7, max: 9 },
    4: { min: 9, max: 12 },
};

/** RightKnight Social damage bands; combat-focused Social outliers remain inside the destination role. */
const SOCIAL_DAMAGE_MAXIMUMS: Record<Tier, number> = {
    1: 4.5,
    2: 12,
    3: 17,
    4: 28,
};

export interface ParsedDamage {
    count: number;
    faces: number;
    bonus: number;
    flat: boolean;
}

interface DamageDieTerm {
    count: number;
    faces: number;
}

interface ParsedDamageExpression {
    dice: DamageDieTerm[];
    bonus: number;
    flat: boolean;
}

export interface ScalingResult {
    adversary: AdversaryInstance;
    warnings: string[];
    advisories: string[];
}

const DIE_LADDER = [4, 6, 8, 10, 12, 20] as const;
const DIE_FACES_PATTERN = '(?:4|6|8|10|12|20)';
const DICE_EXPRESSION_PATTERN = new RegExp(
    `\\b\\d+d${DIE_FACES_PATTERN}(?:\\s*[+-]\\s*(?:\\d+d${DIE_FACES_PATTERN}|\\d+))*\\b`,
    'gi',
);
const ANY_DICE_TERM_PATTERN = /\b\d+d\d+(?:[+-]\d+)?\b/gi;
const FLAT_DAMAGE_PATTERN = /(?<![d+-])\b\d+\b(?!d)/gi;

const DEFAULT_OPTIONS: Required<ScalingOptions> = {
    minionDamage: 'foundry-normalized',
    featureTextMode: 'damage-aware',
};

function clone<T>(value: T): T {
    return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function parseDamageFormula(formula: string): ParsedDamage | null {
    const normalized = formula.trim().toLowerCase().replace(/ /g, '');
    const dice = normalized.match(/^(\d+)d(4|6|8|10|12|20)([+-]\d+)?$/);
    if (dice) {
        return {
            count: Number(dice[1]),
            faces: Number(dice[2]),
            bonus: Number(dice[3] ?? 0),
            flat: false,
        };
    }
    if (/^\d+$/.test(normalized)) return { count: 0, faces: 0, bonus: Number(normalized), flat: true };
    return null;
}

export function expectedDamage(formula: string): number {
    const parsed = parseDamageFormula(formula);
    if (!parsed) throw new Error(`Unsupported damage formula: ${formula}`);
    return parsed.flat ? parsed.bonus : (parsed.count * (parsed.faces + 1)) / 2 + parsed.bonus;
}

function parseDamageExpression(formula: string): ParsedDamageExpression | null {
    const normalized = formula.trim().toLowerCase().replace(/\s/g, '');
    if (/^\d+$/.test(normalized)) return { dice: [], bonus: Number(normalized), flat: true };
    if (!normalized || !/^\d+d\d+(?:[+-](?:\d+d\d+|\d+))*$/.test(normalized)) return null;

    const diceByFaces = new Map<number, number>();
    let bonus = 0;
    for (const token of normalized.match(/[+-]?[^+-]+/g) ?? []) {
        const sign = token.startsWith('-') ? -1 : 1;
        const value = token.replace(/^[+-]/, '');
        const dice = value.match(/^(\d+)d(\d+)$/);
        if (dice) {
            const faces = Number(dice[2]);
            if (sign < 0 || !DIE_LADDER.includes(faces as (typeof DIE_LADDER)[number])) return null;
            diceByFaces.set(faces, (diceByFaces.get(faces) ?? 0) + Number(dice[1]));
        } else if (/^\d+$/.test(value)) {
            bonus += sign * Number(value);
        } else {
            return null;
        }
    }

    const dice = Array.from(diceByFaces, ([faces, count]) => ({ count, faces }));
    return dice.length ? { dice, bonus, flat: false } : null;
}

function expectedDamageExpression(expression: ParsedDamageExpression): number {
    return expression.flat
        ? expression.bonus
        : expression.dice.reduce((total, term) => total + (term.count * (term.faces + 1)) / 2, 0) + expression.bonus;
}

function formatDamageExpression(expression: ParsedDamageExpression): string {
    if (expression.flat) return String(expression.bonus);
    const dice = expression.dice.filter((term) => term.count > 0).map((term) => `${term.count}d${term.faces}`);
    const bonus =
        expression.bonus === 0 ? '' : expression.bonus > 0 ? `+${expression.bonus}` : String(expression.bonus);
    return `${dice.join('+')}${bonus}`;
}

function formatDamage(parsed: ParsedDamage): string {
    if (parsed.flat) return String(parsed.bonus);
    const modifier = parsed.bonus === 0 ? '' : parsed.bonus > 0 ? `+${parsed.bonus}` : String(parsed.bonus);
    return `${parsed.count}d${parsed.faces}${modifier}`;
}

function parseAttackDamage(damage: string): { formula: string; parsed: ParsedDamageExpression; suffix: string } | null {
    const match = damage
        .trim()
        .match(/^((?:\d+d(?:4|6|8|10|12|20)|\d+)(?:\s*[+-]\s*(?:\d+d(?:4|6|8|10|12|20)|\d+))*)(.*)$/i);
    if (!match || (match[2] && !/^\s/.test(match[2]))) return null;
    const parsed = parseDamageExpression(match[1]);
    return parsed ? { formula: match[1], parsed, suffix: match[2] } : null;
}

function attackExpectedDamage(attack: StatblockAttack | undefined): number | null {
    if (!attack) return null;
    const damage = parseAttackDamage(attack.damage);
    return damage ? expectedDamageExpression(damage.parsed) : null;
}

function crossedBoundaries(source: Tier, target: Tier): Array<{ tier: 2 | 3 | 4; sign: 1 | -1 }> {
    const result: Array<{ tier: 2 | 3 | 4; sign: 1 | -1 }> = [];
    if (target > source) {
        for (let tier = source + 1; tier <= target; tier += 1) result.push({ tier: tier as 2 | 3 | 4, sign: 1 });
    } else {
        for (let tier = source; tier > target; tier -= 1) result.push({ tier: tier as 2 | 3 | 4, sign: -1 });
    }
    return result;
}

type DamageMode = 'action' | 'attack';
type SocialDamageProfile = 'low' | 'combat';

function scaleDamageBandValue(value: number, source: StatBand, target: StatBand): number {
    if (value < source.min) return Math.max(1, target.min + value - source.min);
    if (value > source.max) return target.max + value - source.max;
    const sourceMidpoint = (source.min + source.max) / 2;
    const targetMidpoint = (target.min + target.max) / 2;
    const sourceRadius = Math.max(0.5, (source.max - source.min) / 2);
    const targetRadius = Math.max(0.5, (target.max - target.min) / 2);
    const sourcePosition = (value - sourceMidpoint) / sourceRadius;
    return Math.max(1, targetMidpoint + sourcePosition * targetRadius);
}

function socialDamageProfile(expression: ParsedDamageExpression, sourceTier: Tier): SocialDamageProfile {
    if (expression.flat) return 'low';
    const count = expression.dice.reduce((total, term) => total + term.count, 0);
    const largestFaces = Math.max(...expression.dice.map((term) => term.faces));
    return largestFaces >= 6 && (sourceTier !== 2 || count >= 2) ? 'combat' : 'low';
}

function targetExpectedDamage(
    previousExpected: number,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    mode: DamageMode,
    socialProfile: SocialDamageProfile = 'low',
): number {
    if (mode === 'attack' && role === 'social') {
        const benchmarks = SOCIAL_DAMAGE_BENCHMARKS[socialProfile];
        const relativeStrength = clamp(previousExpected / benchmarks[sourceTier], 0.5, 2);
        return clamp(benchmarks[targetTier] * relativeStrength, 1, SOCIAL_DAMAGE_MAXIMUMS[targetTier]);
    }

    return scaleDamageBandValue(
        previousExpected,
        ROLE_DAMAGE_BANDS[role][sourceTier],
        ROLE_DAMAGE_BANDS[role][targetTier],
    );
}

function targetAttackDiceCount(
    role: Role,
    targetTier: Tier,
    sourceCount: number,
    increasing: boolean,
    socialProfile: SocialDamageProfile,
): number {
    if (role === 'social' && targetTier === 2) return socialProfile === 'combat' ? 2 : 1;
    return Math.max(increasing ? sourceCount : 0, targetTier);
}

function reconstructDamageBonus(
    targetExpected: number,
    baseAverage: number,
    role: Role,
    mode: DamageMode,
    targetTier: Tier,
): number {
    const difference = targetExpected - baseAverage;
    // Expected values often end in .5. At the top of a Social band, prefer the
    // legal expression just below the cap rather than rounding beyond it.
    if (role === 'social' && mode === 'attack' && targetExpected >= SOCIAL_DAMAGE_MAXIMUMS[targetTier]) {
        return Math.floor(difference);
    }
    return Math.round(difference);
}

/**
 * Retains Foundryborne's legal-expression reconstruction while targeting the
 * source attack's corresponding position in RightKnight's role damage band.
 */
function scaleFoundryDamageFormula(
    formula: string,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    mode: DamageMode,
    targetExpectedOverride?: number,
): string | null {
    const parsed = parseDamageFormula(formula);
    if (!parsed) return null;

    const previousExpected = expectedDamage(formula);
    if (previousExpected === 0) return formatDamage(parsed);
    const profile = socialDamageProfile(
        {
            dice: parsed.flat ? [] : [{ count: parsed.count, faces: parsed.faces }],
            bonus: parsed.bonus,
            flat: parsed.flat,
        },
        sourceTier,
    );

    const targetExpected =
        targetExpectedOverride ?? targetExpectedDamage(previousExpected, sourceTier, targetTier, role, mode, profile);
    if (parsed.flat) return String(Math.round(targetExpected));

    const value = { ...parsed };
    const tierSteps = targetTier - sourceTier;
    const increasing = tierSteps > 0;
    if (value.faces === 20 || (role === 'social' && targetTier >= 3 && value.faces < 6)) {
        value.faces = role === 'social' ? 6 : 12;
    }
    const expectedDie = () => (value.faces + 1) / 2;
    const baseAverage = () => value.count * expectedDie();
    const baseOverages = Math.floor(value.bonus / expectedDie());

    if (mode === 'attack') {
        value.count = targetAttackDiceCount(role, targetTier, value.count, increasing, profile);
    } else {
        const currentIndex = DIE_LADDER.indexOf(value.faces as (typeof DIE_LADDER)[number]);
        value.faces = DIE_LADDER[clamp(currentIndex + tierSteps, 0, 4)];
    }

    value.bonus = reconstructDamageBonus(targetExpected, baseAverage(), role, mode, targetTier);
    if (value.bonus < 0) {
        let stepsRequired = Math.ceil(Math.abs(value.bonus) / value.count);
        let currentIndex = DIE_LADDER.indexOf(value.faces as (typeof DIE_LADDER)[number]);

        if (mode === 'action' && stepsRequired > currentIndex && value.count > 0) {
            // Foundry removes tier dice here. Keep at least one die so extreme
            // downscales cannot produce a malformed zero/negative-dice formula.
            value.count = Math.max(1, value.count - (increasing ? 1 : Math.abs(tierSteps)));
            value.bonus = reconstructDamageBonus(targetExpected, baseAverage(), role, mode, targetTier);
            if (value.bonus >= 0) return formatDamage(value);
        }

        stepsRequired = Math.ceil(Math.abs(value.bonus) / value.count);
        currentIndex = DIE_LADDER.indexOf(value.faces as (typeof DIE_LADDER)[number]);
        value.faces = DIE_LADDER[Math.max(0, currentIndex - stepsRequired)];
        value.bonus = Math.max(0, reconstructDamageBonus(targetExpected, baseAverage(), role, mode, targetTier));
    }

    const overagesToRemove = Math.floor(value.bonus / expectedDie()) - baseOverages;
    if (mode === 'action' && increasing && overagesToRemove > 0) {
        value.count += overagesToRemove;
        value.bonus = reconstructDamageBonus(targetExpected, baseAverage(), role, mode, targetTier);
    }

    return formatDamage(value);
}

function allocateCompoundDice(dice: DamageDieTerm[], desiredCount: number): DamageDieTerm[] {
    const result = dice.map((term) => ({ ...term, count: 0 }));
    if (desiredCount < dice.length) {
        const strongest = dice
            .map((term, index) => ({ index, contribution: term.count * (term.faces + 1) }))
            .sort((left, right) => right.contribution - left.contribution)
            .slice(0, desiredCount);
        strongest.forEach(({ index }) => (result[index].count = 1));
        return result.filter((term) => term.count > 0);
    }

    const sourceCount = dice.reduce((total, term) => total + term.count, 0);
    const quotas = dice.map((term) => (term.count / sourceCount) * desiredCount);
    quotas.forEach((quota, index) => (result[index].count = Math.floor(quota)));

    for (let index = 0; index < result.length; index += 1) {
        if (result[index].count > 0) continue;
        const donor = result
            .map((term, donorIndex) => ({ donorIndex, count: term.count }))
            .filter(({ donorIndex, count }) => donorIndex !== index && count > 1)
            .sort((left, right) => right.count - left.count)[0];
        if (donor) result[donor.donorIndex].count -= 1;
        result[index].count = 1;
    }

    let assigned = result.reduce((total, term) => total + term.count, 0);
    const remainderOrder = quotas
        .map((quota, index) => ({ index, remainder: quota - Math.floor(quota) }))
        .sort((left, right) => right.remainder - left.remainder);
    for (let index = 0; assigned < desiredCount; index = (index + 1) % remainderOrder.length) {
        result[remainderOrder[index].index].count += 1;
        assigned += 1;
    }
    while (assigned > desiredCount) {
        const donor = result
            .map((term, index) => ({ index, count: term.count }))
            .filter(({ count }) => count > 1)
            .sort((left, right) => right.count - left.count)[0];
        if (!donor) break;
        result[donor.index].count -= 1;
        assigned -= 1;
    }
    return result;
}

function compoundBaseAverage(dice: DamageDieTerm[]): number {
    return dice.reduce((total, term) => total + (term.count * (term.faces + 1)) / 2, 0);
}

function stepCompoundFacesDown(dice: DamageDieTerm[], targetExpected: number): void {
    let baseAverage = compoundBaseAverage(dice);
    while (baseAverage > targetExpected) {
        const candidates = dice
            .map((term, index) => {
                const faceIndex = DIE_LADDER.indexOf(term.faces as (typeof DIE_LADDER)[number]);
                if (faceIndex <= 0) return null;
                const lowerFaces = DIE_LADDER[faceIndex - 1];
                const reduction = (term.count * (term.faces - lowerFaces)) / 2;
                return { index, lowerFaces, distance: Math.abs(baseAverage - reduction - targetExpected) };
            })
            .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
            .sort((left, right) => left.distance - right.distance);
        if (!candidates.length) break;
        dice[candidates[0].index].faces = candidates[0].lowerFaces;
        baseAverage = compoundBaseAverage(dice);
    }
}

/** Rebuild a Horde's injured attack from one-half of its already-scaled standard attack. */
function halveDamageFormula(formula: string): string | null {
    const expression = parseDamageExpression(formula);
    if (!expression) return null;
    const targetExpected = expectedDamageExpression(expression) / 2;
    if (expression.flat) return String(Math.max(1, Math.round(targetExpected)));

    const sourceCount = expression.dice.reduce((total, term) => total + term.count, 0);
    const desiredCounts = Array.from(
        new Set([Math.max(1, Math.floor(sourceCount / 2)), Math.max(1, Math.ceil(sourceCount / 2))]),
    );
    const candidates = desiredCounts.map((desiredCount) => {
        const dice = allocateCompoundDice(expression.dice, desiredCount);
        stepCompoundFacesDown(dice, targetExpected);
        const bonus = Math.max(0, Math.round(targetExpected - compoundBaseAverage(dice)));
        const candidate = { dice, bonus, flat: false } satisfies ParsedDamageExpression;
        return {
            candidate,
            distance: Math.abs(expectedDamageExpression(candidate) - targetExpected),
            count: desiredCount,
        };
    });
    candidates.sort((left, right) => left.distance - right.distance || left.count - right.count);
    return formatDamageExpression(candidates[0].candidate);
}

function scaleCompoundDamageFormula(
    expression: ParsedDamageExpression,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    mode: DamageMode,
    targetExpectedOverride?: number,
): string {
    const previousExpected = expectedDamageExpression(expression);
    if (previousExpected === 0) return formatDamageExpression(expression);
    const profile = socialDamageProfile(expression, sourceTier);
    const targetExpected =
        targetExpectedOverride ?? targetExpectedDamage(previousExpected, sourceTier, targetTier, role, mode, profile);
    if (expression.flat) return String(Math.round(targetExpected));

    const tierSteps = targetTier - sourceTier;
    const increasing = tierSteps > 0;
    const sourceDiceCount = expression.dice.reduce((total, term) => total + term.count, 0);
    const sourceAverageDie = compoundBaseAverage(expression.dice) / sourceDiceCount;
    const baseOverages = Math.floor(expression.bonus / sourceAverageDie);
    let dice = expression.dice.map((term) => ({
        ...term,
        faces:
            term.faces === 20 || (role === 'social' && targetTier >= 3 && term.faces < 6)
                ? role === 'social'
                    ? 6
                    : 12
                : term.faces,
    }));

    if (mode === 'attack') {
        dice = allocateCompoundDice(
            dice,
            targetAttackDiceCount(role, targetTier, sourceDiceCount, increasing, profile),
        );
    } else {
        dice.forEach((term) => {
            const faceIndex = DIE_LADDER.indexOf(term.faces as (typeof DIE_LADDER)[number]);
            term.faces = DIE_LADDER[clamp(faceIndex + tierSteps, 0, 4)];
        });
    }

    stepCompoundFacesDown(dice, targetExpected);
    let bonus = reconstructDamageBonus(targetExpected, compoundBaseAverage(dice), role, mode, targetTier);
    if (bonus < 0) bonus = 0;

    if (mode === 'action' && increasing) {
        const averageDie = compoundBaseAverage(dice) / dice.reduce((total, term) => total + term.count, 0);
        const overagesToRemove = Math.floor(bonus / averageDie) - baseOverages;
        if (overagesToRemove > 0) {
            const primary = dice
                .map((term, index) => ({ index, contribution: term.count * (term.faces + 1) }))
                .sort((left, right) => right.contribution - left.contribution)[0];
            dice[primary.index].count += overagesToRemove;
            bonus = Math.max(
                0,
                reconstructDamageBonus(targetExpected, compoundBaseAverage(dice), role, mode, targetTier),
            );
        }
    }

    return formatDamageExpression({ dice, bonus, flat: false });
}

function scaleDamageExpression(
    formula: string,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    mode: DamageMode,
    targetExpectedOverride?: number,
): string | null {
    const parsed = parseDamageExpression(formula);
    if (!parsed) return null;
    if (parsed.flat || !parseDamageFormula(formula)) {
        return scaleCompoundDamageFormula(parsed, sourceTier, targetTier, role, mode, targetExpectedOverride);
    }
    return scaleFoundryDamageFormula(formula, sourceTier, targetTier, role, mode, targetExpectedOverride);
}

function scaleStandardAttack(
    attack: StatblockAttack | undefined,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    options: Required<ScalingOptions>,
    warnings: string[],
) {
    if (!attack) return undefined;

    const result = clone(attack);
    const damage = parseAttackDamage(attack.damage);
    if (!damage) {
        warnings.push(`Unsupported standard damage formula left unchanged: ${attack.damage}`);
        return result;
    }

    const scaledFormula =
        role === 'minion' && options.minionDamage === 'preserve'
            ? damage.formula
            : scaleDamageExpression(damage.formula, sourceTier, targetTier, role, 'attack');
    if (!scaledFormula) {
        warnings.push(`Unsupported standard damage formula left unchanged: ${attack.damage}`);
        return result;
    }
    result.damage = `${scaledFormula}${damage.suffix}`;
    return result;
}

function warnOnce(warnings: string[], warning: string) {
    if (!warnings.includes(warning)) warnings.push(warning);
}

function scaleFeatureDamageFormula(
    formula: string,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    sourceStandardExpected: number | null,
    targetStandardExpected: number | null,
    maximumRatio: number,
): string | null {
    const parsed = parseDamageExpression(formula);
    if (!parsed) return null;
    let targetExpected: number | undefined;
    if (sourceStandardExpected && targetStandardExpected) {
        const sourceRatio = expectedDamageExpression(parsed) / sourceStandardExpected;
        targetExpected = Math.min(
            ROLE_DAMAGE_BANDS[role][targetTier].max * maximumRatio,
            targetStandardExpected * clamp(sourceRatio, 0.25, maximumRatio),
        );
    }
    return scaleDamageExpression(formula, sourceTier, targetTier, role, 'action', targetExpected);
}

function featureDamageRatioLimit(feature: StatblockFeature, offset: number, formula: string): number {
    const surrounding = feature.description.slice(Math.max(0, offset - 160), offset + formula.length + 120);
    const cost = `${feature.parsedCost ?? ''} ${surrounding}`;
    if (/\b(?:spend(?:ing)?\s+(?:a|\d+)|costs?)\s+Fear\b|^\s*Fear\b/i.test(cost)) return 2;
    if (/\b(?:mark(?:ing)?\s+(?:a|\d+)|costs?)\s+Stress\b|^\s*Stress\b/i.test(cost)) return 1.5;
    if (/\b(additional|also|splash|secondary)\b/i.test(surrounding)) return 0.9;
    if (/\b(each|all)\s+(?:target|enemy|creature|adversary)|\btargets?\b[^.!?]{0,48}\bwithin\b/i.test(surrounding)) {
        return 0.9;
    }
    return 2;
}

function isExplicitFeatureDamageFormula(fullText: string, offset: number, formula: string): boolean {
    const before = fullText.slice(Math.max(0, offset - 72), offset);
    const after = fullText.slice(offset + formula.length, offset + formula.length + 72);

    // Resource amounts and target counts are never damage merely because an
    // earlier part of the sentence mentioned an attack or damage.
    if (/^\s*(?:Hope|Stress|Fear|HP|Armor Slots?|allies|adversaries|creatures|targets?)\b/i.test(after)) {
        return false;
    }

    return (
        /^\s+(?:(?:direct|physical|magic|magical)\s+){0,3}damage\b/i.test(after) ||
        /\b(?:damage|harm)(?:\s+(?:equal\s+to|by|of))?\s*$/i.test(before) ||
        /\b(?:deal|deals|dealt|take|takes|taking)(?:\s+an?)?(?:\s+additional)?\s*$/i.test(before) ||
        /^\s+(?:to|as)\s+(?:the\s+)?damage\b/i.test(after)
    );
}

function isExplicitFlatFeatureDamage(fullText: string, offset: number, formula: string): boolean {
    const before = fullText.slice(Math.max(0, offset - 96), offset);
    const after = fullText.slice(offset + formula.length, offset + formula.length + 72);
    const damageAfter = /^\s+(?:(?:direct|physical|magic|magical)\s+){0,3}damage\b/i.test(after);
    const dealingVerbBefore =
        /\b(?:deal|deals|dealt|take|takes|taking)(?:\s+an?)?(?:\s+(?:additional|extra))?\s*$/i.test(before) ||
        /\b(?:deal|deals|dealt|take|takes|taking)\b[^.!?;]{0,48}\bdamage\s+equal\s+to\s*$/i.test(before);
    return damageAfter && dealingVerbBefore;
}

function scaleFeatureDescription(
    feature: StatblockFeature,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    options: Required<ScalingOptions>,
    warnings: string[],
    sourceStandardExpected: number | null,
    targetStandardExpected: number | null,
): string {
    const description = feature.description;
    if (options.featureTextMode === 'structured-only') return description;

    for (const match of description.matchAll(ANY_DICE_TERM_PATTERN)) {
        const faces = Number(match[0].match(/d(\d+)/i)?.[1]);
        if (
            !DIE_LADDER.includes(faces as (typeof DIE_LADDER)[number]) &&
            isExplicitFeatureDamageFormula(description, match.index, match[0])
        ) {
            warnOnce(warnings, `Unsupported feature damage left unchanged (${feature.name}): ${match[0]}`);
        }
    }

    const scaleExpression = (requireDamageContext: boolean) => (formula: string, offset: number, fullText: string) => {
        if (
            (requireDamageContext || options.featureTextMode === 'damage-aware') &&
            !(requireDamageContext
                ? isExplicitFlatFeatureDamage(fullText, offset, formula)
                : isExplicitFeatureDamageFormula(fullText, offset, formula))
        ) {
            return formula;
        }

        const scaledFormula = scaleFeatureDamageFormula(
            formula,
            sourceTier,
            targetTier,
            role,
            sourceStandardExpected,
            targetStandardExpected,
            featureDamageRatioLimit(feature, offset, formula),
        );
        if (!scaledFormula) {
            warnOnce(warnings, `Unsupported feature damage formula left unchanged (${feature.name}): ${formula}`);
            return formula;
        }
        return scaledFormula;
    };

    const scaledDice = description.replace(DICE_EXPRESSION_PATTERN, scaleExpression(false));
    return scaledDice.replace(FLAT_DAMAGE_PATTERN, scaleExpression(true));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scaleStructuredRoleFeature(
    feature: StatblockFeature,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    targetAttack: StatblockAttack | undefined,
): StatblockFeature | null {
    if (role === 'minion') {
        const passive = feature.name.match(/\bMinion\s*\(\s*(\d+)\s*\)/i);
        if (!passive) return null;
        const sourceValue = Number(passive[1]);
        const targetValue = scaleBandValue(
            sourceValue,
            MINION_PASSIVE_BANDS[sourceTier],
            MINION_PASSIVE_BANDS[targetTier],
        );
        return {
            ...clone(feature),
            name: feature.name.replace(passive[0], `Minion (${targetValue})`),
            description: feature.description.replace(
                new RegExp(`(\\bFor every\\s+)${sourceValue}(\\s+damage\\b)`, 'gi'),
                `$1${targetValue}$2`,
            ),
        };
    }

    if (role === 'horde') {
        const passive = feature.name.match(/\bHorde\s*\(\s*([^)]+)\s*\)/i);
        if (!passive || !parseDamageExpression(passive[1])) return null;
        const targetDamage = targetAttack ? parseAttackDamage(targetAttack.damage) : null;
        const injuredFormula = targetDamage ? halveDamageFormula(targetDamage.formula) : null;
        if (!injuredFormula) return null;
        const sourceFormula = passive[1].trim();
        return {
            ...clone(feature),
            name: feature.name.replace(passive[0], `Horde (${injuredFormula})`),
            description: feature.description.replace(new RegExp(escapeRegExp(sourceFormula), 'gi'), injuredFormula),
        };
    }

    return null;
}

function scaleFeatureDamage(
    features: StatblockFeature[] | undefined,
    sourceTier: Tier,
    targetTier: Tier,
    role: Role,
    options: Required<ScalingOptions>,
    warnings: string[],
    sourceStandardExpected: number | null,
    targetStandardExpected: number | null,
    targetAttack: StatblockAttack | undefined,
): StatblockFeature[] | undefined {
    return features?.map((feature) => {
        const structured = scaleStructuredRoleFeature(feature, sourceTier, targetTier, role, targetAttack);
        if (structured) return structured;
        return {
            ...clone(feature),
            description: scaleFeatureDescription(
                feature,
                sourceTier,
                targetTier,
                role,
                options,
                warnings,
                sourceStandardExpected,
                targetStandardExpected,
            ),
        };
    });
}

function detectRole(type: string | undefined): Role {
    const role = (type ?? '').toLowerCase();
    if (role.includes('bruiser')) return 'bruiser';
    if (role.includes('horde')) return 'horde';
    if (role.includes('leader')) return 'leader';
    if (role.includes('minion')) return 'minion';
    if (role.includes('ranged')) return 'ranged';
    if (role.includes('skulk')) return 'skulk';
    if (role.includes('solo')) return 'solo';
    if (role.includes('support')) return 'support';
    if (role.includes('social')) return 'social';
    return 'standard';
}

function normalizeTier(value: number | string | undefined): Tier | null {
    const tier = Number(value);
    return Number.isInteger(tier) && tier >= 1 && tier <= 4 ? (tier as Tier) : null;
}

function normalizeTargetTier(value: number): Tier | null {
    if (!Number.isFinite(value)) return null;
    return clamp(Math.round(value), 1, 4) as Tier;
}

function scaleBandValue(value: number, source: StatBand, target: StatBand): number {
    if (value < source.min) return Math.round(target.min + value - source.min);
    if (value > source.max) return Math.round(target.max + value - source.max);
    if (source.min === source.max) return Math.round((target.min + target.max) / 2 + value - source.min);
    const percentile = (value - source.min) / (source.max - source.min);
    return Math.round(target.min + percentile * (target.max - target.min));
}

function applySocialCoreScaling(result: AdversaryInstance, sourceTier: Tier, targetTier: Tier) {
    const source = SOCIAL_STAT_BANDS[sourceTier];
    const target = SOCIAL_STAT_BANDS[targetTier];
    const difficulty = Number(result.difficulty);
    if (Number.isFinite(difficulty))
        result.difficulty = scaleBandValue(difficulty, source.difficulty, target.difficulty);
    if (typeof result.hp_stress.hp === 'number') {
        result.hp_stress.hp = scaleBandValue(result.hp_stress.hp, source.hp, target.hp);
    }
    if (typeof result.hp_stress.stress === 'number') {
        result.hp_stress.stress = scaleBandValue(result.hp_stress.stress, source.stress, target.stress);
    }
    if (typeof result.hp_stress.major_hp === 'number') {
        result.hp_stress.major_hp = scaleBandValue(result.hp_stress.major_hp, source.major, target.major);
    }
    if (typeof result.hp_stress.severe_hp === 'number') {
        result.hp_stress.severe_hp = scaleBandValue(result.hp_stress.severe_hp, source.severe, target.severe);
    }
    if (result.attack) {
        const modifier = Number(result.attack.modifier);
        if (Number.isFinite(modifier)) result.attack.modifier = scaleBandValue(modifier, source.attack, target.attack);
    }
}

function applyCoreScaling(result: AdversaryInstance, sourceTier: Tier, targetTier: Tier, role: Role) {
    if (role === 'social') {
        applySocialCoreScaling(result, sourceTier, targetTier);
        return;
    }

    for (const boundary of crossedBoundaries(sourceTier, targetTier)) {
        const delta = ROLE_BOUNDARY_DELTAS[role][boundary.tier];
        const difficulty = Number(result.difficulty);
        if (Number.isFinite(difficulty)) result.difficulty = difficulty + boundary.sign * delta.difficulty;

        if (typeof result.hp_stress.hp === 'number') result.hp_stress.hp += boundary.sign * delta.hp;
        if (typeof result.hp_stress.stress === 'number') result.hp_stress.stress += boundary.sign * delta.stress;
        if (typeof result.hp_stress.major_hp === 'number') {
            result.hp_stress.major_hp += boundary.sign * delta.major;
        }
        if (typeof result.hp_stress.severe_hp === 'number') {
            result.hp_stress.severe_hp += boundary.sign * delta.severe;
        }

        if (result.attack) {
            const modifier = Number(result.attack.modifier);
            if (Number.isFinite(modifier)) result.attack.modifier = modifier + boundary.sign * delta.attack;
        }
    }
}

function preserveLiveState(result: AdversaryInstance, live: AdversaryInstance, original: AdversaryInstance) {
    result._originalStats = clone(original);
    result.id = live.id;
    result.groupId = live.groupId;
    result.displayName = live.displayName;
    result.hasCustomName = live.hasCustomName;
    result.currentHp = Math.min(live.currentHp, result.hp_stress.hp);
    result.currentStress = Math.min(live.currentStress, result.hp_stress.stress);
    result.conditions = live.conditions ? clone(live.conditions) : undefined;
}

function applyCoreGuardrails(result: AdversaryInstance, original: AdversaryInstance) {
    const difficulty = Number(result.difficulty);
    if (Number.isFinite(difficulty)) result.difficulty = Math.max(1, difficulty);
    if (Number.isFinite(result.hp_stress.hp)) result.hp_stress.hp = Math.max(1, result.hp_stress.hp);
    if (Number.isFinite(result.hp_stress.stress)) result.hp_stress.stress = Math.max(0, result.hp_stress.stress);

    if (result.hp_stress.major_hp == null || result.hp_stress.severe_hp == null) return;
    if (!Number.isFinite(result.hp_stress.major_hp) || !Number.isFinite(result.hp_stress.severe_hp)) return;
    result.hp_stress.major_hp = Math.max(1, result.hp_stress.major_hp);
    if (result.hp_stress.severe_hp > result.hp_stress.major_hp) return;

    const originalMajor = original.hp_stress.major_hp;
    const originalSevere = original.hp_stress.severe_hp;
    const originalRatio =
        typeof originalMajor === 'number' &&
        typeof originalSevere === 'number' &&
        originalMajor > 0 &&
        originalSevere > originalMajor
            ? originalSevere / originalMajor
            : 2;
    result.hp_stress.severe_hp = Math.max(
        result.hp_stress.major_hp + 1,
        Math.round(result.hp_stress.major_hp * originalRatio),
    );
}

function collectReviewWarnings(result: AdversaryInstance, warnings: string[]) {
    if (
        result.hp_stress.major_hp != null &&
        result.hp_stress.severe_hp != null &&
        result.hp_stress.major_hp >= result.hp_stress.severe_hp
    ) {
        warnings.push('Scaled thresholds are not monotonic; manual review is required.');
    }

    const difficulty = Number(result.difficulty);
    if (
        !Number.isFinite(difficulty) ||
        !Number.isFinite(result.hp_stress.hp) ||
        !Number.isFinite(result.hp_stress.stress) ||
        result.hp_stress.hp < 1 ||
        result.hp_stress.stress < 0 ||
        difficulty < 1
    ) {
        warnings.push('A scaled core stat is outside safe bounds; manual review is required.');
    }
}

function collectDesignAdvisories(role: Role, sourceTier: Tier, targetTier: Tier, advisories: string[]) {
    if (Math.abs(targetTier - sourceTier) >= 2) {
        advisories.push(
            'This adversary moved two or more tiers; review whether its feature breadth still fits its new tier.',
        );
    }
    if (role === 'social') {
        advisories.push(
            'Social adversaries are fiction-led; consider separate Social and combat-phase statblocks when both modes matter.',
        );
    }
}

export class AdversaryScaler {
    /**
     * Scales from the immutable published stat block stored in `_originalStats`.
     * Repeated tier selections therefore never accumulate rounding or prose edits.
     */
    public static scale(
        adversary: AdversaryInstance,
        requestedTier: number,
        suppliedOptions: ScalingOptions = {},
    ): AdversaryInstance {
        return this.scaleWithResult(adversary, requestedTier, suppliedOptions).adversary;
    }

    public static scaleWithResult(
        adversary: AdversaryInstance,
        requestedTier: number,
        suppliedOptions: ScalingOptions = {},
    ): ScalingResult {
        const targetTier = normalizeTargetTier(requestedTier);
        if (!targetTier) return { adversary, warnings: [], advisories: [] };

        const original = clone((adversary._originalStats ?? adversary) as AdversaryInstance);
        delete original._originalStats;
        const sourceTier = normalizeTier(original.tier);
        if (!sourceTier) return { adversary, warnings: [], advisories: [] };

        const result = clone(original);
        const warnings: string[] = [];
        const advisories: string[] = [];
        const options = { ...DEFAULT_OPTIONS, ...suppliedOptions };
        if (targetTier !== sourceTier) {
            const role = detectRole(original.type);
            const normalizedType = (original.type ?? '').toLowerCase();
            if (
                ![...Object.keys(ROLE_BOUNDARY_DELTAS), 'social'].some((knownRole) =>
                    normalizedType.includes(knownRole),
                )
            ) {
                warnings.push(`Unknown adversary role "${original.type ?? ''}" used Standard scaling.`);
            }
            applyCoreScaling(result, sourceTier, targetTier, role);
            result.attack = scaleStandardAttack(result.attack, sourceTier, targetTier, role, options, warnings);
            result.features = scaleFeatureDamage(
                original.features,
                sourceTier,
                targetTier,
                role,
                options,
                warnings,
                attackExpectedDamage(original.attack),
                attackExpectedDamage(result.attack),
                result.attack,
            );
            result.tier = targetTier;
            applyCoreGuardrails(result, original);
            collectReviewWarnings(result, warnings);
            collectDesignAdvisories(role, sourceTier, targetTier, advisories);
        }

        preserveLiveState(result, adversary, original);
        return { adversary: result, warnings, advisories };
    }
}
