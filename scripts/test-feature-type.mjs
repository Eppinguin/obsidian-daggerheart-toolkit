/**
 * Guards the feat-type parse.
 *
 * The SRD ships every feat's type inside its name ("Earth Eruption - Action")
 * and never in a `type` field. A parser that trusts the field labels all 492
 * bundled feats Passive, which is how they rendered before: one green badge on
 * every card, with the real type duplicated as text in the title.
 *
 * The histogram below is the regression guard. If it moves, the card badges are
 * lying again.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeFeature } = require('../shared/statblock-format.js');

// The data files are written with a BOM, which plain JSON.parse rejects.
const loadJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, ''));
const itemsOf = (parsed) => (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);

// --- Feature types ---------------------------------------------------------

const histogram = {};
const leftoverSuffixes = [];
const countdowns = [];
const costs = {};
const consequenceCosts = [];

for (const file of ['data/adversaries.json', 'data/environments.json']) {
    for (const statblock of itemsOf(loadJson(file))) {
        for (const raw of statblock.feats ?? []) {
            const feature = normalizeFeature({ name: raw.name, text: raw.text });
            assert.ok(feature, `feat "${raw.name}" in ${statblock.name} must normalize`);

            histogram[feature.type] = (histogram[feature.type] ?? 0) + 1;
            if (/[-–—]\s*(Passive|Action|Reaction)\s*$/i.test(feature.name)) {
                leftoverSuffixes.push(feature.name);
            }
            if (feature.countdown) countdowns.push(feature);
            if (feature.parsedCost) {
                costs[feature.parsedCost] = (costs[feature.parsedCost] ?? 0) + 1;
                if (/^(each|all|any|the target|they|those|when|on a success)/i.test(feature.description)) {
                    consequenceCosts.push([feature.name, feature.parsedCost]);
                }
            }
        }
    }
}

assert.deepEqual(
    histogram,
    { Passive: 179, Action: 202, Reaction: 111 },
    'bundled feat types must be parsed from the name suffix, not defaulted to Passive',
);

assert.deepEqual(leftoverSuffixes, [], 'the type suffix must be stripped from the name, or the card shows it twice');

// A handful of feats append a countdown after the type. Widening the suffix
// match to reach them must not swallow the countdown text.
assert.equal(countdowns.length, 4, 'the four countdown-bearing feats must keep their countdown');
assert.deepEqual(
    countdowns.map((f) => [f.name, f.type, f.countdown]).sort(),
    [
        ['Blood and Souls', 'Reaction', 'Countdown (Loop 6)'],
        ['Census Bell', 'Reaction', 'Long-Term Countdown (8)'],
        ['Hallucinatory Breath', 'Action', 'Countdown (Loop 1d6)'],
        ['Hallucinatory Breath', 'Reaction', 'Countdown (Loop 1d6)'],
    ].sort(),
);

// --- Costs -----------------------------------------------------------------
// Cost is read from the leading imperative in the description. The counts are
// the regression guard: a rule that starts matching mid-sentence consequences
// would inflate these sharply, and one that stops matching would empty them.
assert.deepEqual(
    costs,
    { 'Fear 1': 73, 'Stress 1': 54, 'Fear 2': 7, 'HP 1': 1, 'Stress 2': 1, 'Stress 3': 1 },
    'bundled feat costs must be parsed from the leading imperative',
);

// No cost may be attributed to a feature whose description opens by describing
// what happens to someone else — that is a consequence, not a price.
assert.deepEqual(consequenceCosts, [], 'costs must not be read out of consequence clauses');

// An explicit type still wins, so data that grows a real field is unaffected.
assert.equal(normalizeFeature({ name: 'Sudden Strike - Passive', type: 'Action', text: 'x' }).type, 'Action');

// --- Wiring ----------------------------------------------------------------

const compendium = fs.readFileSync('src/services/compendium.ts', 'utf8');
assert.match(compendium, /normalizeStatblockFeature\(/, 'SRD parsing must go through the shared feature normalizer');
assert.ok(
    !/type:\s*feat\.type\s*\|\|\s*'Passive'/.test(compendium),
    'the unconditional Passive fallback must not come back',
);

// The card badge must render the parsed type, not a hardcoded one.
const statblockRenderer = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
assert.match(statblockRenderer, /normalizeFeatureType\(feature\.type\)/);
assert.match(statblockRenderer, /dataset\.featureType/, 'the per-type CSS hook must be set');

// Hand-authored features must get the same treatment as imported ones, or a
// custom adversary silently renders without the cost chip its text describes.
const editModal = fs.readFileSync('src/modals/EditAdversaryModal.ts', 'utf8');
assert.match(editModal, /normalizeStatblockFeature\(/, 'the edit modal must normalize features on save');

// A half-written feature must survive the save rather than being dropped: the
// normalizer returns null when the description is still empty.
const halfWritten = { name: 'New Feature', type: 'Passive', description: '' };
assert.equal(normalizeFeature(halfWritten), null, 'precondition: incomplete features do not normalize');
assert.deepEqual(
    normalizeFeature(halfWritten) ?? halfWritten,
    halfWritten,
    "the modal's fallback must keep an incomplete feature intact",
);

// The counts a GM types by hand are not limited to the ones the SRD happens to use.
assert.equal(normalizeFeature({ name: 'F', text: 'Spend 3 Fear to do nothing' }).parsedCost, 'Fear 3');
assert.equal(normalizeFeature({ name: 'F', text: 'Mark 3 Stress to summon' }).parsedCost, 'Stress 3');

console.log('test-feature-type: ok');
