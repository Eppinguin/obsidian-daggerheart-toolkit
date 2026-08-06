/**
 * Guards the role-family slug.
 *
 * Published types are not safe as CSS class fragments: the Horde variants carry
 * their damage rule in the name ("Horde (3/HP)"), which a bare toLowerCase()
 * turns into "horde-(3/hp)" — parens and a slash are invalid in an unescaped
 * class selector, so the card silently loses its colour, and an exact-match
 * switch misses it, so the encounter budget silently misprices it.
 */
import assert from 'node:assert';
import fs from 'node:fs';

import { transformSync } from 'esbuild';

const source = fs.readFileSync('src/rendering/statblock-type.ts', 'utf8');

// The helper is framework-free, so it can be transpiled and exercised directly
// rather than asserted against as source text. esbuild is already the build
// dependency, so this adds nothing to the toolchain.
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const { normalizeRoleFamily, normalizeFeatureType, ROLE_FAMILIES } = module.exports;

// The case the whole helper exists for.
assert.equal(normalizeRoleFamily('Horde (3/HP)'), 'horde');
assert.equal(normalizeRoleFamily('Horde (10/HP)'), 'horde');

assert.equal(normalizeRoleFamily('Solo'), 'solo');
assert.equal(normalizeRoleFamily('Standard'), 'standard');
assert.equal(normalizeRoleFamily('Event'), 'event');

// Plural spellings collapse onto the singular family, so hand-written content
// agrees with the SRD.
assert.equal(normalizeRoleFamily('Minions'), 'minion');

// Missing and unrecognised types must land on the neutral fallback rather than
// producing an empty or malformed class.
assert.equal(normalizeRoleFamily(undefined), 'default');
assert.equal(normalizeRoleFamily(''), 'default');
assert.equal(normalizeRoleFamily('   '), 'default');
assert.equal(normalizeRoleFamily('Warlord'), 'warlord', 'homebrew keeps its own slug');

// Whatever comes out must always be selector-safe.
for (const input of ['Horde (3/HP)', 'Solo', 'Warlord', '  Spooky  Ghost  ', 'A/B (c)']) {
    assert.match(normalizeRoleFamily(input), /^[a-z0-9-]+$/, `"${input}" must reduce to a selector-safe slug`);
}

// --- Feature types ---------------------------------------------------------

assert.equal(normalizeFeatureType('Action'), 'Action');
assert.equal(normalizeFeatureType('reaction'), 'Reaction');
assert.equal(normalizeFeatureType('Passive'), 'Passive');
// Anything unrecognised reads as Passive: it asks least of the GM, so a
// mislabelled feat degrades quietly instead of implying a turn action.
assert.equal(normalizeFeatureType(undefined), 'Passive');
assert.equal(normalizeFeatureType('Feature'), 'Passive');

// --- CSS / TS agreement ----------------------------------------------------

const families = [...ROLE_FAMILIES];
assert.ok(families.length >= 13, 'ROLE_FAMILIES must cover both taxonomies');

const styles = fs.readFileSync('src/styles.css', 'utf8');
const styled = [...styles.matchAll(/\.dh-type-([a-z-]+)/g)].map((m) => m[1]).filter((name) => name !== 'select');

for (const name of new Set(styled)) {
    assert.ok(
        families.includes(name),
        `.dh-type-${name} has no matching entry in ROLE_FAMILIES — it can never match a card`,
    );
}

// Every family a GM will actually meet in the bundled data must be styled.
const loadJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, ''));
const itemsOf = (parsed) => (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);

for (const file of ['data/adversaries.json', 'data/environments.json']) {
    for (const statblock of itemsOf(loadJson(file))) {
        const family = normalizeRoleFamily(statblock.type);
        if (family === 'default') continue;
        assert.ok(
            styled.includes(family),
            `role family "${family}" (from "${statblock.type}") has no .dh-type-${family} rule`,
        );
    }
}

console.log('test-role-family: ok');
