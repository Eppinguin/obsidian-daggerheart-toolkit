import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'popup.html', 'options.html', 'manifest.json', 'parser.js', 'parser-patch.js',
  'heartofdaggers-filter.js', 'freshcutgrass-parser.js', 'freshcutgrass-state.js',
  'freshcutgrass-rendered-repair.js', 'freshcutgrass-card-boundary.js', 'content-script.js',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'
];
for (const target of ['chromium', 'firefox']) {
  const dir = resolve(root, 'dist', target);
  await Promise.all(required.map((file) => access(resolve(dir, file))));
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  if (target === 'firefox') {
    assert.equal(manifest.browser_specific_settings.gecko.id, 'daggerheart-statblock-clipper@eppinguin.dev');
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
  } else assert.equal(manifest.browser_specific_settings, undefined);
}
console.log('Chromium and Firefox build validation passed');
