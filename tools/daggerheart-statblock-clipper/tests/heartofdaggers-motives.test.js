const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
require('../heartofdaggers-filter.js');

const parser = globalThis.DHStatblockParser;
const rawText = `RULES LAWYER
Tier 3 Solo
A sentient 4th-wall breaking rulebook.
Motives & Tactics : Change the pace, Make mad,
Get eyerolls, Oversee games
Difficulty: 18 | Thresholds: 22/44 | HP: 12 | Stress: 5
ATK: +6 | Rules Filibuster: Close | 3d6+15 Magical
Experience: School of Knowledge +4
Features
Relentless (2) - Passive: This adversary can be spotlighted twice.`;

const item = {
  name: 'Rules Lawyer',
  tier: 3,
  type: 'Solo',
  difficulty: 18,
  hp: 12,
  stress: 5,
  weapon: 'Rules Filibuster',
  range: 'Close',
  damage: '3d6+15 Magical',
  attack: '+6',
  rawText
};

assert.equal(
  parser.motivesFromText(rawText),
  'Change the pace, Make mad, Get eyerolls, Oversee games'
);

const [restored] = parser.filterHeartOfDaggersItems(
  [item],
  { hostname: 'heartofdaggers.com' }
);
assert.equal(restored.motives, 'Change the pace, Make mad, Get eyerolls, Oversee games');

const toolkit = parser.toToolkitStatblock(restored);
assert.equal(toolkit.motives_tactics, 'Change the pace, Make mad, Get eyerolls, Oversee games');
assert.match(
  parser.toToolkitMarkdown(restored),
  /motives_tactics: "Change the pace, Make mad, Get eyerolls, Oversee games"/
);
console.log('Heart of Daggers Motives & Tactics regression passed');
