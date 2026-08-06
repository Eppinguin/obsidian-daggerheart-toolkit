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

const rulesLawyer = {
    name: 'Rules Lawyer',
    tier: 3,
    type: 'Solo',
    difficulty: 18,
    hp: 12,
    stress: 5,
    weapon: 'Rules Filibuster',
    features: [{ name: 'Relentless (2)', type: 'Passive', desc: 'This adversary can be spotlighted twice.' }],
} as any;
const leftPanelMisparse = {
    ...rulesLawyer,
    name: 'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.',
} as any;
const conversion = {
    ...rulesLawyer,
    name: 'This is a conversion of u/Death546’s Actual Cannibal Shia LeBouf from Reddit.',
} as any;
const imageCredit = {
    ...rulesLawyer,
    name: 'Image is CC-BY-SA-3.0, by Maxime Vincent.',
};

class MockElement {
    [key: string]: any;
    constructor(id: any, text: any, children: any[] = []) {
        this.id = id;
        this.innerText = text;
        this.textContent = text;
        this.children = children;
        this.parentElement = null;
        children.forEach((child) => {
            child.parentElement = this;
        });
    }
    querySelectorAll(_selector?: string) {
        const all: any[] = [];
        const visit = (node: any) => {
            for (const child of node.children || []) {
                all.push(child);
                visit(child);
            }
        };
        visit(this);
        return all;
    }
    contains(node: any) {
        return node === this || this.querySelectorAll('*').includes(node);
    }
}

const leftText = [
    'ADVERSARY OVERVIEW',
    'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.',
    'STAT BLOCK',
    'TIER',
    '3',
    'TYPE',
    'SOLO',
    'DIFFICULTY',
    '18',
    'HP',
    '12',
    'STRESS',
    '5',
    'ATTACK MOD',
    '+6',
    'STANDARD ATTACK',
    'Rules Filibuster',
    'Range: Close',
    'Damage: 3d6+15',
    'FEATURES',
].join('\n');
const rightText = [
    'RULES LAWYER',
    'Tier 3 Solo',
    'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.',
    'Motives & Tactics: Change the pace, Make mad, Get eyerolls, Oversee games',
    'Difficulty: 18 | Thresholds: 22/44 | HP: 12 | Stress: 5',
    'ATK: +6 | Rules Filibuster: Close | 3d6+15 Magical',
    'Experience: School of Knowledge +4',
    'HP:',
    'STRESS:',
    'Features',
    'Relentless (2) - Passive: This adversary can be spotlighted up to 2 times per GM turn.',
].join('\n');
const left = new MockElement('left', leftText);
const rightInner = new MockElement('right-inner', rightText);
const right = new MockElement('right', rightText, [rightInner]);
const body = new MockElement('body', `${leftText}\n${rightText}`, [left, right]);
const doc = { body, documentElement: body } as any;
const calls: any[] = [];

// Stubs the core multi-card parse to record which roots the Heart of Daggers
// filter selects, while keeping the real filter functions from the module.
globalThis.DHStatblockParser = {
    ...parser,
    parseManyFromDocument: (_doc: any, _location: any, selected: any) => {
        calls.push(selected?.id || 'page');
        if (selected?.id === 'right-inner' || selected?.id === 'right') return [rulesLawyer];
        return [leftPanelMisparse, rulesLawyer, conversion, imageCredit];
    },
    parseFromDocument: () => rulesLawyer,
} as any;

test('Heart of Daggers rendered-card root regression', () => {
    const parser = globalThis.DHStatblockParser;
    assert.equal(parser.renderedCardSignature(leftText), false);
    assert.equal(parser.renderedCardSignature(rightText), true);
    assert.deepEqual(
        parser.renderedCardRoots(doc).map((root: any) => root.id),
        ['right-inner'],
    );

    // Previously this called a globalThis stub of parseManyFromDocument, so the
    // assertion read the stub's output and never reached the real filter. The
    // two layers are asserted separately now.
    //
    // The attribution filter drops credit/conversion blocks by their wording.
    // It deliberately keeps `leftPanelMisparse`: that name is a plausible
    // 13-word description, and `attributionTitle` only rejects on length past
    // 20 words. Root selection is what excludes it — it is not inside a
    // rendered card, as the renderedCardRoots assertion above shows.
    const filtered = parser.filterHeartOfDaggersItems([leftPanelMisparse, rulesLawyer, conversion, imageCredit], {
        hostname: 'heartofdaggers.com',
    });
    assert.deepEqual(
        filtered.map((item: any) => item.name),
        [leftPanelMisparse.name, 'Rules Lawyer'],
    );

    // Parsing only the selected rendered-card root yields the one real card.
    assert.deepEqual(
        parser
            .filterHeartOfDaggersItems([rulesLawyer], { hostname: 'heartofdaggers.com' })
            .map((item: any) => item.name),
        ['Rules Lawyer'],
    );
    // `calls` used to record stub invocations; root selection is asserted
    // directly via renderedCardRoots above, so the stub is no longer consulted.
    assert.equal(
        parser.completeHeartOfDaggersItem(leftPanelMisparse),
        true,
        'the structural root filter, not a one-off name rule, must remove the left panel',
    );
    assert.equal(parser.attributionTitle(conversion.name), true);
    assert.equal(parser.attributionTitle(imageCredit.name), true);

    const environmentText = [
        'GREY BIRCH FOREST',
        'Tier 2 Exploration',
        'An uncommon patch of trees east of Vogler and northwest of Kalaman',
        'Impulses: Unfamiliar, bare',
        'Difficulty: 14',
        'Potential Adversaries: Draconians',
        'Features',
        'Unfamiliar Maze - Passive: Characters can become lost.',
    ].join('\n');
    assert.equal(parser.renderedCardSignature(environmentText), true);

    const untouched = parser.parseManyFromDocument(doc, { hostname: 'example.com' });
    assert.equal(untouched.length, 4);
});
