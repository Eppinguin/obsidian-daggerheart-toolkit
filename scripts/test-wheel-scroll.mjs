/**
 * Guards wheel-to-horizontal scrolling in the encounter row.
 *
 * The encounter area is one non-wrapping row, so a mouse with only a vertical
 * wheel cannot reach the cards past the right edge. Converting the wheel is the
 * easy half; the hard half is knowing when to keep out of the way, since every
 * card scrolls its own statblock internally.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { transformSync } from 'esbuild';

const source = fs.readFileSync('src/services/wheel-scroll.ts', 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const { shouldScrollHorizontally } = module.exports;

const wheelDown = { deltaX: 0, deltaY: 100 };
const wheelUp = { deltaX: 0, deltaY: -100 };
/** A card whose statblock is twice its height, scrolled to `scrollTop`. */
const card = (scrollTop) => [{ scrollTop, scrollHeight: 800, clientHeight: 400, overflowY: 'auto' }];

// --- The point of the feature ----------------------------------------------

assert.equal(shouldScrollHorizontally(wheelDown, [], true), true, 'a plain wheel over the row must scroll it sideways');

// --- Keeping out of the card's way -----------------------------------------
// A wheel over a card belongs to that card, full stop. Handing it onward at the
// card's end made the encounter lurch sideways mid-read and tied the row's
// position to how far a card happened to be scrolled.

assert.equal(
    shouldScrollHorizontally(wheelDown, card(200), true),
    false,
    'a card with more statblock below must scroll itself, not the row',
);
assert.equal(shouldScrollHorizontally(wheelUp, card(200), true), false, 'scrolling up mid-card must stay in the card');
assert.equal(
    shouldScrollHorizontally(wheelDown, card(400), true),
    false,
    'a card scrolled to the bottom must not hand the wheel to the row',
);
assert.equal(
    shouldScrollHorizontally(wheelUp, card(0), true),
    false,
    'a card scrolled to the top must not hand the wheel to the row',
);
// A short statblock never captures the wheel at all.
assert.equal(
    shouldScrollHorizontally(
        wheelDown,
        [{ scrollTop: 0, scrollHeight: 300, clientHeight: 400, overflowY: 'auto' }],
        true,
    ),
    true,
    'a card with nothing to scroll must not swallow the wheel',
);
// overflow-y: visible means the box does not scroll, whatever its height.
assert.equal(
    shouldScrollHorizontally(
        wheelDown,
        [{ scrollTop: 0, scrollHeight: 800, clientHeight: 400, overflowY: 'visible' }],
        true,
    ),
    true,
    'a tall but non-scrolling box must not swallow the wheel',
);

// --- Gestures that already work must be left alone -------------------------

assert.equal(
    shouldScrollHorizontally({ deltaX: -40, deltaY: 0 }, [], true),
    false,
    'a trackpad already sends horizontal deltas',
);
assert.equal(
    shouldScrollHorizontally({ deltaX: -10, deltaY: 60 }, [], true),
    false,
    'a diagonal trackpad gesture must be left to the browser',
);
assert.equal(
    shouldScrollHorizontally({ deltaX: 0, deltaY: 100, ctrlKey: true }, [], true),
    false,
    'ctrl+wheel is zoom, not scroll',
);

// The card-only rule above applies to the wheel, not to gestures. A horizontal
// trackpad swipe over a card still scrolls the row — it carries a real deltaX,
// so the browser handles it and this conversion never runs.
assert.equal(
    shouldScrollHorizontally({ deltaX: -40, deltaY: 0 }, card(200), true),
    false,
    'a horizontal gesture over a card is left to the browser, which scrolls the row',
);

// Nothing off-screen means nothing to do.
assert.equal(shouldScrollHorizontally(wheelDown, [], false), false, 'a row that fits must not hijack the wheel');

// --- Wiring ----------------------------------------------------------------

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
assert.match(
    view,
    /addEventListener\('wheel', this\.boundHandleEncounterWheel, \{ passive: false \}\)/,
    'the listener must be non-passive, or preventDefault is ignored',
);
assert.match(
    view,
    /removeEventListener\('wheel', this\.boundHandleEncounterWheel\)/,
    'the listener must be torn down with the view',
);

console.log('test-wheel-scroll: ok');
