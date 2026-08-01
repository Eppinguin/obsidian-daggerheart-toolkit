const assert = require('node:assert/strict');

const valid = {
  name: 'Actual Cannibal Shia LaBeouf',
  tier: 3,
  type: 'Solo',
  difficulty: 18,
  hp: 9,
  stress: 5,
  features: [{ name: 'Quiet, Quiet', type: 'Passive', desc: 'He is following you.' }]
};
const conversion = {
  ...valid,
  name: 'This is a conversion of u/Death546’s Actual Cannibal Shia LeBouf from Reddit.'
};
const imageCredit = {
  ...valid,
  name: 'Image is CC-BY-SA-3.0, by Maxime Vincent.'
};
const proseOnly = {
  name: 'This is a conversion of u/Death546’s Actual Cannibal Shia LeBouf from Reddit. Image is CC-BY-SA-3.0, by Maxime Vincent.',
  description: 'Attribution only.'
};

globalThis.DHStatblockParser = {
  parseManyFromDocument: () => [valid, conversion, imageCredit, proseOnly],
  parseFromDocument: () => valid
};
require('../heartofdaggers-filter.js');

const parser = globalThis.DHStatblockParser;
assert.equal(parser.completeHeartOfDaggersItem(valid), true);
assert.equal(parser.completeHeartOfDaggersItem(conversion), false);
assert.equal(parser.completeHeartOfDaggersItem(imageCredit), false);
assert.equal(parser.completeHeartOfDaggersItem(proseOnly), false);
assert.equal(parser.attributionTitle(conversion.name), true);
assert.equal(parser.attributionTitle(imageCredit.name), true);

const filtered = parser.parseManyFromDocument({}, { hostname: 'heartofdaggers.com' });
assert.deepEqual(filtered.map((item) => item.name), ['Actual Cannibal Shia LaBeouf']);

const untouched = parser.parseManyFromDocument({}, { hostname: 'example.com' });
assert.equal(untouched.length, 4);
console.log('Heart of Daggers attribution-root filter regression passed');
