/** FreshCutGrass renders labelled sections three ways, and only one used to
 * parse.
 *
 * `sectionList` anchored its heading pattern with `^...$`, so it matched a bare
 * heading on its own line but not the colon-suffixed or inline-value forms:
 *
 *     MOTIVES & TACTICS     Motives & Tactics:      Motives & Tactics: Feed on nightmares
 *     Feed on nightmares    Feed on nightmares
 *
 * Motives & Tactics and Experiences silently went missing on the latter two.
 * Heart of Daggers was unaffected because `motivesFromText` always handled the
 * colon and inline forms, which is why that site imported correctly.
 */
import { expect, test } from 'vitest';

import { repairFreshCutGrassDomItem } from '../src/parsers/freshcutgrass/card-boundary';

const URL = 'https://freshcutgrass.app/homebrew?id=x';

const HEAD = [
    'SHADOW HAG',
    'SOLO',
    '2',
    'A fey creature that wields shadows',
    'Difficulty',
    '16',
    'HP',
    '8',
    'Stress',
    '6',
];
const TAIL = ['FEATURES', 'Fey Disguise', 'The Hag can disguise herself.'];

const repair = (middle: string[]) =>
    repairFreshCutGrassDomItem({ name: 'SHADOW HAG', rawText: [...HEAD, ...middle, ...TAIL].join('\n') }, URL);

test.each([
    [
        'bare heading on its own line',
        ['MOTIVES & TACTICS', 'Feed on nightmares', 'EXPERIENCES', 'Ageless Knowledge +2'],
    ],
    [
        'heading with a trailing colon',
        ['Motives & Tactics:', 'Feed on nightmares', 'Experiences:', 'Ageless Knowledge +2'],
    ],
    ['value inline after the colon', ['Motives & Tactics: Feed on nightmares', 'Experiences: Ageless Knowledge +2']],
    ['"and" spelled out', ['Motives and Tactics', 'Feed on nightmares', 'Experience', 'Ageless Knowledge +2']],
    ['singular Experience heading', ['MOTIVES & TACTICS', 'Feed on nightmares', 'EXPERIENCE', 'Ageless Knowledge +2']],
])('motives and experiences parse from: %s', (_label, middle) => {
    const item = repair(middle);
    expect(item.motives).toBe('Feed on nightmares');
    expect(item.xp).toBe('Ageless Knowledge +2');
});

test('a section stops at the next label instead of swallowing it', () => {
    // The stop patterns were anchored too, so a colon-suffixed "Experiences:"
    // failed to terminate the motives section and its value bled across.
    const item = repair(['Motives & Tactics:', 'Feed on nightmares', 'Experiences:', 'Ageless Knowledge +2']);
    expect(item.motives).not.toMatch(/Experiences|Ageless/);
    expect(item.xp).not.toMatch(/Feed on nightmares/);
});

test('multi-line section values are joined', () => {
    const item = repair([
        'MOTIVES & TACTICS',
        'Feed on nightmares',
        'Summon hellspawn',
        'EXPERIENCES',
        'Ageless Knowledge +2',
        'Naughty kids +2',
    ]);
    expect(item.motives).toBe('Feed on nightmares, Summon hellspawn');
    expect(item.xp).toBe('Ageless Knowledge +2, Naughty kids +2');
});

test('absent sections stay absent rather than picking up neighbours', () => {
    const item = repair([]);
    expect(item.motives).toBeUndefined();
    expect(item.xp).toBeUndefined();
});
