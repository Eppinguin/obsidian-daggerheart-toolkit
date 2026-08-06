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
globalThis.DHFreshCutGrassCollector = parsers.collectFreshCutGrassState;
globalThis.DHFreshCutGrassCardBoundary = {
    cardDescriptionCandidatesFromText,
    cardDescriptionFromText,
    domCardDescription,
    enrichFreshCutGrassItems,
};

class MockNode {
    [key: string]: any;
}
(global as any).Node = MockNode;
const root: any = new MockNode();
root.__reactProps$fixture = {
    children: {
        homebrew: {
            id: 'uoHvyG83mBqs4YAxPpGB8n',
            name: 'Shadow Hag',
            tier: 2,
            role: 'Solo',
            difficulty: 16,
            hp: 8,
            stress: 6,
            features: [{ name: 'Fey Disguise', type: 'Passive', description: 'Disguise text.' }],
        },
    },
};

root.__reactFiber$fixture = {
    child: {
        sibling: {
            memoizedProps: {
                homebrewRecord: {
                    id: 'uoHvyG83mBqs4YAxPpGB8n',
                    name: 'Shadow Hag Fiber',
                    tier: 2,
                    role: 'Solo',
                    difficulty: 16,
                    hp: 8,
                    stress: 6,
                    features: [{ name: 'Fey Disguise', type: 'Passive', description: 'Fiber text.' }],
                },
            },
        },
    },
} as any;

const emptyStorage = { length: 0, key: () => null, getItem: () => null };
(global as any).document = {
    documentElement: root,
    body: root,
    title: 'Shadow Hag',
    querySelectorAll: () => [root],
};
(global as any).window = { localStorage: emptyStorage, sessionStorage: emptyStorage };
(global as any).performance = { getEntriesByType: () => [] } as any;

test('FreshCutGrass MAIN-world state collector test', () => {
    const result = globalThis.DHFreshCutGrassCollector('uoHvyG83mBqs4YAxPpGB8n');
    assert.equal(result.targetId, 'uoHvyG83mBqs4YAxPpGB8n');
    assert.ok(result.candidates.some((candidate: any) => JSON.stringify(candidate.value).includes('Shadow Hag')));
    assert.ok(result.candidates.some((candidate: any) => JSON.stringify(candidate.value).includes('Shadow Hag Fiber')));
});
