const assert = require('node:assert/strict');
require('../parser.js');
require('../parser-patch.js');
require('../freshcutgrass-parser.js');
require('../freshcutgrass-rendered-repair.js');

global.chrome = {
  runtime: { onMessage: { addListener() {} } },
  storage: { local: { set: async () => {} } }
};
require('../content-script.js');
require('../freshcutgrass-card-boundary.js');

class MockElement {
  constructor({ text = '', tagName = 'DIV', className = '', children = [] } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.tagName = tagName;
    this.className = className;
    this.children = children;
    this.parentElement = null;
    children.forEach((child) => { child.parentElement = this; });
  }
  querySelectorAll(selector) {
    const all = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        all.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector === '*') return all;
    if (/h1,h2,h3,h4,h5,h6/.test(selector)) return all.filter((node) => /^H[1-6]$/.test(node.tagName));
    return [];
  }
  contains(node) {
    return node === this || this.querySelectorAll('*').includes(node);
  }
  matches(selector) {
    return selector.includes('[class*="card"]') && /card/i.test(this.className);
  }
  getAttribute() { return ''; }
}

function card(name, type, tier, description, section, sectionText) {
  const heading = new MockElement({ text: name, tagName: 'H2' });
  const text = `${name}\n${type}\n${tier}\n${description}\n134\n365\n${section}\n${sectionText}`;
  return new MockElement({ text, className: 'community-card', children: [heading] });
}

const cards = [
  card('BRIARBEAR', 'BRUISER', '1', 'A large bear, corrupted by the Witherwild to grow grasping, thorny vines.', 'Motives & Tactics:', 'Climb, Defend territory, Pummel, Track'),
  card('SHADOW HAG', 'SOLO', '2', 'A fey creature that wields\nshadows and secrets', 'Motives & Tactics:', 'Feed on nightmares, summon hellspawn, make deals'),
  card('LIVING VINES', 'STANDARD', '1', 'Moving plants, crawling through the ground and entangling their victims.', 'Motives & Tactics:', 'Entangle, choke out'),
  card('MUSHROOM ENTANGLEMENT', 'EXPLORATION', '1', 'A pulsing, semi-sentient wetland of towering mushrooms and spore clouds.', 'Tone & feel:', 'This encounter is eerie and reactive.'),
  card('RUNEBLIGHT WOLF', 'SOLO', '1', 'A corrupted forest predator, swollen with wild magic.', 'Motives & Tactics:', 'Hunt intruders, corrupt the weak')
];
const body = new MockElement({ text: cards.map((node) => node.innerText).join('\n'), children: cards });
const doc = { body, documentElement: body };
const location = { hostname: 'freshcutgrass.app' };

const helper = globalThis.DHFreshCutGrassCardBoundary;
const shadowDescription = helper.domCardDescription(body, 'Shadow Hag');
assert.equal(shadowDescription, 'A fey creature that wields shadows and secrets');
assert.notEqual(shadowDescription, 'Moving plants, crawling through the ground and entangling their victims.');

const enriched = helper.enrichFreshCutGrassItems([{
  name: 'Shadow Hag',
  desc: 'Moving plants, crawling through the ground and entangling their victims.'
}], doc, location);
assert.equal(enriched[0].desc, 'A fey creature that wields shadows and secrets');
assert.equal(enriched[0].__cardDescription, 'A fey creature that wields shadows and secrets');

const parser = globalThis.DHStatblockParser;
const repaired = parser.repairFreshCutGrassDomItem({
  ...enriched[0],
  rawText: body.innerText + '\nDifficulty\n16\nSTANDARD ATTACK\nMoon Staff: Far | 2d10+3\nMagical\n+2\nFEATURES\nFey Disguise\nThe Hag can disguise herself.'
}, 'https://freshcutgrass.app/homebrew?id=uoHvyG83mBqs4YAxPpGB8n');
assert.equal(repaired.desc, 'A fey creature that wields shadows and secrets');
assert.equal(repaired.__cardDescription, undefined);
console.log('FreshCutGrass five-card description boundary regression passed');
