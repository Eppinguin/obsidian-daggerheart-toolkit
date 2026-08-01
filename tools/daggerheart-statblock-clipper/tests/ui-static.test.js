const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const compactStyles = fs.readFileSync(path.join(root, 'compact-layout.css'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

for (const id of [
  'statusText', 'loadingCard', 'categoryBadge', 'typeBadge', 'tierValue',
  'difficultyValue', 'hpValue', 'stressValue', 'attackSection', 'featureCount',
  'sendLabel', 'sendHint', 'destinationSummary', 'openOptions'
]) {
  assert.match(popup, new RegExp(`id=["']${id}["']`), `missing popup element #${id}`);
}
assert.match(popup, /role="status"/);
assert.match(popup, /aria-live="polite"/);
assert.match(styles, /prefers-color-scheme:\s*dark/);
assert.match(styles, /\.stat-card/);
assert.match(styles, /\.button--primary/);
assert.match(popupJs, /toToolkitStatblock/);
assert.match(popupJs, /openOptionsPage/);
assert.match(options, /Obsidian destination/);
assert.match(popup, /class="popup-root"/);
assert.match(popup, /compact-layout\.css/);
assert.match(compactStyles, /html\.popup-root,[\s\S]*body\.popup-page[\s\S]*width:\s*400px/);
assert.match(compactStyles, /max-width:\s*400px/);
assert.match(compactStyles, /\.app-shell\s*\{[^}]*width:\s*min\(400px,\s*100vw\)/s);
assert.match(compactStyles, /\.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
assert.doesNotMatch(styles, /\.app-header\s*\{[^}]*linear-gradient/s);
assert.match(styles, /\.workspace\s*\{/);

assert.equal(manifest.version, '0.5.2');
for (const size of [16, 32, 48, 128]) {
  const icon = manifest.icons[String(size)];
  assert.ok(icon, `missing manifest icon ${size}`);
  assert.ok(fs.existsSync(path.join(root, icon)), `missing icon file ${icon}`);
}
console.log('UI structure and manifest regression passed');
