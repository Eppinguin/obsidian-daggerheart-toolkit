/**
 * Guards countdown loops.
 *
 * Countdowns only ever tick when the GM clicks them, so reaching zero is never
 * missed. The failure this feature addresses is the *reset*: a looping countdown
 * left at zero is a wrong state that persists silently. The rules below decide
 * when a countdown owes that reset and what resetting means.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { transformSync } from 'esbuild';

const source = fs.readFileSync('src/services/countdown.ts', 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const { isDiceStart, isSpentLoop, resetLabel, fixedStartValue, countdownState, isValidStart } = module.exports;

const countdown = (over) => ({ id: 'c', name: 'Test', value: 0, ...over });

// --- What counts as a dice start -------------------------------------------

assert.equal(isDiceStart('1d6'), true);
assert.equal(isDiceStart('2d6+1'), true);
assert.equal(isDiceStart('6'), false);
assert.equal(isDiceStart(''), false);
assert.equal(isDiceStart(undefined), false);

// --- Which countdowns owe a reset ------------------------------------------

assert.equal(
    isSpentLoop(countdown({ value: 0, loops: true, start: '6' })),
    true,
    'a looping countdown at zero owes a reset',
);
assert.equal(isSpentLoop(countdown({ value: 3, loops: true, start: '6' })), false, 'a loop still running owes nothing');
// A one-shot at zero has done its job. Flagging it would train the GM to ignore
// the flag, which is the one thing this feature cannot afford.
assert.equal(
    isSpentLoop(countdown({ value: 0, loops: false, start: '6' })),
    false,
    'a non-looping countdown at zero must not be flagged',
);
// A loop with nothing to reset to cannot offer a reset.
assert.equal(
    isSpentLoop(countdown({ value: 0, loops: true })),
    false,
    'a loop without a start value must not be flagged',
);
// Negative values are reachable by holding the minus button.
assert.equal(isSpentLoop(countdown({ value: -2, loops: true, start: '6' })), true);

// --- Row state -------------------------------------------------------------

assert.equal(countdownState(countdown({ value: 4 })), 'active');
assert.equal(countdownState(countdown({ value: 0 })), 'finished');
assert.equal(countdownState(countdown({ value: 0, loops: true, start: '1d6' })), 'spent-loop');

// Ticking a spent loop back up by hand settles the debt without the button.
assert.equal(countdownState(countdown({ value: 1, loops: true, start: '6' })), 'active');

// --- What the reset control says -------------------------------------------
// The countdown's own definition decides between rerolling and restoring, so
// the GM is never asked to choose. The label states the outcome up front.

assert.equal(resetLabel(countdown({ loops: true, start: '6' })), 'Reset to 6');
assert.equal(resetLabel(countdown({ loops: true, start: '1d6' })), 'Roll 1d6');
assert.equal(resetLabel(countdown({ loops: true })), 'Reset');

// --- Resolving a fixed start -----------------------------------------------

assert.equal(fixedStartValue('6'), 6);
assert.equal(fixedStartValue(' 12 '), 12);
// Dice have to go through the roller so the result is visible and shared.
assert.equal(fixedStartValue('1d6'), null);
assert.equal(fixedStartValue(undefined), null);
assert.equal(fixedStartValue('banana'), null);

// --- What the two entry points will accept ---------------------------------

assert.equal(isValidStart('6'), true);
assert.equal(isValidStart('1d6'), true);
assert.equal(isValidStart('2d6+1'), true);
assert.equal(isValidStart(''), false);
assert.equal(isValidStart('   '), false);
assert.equal(isValidStart('banana'), false);

// --- Back-compat -----------------------------------------------------------
// Countdowns saved before this feature have neither field and must behave
// exactly as they did: tick down, stop at zero, never nag.

const legacy = { id: 'old', name: 'Ritual', value: 0 };
assert.equal(isSpentLoop(legacy), false);
assert.equal(countdownState(legacy), 'finished');

// --- Wiring ----------------------------------------------------------------

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const helpers = fs.readFileSync('src/rendering/ui-helpers.ts', 'utf8');

// The loop used to be concatenated into the countdown's name, which left the
// tracker unable to tell a real loop from a title containing the word.
assert.ok(!/\$\{cleanName\}\$\{countdownLoop/.test(helpers), 'the loop must travel as data, not baked into the name');
assert.match(helpers, /loops:\s*!!countdownLoop/, 'statblock countdowns must pass their loop flag');
assert.match(helpers, /start:\s*trimmedValue/, 'statblock countdowns must pass their start value');

assert.match(view, /handleResetCountdown/, 'the reset action must exist');
assert.match(view, /drawCountdownComposer/, 'custom countdowns need a start and loop control');

// Looping must be changeable after creation: a hand-written countdown, or one
// whose statblock never said "Loop", can still be made to come back.
assert.match(view, /drawCountdownLoopEditor/, 'loop settings must be editable after creation');

// The start value is editable, not inferred. A countdown made to loop at the
// wrong number used to be stuck that way short of deleting and rebuilding it.
assert.match(view, /cls: 'dh-countdown-loop-editor-start'/, 'the loop editor must expose the start value');
assert.ok(
    !/countdown\.start = String\(countdown\.value\)/.test(view),
    'the start value must not be silently adopted from the current value',
);
// Both entry points accept the same thing.
assert.match(view, /isValidStart\(start\)/, 'the loop editor must validate the start value');

// Changing whether something loops must stay off the row itself: an earlier
// clickable badge dropped the loop on click, which put a destructive action
// beside "run it again" as two near-identical controls.
assert.ok(
    !/loopBadge\.addEventListener\('click', \(\) => this\.handleToggleCountdownLoop/.test(view),
    'the badge must not toggle the loop — that belongs in the overflow menu',
);
assert.match(view, /contextmenu/, 'the row needs a context menu as well as the overflow button');

// Acting on a countdown must not throw away the list's scroll position: with a
// long list, resetting one near the bottom used to jump back to the top.
assert.match(view, /refreshCountdownsList\(\)/, 'the list must be refreshable without rebuilding the popup');
assert.match(
    view,
    /const scrollTop = body\.scrollTop;[\s\S]{0,500}body\.scrollTop = scrollTop/,
    'the refresh must carry the scroll offset across',
);
for (const handler of ['handleResetCountdown', 'handleCountdownValueChange', 'handleRemoveCountdown']) {
    const body = view.slice(view.indexOf(`async ${handler}`), view.indexOf(`async ${handler}`) + 1400);
    assert.ok(
        !/this\.updateCountdownsPopup\(\)/.test(body),
        `${handler} must refresh the list, not tear down the popup`,
    );
}

// The badge and the reset control are one element: what a loop resets to and
// the act of resetting it are the same idea, and two elements put the value on
// screen twice.
assert.ok(!/dh-countdown-reset-btn/.test(view), 'the separate reset button must be gone — the badge is the control');
assert.match(
    view,
    /createEl\(isSpent \? 'button' : 'span'/,
    'the badge must only become a button once the loop is spent',
);
assert.match(view, /'aria-label': resetLabel\(countdown\)/, 'the spent badge needs the full phrase as its name');
// Clicking must reset, never remove the loop: a clickable badge that dropped
// the loop was the version that made deleting look casual.
assert.match(
    view,
    /if \(isSpent\) loopBadge\.addEventListener\('click', \(\) => this\.handleResetCountdown/,
    'clicking the badge must reset, not toggle the loop off',
);

// Deleting must not be a single click sitting beside the reset control.
assert.match(view, /dh-countdown-menu-btn/, 'the row needs an overflow menu');
assert.ok(
    !/createEl\('button', \{ title: 'Remove Countdown'/.test(view),
    'the bare trash button must be gone from the row',
);

// The value controls lead the row, so they sit at the same place on every line
// regardless of how long the name beside them is.
assert.ok(
    view.indexOf("cls: 'dh-countdown-controls'") < view.indexOf("cls: 'dh-countdown-name-wrap'"),
    'value controls must come before the name',
);

// One line per row: an earlier version wrapped the reset button onto its own,
// which cost height on the rows that were already the most cluttered.
const styles2 = fs.readFileSync('src/styles.css', 'utf8');
assert.ok(
    !/flex-wrap: wrap/.test(
        styles2.slice(styles2.indexOf('.dh-countdown-item {'), styles2.indexOf('.dh-countdown-name-wrap')),
    ),
    'the countdown row must not wrap',
);
assert.match(styles2, /\.dh-countdown-loop-badge\.is-spent/, 'the spent badge needs its highlighted state');
// Crossing zero changes how the row renders, so patching the number is not enough.
assert.match(
    view,
    /countdownState\(countdown\) !== stateBefore/,
    'a value change that crosses zero must redraw the row',
);

const styles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(styles, /\.dh-countdown-item\.is-spent-loop/, 'the spent-loop state needs styling');
assert.match(styles, /\.dh-countdown-composer/, 'the composer needs styling');

console.log('test-countdown-loop: ok');
