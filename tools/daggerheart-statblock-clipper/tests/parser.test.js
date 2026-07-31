const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
const parser = globalThis.DHStatblockParser;

const parsed = parser.parseText(`Bog Knight\nManage\nTier\n2\nType\nBruiser\nDifficulty\n15\nHP\n7\nStress\n3\nThresholds: 10 / 18\nATK: +3 | Rusty Blade: Melee | 2d8+3 Physical\nFeatures\nSink – Action: Pull a target under.`);
assert.equal(parsed.name, 'Bog Knight');
assert.equal(parser.toToolkitStatblock(parsed).attack.name, 'Rusty Blade');

const heart = parser.parseText(`Lectors\nTier: 3\nType: Support\nDifficulty: 16\nHP: 6\nStress: 5\nFeatures\nPassives\n—\nActions\nMental Skim\nTarget creature makes a Presence or Instinct Reaction roll. On a failure it learns an immediate intention.\nMind Spike\nfear 1\nThis adversary makes an Attack Roll and deals 1d8 magic damage.\nReactions\nParalytic Suggestion\nstress 1\nWhen a creature declares an action, force an Instinct reaction roll.\nMotives & tactics\nCorrect, control.`);
assert.equal(heart.features.length, 3);
assert.deepEqual(heart.features.map((item) => item.type), ['Action', 'Action', 'Reaction']);
assert.equal(heart.features[1].parsedCost, 'Fear 1');

const second = parser.parseText(`Mire Hag\nManage\nTier: 2\nType: Leader\nDifficulty: 16\nHP: 6\nStress: 4\nATK: +4 | Crooked Staff: Far | 2d6+5 Magical\nFeatures\nBog Call – Action: Summon a swamp creature.`);
assert.equal((parser.toToolkitMarkdownMany([parsed, second]).match(/```daggerheart-statblock/g) || []).length, 2);
assert.equal(JSON.parse(parser.toToolkitJsonMany([parsed, second])).length, 2);
console.log('extension parser tests passed');
