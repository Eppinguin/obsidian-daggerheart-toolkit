const assert = require('node:assert/strict');

class MockNode {}
global.Node = MockNode;
const root = new MockNode();
root.__reactProps$fixture = {
  children: {
    homebrew: {
      id: 'uoHvyG83mBqs4YAxPpGB8n',
      name: 'Shadow Hag',
      tier: 2,
      role: 'Solo',
      difficulty: 16,
      hp: 8,
      stress: 6,
      features: [{ name: 'Fey Disguise', type: 'Passive', description: 'Disguise text.' }]
    }
  }
};

const emptyStorage = { length: 0, key: () => null, getItem: () => null };
global.document = {
  documentElement: root,
  body: root,
  title: 'Shadow Hag',
  querySelectorAll: () => [root]
};
global.window = { localStorage: emptyStorage, sessionStorage: emptyStorage };
global.performance = { getEntriesByType: () => [] };

require('../freshcutgrass-state.js');
const result = globalThis.DHFreshCutGrassCollector('uoHvyG83mBqs4YAxPpGB8n');
assert.equal(result.targetId, 'uoHvyG83mBqs4YAxPpGB8n');
assert.ok(result.candidates.some((candidate) => JSON.stringify(candidate.value).includes('Shadow Hag')));
console.log('FreshCutGrass MAIN-world state collector test passed');
