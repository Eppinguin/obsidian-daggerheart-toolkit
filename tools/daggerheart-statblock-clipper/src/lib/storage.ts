/** Typed extension storage helpers.
 *
 * The manual-selection record gained a timestamp: the legacy content script
 * wrote `lastExtractions`/`lastExtractionUrl` with no expiry and only cleared
 * the `lastExtractionManual` flag on read, so a stale pick could shadow a fresh
 * automatic extraction and the other two keys were never cleaned up.
 */
import type { ClipperSettings, ManualSelection, RawStatblock } from '../types';
import { api } from './browser';

const MANUAL_KEYS = ['lastExtractions', 'lastExtractionUrl', 'lastExtractionManual', 'lastExtractionAt'] as const;

/** How long a manual pick stays authoritative. Matches the background
 * worker's pending-launch window. */
export const MANUAL_SELECTION_MAX_AGE_MS = 10 * 60 * 1000;

export const DEFAULT_SETTINGS: ClipperSettings = {
    vault: '',
    folder: 'Daggerheart/Homebrew',
    overwrite: false,
};

export async function loadSettings(): Promise<ClipperSettings> {
    return (await api.storage.sync.get(DEFAULT_SETTINGS)) as ClipperSettings;
}

export async function saveSettings(settings: ClipperSettings): Promise<void> {
    await api.storage.sync.set(settings);
}

export async function saveManualSelection(items: RawStatblock[], url: string): Promise<void> {
    await api.storage.local.set({
        lastExtractions: items,
        lastExtractionUrl: url,
        lastExtractionManual: true,
        lastExtractionAt: Date.now(),
    } satisfies ManualSelection);
}

export async function clearManualSelection(): Promise<void> {
    await api.storage.local.remove([...MANUAL_KEYS]);
}

/** Returns the manual pick for `url`, or null when absent, stale, or for a
 * different page. Expired records are removed rather than left behind. */
export async function takeManualSelection(url: string): Promise<RawStatblock[] | null> {
    const stored = (await api.storage.local.get([...MANUAL_KEYS])) as Partial<ManualSelection>;
    if (!stored.lastExtractionManual || !Array.isArray(stored.lastExtractions) || !stored.lastExtractions.length) {
        return null;
    }
    if (stored.lastExtractionUrl !== url) return null;

    const age = Date.now() - Number(stored.lastExtractionAt ?? 0);
    if (!Number.isFinite(age) || age > MANUAL_SELECTION_MAX_AGE_MS) {
        await clearManualSelection();
        return null;
    }

    // Consumed once, so a later refresh re-runs automatic extraction.
    await clearManualSelection();
    return stored.lastExtractions;
}
