const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('generates browser-specific MV3 manifests', async () => {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { createManifest } = await import(pathToFileURL(path.join(root, 'scripts/manifest.mjs')));
  const chromium = await createManifest(root, 'chromium');
  const firefox = await createManifest(root, 'firefox');
  assert.equal(chromium.version, pkg.version);
  assert.equal(chromium.browser_specific_settings, undefined);
  assert.equal(firefox.version, pkg.version);
  assert.equal(firefox.browser_specific_settings.gecko.id, 'daggerheart-statblock-clipper@eppinguin.dev');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
});
