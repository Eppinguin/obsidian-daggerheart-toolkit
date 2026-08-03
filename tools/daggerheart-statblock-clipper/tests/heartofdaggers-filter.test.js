const assert = require('node:assert/strict');

const rulesLawyer = {
  name: 'Rules Lawyer',
  tier: 3,
  type: 'Solo',
  difficulty: 18,
  hp: 12,
  stress: 5,
  weapon: 'Rules Filibuster',
  features: [{ name: 'Relentless (2)', type: 'Passive', desc: 'This adversary can be spotlighted twice.' }]
};
const leftPanelMisparse = {
  ...rulesLawyer,
  name: 'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.'
};
const conversion = {
  ...rulesLawyer,
  name: 'This is a conversion of u/Death546’s Actual Cannibal Shia LeBouf from Reddit.'
};
const imageCredit = {
  ...rulesLawyer,
  name: 'Image is CC-BY-SA-3.0, by Maxime Vincent.'
};

class MockElement {
  constructor(id, text, children = []) {
    this.id = id;
    this.innerText = text;
    this.textContent = text;
    this.children = children;
    this.parentElement = null;
    children.forEach((child) => { child.parentElement = this; });
  }
  querySelectorAll() {
    const all = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
  contains(node) {
    return node === this || this.querySelectorAll('*').includes(node);
  }
}

const leftText = [
  'ADVERSARY OVERVIEW',
  'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.',
  'STAT BLOCK',
  'TIER', '3', 'TYPE', 'SOLO', 'DIFFICULTY', '18', 'HP', '12', 'STRESS', '5', 'ATTACK MOD', '+6',
  'STANDARD ATTACK', 'Rules Filibuster', 'Range: Close', 'Damage: 3d6+15', 'FEATURES'
].join('\n');
const rightText = [
  'RULES LAWYER',
  'Tier 3 Solo',
  'A sentient 4th-wall breaking rulebook for the cosmic realm they inhabit.',
  'Motives & Tactics: Change the pace, Make mad, Get eyerolls, Oversee games',
  'Difficulty: 18 | Thresholds: 22/44 | HP: 12 | Stress: 5',
  'ATK: +6 | Rules Filibuster: Close | 3d6+15 Magical',
  'Experience: School of Knowledge +4',
  'HP:', 'STRESS:', 'Features',
  'Relentless (2) - Passive: This adversary can be spotlighted up to 2 times per GM turn.'
].join('\n');
const left = new MockElement('left', leftText);
const rightInner = new MockElement('right-inner', rightText);
const right = new MockElement('right', rightText, [rightInner]);
const body = new MockElement('body', `${leftText}\n${rightText}`, [left, right]);
const doc = { body, documentElement: body };
const calls = [];

globalThis.DHStatblockParser = {
  parseManyFromDocument: (_doc, _location, selected) => {
    calls.push(selected?.id || 'page');
    if (selected?.id === 'right-inner' || selected?.id === 'right') return [rulesLawyer];
    return [leftPanelMisparse, rulesLawyer, conversion, imageCredit];
  },
  parseFromDocument: () => rulesLawyer
};
require('../heartofdaggers-filter.js');

const parser = globalThis.DHStatblockParser;
assert.equal(parser.renderedCardSignature(leftText), false);
assert.equal(parser.renderedCardSignature(rightText), true);
assert.deepEqual(parser.renderedCardRoots(doc).map((root) => root.id), ['right-inner']);

const filtered = parser.parseManyFromDocument(doc, { hostname: 'heartofdaggers.com' });
assert.deepEqual(filtered.map((item) => item.name), ['Rules Lawyer']);
assert.deepEqual(calls, ['right-inner']);
assert.equal(parser.completeHeartOfDaggersItem(leftPanelMisparse), true, 'the structural root filter, not a one-off name rule, must remove the left panel');
assert.equal(parser.attributionTitle(conversion.name), true);
assert.equal(parser.attributionTitle(imageCredit.name), true);

const environmentText = [
  'GREY BIRCH FOREST',
  'Tier 2 Exploration',
  'An uncommon patch of trees east of Vogler and northwest of Kalaman',
  'Impulses: Unfamiliar, bare',
  'Difficulty: 14',
  'Potential Adversaries: Draconians',
  'Features',
  'Unfamiliar Maze - Passive: Characters can become lost.'
].join('\n');
assert.equal(parser.renderedCardSignature(environmentText), true);

const untouched = parser.parseManyFromDocument(doc, { hostname: 'example.com' });
assert.equal(untouched.length, 4);
console.log('Heart of Daggers rendered-card root regression passed');
