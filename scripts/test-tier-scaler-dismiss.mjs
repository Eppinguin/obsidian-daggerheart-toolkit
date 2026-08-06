import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

// The tier row is a popover, so it must dismiss on an outside click and on
// Escape, and only one may be open at a time.
assert.match(
    view,
    /document\.addEventListener\('click', this\.handleDismissTierScaler\)/,
    'an outside click must dismiss the scaler',
);
assert.match(
    view,
    /document\.addEventListener\('keydown', this\.handleTierScalerKeydown\)/,
    'Escape must dismiss the scaler',
);
assert.match(
    view,
    /document\.removeEventListener\('click', this\.handleDismissTierScaler\)/,
    'the dismiss listener must be torn down',
);
assert.match(
    view,
    /document\.removeEventListener\('keydown', this\.handleTierScalerKeydown\)/,
    'the keydown listener must be torn down',
);

// Teardown has to sit outside the `if (this.uiContainer)` guard: the listeners
// are on the document, so they leak if the container is already gone.
const onClose = view.slice(view.indexOf('async onClose() {'));
const beforeGuard = onClose.slice(0, onClose.indexOf('if (this.uiContainer)'));
assert.match(
    beforeGuard,
    /removeEventListener\('click', this\.handleDismissTierScaler\)/,
    'document listeners must be removed regardless of the container',
);

// Every control that acts on the scaler must stop the click reaching the
// document handler, or using the row would dismiss it.
//
// The tier and reset buttons must stop it *themselves* rather than relying on
// the row's listener: scaling redraws the card, so their ancestors can be
// detached before the event finishes bubbling.
const scalerBlock = view.slice(
    view.indexOf('// --- Tier Scaling Controls ---'),
    view.indexOf('// Reserve space for the controls that float over the card title.'),
);

for (const [label, anchor] of [
    ['tier button', "tierBtn.addEventListener('click'"],
    ['reset button', "resetBtn.addEventListener('click'"],
    ['scale toggle', "toggleScaleBtn.addEventListener('click'"],
]) {
    const at = scalerBlock.indexOf(anchor);
    assert.ok(at > -1, `${label} handler not found`);
    const handler = scalerBlock.slice(at, at + 400);
    assert.match(handler, /e\.stopPropagation\(\)/, `${label} must stop the click reaching the dismiss handler`);
}

// Opening a scaler closes any other, so at most one is ever open.
const toggleAt = scalerBlock.indexOf("toggleScaleBtn.addEventListener('click'");
assert.match(
    scalerBlock.slice(toggleAt, toggleAt + 600),
    /closeAllTierScalers\(\)/,
    'opening one scaler must close the others',
);

// Closing must clear both the state and the classes that render it, or a
// reopened card shows a stale row.
const closeAt = view.indexOf('private closeAllTierScalers() {');
const closeBody = view.slice(closeAt, view.indexOf('\n    }', closeAt));
assert.match(closeBody, /activeScalingGroups\.clear\(\)/);
assert.match(closeBody, /dh-tier-controls\.is-visible/);
assert.match(closeBody, /dh-scale-toggle-btn\.is-active/);
// The cluster narrows on close, so the reserved title clearance must be redone.
assert.match(closeBody, /syncCardControlsWidth/, 'closing must recompute the title clearance');

// The row renders out of flow, which is what keeps it off the card title.
assert.match(styles, /\.dh-tier-controls\s*\{[^}]*position:\s*absolute/s);

console.log('Tier scaler dismissal regression passed');
