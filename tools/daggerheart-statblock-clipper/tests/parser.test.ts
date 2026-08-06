import assert from 'node:assert/strict';
import { test } from 'vitest';

import * as parsers from '../src/parsers/index';
import {
    cardDescriptionCandidatesFromText,
    cardDescriptionFromText,
    domCardDescription,
    enrichFreshCutGrassItems,
} from '../src/parsers/freshcutgrass/card-boundary';
import {
    toToolkitStatblock,
    toToolkitMarkdown,
    toToolkitMarkdownMany,
    toToolkitJson,
    toToolkitJsonMany,
    toToolkitYaml,
    toToolkitExport,
} from '../src/format/adapter';

/** The assertions below were written against the globals the old IIFE chain
 * installed. Republish the module exports under those names so the regression
 * coverage keeps running against the shipping code. */
const parser = {
    ...parsers,
    toToolkitStatblock,
    toToolkitMarkdown,
    toToolkitJson,
    toToolkitMarkdownMany,
    toToolkitJsonMany,
    toToolkitYaml,
    toToolkitExport,
    toRawJson: (s: any) => JSON.stringify(s, null, 2),
    toRawJsonMany: (items: any) => JSON.stringify(items, null, 2),
};
globalThis.DHStatblockParser = parser;
globalThis.DHFreshCutGrassCardBoundary = {
    cardDescriptionCandidatesFromText,
    cardDescriptionFromText,
    domCardDescription,
    enrichFreshCutGrassItems,
} as any;

