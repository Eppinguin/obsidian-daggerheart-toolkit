/** Root selection on a FreshCutGrass listing page.
 *
 * `/homebrew?id=…` renders ~100 preview cards and expands the targeted one in
 * place. The expanded card is a plain `MuiCardContent-root` div, so the generic
 * scope selectors (`[role="dialog"]`, `.modal`, `[class*="drawer"]`, …) match
 * nothing, the parser falls back to `document.body`, and it reads the whole
 * ~26k-character listing as one statblock — neighbouring cards bleeding into
 * every field.
 *
 * Text below is copied from
 * https://freshcutgrass.app/homebrew?id=vF4k4p3AGgxHVw9kwLnbof
 */
import { expect, test } from 'vitest';

import { expandedCardSignature } from '../src/parsers/freshcutgrass/expanded-card';

const EXPANDED = [
    'RUNEBLIGHT WOLF',
    'Difficulty: 12',
    'Attack: +2',
    'Bite: Melee | 1d10',
    'Experience:',
    'Runeblight Instincts +2',
    'Motives & Tactics:',
    'Hunt intruders, corrupt the weak, silence light and song.',
    'FEATURES',
    'Runic Leap - Action',
    'Mark a Stress to leap to a target within Far range.',
    'HP & STRESS',
    'MINOR',
    '1 HP',
    '7',
    'MAJOR',
    '2 HP',
    '12',
    'SEVERE',
    '3 HP',
    'HP:',
    '7',
    'STRESS:',
    '3',
].join('\n');

/** A grid preview card: name, blurb, and one labelled section. */
const PREVIEW_ADVERSARY = [
    'BRUISER',
    '1',
    'GIANT SPIDER',
    'A human-sized spider',
    'Motives & Tactics:',
    'Ambush, Feed',
].join('\n');

const PREVIEW_ENVIRONMENT = [
    'TRAVERSAL',
    '1',
    'ROOFTOP CHASE',
    'A chase along rooftops',
    'Tone & feel:',
    'Disorient with twists and turns',
    'Potential Adversaries:',
    'Archer Guards',
].join('\n');

const EXPANDED_ENVIRONMENT = [
    'ANCIENT TUNNELS',
    'Difficulty: 11',
    'Impulses:',
    'Beckon, unsettle',
    'Potential Adversaries:',
    'Rat King, Giant Rat',
    'FEATURES',
    'Collapsing Roof - Action',
    'Debris falls.',
].join('\n');

test('an expanded adversary card is recognised', () => {
    expect(expandedCardSignature(EXPANDED)).toBe(true);
});

test('an expanded environment card is recognised', () => {
    expect(expandedCardSignature(EXPANDED_ENVIRONMENT)).toBe(true);
});

test.each([
    ['adversary preview', PREVIEW_ADVERSARY],
    ['environment preview', PREVIEW_ENVIRONMENT],
    ['empty', ''],
])('a preview card is not mistaken for an expanded one: %s', (_label, text) => {
    expect(expandedCardSignature(text)).toBe(false);
});

test('the whole listing matches too, which is why the smallest root must win', () => {
    // Every ancestor up to <body> contains the expanded card's text, so the
    // signature alone is not enough — `expandedCardRoots` keeps only the
    // innermost matches. Taking an ancestor is exactly what caused the bleed.
    const listing = [PREVIEW_ADVERSARY, EXPANDED, PREVIEW_ENVIRONMENT].join('\n');
    expect(expandedCardSignature(listing)).toBe(true);
});
