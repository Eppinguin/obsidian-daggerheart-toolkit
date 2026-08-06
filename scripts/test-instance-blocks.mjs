import assert from 'node:assert/strict';
import fs from 'node:fs';

const statblock = fs.readFileSync('src/rendering/statblock.ts', 'utf8');
const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

// --- Defeated state ---------------------------------------------------------
//
// In Daggerheart the HP track *fills* as damage lands, so "all pips marked" is
// dead. On a card with four Minions, which are still standing is the question a
// GM asks most and the stack of identical blocks answered least well.

assert.match(statblock, /export function syncDefeatedState\(/, 'the defeated check must be one shared helper');

const helper = statblock.slice(statblock.indexOf('export function syncDefeatedState('));
const helperBody = helper.slice(0, helper.indexOf('\n}'));

// A zero-HP track is not a creature that can be defeated. Environments and
// malformed imports carry one, and without the guard every one would render
// dimmed from the moment it was added.
assert.match(helperBody, /if \(hpMax <= 0\)/, 'a zero-max track must never count as defeated');
assert.match(helperBody, /currentHp >= hpMax/, 'a full HP track means defeated');
// The attribute has to be removed, not just added, or healing would leave a
// revived instance dimmed.
assert.match(helperBody, /delete rowEl\.dataset\.defeated/, 'the state must clear again when HP drops');

// Both instance render paths need it: the first member is built in statblock.ts
// and the rest in the view, from the same markup.
for (const [src, label, anchor] of [
    [statblock, 'the first group member', '`${data.id}-hp-main`'],
    [view, 'additional group members', '`${instance.id}-hp-add`'],
]) {
    assert.match(src, /syncDefeatedState\(/, `${label} must set the defeated state`);
    const at = src.indexOf(anchor);
    assert.ok(at > -1, `${label}: HP track not found`);
    // Called inside the HP callback, not only at render time — the tracks update
    // in place, so a block that dimmed only on the next full redraw would lag
    // the damage that killed it.
    const callback = src.slice(at, at + 500);
    assert.match(callback, /syncDefeatedState\(/, `${label} must re-check on every HP change, not just on redraw`);
}

// --- Instance blocks --------------------------------------------------------
//
// Four Minions render four identical name/HP/Stress triplets, and a 1px divider
// cannot separate a repeating unit three rows tall.

// Anchored on the rule's own line start: `.dh-hp-stress-container
// .dh-additional-tracker-row` appears earlier and would match otherwise.
const block = styles.slice(styles.indexOf('\n.dh-additional-tracker-row {'));
const blockBody = block.slice(0, block.indexOf('}'));
assert.match(blockBody, /border-radius:/, 'each instance must read as its own block');
assert.match(blockBody, /background-color:/, 'each instance needs its own surface');

// A left stripe, not a full frame: a border on all four sides gave every
// instance an outline that competed with the card's own.
assert.match(blockBody, /border-left: 2px solid color-mix\(/, 'instances are marked by one edge, not boxed in');
assert.match(blockBody, /var\(--dh-accent,/, 'the stripe must take the card’s role tint');
assert.ok(!/^\s*border: /m.test(blockBody), 'a full border would compete with the card’s outline');

// --- The card must still look like a card -----------------------------------
//
// The regression that prompted this: the instance styling was allowed to define
// the card's bottom edge, which cost the card its outline and its corners. The
// card frames itself; the blocks only furnish the panel inside it.

const addBtn = styles.slice(styles.indexOf('.dh-add-to-group-button-container {'));
const addBtnBody = addBtn.slice(0, addBtn.indexOf('}'));
assert.match(addBtnBody, /border-top: 1px solid/, 'the add-to-group row must stay separated from the panel above it');
assert.ok(!/border-radius/.test(addBtnBody), 'the card’s corners belong to the card, not to its last child');

// Nothing may flatten the content div's own bottom rounding.
assert.ok(
    !/\.dh-instance-card-content \{[^}]*border-radius: 0;/.test(styles),
    'the card content must keep its bottom corners',
);
const contentRule = styles.slice(styles.indexOf('.dh-instance-card-content {\n    background-color'));
assert.match(
    contentRule.slice(0, contentRule.indexOf('}')),
    /border-radius: 0 0 var\(--radius-m/,
    'the card content must round its bottom corners',
);

// The name heads the block rather than reading as a third row of content.
// Line-anchored: the defeated rule mentions the same class and comes first.
const nameRule = styles.slice(styles.indexOf('\n.dh-additional-tracker-name {'));
const nameBody = nameRule.slice(0, nameRule.indexOf('}'));
assert.match(nameBody, /font-size: var\(--font-ui-small/, 'the instance name must be smaller than body text');
assert.match(nameBody, /font-weight: var\(--font-bold\)/, 'the instance name must be bold enough to head the block');

// Defeated styling must not hide the block: undoing a kill is a click on the
// same pips, so it stays interactive and comes back on hover.
assert.match(
    styles,
    /\.dh-additional-tracker-row\[data-defeated\][\s\S]{0,200}?opacity: 0\.\d+/,
    'a defeated block must recede rather than disappear',
);
assert.match(
    styles,
    /\.dh-additional-tracker-row\[data-defeated\]:hover \{\s*opacity: 1/,
    'a defeated block must come back on hover so its pips stay aimable',
);

console.log('Instance block regression passed');