test('FreshCutGrass attack-heading and comment-description regressions', () => {
    const parser = globalThis.DHStatblockParser;

    const parsed = parser.parseText(
        `Bog Knight\nManage\nTier\n2\nType\nBruiser\nDifficulty\n15\nHP\n7\nStress\n3\nThresholds: 10 / 18\nATK: +3 | Rusty Blade: Melee | 2d8+3 Physical\nFeatures\nSink – Action: Pull a target under.`,
    );
    assert.equal(parsed.name, 'Bog Knight');
    assert.equal(parser.toToolkitStatblock(parsed).attack.name, 'Rusty Blade');

    const heart = parser.parseText(
        `Lectors\nTier: 3\nType: Support\nDifficulty: 16\nHP: 6\nStress: 5\nFeatures\nPassives\n—\nActions\nMental Skim\nTarget creature makes a Presence or Instinct Reaction roll. On a failure it learns an immediate intention.\nMind Spike\nfear 1\nThis adversary makes an Attack Roll and deals 1d8 magic damage.\nReactions\nParalytic Suggestion\nstress 1\nWhen a creature declares an action, force an Instinct reaction roll.\nMotives & tactics\nCorrect, control.`,
    );
    assert.equal(heart.features.length, 3);
    assert.deepEqual(
        heart.features.map((item: any) => item.type),
        ['Action', 'Action', 'Reaction'],
    );
    assert.equal(heart.features[1].parsedCost, 'Fear 1');

    const second = parser.parseText(
        `Mire Hag\nManage\nTier: 2\nType: Leader\nDifficulty: 16\nHP: 6\nStress: 4\nATK: +4 | Crooked Staff: Far | 2d6+5 Magical\nFeatures\nBog Call – Action: Summon a swamp creature.`,
    );
    assert.equal((parser.toToolkitMarkdownMany([parsed, second]).match(/```daggerheart-statblock/g) || []).length, 2);

    // This used to assert a bare array, because no test loaded
    // statblock-format-adapter.js — the popup did, so the shipped output was
    // always the shared format's envelope. The assertion now matches what
    // users actually get.
    const envelope = JSON.parse(parser.toToolkitJsonMany([parsed, second]));
    assert.equal(Array.isArray(envelope.data), true);
    assert.equal(envelope.data.length, 2);
    assert.ok(envelope.version, 'envelope carries a format version');

    const shadowHagState = {
        targetId: 'uoHvyG83mBqs4YAxPpGB8n',
        candidates: [
            {
                path: 'dom.__reactProps.other',
                score: 40,
                value: {
                    id: 'other',
                    name: 'Not Shadow Hag',
                    tier: 2,
                    role: 'Solo',
                    difficulty: 15,
                    hp: 7,
                    stress: 4,
                    features: [{ name: 'Other Feature', type: 'Action', description: 'Other.' }],
                },
            },
            {
                path: 'dom.__reactProps.homebrew',
                score: 90,
                value: {
                    id: 'uoHvyG83mBqs4YAxPpGB8n',
                    data: {
                        name: 'Shadow Hag',
                        tier: 2,
                        role: 'Solo',
                        description: 'A fey creature that wields shadows and secrets.',
                        creatorName: 'RightKnighttoFight',
                        difficulty: 16,
                        hitPoints: 8,
                        stress: 6,
                        damageThresholds: { major: 14, severe: 28 },
                        standardAttack: {
                            name: 'Moon Staff',
                            range: 'Far',
                            damage: '2d10+3',
                            damageType: 'Magical',
                            attackModifier: 2,
                        },
                        motivesAndTactics: ['Feed on nightmares', 'Summon hellspawn', 'Make deals'],
                        experiences: [
                            { name: 'Ageless Knowledge', modifier: 2 },
                            { name: 'Naughty kids should be punished', modifier: 2 },
                        ],
                        features: [
                            {
                                name: 'Fey Disguise',
                                type: 'Passive',
                                description:
                                    'The Hag can take on the appearance of a creature similar in size to them. This disguise can be seen through on an Instinct Roll. On a success, the Hag cannot use their Waking Nightmare against that PC. On a failure, the PC has disadvantage on all action rolls against the Hag.',
                            },
                            {
                                name: 'Relentless (3)',
                                type: 'Passive',
                                description:
                                    'The Hag can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight them.',
                            },
                            {
                                name: 'Raking Claws',
                                type: 'Action',
                                stressCost: 1,
                                description:
                                    'Mark a Stress to make an attack against all targets within Very Close range. Targets the Hag succeeds against take 2d10 magic damage and knocked back to Close range.',
                            },
                            {
                                name: 'Waking Nightmare',
                                type: 'Action',
                                fearCost: 1,
                                description:
                                    'Spend a Fear to force all targets within Far range to make a Presence Reaction Roll. All targets that fail, lose a Hope and mark a Stress as they relive a childhood nightmare. The Hag learns about this nightmare which they use to clear 1 HP and 1 Stress.',
                            },
                            {
                                name: 'Prey on Terror',
                                type: 'Action',
                                stressCost: 1,
                                description:
                                    'Mark a Stress and choose a point within Far range to place a Nightmare Totem. All creatures within Close range of the Nightmare Totem whose nightmares are known to the Hag are Vulnerable.',
                            },
                            {
                                name: 'Ethereal Shift',
                                type: 'Reaction',
                                description:
                                    'If the Hag marks HP, mark a Stress to teleport to a location within Close range and gain resistance to physical damage until the next time the Hag has the spotlight.',
                            },
                        ],
                    },
                },
            },
        ],
    } as any;

    const shadowItems = parser.parseFreshCutGrassState(
        shadowHagState,
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
        [],
    );
    assert.equal(shadowItems.length, 1);
    const shadow = shadowItems[0];
    assert.equal(shadow.name, 'Shadow Hag');
    assert.equal(shadow.tier, 2);
    assert.equal(shadow.type, 'Solo');
    assert.equal(shadow.difficulty, 16);
    assert.equal(shadow.hp, 8);
    assert.equal(shadow.stress, 6);
    assert.equal(shadow.thresholds, '14/28');
    assert.deepEqual(
        { weapon: shadow.weapon, range: shadow.range, damage: shadow.damage, attack: shadow.attack },
        { weapon: 'Moon Staff', range: 'Far', damage: '2d10+3 Magical', attack: '+2' },
    );
    assert.equal(shadow.motives, 'Feed on nightmares, Summon hellspawn, Make deals');
    assert.equal(shadow.xp, 'Ageless Knowledge +2, Naughty kids should be punished +2');
    assert.equal(shadow.author, 'RightKnighttoFight');
    assert.equal(shadow.features.length, 6);
    assert.deepEqual(
        shadow.features.map((feature: any) => feature.name),
        ['Fey Disguise', 'Relentless (3)', 'Raking Claws', 'Waking Nightmare', 'Prey on Terror', 'Ethereal Shift'],
    );
    assert.equal(shadow.features.find((feature: any) => feature.name === 'Raking Claws').parsedCost, 'Stress 1');
    assert.equal(shadow.features.find((feature: any) => feature.name === 'Waking Nightmare').parsedCost, 'Fear 1');
    assert.equal(shadow.features.find((feature: any) => feature.name === 'Prey on Terror').parsedCost, 'Stress 1');
    const shadowToolkit = parser.toToolkitStatblock(shadow);
    assert.equal(shadowToolkit.category, 'adversary');
    assert.equal(shadowToolkit.attack.name, 'Moon Staff');
    assert.equal(shadowToolkit.hp_stress.major_hp, 14);
    assert.equal(shadowToolkit.hp_stress.severe_hp, 28);
    assert.equal(shadowToolkit.features.length, 6);

    const renderedShadowHag = parser.repairFreshCutGrassDomItem(
        {
            name: 'Shadow Hag',
            tier: 2,
            type: 'Solo',
            desc: '10/18/2025 10:03:46 PM',
            difficulty: 16,
            rawText: `Shadow Hag
    Solo
    Tier
    2
    A fey creature that wields shadows and secrets.
    10/18/2025 10:03:46 PM
    Difficulty
    16
    STANDARD ATTACK
    Moon Staff
    Far
    2d10+3
    Magical
    +2
    MOTIVES & TACTICS
    Feed on nightmares
    Summon hellspawn
    Make deals
    EXPERIENCES
    Ageless Knowledge +2
    Naughty kids should be punished +2
    FEATURES
    PASSIVES
    Fey Disguise
    The Hag can take on the appearance of a creature similar in size to them. This disguise can be seen through on an Insight Roll. On a success, the Hag cannot use their “Waking Nightmare” against that PC. On a failure, the PC has disadvantage on all action rolls against the Hag.
    Relentless (3)
    The Hag can be spotlighted up to
    three times per GM turn. Spend Fear as usual to spotlight
    them.
    ACTIONS
    Raking Claws
    Mark a Stress to make an attack against all targets within Very Close range. Targets the Hag succeeds against take 2d10 magic damage and knocked back to Close range.
    Waking Nightmare
    Spend a Fear to force all targets within Far range to make a Presence Reaction Roll. All targets that fail, lose a Hope and mark a Stress as they relive a childhood nightmare. The Hag learns about this nightmare which they use to clear 1 HP and 1 Stress.
    Prey on Terror
    Mark a Stress and choose a point within Far range to place a Nightmare Totem. All creatures within Close range of the Nightmare Totem whose nightmares are known to the Hag are Vulnerable.
    REACTIONS
    Ethereal Shift
    If the Hag marks HP, mark a Stress to teleport to a location within Close range and gain resistance to physical damage until the next time the Hag has the spotlight.
    HP & STRESS
    MINOR
    1 HP
    14
    MAJOR
    2 HP
    28
    SEVERE
    3 HP
    HP:
    8
    STRESS:
    6
    Daggerheart™ Compatible. Terms at Daggerheart.com
    BY ZANDORIANN
    LIKED (134)
    IN LIBRARY (365)
    COMMENTS
    refleximage
    10/18/2025 10:03:46 PM
    This adversary was made by RightKnighttoFight. You can find more of his work at https://ko-fi.com/rightknighttofight`,
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(renderedShadowHag.desc, 'A fey creature that wields shadows and secrets.');
    assert.equal(renderedShadowHag.hp, 8);
    assert.equal(renderedShadowHag.stress, 6);
    assert.equal(renderedShadowHag.thresholds, '14/28');
    assert.deepEqual(
        {
            weapon: renderedShadowHag.weapon,
            range: renderedShadowHag.range,
            damage: renderedShadowHag.damage,
            attack: renderedShadowHag.attack,
        },
        { weapon: 'Moon Staff', range: 'Far', damage: '2d10+3 Magical', attack: '+2' },
    );
    assert.equal(renderedShadowHag.author, 'RightKnighttoFight');
    assert.equal(renderedShadowHag.features.length, 6);
    assert.equal(renderedShadowHag.features[1].name, 'Relentless (3)');
    assert.equal(
        renderedShadowHag.features[1].desc,
        'The Hag can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight them.',
    );
    assert.equal(
        renderedShadowHag.features.find((feature: any) => feature.name === 'Raking Claws').parsedCost,
        'Stress 1',
    );
    assert.equal(
        renderedShadowHag.features.find((feature: any) => feature.name === 'Waking Nightmare').parsedCost,
        'Fear 1',
    );
    assert.equal(
        renderedShadowHag.features.find((feature: any) => feature.name === 'Prey on Terror').parsedCost,
        'Stress 1',
    );
    assert.ok(
        !renderedShadowHag.features.some((feature: any) =>
            /MINOR|MAJOR|SEVERE|LIKED|COMMENTS|refleximage/i.test(feature.name),
        ),
    );
    const renderedToolkit = parser.toToolkitStatblock(renderedShadowHag);
    assert.equal(renderedToolkit.hp_stress.hp, 8);
    assert.equal(renderedToolkit.hp_stress.stress, 6);
    assert.equal(renderedToolkit.hp_stress.major_hp, 14);
    assert.equal(renderedToolkit.hp_stress.severe_hp, 28);
    assert.equal(renderedToolkit.attack.name, 'Moon Staff');
    assert.equal(renderedToolkit.attack.modifier, '+2');
    assert.equal(renderedToolkit.features.length, 6);

    const shadowHeadingAttack = parser.repairFreshCutGrassDomItem(
        {
            name: 'Shadow Hag',
            tier: 2,
            type: 'Solo',
            desc: 'Moving plants, crawling through the ground and entangling their victims.',
            difficulty: 16,
            weapon: 'COMMUNITY ADVERSARIES & ENVIRONMENTS',
            damage: 'Moon Staff: Far | 2d10+3',
            attack: '+2',
            hp: 8,
            stress: 6,
            rawText: `Shadow Hag
    Solo
    Tier
    2
    A fey creature that wields shadows and secrets.
    Difficulty
    16
    STANDARD ATTACK
    COMMUNITY ADVERSARIES & ENVIRONMENTS
    +2
    Moon Staff: Far | 2d10+3
    Magical
    FEATURES
    PASSIVES
    Fey Disguise
    The Hag can disguise herself.
    HP & STRESS
    14
    MAJOR
    28
    SEVERE
    HP:
    8
    STRESS:
    6`,
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(shadowHeadingAttack.desc, 'A fey creature that wields shadows and secrets.');
    assert.equal(shadowHeadingAttack.weapon, 'Moon Staff');
    assert.equal(shadowHeadingAttack.range, 'Far');
    assert.equal(shadowHeadingAttack.damage, '2d10+3 Magical');
    assert.equal(shadowHeadingAttack.attack, '+2');
    assert.notEqual(shadowHeadingAttack.weapon, 'COMMUNITY ADVERSARIES & ENVIRONMENTS');

    const mushroomComments = parser.repairFreshCutGrassDomItem(
        {
            name: 'Mushroom entanglement',
            tier: 1,
            type: 'EnvironmentExploration',
            desc: 'No comments yet. Be the first to comment!',
            difficulty: 11,
            rawText: `Mushroom entanglement
    EnvironmentExploration
    Tier
    1
    Moving plants, crawling through the ground and entangling their victims.
    Difficulty
    11
    FEATURES
    PASSIVES
    Overgrown Battlefield
    There has been a struggle here.
    COMMENTS
    No comments yet. Be the first to comment!
    Daggerheart™ Compatible. Terms at Daggerheart.com`,
        },
        'https://freshcutgrass.app/homebrew?id=c4SRR7SGMMdryPwgfDzvpP',
    );
    assert.equal(mushroomComments.desc, 'Moving plants, crawling through the ground and entangling their victims.');
    assert.ok(!/comments?|be the first/i.test(mushroomComments.desc));

    const commentsOnlyEnvironment = parser.repairFreshCutGrassDomItem(
        {
            name: 'Quiet Grove',
            type: 'EnvironmentExploration',
            desc: 'No comments yet. Be the first to comment!',
            rawText: `Quiet Grove
    EnvironmentExploration
    Tier
    1
    Difficulty
    10
    FEATURES
    A Feature
    Something happens.
    COMMENTS
    No comments yet. Be the first to comment!`,
        },
        'https://freshcutgrass.app/homebrew?id=comments-only',
    );
    assert.equal(commentsOnlyEnvironment.desc, undefined);
});
