import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';

const result = await build({
    entryPoints: ['src/services/summon-parser.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
const { parseSummons, resolveSummon, findSummonTargets, summonLabel } = await import(moduleUrl);

const compendium = [
    { name: 'Jagged Knife Lackey', category: 'adversary' },
    { name: 'Bladed Guard', category: 'adversary' },
    { name: 'Minor Demon', category: 'adversary' },
    { name: 'Vampire', category: 'adversary' },
    { name: 'Rotted Zombie', category: 'adversary' },
    { name: 'Fallen Shock Troop', category: 'adversary' },
    { name: 'Treant Sapling', category: 'adversary' },
    { name: 'Pirate Raiders', category: 'adversary' },
    { name: 'Zombie Legion', category: 'adversary' },
    { name: 'Abandoned Grove', category: 'environment' },
];

// --- Quantities -----------------------------------------------------------

// A number word gives a fixed count.
const three = parseSummons('Summon three Jagged Knife Lackeys, who appear at Far range.');
assert.equal(three.length, 1);
assert.equal(three[0].count, 3);
assert.equal(three[0].countDice, undefined);

// A dice expression is left for the roller, not guessed at.
const rolled = parseSummons('mark a Stress to summon 1d4 Bladed Guards, who appear at Far range');
assert.equal(rolled.length, 1);
assert.equal(rolled[0].count, null);
assert.equal(rolled[0].countDice, '1d4');

// Modifiers stay attached to the dice expression.
assert.equal(parseSummons('summon 1d4+2 Fallen Shock Troops that appear')[0].countDice, '1d4+2');

// No written quantity means one.
assert.equal(parseSummons('Spend a Fear to summon a Zombie Legion, which appears')[0].count, 1);

// --- Name extraction ------------------------------------------------------

// Trailing clauses describing arrival are not part of the name.
assert.equal(
    parseSummons('summon 1d4 Vampires, who appear at Far range and immediately take the spotlight.')[0].name,
    'Vampires',
);

// Stacked leading filler is peeled off entirely.
assert.equal(
    parseSummons('Spend a Fear to summon a number of Fallen Shock Troops equal to twice the number of PCs.')[0].name,
    'Fallen Shock Troops',
);
assert.equal(
    parseSummons('Spend 2 Fear to return up to 1d4+1 defeated Spectral allies to the battle')[0].name,
    'Spectral allies',
);

// --- False positives ------------------------------------------------------

// "grow"/"return" are ordinary English elsewhere in feature text; they only
// count as summons when what follows reads as a name.
assert.deepEqual(parseSummons('spend a Fear to clear a HP and grow two heads.'), []);
assert.deepEqual(parseSummons('the fallen ally’s life force is returned to the forest.'), []);
// Trailing italic prose must not become a target.
assert.deepEqual(parseSummons('What will they try to summon next?*'), []);

// The Dryad genuinely does grow creatures, and that must still register.
assert.equal(
    parseSummons('Spend a Fear to grow three Treant Sapling Minions, who appear at Close range')[0].name,
    'Treant Sapling Minions',
);

// --- Resolution -----------------------------------------------------------

// Plain plurals.
assert.equal(resolveSummon('Bladed Guards', compendium)?.name, 'Bladed Guard');
assert.equal(resolveSummon('Vampires', compendium)?.name, 'Vampire');
assert.equal(resolveSummon('Jagged Knife Lackeys', compendium)?.name, 'Jagged Knife Lackey');

// "-ies" is ambiguous without a dictionary: "zombies" comes from "zombie" but
// "allies" from "ally". Both spellings are tried, so this must not become
// "Rotted Zomby" and miss.
assert.equal(resolveSummon('Rotted Zombies', compendium)?.name, 'Rotted Zombie');

// A trailing collective noun the compendium entry does not carry.
assert.equal(resolveSummon('Treant Sapling Minions', compendium)?.name, 'Treant Sapling');
assert.equal(resolveSummon('Pirate Raiders Horde', compendium)?.name, 'Pirate Raiders');

// The text may be less specific than the entry.
assert.equal(resolveSummon('Shock Troops', compendium)?.name, 'Fallen Shock Troop');

// Longest match wins, so a qualified name beats the bare one.
assert.equal(resolveSummon('Minor Demons', compendium)?.name, 'Minor Demon');

// An exact name is never overridden by a partial match on another entry.
assert.equal(resolveSummon('Zombie Legion', compendium)?.name, 'Zombie Legion');

// Environments are never summon targets.
assert.equal(resolveSummon('Abandoned Grove', compendium), undefined);

// A kind rather than a creature stays unresolved, which routes to the picker.
assert.equal(resolveSummon('Tier 1 adversaries', compendium), undefined);

// --- Generic targets ------------------------------------------------------

const generic = parseSummons('mark a Stress to summon 1d4+1 Tier 1 adversaries, who appear at Far range');
assert.equal(generic.length, 1, 'a generic summon is still surfaced');
assert.equal(generic[0].isGeneric, true, 'and is flagged so the UI opens a picker');

const specific = parseSummons('summon 1d4 Vampires, who appear at Far range');
assert.equal(specific[0].isGeneric, false);

// --- Combined pass and labels --------------------------------------------

const targets = findSummonTargets('Spend a Fear to summon 1d4 Vampires, who appear at Far range.', compendium);
assert.equal(targets[0].match?.name, 'Vampire');
assert.equal(summonLabel(targets[0]), 'Summon 1d4');
assert.equal(summonLabel({ name: 'X', count: 3, sourceText: '' }), 'Summon 3');
assert.equal(summonLabel({ name: 'X', count: 1, sourceText: '' }), 'Summon');

// Duplicate phrasing in one feature yields one control, not two.
const repeated = parseSummons('summon a Minor Demon. Later, summon a Minor Demon again.');
assert.equal(repeated.length, 1, 'identical summons are de-duplicated');

// Two phrases can be worded differently and still mean the same creature. The
// Cult Ritual names its demon as narrative setup and again as the mechanic;
// both resolve to Minor Demon and must collapse into a single control.
const twoWordings = findSummonTargets(
    'the cult begins the ritual to summon a demon, activate the countdown. When it triggers, summon a Minor Demon within Very Close range.',
    compendium,
);
assert.equal(twoWordings.length, 1, 'phrases resolving to the same entry are one control');
assert.equal(twoWordings[0].match?.name, 'Minor Demon');

// Different creatures in one feature stay separate, though.
const twoCreatures = findSummonTargets('summon a Minor Demon and summon three Bladed Guards.', compendium);
assert.equal(twoCreatures.length, 2, 'distinct creatures keep their own controls');

// Unresolved targets are distinguished by name, since that is all they have.
const twoUnresolved = findSummonTargets('summon 1d4 Tier 1 adversaries. Also summon Tier X Minions.', compendium);
assert.equal(twoUnresolved.length, 2, 'different unresolved phrases stay separate');

// --- Real SRD content -----------------------------------------------------

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, ''));
const adversaries = readJson('data/adversaries.json');
const environments = readJson('data/environments.json');
const srdCompendium = adversaries.map((entry) => ({ name: entry.name, category: 'adversary' }));

let found = 0;
let matched = 0;
for (const entry of [...adversaries, ...environments]) {
    for (const feat of entry.feats ?? []) {
        for (const target of findSummonTargets(feat.text ?? '', srdCompendium)) {
            found++;
            if (target.match) matched++;
        }
    }
}

// Guards against a regex change silently dropping the feature. The exact
// numbers will move as content changes; these are floors, not fixtures.
assert.ok(found >= 20, `expected summon phrases across the SRD, found ${found}`);
assert.ok(matched >= 18, `expected most summons to resolve, matched ${matched}/${found}`);

// Specific statblocks that must keep working, spanning both categories and
// every quantity form.
const summonsFor = (name, featName) => {
    const entry = [...adversaries, ...environments].find((item) => item.name === name);
    const feat = entry?.feats?.find((item) => item.name.startsWith(featName));
    assert.ok(feat, `${name} :: ${featName} not found in SRD data`);
    return findSummonTargets(feat.text, srdCompendium);
};

const lackeys = summonsFor('Jagged Knife Lieutenant', 'More Where That Came From');
assert.equal(lackeys[0].match?.name, 'Jagged Knife Lackey');
assert.equal(lackeys[0].count, 3);

const guards = summonsFor('Petty Noble', 'Guards, Seize Them!');
assert.equal(guards[0].match?.name, 'Bladed Guard');
assert.equal(guards[0].countDice, '1d4');

// An environment feature, which is the other half of the request.
const knights = summonsFor('Castle Siege', 'Reinforcements');
assert.equal(knights[0].match?.name, 'Knight of the Realm');

// The Hydra's "grow two heads" must not produce a summon control.
assert.deepEqual(summonsFor('Hydra', 'Regeneration'), []);

// The Cult Ritual mentions its demon twice in one feature. That must render as
// one button, not two identical ones.
const cultRitual = summonsFor('Cult Ritual', 'The Summoning');
assert.equal(cultRitual.length, 1, 'Cult Ritual must yield a single summon control');
assert.equal(cultRitual[0].match?.name, 'Minor Demon');

// --- Wiring ---------------------------------------------------------------

const summonRenderer = fs.readFileSync('src/rendering/summon.ts', 'utf8');
const statblock = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const constants = fs.readFileSync('src/constants.ts', 'utf8');
const styles = fs.readFileSync('src/styles/summon.css', 'utf8');
const mainStyles = fs.readFileSync('src/styles.css', 'utf8');

assert.match(constants, /EVENT_SUMMON = 'dh-summon'/);
assert.match(mainStyles, /@import\s+["']\.\/styles\/summon\.css["']/);

// Both card types render summons: adversaries and environments both have
// features that bring creatures in. They share one feature renderer, so what
// matters is that both reach it and that it adds the controls — not how many
// call sites there happen to be.
assert.match(statblock, /renderSummonControls\(/, 'the shared feature renderer must add summon controls');
assert.equal(
    statblock.match(/renderFeatureList\(plugin, data\.features/g)?.length,
    2,
    'both the adversary and environment renderers must go through renderFeatureList',
);

// The chip must stop propagation, or clicking it also collapses the feature
// description it sits inside.
assert.match(summonRenderer, /event\.stopPropagation\(\)/);

// The event has to be registered and torn down, like every other card event.
assert.match(view, /addEventListener\(EVENT_SUMMON/);
assert.match(view, /removeEventListener\(EVENT_SUMMON/);

// A rolled count goes through the plugin's dice roller so the result is shared.
assert.match(view, /rollDice\(\s*summon\.countDice/s);

// When no roller is configured the count is asked for in a modal. window.prompt
// is not available in every Obsidian environment and looks nothing like the app.
assert.ok(!/window\.prompt/.test(view), 'must not fall back to window.prompt');
assert.match(view, /new SummonCountModal\(/);

// Dismissing that modal must resolve rather than hang the summon.
assert.match(view, /modal\.onClose\s*=\s*\(\)\s*=>\s*\{\s*originalClose\(\);\s*resolve\(null\);\s*\}/);

// Summoned creatures land in a single group, added before the group is drawn.
assert.match(view, /addItemToActiveEncounter\(baseItem: StatblockData, count: number = 1\)/);

// Summoning the same creature again adds instances to the group already on the
// table instead of dealing a second identical card.
assert.match(view, /findGroupForStatblock\(chosen\)/);
assert.match(view, /createNewInstanceFromTemplate\(chosen, existingGroupId\)/);

// A tier-scaled group must not absorb the summon: its creatures no longer have
// the stats of the thing being summoned.
assert.match(view, /_originalStats as AdversaryInstance \| undefined\)\?\.tier/);

// No decorative iconography: the chip uses the same plain glyphs as the rest of
// the plugin's controls.
assert.ok(!/sparkles/.test(summonRenderer), 'chip must not use a sparkles icon');
assert.match(summonRenderer, /'plus-circle' : 'search'/);
assert.match(styles, /\.dh-summon-chip\s*\{/);
assert.match(styles, /\.dh-summon-chip\.is-unresolved/);

console.log('Summon parser and wiring tests passed.');
