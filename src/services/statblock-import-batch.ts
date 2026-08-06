import { Notice } from 'obsidian';
import type DaggerheartStatblockPlugin from '../main';
import type { StatblockData } from '../types';

/**
 * Persist imported statblocks into a content source.
 *
 * The signature is kept as-is (with the source appended) because the clipboard
 * import integration and its test both reference this exact export.
 */
export async function saveStatblockBatch(
    plugin: DaggerheartStatblockPlugin,
    items: StatblockData[],
    sourceId?: string,
): Promise<void> {
    if (!items.length) return;
    const targetSourceId = sourceId ?? plugin.getDefaultWriteSourceId();

    try {
        await plugin.statblockStore.upsertMany(targetSourceId, items);
    } catch (error) {
        console.error('Daggerheart | Could not save imported statblocks:', error);
        new Notice(error instanceof Error ? error.message : 'Import failed; nothing was saved.');
        throw error;
    }
}
