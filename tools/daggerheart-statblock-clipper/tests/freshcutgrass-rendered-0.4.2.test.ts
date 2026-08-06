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

test('FreshCutGrass 0.4.2 rendered regressions', () => {
    const parser = globalThis.DHStatblockParser;

    const shadow = parser.repairFreshCutGrassDomItem(
        {
            name: 'Shadow Hag',
            type: 'Solo',
            desc: 'Moving plants, crawling through the ground and entangling their victims.',
            weapon: 'COMMUNITY ADVERSARIES & ENVIRONMENTS',
            damage: 'Moon Staff: Far | 2d10+3',
            attack: '+2',
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
    Fey Disguise
    The Hag can disguise herself.`,
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(shadow.desc, 'A fey creature that wields shadows and secrets.');
    assert.deepEqual(
        { weapon: shadow.weapon, range: shadow.range, damage: shadow.damage, attack: shadow.attack },
        { weapon: 'Moon Staff', range: 'Far', damage: '2d10+3 Magical', attack: '+2' },
    );

    const mushroom = parser.repairFreshCutGrassDomItem(
        {
            name: 'Mushroom entanglement',
            type: 'EnvironmentExploration',
            desc: 'No comments yet. Be the first to comment!',
            rawText: `Mushroom entanglement
    EnvironmentExploration
    Tier
    1
    Moving plants, crawling through the ground and entangling their victims.
    Difficulty
    11
    FEATURES
    Overgrown Battlefield
    There has been a struggle here.
    COMMENTS
    No comments yet. Be the first to comment!`,
        },
        'https://freshcutgrass.app/homebrew?id=c4SRR7SGMMdryPwgfDzvpP',
    );
    assert.equal(mushroom.desc, 'Moving plants, crawling through the ground and entangling their victims.');
    assert.ok(!/comments?|be the first/i.test(mushroom.desc));
});
