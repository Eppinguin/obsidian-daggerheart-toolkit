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
};

global.chrome = {
    runtime: { onMessage: { addListener() {} } },
    storage: { local: { set: async () => {} } },
} as any;

test('FreshCutGrass card description boundary regressions', () => {
    class MockElement {
        [key: string]: any;
        constructor({ text = '', tagName = 'DIV', className = '', children = [] as any[] } = {}) {
            this.innerText = text;
            this.textContent = text;
            this.tagName = tagName;
            this.className = className;
            this.children = children;
            this.parentElement = null;
            children.forEach((child) => {
                child.parentElement = this;
            });
        }
        querySelectorAll(selector: any) {
            const all: any[] = [];
            const visit = (node: any) => {
                for (const child of node.children || []) {
                    all.push(child);
                    visit(child);
                }
            };
            visit(this);
            if (selector === '*') return all;
            if (/h1,h2,h3,h4,h5,h6/.test(selector)) return all.filter((node) => /^H[1-6]$/.test(node.tagName));
            return [];
        }
        contains(node: any) {
            return node === this || this.querySelectorAll('*').includes(node);
        }
        matches(selector: any) {
            return selector.includes('[class*="card"]') && /card/i.test(this.className);
        }
        getAttribute() {
            return '';
        }
    }

    function card(name: any, type: any, tier: any, description: any, section: any, sectionText: any) {
        const heading = new MockElement({ text: name, tagName: 'H2' });
        const text = `${name}\n${type}\n${tier}\n${description}\n134\n365\n${section}\n${sectionText}`;
        return new MockElement({ text, className: 'community-card', children: [heading] });
    }

    const cards = [
        card(
            'BRIARBEAR',
            'BRUISER',
            '1',
            'A large bear, corrupted by the Witherwild to grow grasping, thorny vines.',
            'Motives & Tactics:',
            'Climb, Defend territory, Pummel, Track',
        ),
        card(
            'SHADOW HAG',
            'SOLO',
            '2',
            'A fey creature that wields\nshadows and secrets',
            'Motives & Tactics:',
            'Feed on nightmares, summon hellspawn, make deals',
        ),
        card(
            'LIVING VINES',
            'STANDARD',
            '1',
            'Moving plants, crawling through the ground and entangling their victims.',
            'Motives & Tactics:',
            'Entangle, choke out',
        ),
        card(
            'MUSHROOM ENTANGLEMENT',
            'EXPLORATION',
            '1',
            'A pulsing, semi-sentient wetland of towering mushrooms and spore clouds.',
            'Tone & feel:',
            'This encounter is eerie and reactive.',
        ),
        card(
            'RUNEBLIGHT WOLF',
            'SOLO',
            '1',
            'A corrupted forest predator, swollen with wild magic.',
            'Motives & Tactics:',
            'Hunt intruders, corrupt the weak',
        ),
    ];
    const body = new MockElement({
        text: cards.map((node) => node.innerText).join('\n'),
        children: cards,
    });
    const doc = { body, documentElement: body } as any;
    const location = { hostname: 'freshcutgrass.app' } as any;

    const helper = globalThis.DHFreshCutGrassCardBoundary;
    const shadowDescription = helper.domCardDescription(body, 'Shadow Hag');
    assert.equal(shadowDescription, 'A fey creature that wields shadows and secrets');
    assert.notEqual(shadowDescription, 'Moving plants, crawling through the ground and entangling their victims.');

    const enriched = helper.enrichFreshCutGrassItems(
        [
            {
                name: 'Shadow Hag',
                desc: 'Moving plants, crawling through the ground and entangling their victims.',
            },
        ],
        doc,
        location,
    );
    assert.equal(enriched[0].desc, 'A fey creature that wields shadows and secrets');
    assert.equal(enriched[0].__cardDescription, 'A fey creature that wields shadows and secrets');

    const parser = globalThis.DHStatblockParser;
    const repaired = parser.repairFreshCutGrassDomItem(
        {
            ...enriched[0],
            rawText:
                body.innerText +
                '\nDifficulty\n16\nSTANDARD ATTACK\nMoon Staff: Far | 2d10+3\nMagical\n+2\nFEATURES\nFey Disguise\nThe Hag can disguise herself.',
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(repaired.desc, 'A fey creature that wields shadows and secrets');
    assert.equal(repaired.__cardDescription, undefined);

    const duplicateLayoutText = [
        'SHADOW HAG',
        'Moving plants, crawling through the ground and entangling their victims.',
        '134',
        '365',
        'SHADOW HAG',
        'SOLO',
        '2',
        'A fey creature that wields',
        'shadows and secrets',
        '134',
        '365',
        'Motives & Tactics:',
        'Feed on nightmares, summon hellspawn, make deals',
        'LIVING VINES',
        'STANDARD',
        '1',
        'Moving plants, crawling through the ground and entangling their victims.',
        'Motives & Tactics:',
        'Entangle, choke out',
    ].join('\n');

    const duplicateCandidates = helper.cardDescriptionCandidatesFromText(duplicateLayoutText, 'Shadow Hag');
    assert.equal(duplicateCandidates[0].description, 'A fey creature that wields shadows and secrets');
    assert.equal(
        helper.cardDescriptionFromText(duplicateLayoutText, 'Shadow Hag'),
        'A fey creature that wields shadows and secrets',
    );

    const duplicateBody = new MockElement({
        text: duplicateLayoutText,
        children: [
            new MockElement({ text: 'SHADOW HAG', tagName: 'H2' }),
            new MockElement({ text: 'SHADOW HAG', tagName: 'H2' }),
        ],
    });
    assert.equal(
        helper.domCardDescription(duplicateBody, 'Shadow Hag'),
        'A fey creature that wields shadows and secrets',
    );

    const statePreferred = parser.repairFreshCutGrassDomItem(
        {
            name: 'Shadow Hag',
            desc: 'A fey creature that wields shadows and secrets',
            extractionMethod: 'freshcutgrass-app-state',
            __cardDescription: 'Moving plants, crawling through the ground and entangling their victims.',
            rawText: duplicateLayoutText,
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(statePreferred.desc, 'A fey creature that wields shadows and secrets');
    assert.equal(statePreferred.__cardDescription, undefined);

    const attributionLine =
        '10/18/2025 10:03:46 PM This adversary was made by RightKnighttoFight. You can find more of his work at https://ko-fi.com/rightknighttofight';
    const attributionOnly = [
        'SHADOW HAG',
        'SOLO',
        '2',
        attributionLine,
        'Motives & Tactics:',
        'Feed on nightmares, summon hellspawn, make deals',
    ].join('\n');
    assert.equal(helper.cardDescriptionFromText(attributionOnly, 'Shadow Hag'), '');

    const attributionDuplicateLayout = [
        'SHADOW HAG',
        'SOLO',
        '2',
        attributionLine,
        'SHADOW HAG',
        'SOLO',
        '2',
        'A fey creature that wields',
        'shadows and secrets',
        'Motives & Tactics:',
        'Feed on nightmares, summon hellspawn, make deals',
    ].join('\n');
    assert.equal(
        helper.cardDescriptionFromText(attributionDuplicateLayout, 'Shadow Hag'),
        'A fey creature that wields shadows and secrets',
    );

    const repairedAttribution = parser.repairFreshCutGrassDomItem(
        {
            name: 'Shadow Hag',
            desc: attributionLine,
            rawText:
                attributionDuplicateLayout + '\nDifficulty\n16\nFEATURES\nFey Disguise\nThe Hag can disguise herself.',
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
    );
    assert.equal(repairedAttribution.desc, 'A fey creature that wields shadows and secrets');

    const stateWithAttribution = parser.parseFreshCutGrassState(
        {
            targetId: 'uoHvyG83mBqs4YAxPpGB8n',
            candidates: [
                {
                    value: {
                        id: 'uoHvyG83mBqs4YAxPpGB8n',
                        name: 'Shadow Hag',
                        tier: 2,
                        role: 'Solo',
                        difficulty: 16,
                        hp: 8,
                        stress: 6,
                        description: attributionLine,
                        features: [
                            { name: 'Fey Disguise', type: 'Passive', description: 'The Hag can disguise herself.' },
                        ],
                    },
                },
            ],
        },
        'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
        [
            {
                name: 'Shadow Hag',
                desc: attributionLine,
                __cardDescription: 'A fey creature that wields shadows and secrets',
                rawText: attributionDuplicateLayout,
            },
        ],
    );
    assert.equal(stateWithAttribution.length, 1);
    assert.equal(stateWithAttribution[0].desc, 'A fey creature that wields shadows and secrets');
});
