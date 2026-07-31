const assert = require('node:assert/strict');
require('../parser.js');
const parser = globalThis.DHStatblockParser;

const parsed = parser.parseText(`Bog Knight
Tier: 2
Type: Bruiser
A wet knight stalking the reeds.
Difficulty: 15
HP: 7
Stress: 3
Thresholds: 10 / 18
ATK: +3 | Rusty Blade: Melee | 2d8+3 Physical
Experience: Swamp Lore +2
Motives & tactics: Drag, drown
Features
Sink – Action: Pull a target under.` , {
  source: 'https://freshcutgrass.app/homebrew/bog-knight',
  sourceSite: 'freshcutgrass.app',
  author: 'Maker'
});
const toolkit = parser.toToolkitStatblock(parsed);
assert.equal(toolkit.category, 'adversary');
assert.equal(toolkit.attack.name, 'Rusty Blade');
assert.equal(toolkit.attack.modifier, '+3');
assert.deepEqual(toolkit.hp_stress, { hp: 7, stress: 3, major_hp: 10, severe_hp: 18 });
assert.equal(toolkit.source.author, 'Maker');
const json = JSON.parse(parser.toToolkitJson(parsed));
assert.equal(json.type, 'adversary');
assert.equal(json.data.category, 'adversary');
assert.match(parser.toToolkitMarkdown(parsed), /^```daggerheart-statblock/);

const env = parser.parseText(`Glass Bridge
Tier: 2
Type: Traversal
Difficulty: 14
Impulses: Crack, sway
Potential adversaries: Glass Snake
Features
Shatter – Reaction: The bridge breaks.`);
assert.equal(parser.toToolkitStatblock(env).category, 'environment');
console.log('extension parser tests passed');
