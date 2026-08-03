import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const styles = fs.readFileSync('src/styles/encounter-thresholds.css', 'utf8');
const encounterImports = fs.readFileSync('src/styles/manage-encounters.css', 'utf8');
const modalIndex = fs.readFileSync('src/modals/index.ts', 'utf8');
const instanceControls = fs.readFileSync('src/services/encounter-instance-controls.ts', 'utf8');

assert.match(renderer, /dh-threshold-bar/);
assert.match(renderer, /dh-threshold-minor/);
assert.match(renderer, /dh-threshold-major/);
assert.match(renderer, /dh-threshold-severe/);

assert.match(encounterImports, /@import\s+["']\.\/encounter-thresholds\.css["']/);
assert.match(styles, /\.dh-encounter-view\s+\.dh-instance-card-content\s+\.dh-threshold-bar/);
assert.match(styles, /grid-template-columns:\s*minmax\(52px, 1fr\)\s+38px/);
assert.match(styles, /\.dh-threshold-minor::after\s*\{\s*content:\s*"1 HP"/s);
assert.match(styles, /\.dh-threshold-major::after\s*\{\s*content:\s*"2 HP"/s);
assert.match(styles, /\.dh-threshold-severe::after\s*\{\s*content:\s*"3 HP"/s);
assert.match(styles, /:not\(:has\(\.dh-threshold-severe\)\)/);
assert.doesNotMatch(styles, /(?:^|\n)\.dh-threshold-value\s*\{/);

assert.match(styles, /\.dh-features-section:has\(\+ \.dh-hp-stress-container\)[^{]*\.dh-features-list\s*\{\s*margin-bottom:\s*0/s);
assert.match(styles, /\.dh-features-section \+ \.dh-hp-stress-container\s*\{[^}]*margin-top:\s*var\(--size-4-1, 4px\)[^}]*padding-top:\s*var\(--size-4-1, 4px\)/s);

assert.match(modalIndex, /services\/encounter-instance-controls/);
assert.match(instanceControls, /renderAdditionalTrackerRow/);
assert.match(instanceControls, /dh-add-condition-btn/);
assert.match(instanceControls, /setIcon\(conditionButton, 'tag'\)/);
assert.match(instanceControls, /instanceId:\s*instance\.id/);
assert.match(instanceControls, /dh-request-condition-menu/);

console.log('Encounter threshold and per-instance condition controls regression passed');
