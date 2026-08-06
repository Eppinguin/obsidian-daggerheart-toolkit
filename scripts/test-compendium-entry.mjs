import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

// Both categories carry an icon. With only environments marked, the glyph had
// nothing to align against and read as a stray mark rather than a label.
const block = view.slice(
    view.indexOf('// Category icon in a fixed leading column'),
    view.indexOf('const addButton = itemEntry.createEl'),
);
assert.match(
    block,
    /isEnvironment \? 'mountain-snow' : 'skull'/,
    'adversaries need an icon too, matching the import/export convention',
);

// The icon must be a sibling of the text, not appended inside the name: nesting
// it made its position depend on the name's length.
assert.match(
    block,
    /itemEntry\.createSpan\(\{\s*cls: 'dh-entry-icon'/s,
    'the icon must sit in its own leading column on the entry',
);
assert.doesNotMatch(
    block,
    /nameSpan\.createSpan\(\{ cls: 'dh-entry-icon'/,
    'the icon must not be nested inside the name',
);
assert.match(
    styles,
    /\.dh-entry-icon\s*\{[^}]*flex:\s*0 0 16px/s,
    'the icon column must be fixed width so entries align',
);

// Tier and type are on every entry but were previously only visible by opening
// the preview.
assert.match(block, /Tier \$\{itemData\.tier\}/);
assert.match(block, /dh-entry-meta/);
assert.match(
    styles,
    /\.dh-entry-meta\s*\{[^}]*text-overflow:\s*ellipsis/s,
    'long metadata must truncate rather than wrap the row',
);
assert.match(
    styles,
    /\.dh-entry-name\s*\{[^}]*text-overflow:\s*ellipsis/s,
    'long names must truncate rather than wrap the row',
);

// A tier of 0 is falsy: filtering on truthiness would drop it.
assert.match(
    block,
    /itemData\.tier !== undefined && itemData\.tier !== null/,
    'tier 0 must still produce a metadata line',
);

// The row is now icon | text | button, so the text column must be allowed to
// shrink and the button must not.
assert.match(
    styles,
    /\.dh-entry-text\s*\{[^}]*min-width:\s*0/s,
    'the text column needs min-width:0 or it refuses to shrink and pushes the button out',
);
assert.match(styles, /\.dh-add-compendium-btn\s*\{[^}]*flex:\s*0 0 auto/s, 'the add button must not shrink');

// Entries now contain nested elements, so the add-button guard cannot test the
// event target's own class.
assert.match(
    view,
    /closest\?\.\('\.dh-add-compendium-btn'\)/,
    'the add-button guard must use closest(), or clicks on its children fall through',
);

// Every compendium entry should produce a metadata line.
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const flat = (d) => (Array.isArray(d) ? d : Object.values(d)[0]);
const items = [...flat(load('data/adversaries.json')), ...flat(load('data/environments.json'))];
const withoutMeta = items.filter((i) => (i.tier === undefined || i.tier === null) && !i.type);
assert.equal(withoutMeta.length, 0, `every entry should have tier or type; ${withoutMeta.length} have neither`);

console.log(`Compendium entry regression passed (${items.length} entries checked)`);
