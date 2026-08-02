const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('opens the protocol prompt in front and restores the source tab after returning from Obsidian', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');
  const state = {};
  const calls = { create: [], update: [], remove: [], focus: [] };
  let messageListener;
  let focusListener;
  let removedListener;

  const storage = {
    async get(key) { return { [key]: state[key] }; },
    async set(values) { Object.assign(state, values); },
    async remove(key) { delete state[key]; }
  };

  const browser = {
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    storage: { session: storage, local: storage },
    tabs: {
      async create(properties) {
        calls.create.push(properties);
        return { id: 91, windowId: properties.windowId };
      },
      async update(tabId, properties) { calls.update.push({ tabId, properties }); },
      async remove(tabId) { calls.remove.push(tabId); },
      onRemoved: { addListener(listener) { removedListener = listener; } }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async update(windowId, properties) { calls.focus.push({ windowId, properties }); },
      onFocusChanged: { addListener(listener) { focusListener = listener; } }
    }
  };

  vm.runInNewContext(source, { browser, chrome: undefined, Date, Number, String, Error, globalThis: undefined });
  assert.equal(typeof messageListener, 'function');
  assert.equal(typeof focusListener, 'function');
  assert.equal(typeof removedListener, 'function');

  const response = await new Promise(resolve => {
    const keepOpen = messageListener({
      type: 'DH_OPEN_EXTERNAL_URI',
      uri: 'obsidian://daggerheart-import?source=test',
      sourceTabId: 17,
      sourceWindowId: 4
    }, null, resolve);
    assert.equal(keepOpen, true);
  });

  assert.deepEqual(response, { ok: true, launchTabId: 91 });
  assert.deepEqual(calls.create, [{
    url: 'obsidian://daggerheart-import?source=test',
    active: true,
    windowId: 4
  }]);
  assert.equal(calls.update.length, 0, 'source tab must not be restored before Obsidian takes focus');

  await focusListener(-1);
  assert.equal(calls.update.length, 0, 'browser blur only marks the external-app transition');

  await focusListener(4);
  assert.deepEqual(calls.update, [{ tabId: 17, properties: { active: true } }]);
  assert.deepEqual(calls.focus, [{ windowId: 4, properties: { focused: true } }]);
  assert.deepEqual(calls.remove, [91]);
  assert.equal(state.dhPendingObsidianLaunch, undefined);
});
