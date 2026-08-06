/** Experiences and Motives & Tactics must survive to the toolkit output.
 *
 * Sources supply these three ways: a plain string, an array of strings, or an
 * array of `{ name, modifier }` objects. FreshCutGrass app state uses the last
 * form, which previously reached the YAML emitter unflattened and serialized as
 * `experience: "[object Object]"` — the field looked imported but was garbage.
 * Experiences were never covered end to end, so nothing caught it.
 */
import { expect, test } from 'vitest';

import { toToolkitStatblock, toToolkitYaml } from '../src/format/adapter';
import { parseFreshCutGrassState } from '../src/parsers/freshcutgrass/card-boundary';
import type { RawStatblock } from '../src/types';

const adversary = {
    name: 'Shadow Hag',
    category: 'adversary',
    type: 'Solo',
    tier: 2,
    difficulty: 16,
    hp: 8,
    stress: 6,
};

const yamlValue = (statblock: RawStatblock, key: string): string | undefined =>
    toToolkitYaml(statblock)
        .split('\n')
        .find((line) => line.startsWith(`${key}:`));

test.each([
    ['string', 'Ageless Knowledge +2', 'Ageless Knowledge +2'],
    ['array of strings', ['Ageless Knowledge +2', 'Sneaky +1'], 'Ageless Knowledge +2, Sneaky +1'],
    [
        'array of {name, modifier} objects',
        [
            { name: 'Ageless Knowledge', modifier: 2 },
            { name: 'Naughty kids should be punished', modifier: 2 },
        ],
        'Ageless Knowledge +2, Naughty kids should be punished +2',
    ],
    ['array with a negative modifier', [{ name: 'Clumsy', modifier: -1 }], 'Clumsy -1'],
    ['object without a modifier', [{ name: 'Ageless Knowledge' }], 'Ageless Knowledge'],
])('experience serializes from %s', (_label, xp, expected) => {
    const statblock = { ...adversary, xp } as unknown as RawStatblock;
    expect(toToolkitStatblock(statblock).experience).toBe(expected);
    expect(yamlValue(statblock, 'experience')).toBe(`experience: ${JSON.stringify(expected)}`);
});

test.each([
    ['string', 'Feed on nightmares', 'Feed on nightmares'],
    ['array of strings', ['Feed on nightmares', 'Make deals'], 'Feed on nightmares, Make deals'],
    ['array of objects', [{ name: 'Feed on nightmares' }], 'Feed on nightmares'],
])('motives_tactics serializes from %s', (_label, motives, expected) => {
    const statblock = { ...adversary, motives } as unknown as RawStatblock;
    expect(yamlValue(statblock, 'motives_tactics')).toBe(`motives_tactics: ${JSON.stringify(expected)}`);
});

test('neither field is emitted when absent', () => {
    const yaml = toToolkitYaml(adversary as unknown as RawStatblock);
    expect(yaml).not.toMatch(/^experience:/m);
    expect(yaml).not.toMatch(/^motives_tactics:/m);
});

test('both fields survive the FreshCutGrass app-state path end to end', () => {
    const state = {
        id: 'x',
        name: 'SHADOW HAG',
        tier: 2,
        type: 'Solo',
        difficulty: 16,
        hp: 8,
        stress: 6,
        motivesAndTactics: ['Feed on nightmares', 'Summon hellspawn'],
        experiences: [{ name: 'Ageless Knowledge', modifier: 2 }],
    };

    const [raw] = parseFreshCutGrassState(state, 'https://freshcutgrass.app/homebrew?id=x', []);
    const yaml = toToolkitYaml(raw);

    expect(yaml).toMatch(/^experience: "Ageless Knowledge \+2"$/m);
    expect(yaml).toMatch(/^motives_tactics: "Feed on nightmares, Summon hellspawn"$/m);
    expect(yaml).not.toMatch(/object Object/);
});
