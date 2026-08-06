/**
 * Turning a vertical wheel into horizontal scrolling for the encounter row.
 *
 * The decision is separated from the DOM so it can be tested directly: the
 * awkward part is not moving the scroll, it is knowing when *not* to. Cards
 * scroll internally, so taking every wheel event would make reading a long
 * feature list drag the whole encounter sideways.
 */

/** The bit of an element this decision needs. Kept minimal so tests can fake it. */
export interface ScrollableBox {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    /** Computed overflow-y; 'visible' means the box does not scroll. */
    overflowY: string;
}

export interface WheelIntent {
    deltaX: number;
    deltaY: number;
    ctrlKey?: boolean;
}

/**
 * Whether the encounter area should convert this wheel event into horizontal
 * movement, given the scrollable ancestors between the pointer and the area.
 *
 * `chain` runs from the element under the pointer outward, excluding the
 * encounter area itself.
 *
 * A mouse wheel over a card belongs to that card and nothing else. Handing the
 * wheel onward once the card hits its end made the encounter lurch sideways
 * mid-read, and tied the row's position to how far a card happened to be
 * scrolled. Gestures are unaffected: a trackpad sends real horizontal deltas,
 * which never reach this conversion in the first place.
 */
export function shouldScrollHorizontally(intent: WheelIntent, chain: ScrollableBox[], areaOverflows: boolean): boolean {
    // A real horizontal gesture — trackpad or tilt wheel — already works.
    if (intent.deltaX !== 0 || intent.deltaY === 0) return false;
    // Ctrl+wheel is pinch-zoom, not a scroll.
    if (intent.ctrlKey) return false;
    // Nothing off-screen to reach.
    if (!areaOverflows) return false;

    // Over anything that scrolls vertically, the wheel stays there — whether or
    // not it has room left to move.
    return !chain.some((box) => box.scrollHeight > box.clientHeight && box.overflowY !== 'visible');
}
