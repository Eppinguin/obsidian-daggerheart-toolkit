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

test('FreshCutGrass rendered Shadow Hag repair regression', () => {
    const parser = globalThis.DHStatblockParser;

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

    const toolkit = parser.toToolkitStatblock(renderedShadowHag);
    assert.equal(toolkit.hp_stress.hp, 8);
    assert.equal(toolkit.hp_stress.stress, 6);
    assert.equal(toolkit.hp_stress.major_hp, 14);
    assert.equal(toolkit.hp_stress.severe_hp, 28);
    assert.equal(toolkit.attack.name, 'Moon Staff');
    assert.equal(toolkit.attack.modifier, '+2');
    assert.equal(toolkit.features.length, 6);
});
