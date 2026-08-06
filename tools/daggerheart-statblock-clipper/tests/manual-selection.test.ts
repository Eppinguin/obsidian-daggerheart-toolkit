/** Manual-selection expiry.
 *
 * The legacy content script wrote `lastExtractions`/`lastExtractionUrl` with no
 * timestamp and cleared only the `lastExtractionManual` flag on read, so the
 * other keys accumulated and a stale pick could shadow a fresh extraction.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
    MANUAL_SELECTION_MAX_AGE_MS,
    clearManualSelection,
    saveManualSelection,
    takeManualSelection,
} from '../src/lib/storage';
import type { RawStatblock } from '../src/types';

const URL_A = 'https://freshcutgrass.app/homebrew?id=a';
const URL_B = 'https://freshcutgrass.app/homebrew?id=b';
const ITEMS = [{ name: 'Shadow Hag' }] as RawStatblock[];

let store: Record<string, unknown> = {};

beforeEach(() => {
    store = {};
    (globalThis as Record<string, unknown>).chrome = {
        storage: {
            local: {
                get: async (keys: string[]) =>
                    Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
                set: async (values: Record<string, unknown>) => {
                    Object.assign(store, values);
                },
                remove: async (keys: string[] | string) => {
                    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
                },
            },
            sync: { get: async (d: unknown) => d, set: async () => {} },
        },
    };
    vi.resetModules();
});

afterEach(() => {
    vi.useRealTimers();
});

test('a fresh manual selection is returned for the matching page', async () => {
    await saveManualSelection(ITEMS, URL_A);
    expect(await takeManualSelection(URL_A)).toEqual(ITEMS);
});

test('a manual selection is consumed once, so a refresh re-runs automatic extraction', async () => {
    await saveManualSelection(ITEMS, URL_A);
    expect(await takeManualSelection(URL_A)).toEqual(ITEMS);
    expect(await takeManualSelection(URL_A)).toBeNull();
});

test('a manual selection does not apply to a different page', async () => {
    await saveManualSelection(ITEMS, URL_A);
    expect(await takeManualSelection(URL_B)).toBeNull();
});

test('a manual selection older than the max age is discarded', async () => {
    vi.useFakeTimers();
    await saveManualSelection(ITEMS, URL_A);
    vi.advanceTimersByTime(MANUAL_SELECTION_MAX_AGE_MS + 1000);
    expect(await takeManualSelection(URL_A)).toBeNull();
});

test('an expired selection clears every key rather than leaving orphans', async () => {
    vi.useFakeTimers();
    await saveManualSelection(ITEMS, URL_A);
    vi.advanceTimersByTime(MANUAL_SELECTION_MAX_AGE_MS + 1000);
    await takeManualSelection(URL_A);
    expect(Object.keys(store)).toEqual([]);
});

test('a selection just inside the max age still applies', async () => {
    vi.useFakeTimers();
    await saveManualSelection(ITEMS, URL_A);
    vi.advanceTimersByTime(MANUAL_SELECTION_MAX_AGE_MS - 1000);
    expect(await takeManualSelection(URL_A)).toEqual(ITEMS);
});

test('a record missing its timestamp is treated as stale', async () => {
    // Records written by the previous extension version have no timestamp.
    store.lastExtractions = ITEMS;
    store.lastExtractionUrl = URL_A;
    store.lastExtractionManual = true;
    expect(await takeManualSelection(URL_A)).toBeNull();
});

test('clearManualSelection removes every key', async () => {
    await saveManualSelection(ITEMS, URL_A);
    await clearManualSelection();
    expect(Object.keys(store)).toEqual([]);
});
