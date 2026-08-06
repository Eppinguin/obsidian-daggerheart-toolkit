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
    features: [
        {
            name: 'Waking Nightmare (Fear 1)',
            type: 'Action',
            desc: 'Force targets to relive a nightmare.',
        },
    ],
});

assert.equal(shadowHag.category, 'adversary');
assert.equal(shadowHag.attack.name, 'Moon Staff');
assert.equal(shadowHag.attack.modifier, '+2');
assert.equal(shadowHag.hp_stress.major_hp, 14);
assert.equal(shadowHag.hp_stress.severe_hp, 28);
assert.equal(shadowHag.motives_tactics, 'Feed on nightmares, summon hellspawn, make deals');
assert.equal(shadowHag.features[0].parsedCost, 'Fear 1');

// SRD feats carry their type as a name suffix rather than a field, so the
// suffix has to become the type and leave the name clean.
const suffixed = format.normalizeFeature({
    name: 'Earth Eruption - Action',
    text: 'Burst out of the ground.',
});
assert.equal(suffixed.name, 'Earth Eruption');
assert.equal(suffixed.type, 'Action');

// A few feats append a countdown after the type. Reaching them must not eat it.
const withCountdown = format.normalizeFeature({
    name: 'Hallucinatory Breath - Reaction: Countdown (Loop 1d6)',
    text: 'Exhale a cloud of spores.',
});
assert.equal(withCountdown.name, 'Hallucinatory Breath');
assert.equal(withCountdown.type, 'Reaction');
assert.equal(withCountdown.countdown, 'Countdown (Loop 1d6)');

const longCountdown = format.normalizeFeature({
    name: 'Census Bell - Reaction: Long-Term Countdown (8)',
    text: 'Toll the bell.',
});
assert.equal(longCountdown.type, 'Reaction');
assert.equal(longCountdown.countdown, 'Long-Term Countdown (8)');

// An em dash separator is used in some hand-written content.
assert.equal(format.normalizeFeature({ name: 'Spit Acid — Action', text: 'x' }).type, 'Action');

// A declared type still wins over the suffix.
assert.equal(format.normalizeFeature({ name: 'Sudden Strike - Passive', type: 'Action', text: 'x' }).type, 'Action');

// --- Cost parsed from the description --------------------------------------
// SRD feats state their price as a leading imperative rather than a field.
assert.equal(
    format.normalizeFeature({
        name: 'Earth Eruption - Action',
        text: 'Mark a Stress to have the Burrower burst out.',
    }).parsedCost,
    'Stress 1',
);
assert.equal(
    format.normalizeFeature({
        name: 'Group Attack - Action',
        text: 'Spend a Fear to choose a target.',
    }).parsedCost,
    'Fear 1',
);
assert.equal(
    format.normalizeFeature({
        name: 'Big Move - Action',
        text: 'Spend two Fear to do something drastic.',
    }).parsedCost,
    'Fear 2',
);
assert.equal(
    format.normalizeFeature({ name: 'Numeric - Action', text: 'Mark 3 Stress to push through.' }).parsedCost,
    'Stress 3',
);

// The same words mid-sentence are a consequence the PLAYERS pay, not a cost the
// GM pays. Labelling those as costs would be actively misleading at the table.
for (const consequence of [
    'Each target knocked back by this must mark a Stress.',
    'When the attack causes a target to mark HP, you can mark a Stress.',
    'On a success, the target must mark a Stress.',
    'You must spend a Fear to spotlight the Ogre.',
]) {
    const parsed = format.normalizeFeature({ name: 'Whatever - Passive', text: consequence });
    assert.ok(!parsed.parsedCost, `must not read a cost out of: "${consequence}"`);
}

// A cost declared on the name still wins over the description.
assert.equal(
    format.normalizeFeature({
        name: 'Waking Nightmare (Fear 1) - Action',
        text: 'Mark a Stress to do it.',
    }).parsedCost,
    'Fear 1',
);

const envelope = format.createEnvelope([
    shadowHag,
    {
        name: 'Mushroom Entanglement',
        category: 'environment',
        tier: 1,
        type: 'Exploration',
        difficulty: 11,
        description: 'A living wetland of towering mushrooms.',
        impulses: 'Entangle, react, spread spores',
        hp_stress: { hp: 0, stress: 0 },
    },
]);
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
