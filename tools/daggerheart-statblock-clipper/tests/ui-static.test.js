const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const compact = fs.readFileSync(path.join(root, 'compact-layout.css'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifests/base.json'), 'utf8'));
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifests/firefox.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const id of [
  'status', 'result', 'sendObsidian', 'createNote', 'copyMarkdown', 'copyJson',
  'copyDiagnostics', 'selectBlock', 'vault', 'folder', 'motivesSection', 'motivesValue'
]) assert.match(popup, new RegExp(`id="${id}"`));

assert.match(popup, /<script src="statblock-format\.js"><\/script>/);
assert.match(popup, /<script src="statblock-format-adapter\.js"><\/script>/);
assert.match(popup, /<script src="popup\.js"><\/script>/);
assert.match(options, /<script src="options\.js"><\/script>/);
assert.match(compact, /width:\s*400px/);
assert.match(compact, /\.utility-actions/);
assert.doesNotMatch(styles, /linear-gradient/);
assert.match(popupJs, /obsidian:\/\/daggerheart-import/);
assert.match(popupJs, /copyDiagnostics/);
assert.match(popupJs, /motives_tactics/);
assert.equal(baseManifest.manifest_version, 3);
assert.equal(baseManifest.version, undefined);
assert.equal(pkg.version, '0.7.0');
assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, '128.0');
assert.deepEqual(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
for (const size of [16, 32, 48, 128]) assert.ok(fs.existsSync(path.join(root, `icons/icon-${size}.png`)));
console.log('Vite source and cross-browser manifest regression passed');
