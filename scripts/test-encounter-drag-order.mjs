import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * The encounter area is a single non-wrapping row that scrolls horizontally
 * (see the overflow assertions below), so the pointer's X alone decides the
 * insertion slot: the first card whose midpoint the pointer sits left of.
 *
 * An earlier revision wrapped onto rows and needed a row-aware comparator; the
 * wrap was reverted to keep cards height-contained, and the comparator with it.
 *
 * This mirrors getGroupDragAfterId() in EncounterBuilderView.
 */
function pickInsertionPoint(midpoints, x) {
    for (const card of midpoints) {
        if (x < card.mid) return card.id;
    }
    return null;
}

// Four 300px cards in one row, 15px gap: midpoints at 150, 465, 780, 1095.
const midpoints = [];
for (let c = 0; c < 4; c++) {
    midpoints.push({ id: `c${c}`, mid: c * 315 + 150 });
}

assert.equal(pickInsertionPoint(midpoints, 10), 'c0', 'before the first card');
assert.equal(pickInsertionPoint(midpoints, 200), 'c1', 'past c0 midpoint, before c1');
assert.equal(pickInsertionPoint(midpoints, 500), 'c2', 'past c1 midpoint, before c2');
assert.equal(pickInsertionPoint(midpoints, 1200), null, 'past the last midpoint appends');

const view = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');

// --- Drag smoothness invariants ---
// dragover fires continuously while the pointer moves. Reading layout there
// (getBoundingClientRect) forces a synchronous layout per card per event, which
// is what made reordering feel choppy. Midpoints are cached instead, and
// refreshed only when the order changes or the row scrolls.
const dragOver = view.match(/private handleDragOver\(e: DragEvent\) \{[\s\S]*?\n    \}/);
assert.ok(dragOver, 'handleDragOver must exist');
assert.doesNotMatch(
    dragOver[0],
    /getGroupDragAfterId\([^)]*\)\s*\{/,
    'the slot lookup must not re-measure inside dragover',
);
assert.match(
    view,
    /private getGroupDragAfterId\(x: number\): string \| null/,
    'slot selection is X-only against cached midpoints',
);

// Re-inserting the dragged node where it already sits still re-lays out the row
// and interrupts the browser's drag hit-testing, so the move must be guarded.
assert.match(
    dragOver[0],
    /if \(dragging\.nextElementSibling === afterElement\) return;/,
    'dragover must skip the DOM move when the slot is unchanged',
);

// A drag that changed nothing must not rebuild the view: drawUI() throws away
// scroll position and any feature the GM had expanded mid-combat.
const dragEnd = view.match(/private handleDragEnd\(e: DragEvent\) \{[\s\S]*?\n    \}/);
assert.ok(dragEnd, 'handleDragEnd must exist');
assert.match(
    dragEnd[0],
    /if \(changed\) this\.drawUI\(\);/,
    'dragend must only redraw when the order actually changed',
);

// The row scrolls horizontally and never wraps, so a card can only reach an
// off-screen slot if the area autoscrolls while the pointer sits at the edge.
assert.match(
    view,
    /private startDragAutoScroll\(encounterArea: HTMLElement\)/,
    'dragging near the edge must scroll the encounter area',
);
assert.match(
    view,
    /cancelAnimationFrame\(this\.dragAutoScrollFrame\)/,
    'the autoscroll loop must be cancelled, not left running after the drop',
);

const styles = fs.readFileSync('src/styles.css', 'utf8');

// The dragged card stays in the flow as its own placeholder, so its footprint
// must not change: a border would widen it by 2px and shove every card in the
// row sideways the instant the drag began. outline draws the slot for free.
const draggingRule = styles.match(/\.dh-adversary-group-container\.dh-dragging\s*\{[^}]*\}/s);
assert.ok(draggingRule, 'the dragging state must be styled');
assert.doesNotMatch(
    draggingRule[0],
    /^\s*border:/m,
    'the dragged card must not take on a border; it would resize the placeholder',
);
assert.match(draggingRule[0], /outline:/, 'use outline so the slot marker takes no space');

// Height containment: cards scroll internally and must never grow past the
// encounter area, or the pinned live-state footer falls off the bottom of the
// window. This is the invariant that a wrapping grid broke.
assert.match(
    styles,
    /\.dh-encounter-area\s*\{[^}]*overflow-y:\s*hidden/s,
    'the encounter area must not scroll vertically; cards scroll internally',
);
assert.match(
    styles,
    /\.dh-encounter-area \.dh-adversary-group-container\s*\{[^}]*max-height:\s*100%/s,
    'groups must be capped at the height of the encounter area',
);
assert.match(
    styles,
    /\.dh-encounter-area \.dh-adversary-instance-card\s*\{[^}]*max-height:\s*100%/s,
    'cards must be capped at the height of the encounter area',
);
assert.match(styles, /\.dh-card-static-region\s*\{[^}]*overflow-y:\s*auto/s, 'the statblock region is what scrolls');

// A flex child without min-height:0 refuses to shrink below its content, which
// is what makes a tall card push past the bottom of the window regardless of
// any max-height above it. Both links in the chain need it.
for (const sel of ['.dh-instance-card-content', '.dh-card-static-region']) {
    const rule = new RegExp(sel.replace(/[.]/g, '\\$&') + '\\s*\\{[^}]*min-height:\\s*0', 's');
    assert.match(styles, rule, `${sel} needs min-height:0 or it cannot shrink`);
}
// The footer must never shrink away; it is the point of the pinned layout.
assert.match(
    styles,
    /\.dh-instance-card-content \.dh-hp-stress-container\s*\{[^}]*flex:\s*0 0 auto/s,
    'the live-state footer must not shrink',
);

// --- Card title vs. the floating control cluster ---
// The controls are absolutely positioned over the card title, so the title has
// to reserve room for them. A hardcoded reserve silently goes stale whenever a
// control is added: 70px was reserved while the cluster had grown to 156px, and
// long adversary names ran underneath the buttons.
assert.match(
    styles,
    /\.dh-header \.dh-name\s*\{[^}]*padding-right:\s*var\(--dh-card-controls-w/s,
    'the card title must reserve the measured control width, not a fixed guess',
);
assert.match(view, /setProperty\('--dh-card-controls-w'/, 'the control width must be measured and published');
assert.match(view, /requestAnimationFrame/, 'measure after layout, or the controls report a zero width on first paint');

// The tier row must stay out of the cluster's flow, or opening it pushes the
// controls left across the title.
assert.match(
    styles,
    /\.dh-tier-controls\s*\{[^}]*position:\s*absolute/s,
    'the tier row must drop below the cluster rather than widen it',
);

// The fallback applies for the frame before measurement, so it must already
// clear the widest fixed cluster (5 buttons at 28px with 4px gaps = 156px).
const fallback = styles.match(/--dh-card-controls-w,\s*(\d+)px/);
assert.ok(fallback, 'a fallback reserve is required for first paint');
assert.ok(Number(fallback[1]) >= 156, `fallback reserve ${fallback[1]}px must clear the 156px control cluster`);

console.log('Encounter drag ordering and wrapped layout regression passed');
