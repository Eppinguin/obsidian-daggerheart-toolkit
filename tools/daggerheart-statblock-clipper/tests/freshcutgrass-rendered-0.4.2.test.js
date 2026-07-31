const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
require('../freshcutgrass-parser.js');
require('../freshcutgrass-rendered-repair.js');
const parser = globalThis.DHStatblockParser;

const shadow = parser.repairFreshCutGrassDomItem({
  name: 'Shadow Hag',
  type: 'Solo',
  desc: 'Moving plants, crawling through the ground and entangling their victims.',
  weapon: 'COMMUNITY ADVERSARIES & ENVIRONMENTS',
  damage: 'Moon Staff: Far | 2d10+3',
  attack: '+2',
  rawText: `Shadow Hag
Solo
Tier
2
A fey creature that wields shadows and secrets.
Difficulty
16
STANDARD ATTACK
COMMUNITY ADVERSARIES & ENVIRONMENTS
+2
Moon Staff: Far | 2d10+3
Magical
FEATURES
Fey Disguise
The Hag can disguise herself.`
}, 'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n');
assert.equal(shadow.desc, 'A fey creature that wields shadows and secrets.');
assert.deepEqual(
  { weapon: shadow.weapon, range: shadow.range, damage: shadow.damage, attack: shadow.attack },
  { weapon: 'Moon Staff', range: 'Far', damage: '2d10+3 Magical', attack: '+2' }
);

const mushroom = parser.repairFreshCutGrassDomItem({
  name: 'Mushroom entanglement',
  type: 'EnvironmentExploration',
  desc: 'No comments yet. Be the first to comment!',
  rawText: `Mushroom entanglement
EnvironmentExploration
Tier
1
Moving plants, crawling through the ground and entangling their victims.
Difficulty
11
FEATURES
Overgrown Battlefield
There has been a struggle here.
COMMENTS
No comments yet. Be the first to comment!`
}, 'https://freshcutgrass.app/homebrew?id=c4SRR7SGMMdryPwgfDzvpP');
assert.equal(mushroom.desc, 'Moving plants, crawling through the ground and entangling their victims.');
assert.ok(!/comments?|be the first/i.test(mushroom.desc));

console.log('FreshCutGrass 0.4.2 rendered regressions passed');
