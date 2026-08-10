import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const result = await build({
    entryPoints: ['src/services/adversary-scaler.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
const { AdversaryScaler, expectedDamage, parseDamageFormula } = await import(moduleUrl);

// Frozen independently from the implementation so the catalogue sweep catches
// accidental changes to the RightKnight/Foundry additive tables.
const BENCHMARK_DELTAS = {
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

const SOCIAL_STAT_BANDS = {
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

const SOCIAL_DAMAGE_MAXIMUMS = { 1: 4.5, 2: 12, 3: 17, 4: 28 };
const MINION_PASSIVE_BANDS = {
    1: { min: 3, max: 5 },
    2: { min: 5, max: 7 },
    3: { min: 7, max: 9 },
    4: { min: 9, max: 12 },
};

const ROLE_DAMAGE_BANDS = {
    bruiser: { 1: [8, 11], 2: [12, 16], 3: [18, 22], 4: [30, 45] },
    horde: { 1: [5, 8], 2: [9, 13], 3: [14, 19], 4: [20, 30] },
    leader: { 1: [6, 9], 2: [12, 15], 3: [15, 18], 4: [25, 35] },
    minion: { 1: [1, 3], 2: [2, 4], 3: [5, 8], 4: [10, 12] },
    ranged: { 1: [6, 9], 2: [12, 16], 3: [15, 18], 4: [25, 35] },
    skulk: { 1: [5, 8], 2: [9, 13], 3: [14, 18], 4: [20, 35] },
    solo: { 1: [8, 11], 2: [15, 20], 3: [20, 30], 4: [30, 45] },
    standard: { 1: [4, 6], 2: [8, 12], 3: [12, 17], 4: [17, 28] },
    support: { 1: [3, 5], 2: [5, 12], 3: [13, 16], 4: [18, 25] },
    social: { 1: [2, 4], 2: [5, 12], 3: [12, 17], 4: [17, 28] },
};

function scaleSocialBandValue(value, source, target) {
    if (value < source.min) return Math.round(target.min + value - source.min);
    if (value > source.max) return Math.round(target.max + value - source.max);
    if (source.min === source.max) return Math.round((target.min + target.max) / 2 + value - source.min);
    const percentile = (value - source.min) / (source.max - source.min);
    return Math.round(target.min + percentile * (target.max - target.min));
}

function scaleGuideDamage(value, sourceTier, targetTier, role) {
    const [sourceMin, sourceMax] = ROLE_DAMAGE_BANDS[role][sourceTier];
    const [targetMin, targetMax] = ROLE_DAMAGE_BANDS[role][targetTier];
    if (value < sourceMin) return Math.max(1, targetMin + value - sourceMin);
    if (value > sourceMax) return targetMax + value - sourceMax;
    const percentile = (value - sourceMin) / (sourceMax - sourceMin);
    return targetMin + percentile * (targetMax - targetMin);
}

function maskScaledDiceExpressions(description) {
    return description
        .replace(
            /(\b(?:deal|deals|dealt|take|takes|taking)(?:\s+an?)?(?:\s+(?:additional|extra))?\s+)\d+(?=\s+(?:(?:direct|physical|magic|magical)\s+){0,3}damage\b)/gi,
            '$1<damage-expression>',
        )
        .replace(/\b\d+d(?:4|6|8|10|12|20)(?:[+-]\d+)?\b/gi, '<damage-expression>');
}

function normalizedRole(type) {
    const normalized = String(type).toLowerCase();
    return (
        ['bruiser', 'horde', 'leader', 'minion', 'ranged', 'skulk', 'solo', 'support', 'social'].find((role) =>
            normalized.includes(role),
        ) ?? 'standard'
    );
}

function boundaryDelta(role, sourceTier, targetTier, stat) {
    let value = 0;
    if (targetTier > sourceTier) {
        for (let tier = sourceTier + 1; tier <= targetTier; tier += 1) {
            value += BENCHMARK_DELTAS[role][tier][stat];
        }
    } else {
        for (let tier = sourceTier; tier > targetTier; tier -= 1) {
            value -= BENCHMARK_DELTAS[role][tier][stat];
        }
    }
    return value;
}

function expectedCoreStats(template, role, targetTier) {
    if (role === 'social') {
        const source = SOCIAL_STAT_BANDS[template.tier];
        const target = SOCIAL_STAT_BANDS[targetTier];
        return {
            difficulty: scaleSocialBandValue(template.difficulty, source.difficulty, target.difficulty),
            hp: scaleSocialBandValue(template.hp_stress.hp, source.hp, target.hp),
            stress: scaleSocialBandValue(template.hp_stress.stress, source.stress, target.stress),
            major:
                template.hp_stress.major_hp == null
                    ? null
                    : scaleSocialBandValue(template.hp_stress.major_hp, source.major, target.major),
            severe:
                template.hp_stress.severe_hp == null
                    ? null
                    : scaleSocialBandValue(template.hp_stress.severe_hp, source.severe, target.severe),
        };
    }

    const difficulty = Math.max(1, template.difficulty + boundaryDelta(role, template.tier, targetTier, 'difficulty'));
    const hp = Math.max(1, template.hp_stress.hp + boundaryDelta(role, template.tier, targetTier, 'hp'));
    const stress = Math.max(0, template.hp_stress.stress + boundaryDelta(role, template.tier, targetTier, 'stress'));
    const sourceMajor = template.hp_stress.major_hp;
    const sourceSevere = template.hp_stress.severe_hp;
    const major =
        sourceMajor == null ? null : Math.max(1, sourceMajor + boundaryDelta(role, template.tier, targetTier, 'major'));
    const additiveSevere =
        sourceSevere == null ? null : sourceSevere + boundaryDelta(role, template.tier, targetTier, 'severe');
    if (major == null || additiveSevere == null) {
        return { difficulty, hp, stress, major, severe: additiveSevere };
    }

    const sourceRatio = sourceMajor > 0 && sourceSevere > sourceMajor ? sourceSevere / sourceMajor : 2;
    const severe = additiveSevere > major ? additiveSevere : Math.max(major + 1, Math.round(major * sourceRatio));
    return { difficulty, hp, stress, major, severe };
}

const original = {
    id: 'adversary-1',
    groupId: 'group-1',
    name: 'Test Standard',
    displayName: 'Test Standard',
    category: 'adversary',
    tier: 1,
    type: 'Standard',
    difficulty: 12,
    hp_stress: { hp: 4, stress: 2, major_hp: 7, severe_hp: 14 },
    currentHp: 4,
    currentStress: 0,
    attack: { name: 'Strike', range: 'Melee', damage: '1d6+1 phy', modifier: 1 },
    features: [
        {
            name: 'Burst',
            type: 'Action',
            description: 'Deal 1d6 physical damage, gain 1 Fear, then start Countdown (5).',
        },
    ],
};

assert.deepEqual(parseDamageFormula('2d8+3'), { count: 2, faces: 8, bonus: 3, flat: false });
assert.equal(expectedDamage('2d8+3'), 12);
assert.equal(expectedDamage('4'), 4);
assert.equal(parseDamageFormula('1d6+1d4'), null, 'compound formulas must not be guessed at');
assert.deepEqual(parseDamageFormula('1d20'), { count: 1, faces: 20, bonus: 0, flat: false });

const tierTwoResult = AdversaryScaler.scaleWithResult(structuredClone(original), 2);
const tierTwo = tierTwoResult.adversary;
assert.equal(tierTwo.tier, 2);
assert.equal(tierTwo.difficulty, 14);
assert.deepEqual(tierTwo.hp_stress, { hp: 4, stress: 2, major_hp: 10, severe_hp: 22 });
assert.equal(tierTwo.attack.modifier, 2);
assert.equal(tierTwo.attack.damage, '2d6+2 phy');
assert.match(tierTwo.attack.damage, / phy$/, 'the plugin damage-type suffix must survive reconstruction');
assert.equal(tierTwo.features[0].description, 'Deal 1d8+3 physical damage, gain 1 Fear, then start Countdown (5).');
assert.deepEqual(tierTwoResult.warnings, [], 'routine scaling must not burden the GM with implementation details');
assert.deepEqual(tierTwoResult.advisories, []);
assert.equal(tierTwo._originalStats.tier, 1);
assert.equal(original._originalStats, undefined, 'scaling must not mutate the live input to install its snapshot');

const bear = {
    ...structuredClone(original),
    id: 'bear',
    name: 'Bear',
    displayName: 'Bear',
    type: 'Bruiser',
    difficulty: 14,
    hp_stress: { hp: 7, stress: 2, major_hp: 9, severe_hp: 17 },
    currentHp: 7,
    attack: { name: 'Claws', range: 'Melee', damage: '1d8+3 phy', modifier: 1 },
};
const bearTierTwo = AdversaryScaler.scale(bear, 2);
assert.equal(bearTierTwo.difficulty, 16);
assert.deepEqual(bearTierTwo.hp_stress, { hp: 8, stress: 4, major_hp: 14, severe_hp: 27 });
assert.deepEqual(bearTierTwo.attack, { name: 'Claws', range: 'Melee', damage: '2d8+3 phy', modifier: 3 });

const bearTierThree = AdversaryScaler.scale(bear, 3);
assert.equal(bearTierThree.difficulty, 18);
assert.deepEqual(bearTierThree.hp_stress, { hp: 9, stress: 4, major_hp: 21, severe_hp: 42 });
assert.equal(bearTierThree.attack.damage, '3d8+4 phy');
assert.equal(bearTierThree.attack.modifier, 5);

const bearTierFourResult = AdversaryScaler.scaleWithResult(bear, 4);
const bearTierFour = bearTierFourResult.adversary;
assert.equal(bearTierFour.difficulty, 20);
assert.deepEqual(bearTierFour.hp_stress, { hp: 10, stress: 4, major_hp: 33, severe_hp: 67 });
assert.equal(bearTierFour.attack.damage, '4d8+12 phy');
assert.equal(bearTierFour.attack.modifier, 7);
assert.deepEqual(bearTierFourResult.warnings, []);
assert.match(bearTierFourResult.advisories[0], /two or more tiers/);

const minion = {
    ...structuredClone(original),
    id: 'rat',
    name: 'Giant Rat',
    displayName: 'Giant Rat',
    type: 'Minion',
    difficulty: 10,
    hp_stress: { hp: 1, stress: 1, major_hp: null, severe_hp: null },
    currentHp: 1,
    attack: { name: 'Claws', range: 'Melee', damage: '1 phy', modifier: -4 },
    features: [
        {
            name: 'Minion (3) - Passive',
            type: 'Passive',
            description: 'For every 3 damage a PC deals, defeat an additional Minion within range.',
        },
    ],
};
const minionTierTwoResult = AdversaryScaler.scaleWithResult(minion, 2);
assert.equal(minionTierTwoResult.adversary.attack.damage, '2 phy');
assert.equal(minionTierTwoResult.adversary.attack.modifier, -3);
assert.equal(minionTierTwoResult.adversary.hp_stress.major_hp, null);
assert.equal(minionTierTwoResult.adversary.hp_stress.severe_hp, null);
assert.equal(minionTierTwoResult.adversary.features[0].name, 'Minion (5) - Passive');
assert.match(minionTierTwoResult.adversary.features[0].description, /For every 5 damage/);
assert.deepEqual(minionTierTwoResult.warnings, [], 'absent Minion thresholds are normal, not a warning');
assert.equal(AdversaryScaler.scale(minion, 2, { minionDamage: 'preserve' }).attack.damage, '1 phy');
assert.match(AdversaryScaler.scale(minion, 4).features[0].name, /Minion \(9\)/);
assert.equal(
    AdversaryScaler.scale(minion, 2, { featureTextMode: 'structured-only' }).features[0].name,
    'Minion (5) - Passive',
);

const horde = {
    ...structuredClone(original),
    id: 'mosquitoes',
    name: 'Giant Mosquitoes',
    displayName: 'Giant Mosquitoes',
    type: 'Horde (5/HP)',
    attack: { name: 'Proboscis', range: 'Melee', damage: '1d8+3 phy', modifier: -2 },
    features: [
        {
            name: 'Horde (1d4+1) - Passive',
            type: 'Passive',
            description: 'When marked half HP, their standard attack deals 1d4+1 physical damage instead.',
        },
    ],
};
const hordeTierTwo = AdversaryScaler.scale(horde, 2);
assert.equal(hordeTierTwo.attack.damage, '2d8+3 phy');
assert.equal(hordeTierTwo.features[0].name, 'Horde (1d8+2) - Passive');
assert.match(hordeTierTwo.features[0].description, /deals 1d8\+2 physical damage instead/);
assert.ok(
    Math.abs(expectedDamage('1d8+2') - expectedDamage('2d8+3') / 2) <= 0.5,
    'the Horde passive should average half of its scaled standard attack',
);
assert.equal(
    AdversaryScaler.scale(horde, 2, { featureTextMode: 'structured-only' }).features[0].name,
    hordeTierTwo.features[0].name,
    'structured-only mode should still scale explicit Horde mechanics',
);
assert.deepEqual(
    AdversaryScaler.scale(AdversaryScaler.scale(horde, 2), 3),
    AdversaryScaler.scale(horde, 3),
    'structured role mechanics must remain path-independent',
);

const social = {
    ...structuredClone(original),
    id: 'courtier',
    name: 'Courtier',
    displayName: 'Courtier',
    type: 'Social',
    difficulty: 12,
    hp_stress: { hp: 3, stress: 4, major_hp: 4, severe_hp: 8 },
    currentHp: 3,
    attack: { name: 'Daggers', range: 'Melee', damage: '1d4+2 phy', modifier: -4 },
    features: [],
};
const socialTierTwoResult = AdversaryScaler.scaleWithResult(social, 2);
assert.equal(socialTierTwoResult.adversary.difficulty, 15);
assert.deepEqual(socialTierTwoResult.adversary.hp_stress, { hp: 3, stress: 4, major_hp: 7, severe_hp: 16 });
assert.equal(socialTierTwoResult.adversary.attack.damage, '1d4+3 phy');
assert.equal(socialTierTwoResult.adversary.attack.modifier, -3);
assert.deepEqual(socialTierTwoResult.warnings, []);
assert.match(socialTierTwoResult.advisories[0], /separate Social and combat-phase statblocks/);

const socialTierThree = AdversaryScaler.scale(social, 3);
assert.equal(socialTierThree.difficulty, 17);
assert.deepEqual(socialTierThree.hp_stress, { hp: 4, stress: 4, major_hp: 18, severe_hp: 30 });
assert.equal(socialTierThree.attack.damage, '3d6+3 phy');
assert.equal(socialTierThree.attack.modifier, -2);

const socialTierFourResult = AdversaryScaler.scaleWithResult(social, 4);
assert.equal(socialTierFourResult.adversary.difficulty, 19);
assert.deepEqual(socialTierFourResult.adversary.hp_stress, { hp: 4, stress: 4, major_hp: 30, severe_hp: 45 });
assert.equal(socialTierFourResult.adversary.attack.damage, '4d6+4 phy');
assert.equal(socialTierFourResult.adversary.attack.modifier, 2);
assert.deepEqual(socialTierFourResult.warnings, []);
assert.equal(socialTierFourResult.advisories.length, 2);

const monarch = {
    ...structuredClone(social),
    id: 'monarch',
    name: 'Monarch',
    displayName: 'Monarch',
    tier: 3,
    difficulty: 16,
    hp_stress: { hp: 6, stress: 5, major_hp: 16, severe_hp: 32 },
    currentHp: 6,
    attack: { name: 'Scepter', range: 'Melee', damage: '3d6+3 phy', modifier: 0 },
};
const monarchTierOne = AdversaryScaler.scale(monarch, 1);
assert.equal(monarchTierOne.difficulty, 11);
assert.deepEqual(monarchTierOne.hp_stress, { hp: 5, stress: 5, major_hp: 3, severe_hp: 9 });
assert.equal(monarchTierOne.attack.damage, '1d6+1 phy');
assert.equal(monarchTierOne.attack.modifier, -2);

const d20Attack = {
    ...structuredClone(original),
    attack: { name: 'Crush', range: 'Melee', damage: '1d20 phy/mag', modifier: 1 },
};
const d20Result = AdversaryScaler.scaleWithResult(d20Attack, 2);
assert.doesNotMatch(d20Result.adversary.attack.damage, /d20/);
assert.equal(
    d20Result.warnings.some((warning) => warning.startsWith('Unsupported standard damage formula')),
    false,
);

const combatSocial = {
    ...structuredClone(social),
    attack: { name: 'Command', range: 'Far', damage: '1d6+1 mag', modifier: -1 },
};
assert.equal(
    AdversaryScaler.scale(combatSocial, 2).attack.damage,
    '2d6+2 mag',
    "combat-capable Social attacks should follow the guide's two-die Tier 2 path",
);

const featureModes = {
    ...structuredClone(original),
    features: [
        { name: 'Cataclysm', type: 'Action', description: 'Deal 1d20 magic damage and lose 1d4 Hope.' },
        { name: 'Rally', type: 'Action', description: 'Spotlight up to 2d4 allies within Far range. Countdown (5).' },
        {
            name: 'Threshold Strike',
            type: 'Action',
            description: "Deal physical damage equal to 3d4 + the target's Major threshold.",
        },
        { name: 'Certainty', type: 'Action', description: 'Deal 7 direct damage.' },
        {
            name: 'Splash',
            type: 'Reaction',
            description: 'Deal 1d12+6 physical damage to each target within Close range.',
        },
        {
            name: 'Fear Nova',
            type: 'Action',
            parsedCost: 'Fear 1',
            description: 'Spend a Fear to deal 1d12+6 physical damage to each target within Close range.',
        },
        {
            name: 'Stress Nova',
            type: 'Action',
            parsedCost: 'Stress 1',
            description: 'Mark a Stress to deal 1d12+6 physical damage to each target within Close range.',
        },
    ],
};
const damageAwareFeatures = AdversaryScaler.scaleWithResult(featureModes, 2);
assert.doesNotMatch(damageAwareFeatures.adversary.features[0].description, /1d20/);
assert.match(damageAwareFeatures.adversary.features[0].description, /lose 1d4 Hope/);
assert.match(damageAwareFeatures.adversary.features[1].description, /2d4 allies/);
assert.equal(
    damageAwareFeatures.adversary.features[2].description,
    "Deal physical damage equal to 4d6+1 + the target's Major threshold.",
    'the static component of a dynamic damage formula should scale without rewriting the dynamic term',
);
assert.equal(
    damageAwareFeatures.adversary.features[5].description,
    'Spend a Fear to deal 2d12+5 physical damage to each target within Close range.',
    'Fear-priced area damage should retain its source strength instead of being treated as free splash damage',
);
assert.equal(
    damageAwareFeatures.adversary.features[6].description,
    'Mark a Stress to deal 2d12+1 physical damage to each target within Close range.',
    'Stress-priced area damage should scale above free area damage but below a Fear move',
);
assert.equal(
    damageAwareFeatures.adversary.features[3].description,
    'Deal 14 direct damage.',
    'explicit flat feature damage should preserve its relationship to the standard attack',
);
assert.equal(
    damageAwareFeatures.adversary.features[4].description,
    'Deal 1d12+2 physical damage to each target within Close range.',
    'secondary and area damage must stay below the scaled standard attack',
);
assert.deepEqual(damageAwareFeatures.warnings, []);

const allDiceFeatures = AdversaryScaler.scale(featureModes, 2, { featureTextMode: 'all-dice' });
assert.doesNotMatch(allDiceFeatures.features[1].description, /2d4 allies/);
assert.doesNotMatch(allDiceFeatures.features[0].description, /lose 1d4 Hope/);
assert.match(allDiceFeatures.features[1].description, /Countdown \(5\)/);
assert.equal(allDiceFeatures.features[2].description, damageAwareFeatures.adversary.features[2].description);

const structuredOnlyFeatures = AdversaryScaler.scale(featureModes, 2, { featureTextMode: 'structured-only' });
assert.deepEqual(structuredOnlyFeatures.features, featureModes.features);

const support = {
    ...structuredClone(original),
    id: 'hexer',
    name: 'Jagged Knife Hexer',
    displayName: 'Jagged Knife Hexer',
    type: 'Support',
    attack: { name: 'Staff', range: 'Melee', damage: '1d6+2 mag', modifier: 1 },
    features: [],
};
assert.equal(AdversaryScaler.scale(support, 2).attack.damage, '2d6+6 mag');
assert.equal(AdversaryScaler.scale(support, 3).attack.damage, '3d6+6 mag');
assert.equal(AdversaryScaler.scale(support, 4).attack.damage, '4d6+12 mag');

const flatStandard = {
    ...structuredClone(original),
    attack: { name: 'Impact', range: 'Melee', damage: '6 phy', modifier: 1 },
    features: [],
};
assert.equal(AdversaryScaler.scale(flatStandard, 2).attack.damage, '12 phy');

const compoundDamage = {
    ...structuredClone(original),
    attack: { name: 'Twin Strike', range: 'Melee', damage: '1d6+1d4+2 phy', modifier: 1 },
    features: [{ name: 'Split Burst', type: 'Action', description: 'Deal 1d6+1d4+2 physical damage.' }],
};
const compoundTierThree = AdversaryScaler.scaleWithResult(compoundDamage, 3);
assert.equal(compoundTierThree.adversary.attack.damage, '2d6+1d4+10 phy');
assert.equal(compoundTierThree.adversary.features[0].description, 'Deal 3d10+1d8 physical damage.');
assert.deepEqual(compoundTierThree.warnings, []);
assert.deepEqual(
    AdversaryScaler.scale(AdversaryScaler.scale(compoundDamage, 2), 3),
    compoundTierThree.adversary,
    'compound expressions must remain path-independent',
);

const extremeSolo = {
    ...structuredClone(original),
    tier: 3,
    type: 'Solo',
    attack: { name: 'Worldbreaker', range: 'Melee', damage: '3d20 phy', modifier: 5 },
    features: [],
};
const extremeSoloTierFour = AdversaryScaler.scale(extremeSolo, 4);
assert.equal(extremeSoloTierFour.attack.damage, '4d12+21 phy');
assert.doesNotMatch(
    extremeSoloTierFour.attack.damage,
    /d20/,
    'd20 input must normalize onto the ordinary output ladder',
);
assert.ok(
    expectedDamage(extremeSoloTierFour.attack.damage.split(' ')[0]) <= 47,
    'an extreme Solo should preserve only its small absolute deviation above the destination guide band',
);

const identityDamage = ['1d4+1', '1d8+2', '1d12+6'].map((damage) =>
    expectedDamage(
        AdversaryScaler.scale(
            {
                ...structuredClone(original),
                attack: { name: damage, range: 'Melee', damage: `${damage} phy`, modifier: 1 },
                features: [],
            },
            4,
        ).attack.damage.split(' ')[0],
    ),
);
assert.ok(
    identityDamage[0] < identityDamage[1] && identityDamage[1] < identityDamage[2],
    'weak, ordinary, and signature attacks must keep their relative identity',
);

const unknownRole = AdversaryScaler.scaleWithResult({ ...structuredClone(original), type: 'Mystic' }, 2);
assert.equal(unknownRole.adversary.difficulty, 14);
assert.deepEqual(unknownRole.warnings, ['Unknown adversary role "Mystic" used Standard scaling.']);

const unsupportedDamage = AdversaryScaler.scaleWithResult(
    {
        ...structuredClone(original),
        attack: { name: 'Odd Die', range: 'Melee', damage: '2d7+1 phy', modifier: 1 },
        features: [{ name: 'Odd Burst', type: 'Action', description: 'Deal 2d7+1 physical damage.' }],
    },
    2,
);
assert.equal(unsupportedDamage.adversary.attack.damage, '2d7+1 phy');
assert.equal(unsupportedDamage.adversary.features[0].description, 'Deal 2d7+1 physical damage.');
assert.ok(unsupportedDamage.warnings.some((warning) => warning.startsWith('Unsupported standard damage')));
assert.ok(unsupportedDamage.warnings.some((warning) => warning.startsWith('Unsupported feature damage')));

const afterHop = AdversaryScaler.scale(AdversaryScaler.scale(structuredClone(bear), 2), 3);
const directTierThree = AdversaryScaler.scale(structuredClone(bear), 3);
assert.deepEqual(afterHop, directTierThree, 'tier changes must always recompute from the immutable source');
const afterFourHops = AdversaryScaler.scale(
    AdversaryScaler.scale(AdversaryScaler.scale(structuredClone(bear), 2), 3),
    4,
);
assert.deepEqual(afterFourHops, bearTierFour, 'direct and sequential tier paths must be identical');

tierTwo.id = 'live-instance-id';
tierTwo.groupId = 'live-group-id';
tierTwo.displayName = 'The one on the roof';
tierTwo.hasCustomName = true;
tierTwo.currentHp = 3;
tierTwo.currentStress = 1;
tierTwo.conditions = [{ name: 'Vulnerable', description: 'Attacks have advantage.' }];
const reverted = AdversaryScaler.scale(tierTwo, 1);
assert.equal(reverted.tier, 1);
assert.equal(reverted.id, 'live-instance-id');
assert.equal(reverted.groupId, 'live-group-id');
assert.equal(reverted.displayName, 'The one on the roof');
assert.equal(reverted.hasCustomName, true);
assert.equal(reverted.currentHp, 3);
assert.equal(reverted.currentStress, 1);
assert.deepEqual(reverted.conditions, tierTwo.conditions);
assert.equal(reverted.difficulty, original.difficulty);
assert.deepEqual(reverted.hp_stress, original.hp_stress);
assert.deepEqual(reverted.attack, original.attack);
assert.deepEqual(reverted.features, original.features);
assert.equal(Number(reverted._originalStats.tier), 1);

const clamped = AdversaryScaler.scale(reverted, 99);
assert.equal(clamped.tier, 4);
assert.equal(clamped._originalStats.tier, 1);

const bundledAdversaries = JSON.parse((await readFile('data/adversaries.json', 'utf8')).replace(/^\uFEFF/, ''));
let officialWarningOperations = 0;
const catalogue = [];
for (const raw of bundledAdversaries) {
    const [majorHp, severeHp] = raw.thresholds?.split('/') ?? [];
    const numericMajorHp = majorHp && Number.isFinite(Number(majorHp)) ? Number(majorHp) : null;
    const numericSevereHp = severeHp && Number.isFinite(Number(severeHp)) ? Number(severeHp) : null;
    const template = {
        name: raw.name,
        category: 'adversary',
        tier: Number(raw.tier),
        type: raw.type,
        difficulty: Number(raw.difficulty),
        hp_stress: {
            hp: Number(raw.hp) || 0,
            stress: Number(raw.stress) || 0,
            major_hp: numericMajorHp,
            severe_hp: numericSevereHp,
        },
        attack: { name: raw.attack, range: raw.range, damage: raw.damage, modifier: Number(raw.atk) },
        features: raw.feats?.map((feature) => ({ name: feature.name, type: '', description: feature.text })),
    };
    const instance = {
        ...structuredClone(template),
        id: `bundled-${template.name}`,
        groupId: `bundled-group-${template.name}`,
        displayName: template.name,
        currentHp: template.hp_stress.hp,
        currentStress: 0,
    };
    const role = normalizedRole(template.type);
    catalogue.push({ template, instance, role });

    for (const targetTier of [1, 2, 3, 4]) {
        const scalingResult = AdversaryScaler.scaleWithResult(instance, targetTier);
        const scaled = scalingResult.adversary;
        if (scalingResult.warnings.length) officialWarningOperations += 1;
        assert.deepEqual(scalingResult.warnings, [], `${template.name} should scale without GM intervention`);
        const expectedCore = expectedCoreStats(template, role, targetTier);
        assert.equal(Number(scaled.tier), targetTier, `${template.name} should reach tier ${targetTier}`);
        assert.equal(
            Number(scaled.difficulty),
            expectedCore.difficulty,
            `${template.name} Difficulty must use only ${role} boundary deltas`,
        );
        assert.equal(
            scaled.hp_stress.hp,
            expectedCore.hp,
            `${template.name} HP must use ${role} boundary deltas with a playable minimum`,
        );
        assert.equal(
            scaled.hp_stress.stress,
            expectedCore.stress,
            `${template.name} Stress must use ${role} boundary deltas with a safe minimum`,
        );
        if (template.hp_stress.major_hp == null) assert.equal(scaled.hp_stress.major_hp, null);
        else {
            assert.equal(
                scaled.hp_stress.major_hp,
                expectedCore.major,
                `${template.name} Major threshold must remain playable after ${role} boundary deltas`,
            );
        }
        if (template.hp_stress.severe_hp == null) assert.equal(scaled.hp_stress.severe_hp, null);
        else {
            assert.equal(
                scaled.hp_stress.severe_hp,
                expectedCore.severe,
                `${template.name} Severe threshold must preserve a valid relationship to Major`,
            );
        }

        if (template.name === 'Fallen Warlord: Undefeated Champion' && targetTier === 1) {
            assert.deepEqual(
                [scaled.hp_stress.major_hp, scaled.hp_stress.severe_hp],
                [11, 18],
                'extreme Solo downscaling must repair crossed thresholds using the source ratio',
            );
        }
        if (template.name === 'Hallowed Archer' && targetTier === 1) {
            assert.equal(scaled.hp_stress.hp, 1, 'extreme Ranged downscaling must retain at least 1 HP');
        }
        if (template.name === 'Volcanic Dragon: Ashen Tyrant' && targetTier === 1) {
            assert.deepEqual(
                [scaled.hp_stress.major_hp, scaled.hp_stress.severe_hp],
                [5, 9],
                'extreme Solo downscaling must separate equal thresholds using the source ratio',
            );
        }
        if (Number.isFinite(template.attack.modifier)) {
            const expectedAttack =
                role === 'social'
                    ? scaleSocialBandValue(
                          template.attack.modifier,
                          SOCIAL_STAT_BANDS[template.tier].attack,
                          SOCIAL_STAT_BANDS[targetTier].attack,
                      )
                    : template.attack.modifier + boundaryDelta(role, template.tier, targetTier, 'attack');
            assert.equal(
                Number(scaled.attack.modifier),
                expectedAttack,
                `${template.name} Attack must use the ${role} destination policy`,
            );
        }

        assert.equal(scaled.features?.length, template.features?.length, `${template.name} must retain every feature`);
        scaled.features?.forEach((feature, index) => {
            const sourceFeature = template.features[index];
            const structuredHorde = role === 'horde' && /^Horde\s*\(/i.test(sourceFeature.name);
            const structuredMinion = role === 'minion' && /^Minion\s*\(/i.test(sourceFeature.name);
            if (!structuredHorde && !structuredMinion) {
                assert.equal(feature.name, sourceFeature.name, `${template.name} feature names must not change`);
            }
            assert.equal(feature.type, template.features[index].type, `${template.name} feature types must not change`);

            if (targetTier !== template.tier && structuredHorde) {
                const formula = feature.name.match(/^Horde\s*\(([^)]+)\)/i)?.[1];
                assert.ok(formula, `${template.name} must retain a readable Horde passive`);
                assert.match(feature.description, new RegExp(formula.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
                assert.ok(
                    Math.abs(expectedDamage(formula) - standardExpected(scaled) / 2) <= 0.5,
                    `${template.name} Horde damage should average half its scaled standard attack`,
                );
            }
            if (targetTier !== template.tier && structuredMinion) {
                const sourcePassive = Number(sourceFeature.name.match(/^Minion\s*\((\d+)\)/i)?.[1]);
                const passive = Number(feature.name.match(/^Minion\s*\((\d+)\)/i)?.[1]);
                assert.equal(
                    passive,
                    scaleSocialBandValue(
                        sourcePassive,
                        MINION_PASSIVE_BANDS[template.tier],
                        MINION_PASSIVE_BANDS[targetTier],
                    ),
                    `${template.name} Minion passive should preserve its deviation through the destination guide band`,
                );
                assert.match(feature.description, new RegExp(`For every ${passive} damage`, 'i'));
            }
            const protectedDice = [
                ...template.features[index].description.matchAll(
                    /\b\d+d(?:4|6|8|10|12|20)(?:[+-]\d+)?(?=\s+(?:Hope|Stress|Fear|HP|Armor Slots?|allies|adversaries|creatures|targets?))/gi,
                ),
            ];
            for (const match of protectedDice) {
                assert.match(
                    feature.description,
                    new RegExp(`${match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'i'),
                    `${template.name} must not scale non-damage resource or target dice in ${feature.name}`,
                );
            }
            if (!structuredMinion) {
                assert.equal(
                    maskScaledDiceExpressions(feature.description),
                    maskScaledDiceExpressions(template.features[index].description),
                    `${template.name} must only rewrite supported dice expressions`,
                );
            }
        });
        if (targetTier === template.tier) {
            assert.deepEqual(
                scaled.features,
                template.features,
                `${template.name} must return exactly to source prose`,
            );
        }

        const sourceDamage = parseDamageFormula(template.attack.damage.split(' ')[0]);
        const scaledDamage = parseDamageFormula(scaled.attack.damage.split(' ')[0]);
        if (targetTier !== template.tier && sourceDamage && scaledDamage) {
            if (role !== 'social') {
                const expectedGuideDamage = scaleGuideDamage(
                    expectedDamage(template.attack.damage.split(' ')[0]),
                    template.tier,
                    targetTier,
                    role,
                );
                const reconstructableGuideDamage = sourceDamage.flat
                    ? expectedGuideDamage
                    : Math.max(targetTier * 2.5, expectedGuideDamage);
                assert.ok(
                    Math.abs(standardExpected(scaled) - reconstructableGuideDamage) <= 0.5,
                    `${template.name} Tier ${template.tier}→${targetTier} damage ${standardExpected(scaled)} should preserve guide target ${expectedGuideDamage} in the ${role} band`,
                );
            }
            if (sourceDamage.flat) assert.equal(scaledDamage.flat, true, `${template.name} must retain flat damage`);
            else {
                const combatSocial =
                    role === 'social' && sourceDamage.faces >= 6 && (template.tier !== 2 || sourceDamage.count >= 2);
                const expectedCount =
                    role === 'social' && targetTier === 2
                        ? combatSocial
                            ? 2
                            : 1
                        : Math.max(targetTier > template.tier ? sourceDamage.count : 0, targetTier);
                assert.equal(scaledDamage.count, expectedCount, `${template.name} must use Foundry attack dice counts`);
                assert.notEqual(scaledDamage.faces, 20, `${template.name} must not generate d20 damage`);
            }
        }
    }
}

assert.equal(officialWarningOperations, 0, 'every bundled official adversary should scale without GM intervention');

for (const { instance, role } of catalogue) {
    if (role !== 'social') continue;
    for (const targetTier of [1, 2, 3, 4]) {
        const scaled = AdversaryScaler.scale(instance, targetTier);
        assert.ok(
            standardExpected(scaled) <= SOCIAL_DAMAGE_MAXIMUMS[targetTier],
            `${instance.name} Tier ${targetTier} damage must stay inside the RightKnight Social band`,
        );
    }
}

function standardExpected(adversary) {
    return expectedDamage(adversary.attack.damage.split(' ')[0]);
}

console.log('Recommended adversary scaler regressions passed');
