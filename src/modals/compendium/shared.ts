import { ButtonComponent, setIcon } from 'obsidian';
import type DaggerheartStatblockPlugin from '../../main';
import type { StatblockData } from '../../types';
import { ContentSource, isSourceWritable } from '../../services/content-source';

/** An entry paired with the source it actually lives in. */
export interface ManagedEntry {
    data: StatblockData;
    source: ContentSource;
    isShadowed: boolean;
}

/** Stable selection key for an entry within its source. */
export function entryKey(entry: ManagedEntry): string {
    return `${entry.source.id}::${entry.data.name.toLowerCase()}`;
}

/**
 * Whether an entry can be changed: either its source accepts writes, or it
 * lives in a note whose block we can rewrite in place.
 */
export function isEntryEditable(plugin: DaggerheartStatblockPlugin, entry: ManagedEntry): boolean {
    if (isSourceWritable(entry.source)) return true;
    return entry.source.kind === 'markdown' && plugin.statblockStore.canEditInPlace(entry.data);
}

/** Every entry the plugin knows about, including shadowed and disabled ones. */
export function collectEntries(plugin: DaggerheartStatblockPlugin): ManagedEntry[] {
    const entries: ManagedEntry[] = [];
    for (const source of plugin.getContentSources()) {
        for (const data of plugin.compendium.getEntriesForSource(source.id)) {
            entries.push({ data, source, isShadowed: plugin.compendium.isShadowed(data) });
        }
    }
    return entries;
}

/** Human-readable summary of what a source holds and how it behaves. */
export function describeSource(plugin: DaggerheartStatblockPlugin, source: ContentSource): string {
    const count = plugin.compendium.getEntriesForSource(source.id).length;
    const details: string[] = [`${count} ${count === 1 ? 'entry' : 'entries'}`];
    if (source.kind === 'markdown') details.push(source.path || 'no folder set');
    else if (source.kind === 'user-json') details.push(source.path);
    if (source.kind === 'builtin-srd') details.push('bundled SRD');
    if (source.doNotDistribute) details.push('never exported');
    return details.join(' · ');
}

/** A small pill naming a source, with a lock when it holds personal content. */
export function renderSourceBadge(parent: HTMLElement, source: ContentSource | undefined): HTMLElement | null {
    if (!source) return null;
    const badge = parent.createSpan({ text: source.label, cls: 'dh-source-badge' });
    if (source.doNotDistribute) {
        badge.addClass('is-locked');
        const lock = badge.createSpan({ cls: 'dh-source-badge-icon' });
        setIcon(lock, 'lock');
        badge.title = 'Personal licensed content — excluded from export.';
    }
    return badge;
}

/**
 * Two-click delete confirmation, matching ManageEncountersModal.
 *
 * The first click arms the button and the second commits, with the armed state
 * reverting on its own so a stray click cannot linger as a trap.
 */
export function makeConfirmableDelete(
    button: ButtonComponent,
    tooltip: string,
    onConfirm: () => void | Promise<void>,
): ButtonComponent {
    return button
        .setIcon('trash')
        .setTooltip(tooltip)
        .setClass('dh-icon-button')
        .setClass('dh-delete-btn-confirmable')
        .onClick(async () => {
            if (button.buttonEl.classList.contains('is-confirming-delete')) {
                await onConfirm();
                return;
            }
            button.buttonEl.classList.add('is-confirming-delete');
            button.setTooltip('Confirm delete?');
            setIcon(button.buttonEl, 'check-circle');
            setTimeout(() => {
                if (button.buttonEl.classList.contains('is-confirming-delete')) {
                    button.buttonEl.classList.remove('is-confirming-delete');
                    button.setTooltip(tooltip);
                    setIcon(button.buttonEl, 'trash');
                }
            }, 3000);
        });
}
