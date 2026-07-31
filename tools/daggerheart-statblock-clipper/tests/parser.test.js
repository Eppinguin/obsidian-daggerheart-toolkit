const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
require('../freshcutgrass-parser.js');
require('../freshcutgrass-rendered-repair.js');
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
