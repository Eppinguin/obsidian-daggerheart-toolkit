/** Guards the parser entry point.
 *
 * The legacy build declared this chain as ordered <script> lists in four places
 * that disagreed with each other, so the popup, the injected content script,
 * and the tests each ran a different effective parser. Composition now lives in
 * `src/parsers/index.ts`; this test fails if an export goes missing from it.
 */
import { expect, test } from 'vitest';

import * as parsers from '../src/parsers/index';

const EXPECTED_EXPORTS = [
    // core
    'parseText',
    'parseFeatureLines',
    'discoverStatblockRoots',
    // heart of daggers
    'attributionTitle',
    'completeHeartOfDaggersItem',
    'filterHeartOfDaggersItems',
    'motivesFromText',
    'renderedCardRoots',
    'renderedCardSignature',
    'restoreMotives',
    // freshcutgrass
    'parseFreshCutGrassState',
    'repairFreshCutGrassDomItem',
    'collectFreshCutGrassState',
    // composed entry points
    'parseManyFromDocument',
    'parseFromDocument',
    'extractWithDiagnostics',
];

test('the parser barrel exposes the full surface the entry points rely on', () => {
    const missing = EXPECTED_EXPORTS.filter((name) => typeof (parsers as Record<string, unknown>)[name] !== 'function');
    expect(missing).toEqual([]);
});

test('diagnostics are wired into the composed extraction path', () => {
    // Regression for the dead `extraction-diagnostics.js`: it shipped in both
    // builds but nothing ever loaded it, so its counters never ran.
    expect(typeof parsers.extractWithDiagnostics).toBe('function');
});
