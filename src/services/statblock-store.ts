import { Notice, TFile } from 'obsidian';
import type DaggerheartStatblockPlugin from '../main';
import type { StatblockData } from '../types';
import { ContentSource, isSourceExportable, isSourceWritable } from './content-source';
import { exportToJsonString } from './export-import';
import { ContentType } from './export-import';
import {
    blockMatchesName,
    findStatblockBlocks,
    removeStatblockBlock,
    replaceStatblockBlock,
} from './markdown-statblock';
import { statblockToYaml } from './statblock-format';

const USER_DATA_FOLDER = 'user_data';

/**
 * Fields that only make sense on a live encounter instance, or that the loader
 * re-derives. None of them belong in a saved compendium entry.
 */
export type MergeConflictStrategy = 'skip' | 'replace' | 'rename';

export interface MergeResult {
    moved: number;
    skipped: number;
    renamed: number;
    replaced: number;
}

/** Suffix a name until it no longer collides, e.g. "Hag (2)". */
function uniqueName(baseName: string, taken: Set<string>): string {
    let counter = 2;
    let candidate = `${baseName} (${counter})`;
    while (taken.has(candidate.toLowerCase())) {
        counter++;
        candidate = `${baseName} (${counter})`;
    }
    return candidate;
}

const TRANSIENT_FIELDS = [
    'sourceId',
    'sourceFile',
    'sourceBlockIndex',
    'id',
    'groupId',
    'currentHp',
    'currentStress',
    'displayName',
    'hasCustomName',
    'conditions',
    '_originalStats',
] as const;

/**
 * The single owner of every statblock mutation.
 *
 * Before this existed, three separate writers picked their own target file,
 * which is how custom environments ended up in a `user-environments.json` the
 * loader never read. Routing everything through one service that resolves the
 * file from the same registry the loader uses makes that class of bug
 * unrepresentable.
 */
export class StatblockStore {
    constructor(private plugin: DaggerheartStatblockPlugin) {}

    async upsert(sourceId: string, data: StatblockData, options: { silent?: boolean } = {}): Promise<void> {
        const source = this.requireWritable(sourceId);
        const entries = await this.readSource(sourceId);
        const clean = this.sanitize(data);
        const index = entries.findIndex((entry) => this.sameName(entry, clean.name));

        if (index >= 0) {
            entries[index] = clean;
            if (!options.silent) new Notice(`Updated "${clean.name}" in ${source.label}.`);
        } else {
            entries.push(clean);
            if (!options.silent) new Notice(`Saved "${clean.name}" to ${source.label}.`);
        }

        await this.writeSource(source, entries);
    }

    /** Batch upsert: one read and one write regardless of item count. */
    async upsertMany(sourceId: string, items: StatblockData[]): Promise<void> {
        if (!items.length) return;
        const source = this.requireWritable(sourceId);
        const entries = await this.readSource(sourceId);

        for (const item of items) {
            const clean = this.sanitize(item);
            const index = entries.findIndex((entry) => this.sameName(entry, clean.name));
            if (index >= 0) entries[index] = clean;
            else entries.push(clean);
        }

        await this.writeSource(source, entries);
    }

    /** Replace the entry called `oldName`, which may itself carry a new name. */
    async rename(sourceId: string, oldName: string, newData: StatblockData): Promise<void> {
        const source = this.requireWritable(sourceId);
        const entries = await this.readSource(sourceId);
        const clean = this.sanitize(newData);
        const index = entries.findIndex((entry) => this.sameName(entry, oldName));

        if (index < 0) {
            await this.upsert(sourceId, newData);
            return;
        }

        entries[index] = clean;
        await this.writeSource(source, entries);
        new Notice(`Renamed "${oldName}" to "${clean.name}".`);
    }

    async remove(sourceId: string, name: string): Promise<boolean> {
        const removed = await this.removeMany(sourceId, [name]);
        return removed > 0;
    }

    async removeMany(sourceId: string, names: string[]): Promise<number> {
        if (!names.length) return 0;
        const source = this.requireWritable(sourceId);
        const entries = await this.readSource(sourceId);
        const targets = new Set(names.map((name) => name.toLowerCase()));

        const kept = entries.filter((entry) => !targets.has(entry.name?.toLowerCase()));
        const removed = entries.length - kept.length;
        if (removed > 0) await this.writeSource(source, kept);
        return removed;
    }

    /**
     * Copy entries into the destination, then drop them from the origin.
     *
     * The order matters: if the second write fails the user is left with a
     * visible duplicate, which is recoverable. Deleting first would risk losing
     * the entries entirely.
     */
    async move(fromSourceId: string, toSourceId: string, names: string[]): Promise<void> {
        if (!names.length || fromSourceId === toSourceId) return;
        this.requireWritable(fromSourceId);
        const destination = this.requireWritable(toSourceId);

        const entries = await this.readSource(fromSourceId);
        const targets = new Set(names.map((name) => name.toLowerCase()));
        const moving = entries.filter((entry) => targets.has(entry.name?.toLowerCase()));
        if (!moving.length) return;

        await this.upsertMany(toSourceId, moving);
        await this.removeMany(
            fromSourceId,
            moving.map((entry) => entry.name),
        );
        new Notice(`Moved ${moving.length} entr${moving.length === 1 ? 'y' : 'ies'} to ${destination.label}.`);
    }

