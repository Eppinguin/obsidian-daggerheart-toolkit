import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');
const statblock = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

// --- The three levels -------------------------------------------------------

assert.match(
    types,
    /export type CardDensity = 'full' \| 'compact' \| 'collapsed'/,
    'the three density levels must be a named type',
);
assert.match(
    types,
    /CARD_DENSITY_CYCLE:\s*CardDensity\[\]\s*=\s*\['full', 'compact', 'collapsed'\]/,
    'the cycle order must be full -> compact -> collapsed',
);

// --- Persistence ------------------------------------------------------------
//
// The whole point of the change: this state used to live in the leaf's
// ephemeral state, which is discarded whenever the leaf is recreated. It must
// now round-trip through the encounter.

assert.match(types, /cardDensity\?: Record<string, CardDensity>/, 'SavedEncounter must carry per-group density');
assert.match(types, /toggledFeatures\?: string\[\]/, 'SavedEncounter must carry the feature toggles');

const autoSave = view.slice(view.indexOf('async autoSaveCurrentEncounter()'));
assert.match(
    autoSave.slice(0, autoSave.indexOf('showEncounterSwitcherMenu')),
    /\.\.\.this\.cardStateSnapshot\(\)/,
    'the card layout must be written on the normal encounter save path',
);

assert.match(
    view,
    /loadItemsForCurrentEncounter\(\)\s*\{[\s\S]{0,400}?this\.loadCardStateFrom\(encounter\)/,
    'switching encounters must adopt that encounter’s saved layout',
);

// Both fields must be gone from the ephemeral state, or the stale leaf copy
// would race the saved one on reopen. Scoped to getState: `toggledFeatures`
// legitimately appears elsewhere, not least in the encounter snapshot.
const getState = view.slice(view.indexOf('    getState() {'));
const getStateBody = getState.slice(0, getState.indexOf('\n    }'));
for (const field of ['cardDensity', 'toggledFeatures', 'collapsedProseGroups']) {
    assert.ok(!getStateBody.includes(field), `${field} must not be persisted in the leaf's ephemeral state`);
}
// The old set must be gone from the view entirely, not merely from getState.
assert.ok(!view.includes('collapsedProseGroups'), 'the old collapsed-groups set must be fully replaced');

// An unknown level from a hand-edited file must not stick a card in a state no
// CSS matches.
assert.match(view, /CARD_DENSITY_CYCLE\.includes\(density\)/, 'an unrecognised saved density must be rejected on load');

// A card left at the default writes nothing, so an untouched encounter stays
// clean in encounters.json.
const snapshot = view.slice(view.indexOf('private cardStateSnapshot()'));
assert.match(
    snapshot.slice(0, snapshot.indexOf('private persistCardState')),
    /if \(density !== 'full'\) cardDensity\[groupId\] = density/,
    "only groups moved off 'full' should be written",
);

// --- The combat strip -------------------------------------------------------
//
// Difficulty and the attack rolls used to sit inside the region collapsing
// hides, so a collapsed card kept the HP track and discarded the numbers a GM
// needs to change it.

assert.match(statblock, /export function renderCoreStats\(/, 'the core stats must be built by one shared helper');
assert.match(
    statblock,
    /if \(data\.difficulty === undefined && !attack\) return null/,
    'a card with neither number must not grow an empty strip',
);

// Imports leave a placeholder attack `{name:'Attack', range:'', damage:'',
// modifier:'0'}` on entries that have no attack at all — environments carry one
// routinely. It is truthy, so rendering on `data.attack` alone gave every
// environment a bare "ATK d20" chip for an attack it does not have.
assert.match(statblock, /function hasAttack\(/, 'a placeholder attack must be filtered out');
const hasAttackFn = statblock.slice(statblock.indexOf('function hasAttack('));
const hasAttackBody = hasAttackFn.slice(0, hasAttackFn.indexOf('\n}'));
assert.match(hasAttackBody, /modifier !== '' && modifier !== '0'/, "a '0' modifier must not count as an attack");
assert.match(hasAttackBody, /damage !== '' \|\| hasModifier/, 'an attack needs a roll or damage to be real');
// A name alone is the placeholder's own default, so it must not qualify.
assert.ok(!/attack\.name/.test(hasAttackBody), 'a name alone must not make an attack real');

// Rendered in both card types, and in both cases outside the collapsing region.
const stripCalls = statblock.match(
    /renderCoreStats\(plugin, data, statblockContentDiv as HTMLElement, 'dh-card-combat-strip'\)/g,
);
assert.equal(stripCalls?.length, 2, 'both adversaries and environments need a combat strip');

// The expanded copy still goes inside the scrolling region.
const inRegion = statblock.match(/renderCoreStats\(plugin, data, staticRegion\)/g);
assert.equal(inRegion?.length, 2, 'both card types keep their in-statblock core stats line');

// On an adversary the strip must precede the live-state block, so the reading
// order stays name -> numbers -> thresholds -> tracks.
const adversary = statblock.slice(statblock.indexOf('function renderAdversaryInstance('));
assert.ok(
    adversary.indexOf("'dh-card-combat-strip'") < adversary.indexOf("cls: 'dh-hp-stress-container'"),
    'the combat strip must sit above the HP block',
);

// --- CSS --------------------------------------------------------------------
//
// The old `:has(.dh-card-static-region.is-collapsed)` chain was card-wide and
// could not express a third level.

assert.ok(
    !styles.includes('.dh-card-static-region.is-collapsed'),
    'collapse styling must not key on a descendant class',
);
assert.match(
    styles,
    /\.dh-adversary-instance-card\[data-density='collapsed'\] \.dh-card-static-region \{\s*display: none/,
    'collapsed must hide the statblock region',
);
assert.match(styles, /\.dh-card-combat-strip \{\s*display: none/, 'the strip must be hidden by default');
assert.match(
    styles,
    /\.dh-adversary-instance-card\[data-density='collapsed'\] \.dh-card-combat-strip \{\s*display: flex/,
    'the strip must be revealed when collapsed',
);

// --- Feature expansion ------------------------------------------------------

// The baseline is density-aware: compact folds everything, otherwise the global
// setting decides.
const baseline = view.slice(view.indexOf('private featureBaseline('));
assert.match(
    baseline.slice(0, baseline.indexOf('\n    }')),
    /=== 'compact' \? false : this\.plugin\.settings\.showFeatureDetailsOnCards/,
    'compact must fold every feature by default',
);

const isExpanded = view.slice(view.indexOf('private isFeatureExpanded('));
const body = isExpanded.slice(0, isExpanded.indexOf('\n    }'));
// Departures from the baseline rather than absolute states, so flipping the
// global setting still moves every feature the GM has not touched.
assert.match(body, /const base = this\.featureBaseline\(groupId\)/, 'expansion must read the density-aware baseline');
assert.match(
    body,
    /this\.toggledFeatures\.has\(`\$\{groupId\}::\$\{featureName\}`\) \? !base : base/,
    'per-feature toggles must remain departures from the baseline',
);

// Peeking at one feat on a folded card must persist. Comparing the new state to
// the raw *setting* instead of the baseline deleted the key — so the peek was
// lost on the next redraw, and every redraw follows an HP tick.
const onToggle = view.slice(view.indexOf('onToggle: (feature, expanded)'));
assert.match(
    onToggle.slice(0, onToggle.indexOf('},')),
    /if \(expanded === this\.featureBaseline\(groupId\)\) this\.toggledFeatures\.delete\(key\)/,
    'a toggle must be recorded against the density-aware baseline, not the raw setting',
);

// Changing a card's level flips what "departure" means, so the peeks retire
// with it — otherwise feats peeked open while folded would come back as the
// only closed ones once the card expands.
for (const [fn, label] of [
    ['private setGroupDensity(', 'cycling one card'],
    ['private cycleAllDensity()', 'cycling every card'],
]) {
    const at = view.indexOf(fn);
    assert.ok(at > -1, `${fn} not found`);
    assert.match(
        view.slice(at, at + 1400),
        /this\.clearFeatureToggles\(groupId\)/,
        `${label} must retire that card's per-feature overrides`,
    );
}

// --- Cleanup ----------------------------------------------------------------

const removeGroup = view.slice(view.indexOf('removeGroupFromEncounter(groupId: string)'));
assert.match(
    removeGroup.slice(0, 1200),
    /this\.cardDensity\.delete\(groupId\)/,
    'removing a group must drop its density entry',
);

console.log('Card density regression passed');
