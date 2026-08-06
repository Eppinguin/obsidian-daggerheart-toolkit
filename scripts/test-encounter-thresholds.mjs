import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const styles = fs.readFileSync('src/styles/encounter-thresholds.css', 'utf8');
const encounterImports = fs.readFileSync('src/styles/manage-encounters.css', 'utf8');
const conditions = fs.readFileSync('src/rendering/conditions.ts', 'utf8');
const encounterView = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');

assert.match(renderer, /dh-threshold-bar/);
assert.match(renderer, /dh-threshold-minor/);
assert.match(renderer, /dh-threshold-major/);
assert.match(renderer, /dh-threshold-severe/);

assert.match(encounterImports, /@import\s+["']\.\/encounter-thresholds\.css["']/);
assert.match(styles, /\.dh-encounter-view\s+\.dh-instance-card-content\s+\.dh-threshold-bar/);
// The bar is one continuous pill, not a row of separate tiles: the segments
// flex to share the width and only the two outer ends are rounded/bordered.
assert.match(styles, /\.dh-threshold-bar\s*\{[^}]*display:\s*flex/s);
assert.match(styles, /\.dh-threshold-segment\s*\{[^}]*flex:\s*1 1 0/s);
assert.match(
    styles,
    /\.dh-threshold-segment:first-child\s*\{[^}]*border-radius:\s*var\(--radius-m\) 0 0 var\(--radius-m\)/s,
);
assert.match(
    styles,
    /\.dh-threshold-segment:last-child\s*\{[^}]*border-radius:\s*0 var\(--radius-m\) var\(--radius-m\) 0/s,
);

// The value chips straddle the seams between bands: pulled in over the join and
// stacked above the track. Without both, the numbers stop reading as boundaries.
assert.match(styles, /\.dh-threshold-bar > \.dh-threshold-value\s*\{[^}]*margin:\s*0 -1px/s);
assert.match(styles, /\.dh-threshold-bar > \.dh-threshold-value\s*\{[^}]*z-index:\s*1/s);

// The whole bar stays a single compact row; it competes with the statblock for
// card height, so a regression that lets it grow is worth catching.
assert.match(styles, /--dh-threshold-h:\s*24px/);

// Features are the last block in the scrolling static region; the pinned
// live-state footer supplies the visual break, so no trailing margin.
assert.match(
    styles,
    /\.dh-card-static-region \.dh-features-section:last-child \.dh-features-list\s*\{\s*margin-bottom:\s*0/s,
);

// Live state must be pinned, not scrolled: the static region owns the scroll
// boundary and the HP/Stress block must not shrink.
const main = fs.readFileSync('src/styles.css', 'utf8');
assert.match(main, /\.dh-card-static-region\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(main, /\.dh-instance-card-content \.dh-hp-stress-container\s*\{[^}]*flex:\s*0 0 auto/s);
assert.match(main, /\.dh-adversary-instance-card\s*\{[^}]*overflow:\s*hidden/s);
// Both renderers must place prose inside the static region.
assert.match(renderer, /cls: 'dh-card-static-region'/);
assert.equal(
    (renderer.match(/dh-card-static-region/g) || []).length,
    2,
    'both the adversary and environment renderers need a static region',
);

// Condition UI has exactly one implementation, used by both renderers.
// The first group member is rendered by statblock.ts; members 2..n are
// rendered by EncounterBuilderView. Both must go through conditions.ts, or
// the two paths drift apart as they did before it existed.
assert.match(conditions, /export function renderConditionTags/);
assert.match(conditions, /export function renderConditionButton/);
assert.match(conditions, /dh-add-condition-btn/);
// The chip itself is the remove control, and carries its own rules text.
assert.match(conditions, /dh-condition-tooltip/);
assert.match(conditions, /EVENT_REMOVE_CONDITION/);
// The container is keyed by instance so conditions can be refreshed on their
// own instead of redrawing the whole adversary group.
assert.match(conditions, /dataset\.instanceId\s*=\s*instance\.id/);

for (const [name, source] of [
    ['statblock.ts', renderer],
    ['EncounterBuilderView.ts', encounterView],
]) {
    assert.match(
        source,
        /from '\.\.\/rendering\/conditions'|from '\.\/conditions'/,
        `${name} must import the shared condition renderer`,
    );
    assert.match(source, /renderConditionButton\(/, `${name} must render a condition button`);
    assert.match(source, /renderConditionTags\(/, `${name} must render condition tags`);
}

// Condition chips are a highlight, not a wash: each colour family sets only the
// hue, and the chip derives a solid tint plus a matching ring from it. The old
// rules painted --color-*-faint backgrounds directly, which disappeared against
// the card.
const mainStyles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(mainStyles, /\.dh-condition-tag\.dh-cond-red\s*\{\s*--dh-cond-hue:\s*var\(--color-red\)/);
assert.match(mainStyles, /\.dh-condition-tag\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px/s);
assert.doesNotMatch(mainStyles, /\.dh-condition-tag\.dh-cond-\w+\s*\{\s*background-color:\s*var\(--color-\w+-faint\)/);

// The collapse toggle is a play-time view control, so it sits at the front of
// the header cluster beside the drag handle, and the destructive delete sits
// last. Order here is DOM order, which is the visual order in the flex row.
const controlOrder = ['dh-drag-handle', 'dh-prose-toggle-btn', 'Edit Item', 'dh-card-delete-btn'].map((marker) =>
    encounterView.indexOf(marker),
);
assert.ok(
    controlOrder.every((i) => i !== -1),
    'every header control must be present',
);
assert.deepEqual(
    [...controlOrder].sort((a, b) => a - b),
    controlOrder,
    'header controls must be created in order: drag, collapse, edit, ..., delete',
);

// "Spend a Fear" / "Spend 2 Fear" in a feature's text spends from the encounter
// Fear tracker rather than being inert emphasis.
const uiHelpers = fs.readFileSync('src/rendering/ui-helpers.ts', 'utf8');
assert.match(uiHelpers, /Spend\\s\+\(a\|\\d\+\)\\s\+fear/i);
assert.match(uiHelpers, /EVENT_SPEND_FEAR/);
assert.match(fs.readFileSync('src/constants.ts', 'utf8'), /export const EVENT_SPEND_FEAR/);
assert.match(encounterView, /handleSpendFearEvent/);
// A spend it cannot afford must be refused outright, not silently clamped to
// whatever Fear happens to be left.
assert.match(encounterView, /Not enough Fear/);
// Every visible readout updates, not just the one captured when it was drawn.
assert.match(encounterView, /querySelectorAll\('\.dh-fear-value'\)/);

// The prototype monkey-patch that used to inject the button is gone.
assert.equal(
    fs.existsSync('src/services/encounter-instance-controls.ts'),
    false,
    'encounter-instance-controls.ts should no longer exist; conditions.ts replaces it',
);

// Conditions must be real and documented. The SRD defines exactly three standard
// conditions; everything else offered must come from an actual adversary feature,
// and every entry needs its rules text so the GM can read it in play.
const constants = fs.readFileSync('src/constants.ts', 'utf8');
for (const name of ['Hidden', 'Restrained', 'Vulnerable']) {
    assert.match(constants, new RegExp(`name: ['"]${name}['"]`), `${name} is a standard SRD condition`);
}
const standard = constants.slice(
    constants.indexOf('DAGGERHEART_CONDITIONS'),
    constants.indexOf('DAGGERHEART_ADVERSARY_CONDITIONS'),
);
assert.equal((standard.match(/name:\s*['"]/g) || []).length, 3, 'the SRD defines exactly three standard conditions');
// Every condition carries a description.
const allConditions = constants.slice(
    constants.indexOf('DAGGERHEART_CONDITIONS'),
    constants.indexOf('// Custom Event Names'),
);
const conditionCount = (allConditions.match(/name:\s*['"]/g) || []).length;
const descriptions = [...allConditions.matchAll(/description:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
);
assert.ok(conditionCount >= 16, `expected all conditions to be well-formed, found ${conditionCount}`);
assert.equal(descriptions.length, conditionCount, 'every condition must have rules text');
for (const description of descriptions) {
    assert.ok(description.trim().length > 20, `condition needs real rules text, got: "${description}"`);
}

console.log('Encounter threshold and per-instance condition controls regression passed');
