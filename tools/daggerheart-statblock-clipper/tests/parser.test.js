const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
require('../freshcutgrass-parser.js');
const parser = globalThis.DHStatblockParser;

const parsed = parser.parseText(`Bog Knight
Manage
Tier
2
Type
Bruiser
Difficulty
15
HP
7
Stress
3
Thresholds: 10 / 18
ATK: +3 | Rusty Blade: Melee | 2d8+3 Physical
Features
Sink – Action: Pull a target under.`);
assert.equal(parsed.name, 'Bog Knight');
assert.equal(parser.toToolkitStatblock(parsed).attack.name, 'Rusty Blade');

const heart = parser.parseText(`Lectors
Tier: 3
Type: Support
Difficulty: 16
HP: 6
Stress: 5
Features
Passives
—
Actions
Mental Skim
Target creature makes a Presence or Instinct Reaction roll. On a failure it learns an immediate intention.
Mind Spike
fear 1
This adversary makes an Attack Roll and deals 1d8 magic damage.
Reactions
Paralytic Suggestion
stress 1
When a creature declares an action, force an Instinct reaction roll.
Motives & tactics
Correct, control.`);
assert.equal(heart.features.length, 3);
assert.deepEqual(heart.features.map((item) => item.type), ['Action', 'Action', 'Reaction']);
assert.equal(heart.features[1].parsedCost, 'Fear 1');

const second = parser.parseText(`Mire Hag
Manage
Tier: 2
Type: Leader
Difficulty: 16
HP: 6
Stress: 4
ATK: +4 | Crooked Staff: Far | 2d6+5 Magical
Features
Bog Call – Action: Summon a swamp creature.`);
assert.equal((parser.toToolkitMarkdownMany([parsed, second]).match(/```daggerheart-statblock/g) || []).length, 2);
assert.equal(JSON.parse(parser.toToolkitJsonMany([parsed, second])).length, 2);
console.log('extension parser tests passed');

const shadowHagState = {
  targetId: 'uoHvyG83mBqs4YAxPpGB8n',
  candidates: [{ path: 'dom.__reactProps.other', score: 40, value: { id: 'other', name: 'Not Shadow Hag', tier: 2, role: 'Solo', difficulty: 15, hp: 7, stress: 4, features: [{ name: 'Other Feature', type: 'Action', description: 'Other.' }] } }, {
    path: 'dom.__reactProps.homebrew',
    score: 90,
    value: {
      id: 'uoHvyG83mBqs4YAxPpGB8n',
      data: {
        name: 'Shadow Hag',
        tier: 2,
        role: 'Solo',
        description: 'A fey creature that wields shadows and secrets.',
        creatorName: 'RightKnighttoFight',
        difficulty: 16,
        hitPoints: 8,
        stress: 6,
        damageThresholds: { major: 14, severe: 28 },
        standardAttack: {
          name: 'Moon Staff',
          range: 'Far',
          damage: '2d10+3',
          damageType: 'Magical',
          attackModifier: 2
        },
        motivesAndTactics: ['Feed on nightmares', 'Summon hellspawn', 'Make deals'],
        experiences: [
          { name: 'Ageless Knowledge', modifier: 2 },
          { name: 'Naughty kids should be punished', modifier: 2 }
        ],
        features: [
          { name: 'Fey Disguise', type: 'Passive', description: 'The Hag can take on the appearance of a creature similar in size to them. This disguise can be seen through on an Instinct Roll. On a success, the Hag cannot use their Waking Nightmare against that PC. On a failure, the PC has disadvantage on all action rolls against the Hag.' },
          { name: 'Relentless (3)', type: 'Passive', description: 'The Hag can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight them.' },
          { name: 'Raking Claws', type: 'Action', stressCost: 1, description: 'Mark a Stress to make an attack against all targets within Very Close range. Targets the Hag succeeds against take 2d10 magic damage and knocked back to Close range.' },
          { name: 'Waking Nightmare', type: 'Action', fearCost: 1, description: 'Spend a Fear to force all targets within Far range to make a Presence Reaction Roll. All targets that fail, lose a Hope and mark a Stress as they relive a childhood nightmare. The Hag learns about this nightmare which they use to clear 1 HP and 1 Stress.' },
          { name: 'Prey on Terror', type: 'Action', stressCost: 1, description: 'Mark a Stress and choose a point within Far range to place a Nightmare Totem. All creatures within Close range of the Nightmare Totem whose nightmares are known to the Hag are Vulnerable.' },
          { name: 'Ethereal Shift', type: 'Reaction', description: 'If the Hag marks HP, mark a Stress to teleport to a location within Close range and gain resistance to physical damage until the next time the Hag has the spotlight.' }
        ]
      }
    }
  }]
};

const shadowItems = parser.parseFreshCutGrassState(
  shadowHagState,
  'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n',
  []
);
assert.equal(shadowItems.length, 1);
const shadow = shadowItems[0];
assert.equal(shadow.name, 'Shadow Hag');
assert.equal(shadow.tier, 2);
assert.equal(shadow.type, 'Solo');
assert.equal(shadow.difficulty, 16);
assert.equal(shadow.hp, 8);
assert.equal(shadow.stress, 6);
assert.equal(shadow.thresholds, '14/28');
assert.deepEqual(
  { weapon: shadow.weapon, range: shadow.range, damage: shadow.damage, attack: shadow.attack },
  { weapon: 'Moon Staff', range: 'Far', damage: '2d10+3 Magical', attack: '+2' }
);
assert.equal(shadow.motives, 'Feed on nightmares, Summon hellspawn, Make deals');
assert.equal(shadow.xp, 'Ageless Knowledge +2, Naughty kids should be punished +2');
assert.equal(shadow.author, 'RightKnighttoFight');
assert.equal(shadow.features.length, 6);
assert.deepEqual(shadow.features.map((feature) => feature.name), [
  'Fey Disguise', 'Relentless (3)', 'Raking Claws', 'Waking Nightmare', 'Prey on Terror', 'Ethereal Shift'
]);
assert.equal(shadow.features.find((feature) => feature.name === 'Raking Claws').parsedCost, 'Stress 1');
assert.equal(shadow.features.find((feature) => feature.name === 'Waking Nightmare').parsedCost, 'Fear 1');
assert.equal(shadow.features.find((feature) => feature.name === 'Prey on Terror').parsedCost, 'Stress 1');
const shadowToolkit = parser.toToolkitStatblock(shadow);
assert.equal(shadowToolkit.category, 'adversary');
assert.equal(shadowToolkit.attack.name, 'Moon Staff');
assert.equal(shadowToolkit.hp_stress.major_hp, 14);
assert.equal(shadowToolkit.hp_stress.severe_hp, 28);
assert.equal(shadowToolkit.features.length, 6);
console.log('FreshCutGrass Shadow Hag app-state regression passed');
