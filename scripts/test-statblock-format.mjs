import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

await import(`${pathToFileURL(resolve('shared/statblock-format.js')).href}?${Date.now()}`);
const format = globalThis.DHStatblockFormat;
assert.ok(format, 'shared statblock runtime should install itself');

const shadowHag = format.normalizeStatblock({
    name: 'Shadow Hag',
    tier: 2,
    type: 'Solo',
    desc: 'A fey creature that wields shadows and secrets',
    difficulty: 16,
    weapon: 'Moon Staff',
    range: 'Far',
    damage: '2d10+3 Magical',
    attack: '+2',
    hp: 8,
    stress: 6,
    thresholds: '14/28',
    motives: 'Feed on nightmares, summon hellspawn, make deals',
    features: [{ name: 'Waking Nightmare (Fear 1)', type: 'Action', desc: 'Force targets to relive a nightmare.' }]
});

assert.equal(shadowHag.category, 'adversary');
assert.equal(shadowHag.attack.name, 'Moon Staff');
assert.equal(shadowHag.attack.modifier, '+2');
assert.equal(shadowHag.hp_stress.major_hp, 14);
assert.equal(shadowHag.hp_stress.severe_hp, 28);
assert.equal(shadowHag.motives_tactics, 'Feed on nightmares, summon hellspawn, make deals');
assert.equal(shadowHag.features[0].parsedCost, 'Fear 1');

const envelope = format.createEnvelope([shadowHag, {
    name: 'Mushroom Entanglement',
    category: 'environment',
    tier: 1,
    type: 'Exploration',
    difficulty: 11,
    description: 'A living wetland of towering mushrooms.',
    impulses: 'Entangle, react, spread spores',
    hp_stress: { hp: 0, stress: 0 }
}]);
assert.equal(envelope.type, 'statblocks');
assert.equal(envelope.data.length, 2);
assert.equal(format.normalizePayload(JSON.stringify(envelope)).length, 2);

const markdown = format.toMarkdown(envelope.data);
assert.match(markdown, /motives_tactics: "Feed on nightmares/);
assert.equal((markdown.match(/```daggerheart-statblock/g) || []).length, 2);

const validation = format.validateStatblock(shadowHag);
assert.equal(validation.valid, true);
assert.deepEqual(validation.errors, []);
console.log('Shared statblock format contract passed');
