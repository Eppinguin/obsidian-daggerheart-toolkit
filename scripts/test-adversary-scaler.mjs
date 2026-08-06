import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
    entryPoints: ['src/services/adversary-scaler.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
const { AdversaryScaler } = await import(moduleUrl);

const original = {
    id: 'adversary-1',
    groupId: 'group-1',
    name: 'Test Standard',
    displayName: 'Test Standard',
    category: 'adversary',
    tier: 1,
    type: 'Standard',
    difficulty: 12,
    hp_stress: { hp: 4, stress: 2, major_hp: 7, severe_hp: 14 },
    currentHp: 4,
    currentStress: 0,
    attack: { name: 'Strike', range: 'Melee', damage: '1d6+1 phy', modifier: 1 },
    features: [{ name: 'Burst', type: 'Action', description: 'Deal 1d6 damage.' }],
};

const tierTwo = AdversaryScaler.scale(structuredClone(original), 2);
assert.equal(tierTwo.tier, 2);
assert.equal(tierTwo.difficulty, 14);
assert.deepEqual(tierTwo.hp_stress, { hp: 5, stress: 2, major_hp: 11, severe_hp: 22 });
assert.equal(tierTwo.attack.modifier, 2);
assert.equal(tierTwo.attack.damage, '2d8+2 phy');
assert.equal(tierTwo.features[0].description, 'Deal 2d6 damage.');
assert.equal(tierTwo._originalStats.tier, 1);

tierTwo.id = 'live-instance-id';
tierTwo.currentHp = 3;
tierTwo.currentStress = 1;
tierTwo.conditions = [{ name: 'Vulnerable', description: 'Attacks have advantage.' }];
const reverted = AdversaryScaler.scale(tierTwo, 1);
assert.equal(reverted.tier, 1);
assert.equal(reverted.id, 'live-instance-id');
assert.equal(reverted.currentHp, 3);
assert.equal(reverted.currentStress, 1);
assert.deepEqual(reverted.conditions, tierTwo.conditions);
assert.equal(reverted.difficulty, original.difficulty);
assert.deepEqual(reverted.hp_stress, original.hp_stress);
assert.deepEqual(reverted.attack, original.attack);
assert.deepEqual(reverted.features, original.features);

const tierFour = AdversaryScaler.scale(reverted, 99);
assert.equal(tierFour.tier, 4);
assert.equal(tierFour._originalStats.tier, 1);

// A renamed instance must stay renamed through scaling. Losing the flag would
// let the automatic "Name #N" numbering reclaim the name the next time the
// group's membership changed -- long after the scale, so the cause would be
// invisible.
//
// Scaling rebuilds the adversary from _originalStats, so the flag only needs
// explicit carrying when it was set AFTER the first scale: the snapshot then
// holds the stale value. Renaming a scaled adversary is the ordinary case.
const scaledFirst = AdversaryScaler.scale({ ...structuredClone(original), hasCustomName: false }, 3);
assert.equal(scaledFirst._originalStats.hasCustomName, false);
scaledFirst.displayName = 'The one on the roof';
scaledFirst.hasCustomName = true;

const rescaled = AdversaryScaler.scale(scaledFirst, 2);
assert.equal(rescaled.displayName, 'The one on the roof');
assert.equal(
    rescaled.hasCustomName,
    true,
    'a rename made after scaling must survive the next scale, despite the stale snapshot',
);

// The published tier is what the scaling UI offers as the reset target, so it
// must stay reachable from a scaled instance however many times it was scaled.
assert.equal(Number(rescaled._originalStats.tier), 1);
const resetToBase = AdversaryScaler.scale(rescaled, Number(rescaled._originalStats.tier));
assert.equal(resetToBase.tier, 1);
assert.deepEqual(
    resetToBase.hp_stress,
    original.hp_stress,
    'resetting to the published tier must restore the published stats',
);
assert.deepEqual(resetToBase.attack, original.attack);

console.log('Adversary scaler tier and reversibility regressions passed');