    /**
     * Move every entry out of one source into another.
     *
     * `onConflict` decides what happens to names the destination already has:
     * skip keeps the destination's version, replace overwrites it, and rename
     * keeps both by suffixing the incoming one.
     */
    async mergeSource(
        fromSourceId: string,
        toSourceId: string,
        onConflict: MergeConflictStrategy = 'rename',
    ): Promise<MergeResult> {
        if (fromSourceId === toSourceId) throw new Error('A source cannot be merged into itself.');
        const from = this.plugin.getSource(fromSourceId);
        if (!from) throw new Error(`Unknown content source: ${fromSourceId}`);
        this.requireWritable(toSourceId);

        // Markdown and SRD entries are copied rather than moved, since their
        // origin is not ours to empty.
        const canEmptyOrigin = isSourceWritable(from);
        const incoming = canEmptyOrigin
            ? await this.readSource(fromSourceId)
            : this.plugin.compendium.getEntriesForSource(fromSourceId);
        if (!incoming.length) return { moved: 0, skipped: 0, renamed: 0, replaced: 0 };

        const destination = await this.readSource(toSourceId);
        const taken = new Set(destination.map((entry) => entry.name.toLowerCase()));
        const result: MergeResult = { moved: 0, skipped: 0, renamed: 0, replaced: 0 };
        const additions: StatblockData[] = [];

        for (const raw of incoming) {
            const entry = this.sanitize(raw);
            const key = entry.name.toLowerCase();

            if (!taken.has(key)) {
                taken.add(key);
                additions.push(entry);
                result.moved++;
                continue;
            }

            if (onConflict === 'skip') {
                result.skipped++;
                continue;
            }
            if (onConflict === 'replace') {
                additions.push(entry);
                result.replaced++;
                continue;
            }

            entry.name = uniqueName(entry.name, taken);
            taken.add(entry.name.toLowerCase());
            additions.push(entry);
            result.renamed++;
        }

        if (additions.length) await this.upsertMany(toSourceId, additions);
        // Emptied only after the destination is safely written, so a failure
        // leaves duplicates rather than losing entries.
        if (canEmptyOrigin && additions.length) {
            const consumed = incoming
                .filter(
                    (entry) =>
                        onConflict !== 'skip' || !destination.some((existing) => this.sameName(existing, entry.name)),
                )
                .map((entry) => entry.name);
            await this.removeMany(fromSourceId, consumed);
        }
        return result;
    }

