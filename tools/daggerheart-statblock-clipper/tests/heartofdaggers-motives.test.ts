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

test('Heart of Daggers Motives & Tactics regression', () => {
    const parser = globalThis.DHStatblockParser;
    const rawText = `RULES LAWYER
    Tier 3 Solo
    A sentient 4th-wall breaking rulebook.
    Motives & Tactics : Change the pace, Make mad,
    Get eyerolls, Oversee games
    Difficulty: 18 | Thresholds: 22/44 | HP: 12 | Stress: 5
    ATK: +6 | Rules Filibuster: Close | 3d6+15 Magical
    Experience: School of Knowledge +4
    Features
    Relentless (2) - Passive: This adversary can be spotlighted twice.`;

    const item = {
        name: 'Rules Lawyer',
        tier: 3,
        type: 'Solo',
        difficulty: 18,
        hp: 12,
        stress: 5,
        weapon: 'Rules Filibuster',
        range: 'Close',
        damage: '3d6+15 Magical',
        attack: '+6',
        rawText,
    };

    assert.equal(parser.motivesFromText(rawText), 'Change the pace, Make mad, Get eyerolls, Oversee games');

    const [restored] = parser.filterHeartOfDaggersItems([item], { hostname: 'heartofdaggers.com' });
    assert.equal(restored.motives, 'Change the pace, Make mad, Get eyerolls, Oversee games');

    const toolkit = parser.toToolkitStatblock(restored);
    assert.equal(toolkit.motives_tactics, 'Change the pace, Make mad, Get eyerolls, Oversee games');
    assert.match(
        parser.toToolkitMarkdown(restored),
        /motives_tactics: "Change the pace, Make mad, Get eyerolls, Oversee games"/,
    );
});
