/**
 * Countdown loop rules.
 *
 * A countdown only ever ticks when the GM clicks it, so reaching zero is never
 * missed. What does get missed is the *reset* afterwards: a looping countdown
 * that triggered and was left at zero is a wrong state that persists silently
 * for the rest of the session. These helpers decide when a countdown owes the
 * GM that reset, and what resetting it means.
 *
 * Framework-free so the test scripts can import it directly.
 */
import type { Countdown } from '../types';

/** A start value written as dice ("1d6", "2d6+1") rather than a fixed number. */
const DICE_START = /^\d+d\d+(?:\s*[+-]\s*\d+)*$/i;

export function isDiceStart(start?: string): boolean {
    return !!start && DICE_START.test(start.trim());
}

/**
 * Whether this countdown has triggered and is waiting to be sent round again.
 *
 * Only loops qualify. A one-shot countdown at zero has done its job and owes
 * nothing, so flagging it would train the GM to ignore the flag.
 */
export function isSpentLoop(countdown: Countdown): boolean {
    return !!countdown.loops && countdown.value <= 0 && !!countdown.start;
}

/**
 * What the reset control should say. The countdown's own definition decides
 * between rerolling and restoring, so the GM is never asked to choose.
 */
export function resetLabel(countdown: Countdown): string {
    const start = (countdown.start ?? '').trim();
    if (!start) return 'Reset';
    return isDiceStart(start) ? `Roll ${start}` : `Reset to ${start}`;
}

/**
 * The value a reset produces for a fixed start. Dice starts have to go through
 * the plugin's roller instead, so the result is visible and shared.
 */
export function fixedStartValue(start?: string): number | null {
    if (!start || isDiceStart(start)) return null;
    const parsed = Number.parseInt(start.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether a typed start value is usable — a plain number or a dice string.
 * Shared by the add row and the loop editor so both accept the same thing.
 */
export function isValidStart(start: string): boolean {
    const trimmed = start.trim();
    if (!trimmed) return false;
    return isDiceStart(trimmed) || fixedStartValue(trimmed) !== null;
}

/** How the row should present itself. */
export type CountdownState = 'active' | 'spent-loop' | 'finished';

export function countdownState(countdown: Countdown): CountdownState {
    if (isSpentLoop(countdown)) return 'spent-loop';
    if (countdown.value <= 0) return 'finished';
    return 'active';
}
