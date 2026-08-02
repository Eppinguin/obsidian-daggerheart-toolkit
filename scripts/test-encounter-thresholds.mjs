import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const styles = fs.readFileSync('src/styles/encounter-thresholds.css', 'utf8');
const encounterImports = fs.readFileSync('src/styles/manage-encounters.css', 'utf8');

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

console.log('Encounter threshold display regression passed');