    /** Read one source's raw array, bypassing the merged compendium. */
    async readSource(sourceId: string): Promise<StatblockData[]> {
        const source = this.plugin.getSource(sourceId);
        if (!source || source.kind !== 'user-json') return [];

        const path = this.pathFor(source);
        if (!(await this.plugin.app.vault.adapter.exists(path))) return [];

        try {
            let raw = await this.plugin.app.vault.adapter.read(path);
            if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
            if (!raw.trim()) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as StatblockData[]) : [];
        } catch (error) {
            console.error(`Daggerheart | Could not read source "${source.label}":`, error);
            new Notice(`Could not read ${source.path}. See console for details.`);
            throw error;
        }
    }

    /**
     * Serialize a whole source for backup.
     *
     * Throws for do-not-distribute sources rather than relying on the UI to
     * hide the button, so a future caller cannot quietly bypass the rule.
     */
    async exportSource(sourceId: string): Promise<string> {
        const source = this.plugin.getSource(sourceId);
        if (!source) throw new Error(`Unknown content source: ${sourceId}`);
        if (!isSourceExportable(source)) {
            throw new Error(`"${source.label}" is marked as personal content and cannot be exported.`);
        }

        const entries =
            source.kind === 'user-json'
                ? await this.readSource(sourceId)
                : (this.plugin.compendium.entriesBySource.get(sourceId) ?? []).map((entry) => this.sanitize(entry));
        return exportToJsonString('statblocks', entries);
    }

    /** Serialize a single entry. Subject to the same do-not-distribute rule. */
    exportEntry(entry: StatblockData): string {
        const source = this.plugin.getSource(entry.sourceId);
        if (source && !isSourceExportable(source)) {
            throw new Error(`"${entry.name}" belongs to personal content and cannot be exported.`);
        }
        const type = entry.category === 'environment' ? ContentType.ENVIRONMENT : ContentType.ADVERSARY;
        return exportToJsonString(type, this.sanitize(entry));
    }

    /** Remove a source from the registry and delete its backing file. */
    async deleteSource(sourceId: string): Promise<void> {
        const source = this.plugin.getSource(sourceId);
        if (!source) return;
        if (!source.removable) throw new Error(`"${source.label}" cannot be removed.`);

        if (source.kind === 'user-json') {
            const path = this.pathFor(source);
            try {
                if (await this.plugin.app.vault.adapter.exists(path)) {
                    await this.plugin.app.vault.adapter.remove(path);
                }
            } catch (error) {
                console.error(`Daggerheart | Could not delete ${path}:`, error);
                new Notice(`Removed "${source.label}" from the list, but its file could not be deleted.`);
            }
        }

        this.plugin.settings.contentSources = this.plugin.getContentSources().filter((item) => item.id !== sourceId);
        await this.plugin.saveSettings();
        await this.plugin.triggerCompendiumUpdate();
    }

    // --- Markdown notes ----------------------------------------------------

    /**
     * Rewrite one statblock inside its note, leaving the rest of the file alone.
     *
     * Notes belong to the user, so this refuses whenever the block it intends
     * to overwrite no longer matches the entry it was read from — the note
     * having been edited since load makes a stale index unsafe.
     */
    async updateMarkdownEntry(entry: StatblockData, updated: StatblockData): Promise<void> {
        const { sourceFile, sourceBlockIndex } = entry;
        if (!sourceFile || sourceBlockIndex === undefined) {
            throw new Error('This entry is not linked to a note and cannot be edited in place.');
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(sourceFile);
        if (!(file instanceof TFile)) {
            throw new Error(`Could not find the note ${sourceFile}.`);
        }

        const content = await this.plugin.app.vault.read(file);
        const blocks = findStatblockBlocks(content);
        const target = blocks[sourceBlockIndex];
        if (!target || !blockMatchesName(target.body, entry.name)) {
            throw new Error(`${sourceFile} has changed since it was loaded. Refresh the compendium and try again.`);
        }

        const yaml = statblockToYaml(this.sanitize(updated));
        const next = replaceStatblockBlock(content, sourceBlockIndex, yaml);
        if (next === null) {
            throw new Error(`Could not locate the statblock in ${sourceFile}.`);
        }

        await this.plugin.app.vault.modify(file, next);
        // The vault-modify watcher reloads the compendium on its own, but that
        // is debounced; reloading here keeps the UI immediate.
        await this.plugin.triggerCompendiumUpdate();
    }

    /** Delete one statblock block from its note, leaving the prose intact. */
    async removeMarkdownEntry(entry: StatblockData): Promise<void> {
        const { sourceFile, sourceBlockIndex } = entry;
        if (!sourceFile || sourceBlockIndex === undefined) {
            throw new Error('This entry is not linked to a note and cannot be removed.');
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(sourceFile);
        if (!(file instanceof TFile)) {
            throw new Error(`Could not find the note ${sourceFile}.`);
        }

        const content = await this.plugin.app.vault.read(file);
        const blocks = findStatblockBlocks(content);
        const target = blocks[sourceBlockIndex];
        if (!target || !blockMatchesName(target.body, entry.name)) {
            throw new Error(`${sourceFile} has changed since it was loaded. Refresh the compendium and try again.`);
        }

        const next = removeStatblockBlock(content, sourceBlockIndex);
        if (next === null) {
            throw new Error(`Could not locate the statblock in ${sourceFile}.`);
        }

        await this.plugin.app.vault.modify(file, next);
        await this.plugin.triggerCompendiumUpdate();
    }

    /** Whether this entry can be written back to the note it came from. */
    canEditInPlace(entry: StatblockData): boolean {
        if (!entry.sourceFile || entry.sourceBlockIndex === undefined) return false;
        return this.plugin.app.vault.getAbstractFileByPath(entry.sourceFile) instanceof TFile;
    }

    // --- internals ---------------------------------------------------------

    private requireWritable(sourceId: string): ContentSource {
        const source = this.plugin.getSource(sourceId);
        if (!source) throw new Error(`Unknown content source: ${sourceId}`);
        if (!isSourceWritable(source)) {
            throw new Error(`"${source.label}" is read-only and cannot be modified.`);
        }
        return source;
    }

    private pathFor(source: ContentSource): string {
        return `${this.plugin.manifest.dir}/${USER_DATA_FOLDER}/${source.path}`;
    }

    private sameName(entry: StatblockData, name: string): boolean {
        return entry.name?.toLowerCase() === name?.toLowerCase();
    }

    /** Drop encounter-instance state and loader-derived fields before writing. */
    private sanitize(data: StatblockData): StatblockData {
        const clean = { ...data } as Record<string, unknown>;
        for (const field of TRANSIENT_FIELDS) delete clean[field];
        clean.isCustom = true;
        return clean as unknown as StatblockData;
    }

    private async writeSource(source: ContentSource, entries: StatblockData[]): Promise<void> {
        const folder = `${this.plugin.manifest.dir}/${USER_DATA_FOLDER}`;
        if (!(await this.plugin.app.vault.adapter.exists(folder))) {
            await this.plugin.app.vault.adapter.mkdir(folder);
        }
        await this.plugin.app.vault.adapter.write(this.pathFor(source), JSON.stringify(entries, null, 2));
        await this.plugin.triggerCompendiumUpdate();
    }
}
