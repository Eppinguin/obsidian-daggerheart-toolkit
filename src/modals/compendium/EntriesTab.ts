import { App, ButtonComponent, Notice, setIcon } from 'obsidian';
import type DaggerheartStatblockPlugin from '../../main';
import type { StatblockData } from '../../types';
import { isSourceExportable, isSourceWritable } from '../../services/content-source';
import { createBlankStatblock, toEditableInstance, uniqueCopyName } from '../../services/statblock-instance';
import { copyToClipboard } from '../../services/export-import';
import { renderStatblockCard } from '../../rendering/statblock';
import { ConfirmationModal } from '../ConfirmationModal';
import { EditAdversaryModal } from '../EditAdversaryModal';
import { SourcePickerModal } from '../SourcePickerModal';
import {
    ManagedEntry,
    collectEntries,
    entryKey,
    isEntryEditable,
    makeConfirmableDelete,
    renderSourceBadge,
} from './shared';

type CategoryFilter = 'all' | 'adversary' | 'environment';
type SortKey = 'name' | 'tier' | 'type' | 'source';

/** Browse, edit, and bulk-manage every statblock the plugin knows about. */
export class EntriesTab {
    private searchTerm = '';
    private categoryFilter: CategoryFilter = 'all';
    private sourceFilter = 'all';
    private sortKey: SortKey = 'name';
    private showShadowed = true;
    private selected = new Set<string>();
    private expanded = new Set<string>();
    private container: HTMLElement | null = null;

    constructor(
        private app: App,
        private plugin: DaggerheartStatblockPlugin,
        /** Closes the manager, for actions that navigate away. */
        private closeManager: () => void,
        /** Re-renders the whole manager after a structural change. */
        private refreshManager: () => void,
    ) {}

    render(parent: HTMLElement): void {
        this.container = parent.createDiv({ cls: 'dh-manage-tab-body' });
        this.renderToolbar(this.container);
        this.renderList(this.container.createDiv({ cls: 'dh-manage-entries' }));
    }

    // --- Toolbar -----------------------------------------------------------

    private renderToolbar(parent: HTMLElement): void {
        const filters = parent.createDiv({ cls: 'dh-manage-filters' });

        const search = filters.createEl('input', {
            type: 'text',
            placeholder: 'Search entries…',
            cls: 'dh-compendium-search',
            value: this.searchTerm,
        });
        search.addEventListener('input', (event) => {
            this.searchTerm = (event.target as HTMLInputElement).value;
            this.refreshList();
        });

        this.addSelect(
            filters,
            'Category',
            this.categoryFilter,
            [
                ['all', 'All items'],
                ['adversary', 'Adversaries'],
                ['environment', 'Environments'],
            ],
            (value) => {
                this.categoryFilter = value as CategoryFilter;
                this.refreshList();
            },
        );

        this.addSelect(
            filters,
            'Source',
            this.sourceFilter,
            [
                ['all', 'All sources'],
                ...this.plugin.getContentSources().map((source) => [source.id, source.label] as [string, string]),
            ],
            (value) => {
                this.sourceFilter = value;
                this.refreshList();
            },
        );

        this.addSelect(
            filters,
            'Sort',
            this.sortKey,
            [
                ['name', 'Name'],
                ['tier', 'Tier'],
                ['type', 'Type'],
                ['source', 'Source'],
            ],
            (value) => {
                this.sortKey = value as SortKey;
                this.refreshList();
            },
        );

        const shadowLabel = filters.createEl('label', { cls: 'dh-manage-shadow-toggle' });
        const shadowCheckbox = shadowLabel.createEl('input', { type: 'checkbox' });
        shadowCheckbox.checked = this.showShadowed;
        shadowLabel.createSpan({ text: 'Hidden duplicates' });
        shadowCheckbox.addEventListener('change', () => {
            this.showShadowed = shadowCheckbox.checked;
            this.refreshList();
        });

        const actions = parent.createDiv({ cls: 'dh-manage-entry-actions' });
        new ButtonComponent(actions)
            .setButtonText('New adversary')
            .setIcon('plus')
            .onClick(() => this.createEntry('adversary'));
        new ButtonComponent(actions)
            .setButtonText('New environment')
            .setIcon('plus')
            .onClick(() => this.createEntry('environment'));
    }

    private addSelect(
        parent: HTMLElement,
        label: string,
        current: string,
        options: [string, string][],
        onChange: (value: string) => void,
    ): void {
        const wrap = parent.createDiv({ cls: 'dh-filter-section' });
        wrap.createSpan({ text: `${label}:`, cls: 'dh-filter-label' });
        const select = wrap.createEl('select', { cls: 'dh-type-select' });
        for (const [value, text] of options) {
            const option = select.createEl('option', { text, value });
            if (value === current) option.selected = true;
        }
        select.addEventListener('change', (event) => onChange((event.target as HTMLSelectElement).value));
    }

    private createEntry(category: 'adversary' | 'environment'): void {
        const data = createBlankStatblock(category);
        new EditAdversaryModal(this.app, this.plugin, toEditableInstance(data), () => this.refreshManager(), {
            allowNoteEdits: false,
        }).open();
    }

    // --- Data --------------------------------------------------------------

    private visibleEntries(): ManagedEntry[] {
        const search = this.searchTerm.trim().toLowerCase();
        const filtered = collectEntries(this.plugin).filter((entry) => {
            if (!this.showShadowed && entry.isShadowed) return false;
            if (this.sourceFilter !== 'all' && entry.source.id !== this.sourceFilter) return false;
            if (this.categoryFilter !== 'all' && entry.data.category !== this.categoryFilter) return false;
            if (search && !entry.data.name.toLowerCase().includes(search)) return false;
            return true;
        });

        const byName = (a: ManagedEntry, b: ManagedEntry) => a.data.name.localeCompare(b.data.name);
        return filtered.sort((a, b) => {
            switch (this.sortKey) {
                case 'tier':
                    return (Number(a.data.tier) || 0) - (Number(b.data.tier) || 0) || byName(a, b);
                case 'type':
                    return (a.data.type ?? '').localeCompare(b.data.type ?? '') || byName(a, b);
                case 'source':
                    return a.source.label.localeCompare(b.source.label) || byName(a, b);
                default:
                    return byName(a, b);
            }
        });
    }

    private refreshList(): void {
        const existing = this.container?.querySelector('.dh-manage-entries');
        if (!existing) {
            this.refreshManager();
            return;
        }
        const replacement = createDiv({ cls: 'dh-manage-entries' });
        existing.replaceWith(replacement);
        this.renderList(replacement);
    }

    // --- List --------------------------------------------------------------

    private renderList(container: HTMLElement): void {
        const visible = this.visibleEntries();

        // Selections pointing at rows the filters now hide would still act on
        // confirm while being invisible, so they are dropped.
        const visibleKeys = new Set(visible.map(entryKey));
        for (const key of Array.from(this.selected)) {
            if (!visibleKeys.has(key)) this.selected.delete(key);
        }

        this.renderListHeader(container, visible);

        const listEl = container.createDiv({ cls: 'dh-manage-list' });
        if (!visible.length) {
            listEl.createEl('p', { text: 'No entries match these filters.', cls: 'dh-no-items-message' });
        } else {
            for (const entry of visible) this.renderRow(listEl, entry, container);
        }

        this.fillBulkBar(container.createDiv({ cls: 'dh-manage-bulk-bar' }), visible);
    }

    private renderListHeader(container: HTMLElement, visible: ManagedEntry[]): void {
        const header = container.createDiv({ cls: 'dh-manage-list-header' });

        const selectable = visible.length > 0;
        const allSelected = selectable && visible.every((entry) => this.selected.has(entryKey(entry)));
        const someSelected = visible.some((entry) => this.selected.has(entryKey(entry)));

        const checkbox = header.createEl('input', {
            type: 'checkbox',
            cls: 'dh-manage-select-checkbox',
        });
        checkbox.checked = allSelected;
        checkbox.indeterminate = someSelected && !allSelected;
        checkbox.disabled = !selectable;
        checkbox.setAttribute('aria-label', 'Select all shown entries');
        checkbox.addEventListener('change', () => {
            // Acts on the filtered set, so "select all" after a search means
            // the search results rather than the whole compendium.
            for (const entry of visible) {
                if (checkbox.checked) this.selected.add(entryKey(entry));
                else this.selected.delete(entryKey(entry));
            }
            this.refreshList();
        });

        header.createSpan({
            text: `${visible.length} ${visible.length === 1 ? 'entry' : 'entries'}`,
            cls: 'dh-manage-list-count',
        });
    }

    private renderRow(listEl: HTMLElement, entry: ManagedEntry, container: HTMLElement): void {
        const { data, source, isShadowed } = entry;
        const key = entryKey(entry);
        const rowEl = listEl.createDiv({ cls: 'dh-manage-list-item' });
        if (isShadowed) rowEl.addClass('dh-entry-shadowed');

        const checkbox = rowEl.createEl('input', {
            type: 'checkbox',
            cls: 'dh-manage-select-checkbox',
        });
        checkbox.checked = this.selected.has(key);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) this.selected.add(key);
            else this.selected.delete(key);
            this.refreshList();
        });

        const isExpanded = this.expanded.has(key);
        const disclosure = rowEl.createEl('button', {
            cls: 'dh-icon-button dh-manage-disclosure',
            attr: {
                'aria-label': isExpanded ? 'Hide statblock' : 'Show statblock',
                'aria-expanded': String(isExpanded),
            },
        });
        setIcon(disclosure, isExpanded ? 'chevron-down' : 'chevron-right');
        disclosure.addEventListener('click', () => {
            if (isExpanded) this.expanded.delete(key);
            else this.expanded.add(key);
            this.refreshList();
        });

        const nameContainer = rowEl.createDiv({ cls: 'dh-manage-item-name-container' });
        const icon = nameContainer.createSpan({ cls: 'dh-entry-icon' });
        setIcon(icon, data.category === 'environment' ? 'mountain' : 'skull');
        nameContainer.createSpan({ text: data.name, cls: 'dh-manage-item-name' });
        renderSourceBadge(nameContainer, source);

        const meta: string[] = [];
        if (data.tier !== undefined && data.tier !== '') meta.push(`T${data.tier}`);
        if (data.type) meta.push(data.type);
        if (meta.length) nameContainer.createSpan({ text: meta.join(' · '), cls: 'dh-manage-item-meta' });

        if (isShadowed) {
            const winner = this.plugin.compendium
                .getStatblocks()
                .find((item) => item.name.toLowerCase() === data.name.toLowerCase());
            const winnerLabel = this.plugin.getSource(winner?.sourceId)?.label ?? 'another source';
            nameContainer.title = `Hidden by the entry of the same name in ${winnerLabel}.`;
        }

        this.renderRowButtons(rowEl.createDiv({ cls: 'dh-manage-item-buttons' }), entry, container);

        if (isExpanded) {
            const preview = listEl.createDiv({ cls: 'dh-manage-preview' });
            renderStatblockCard(this.plugin, data, preview, false);
        }
    }

    private renderRowButtons(buttonsEl: HTMLElement, entry: ManagedEntry, _container: HTMLElement): void {
        const { data, source } = entry;
        const writable = isSourceWritable(source);
        const editsNote = source.kind === 'markdown' && this.plugin.statblockStore.canEditInPlace(data);
        const editable = isEntryEditable(this.plugin, entry);

        new ButtonComponent(buttonsEl)
            .setIcon('pencil')
            .setTooltip(
                editsNote
                    ? `Edit in ${data.sourceFile}`
                    : writable
                      ? 'Edit entry'
                      : 'Edit a copy (this source is read-only)',
            )
            .setClass('dh-icon-button')
            .onClick(() => {
                new EditAdversaryModal(this.app, this.plugin, toEditableInstance(data), () => this.refreshManager(), {
                    allowNoteEdits: true,
                }).open();
            });

        if (data.sourceFile) {
            new ButtonComponent(buttonsEl)
                .setIcon('file-text')
                .setTooltip(`Open ${data.sourceFile}`)
                .setClass('dh-icon-button')
                .onClick(() => {
                    this.closeManager();
                    void this.app.workspace.openLinkText(data.sourceFile!, '', false);
                });
        }

        new ButtonComponent(buttonsEl)
            .setIcon('copy')
            .setTooltip('Duplicate into a writable source')
            .setClass('dh-icon-button')
            .onClick(() => void this.duplicate(entry));

        const moveButton = new ButtonComponent(buttonsEl)
            .setIcon('arrow-right-left')
            .setTooltip(writable ? 'Move to another source' : 'Read-only sources cannot be moved from')
            .setClass('dh-icon-button')
            .onClick(() => this.promptMove([entry]));
        if (!writable) moveButton.setDisabled(true);

        // Licensed content gets no export affordance at all.
        if (isSourceExportable(source)) {
            new ButtonComponent(buttonsEl)
                .setIcon('upload')
                .setTooltip('Copy this entry as JSON')
                .setClass('dh-icon-button')
                .onClick(() => {
                    try {
                        void copyToClipboard(this.plugin.statblockStore.exportEntry(data));
                    } catch (error) {
                        new Notice(error instanceof Error ? error.message : 'Could not export this entry.');
                    }
                });
        }

        const deleteTooltip = editsNote
            ? `Remove this statblock from ${data.sourceFile}`
            : writable
              ? 'Delete entry'
              : 'Read-only: edit the source file directly';
        const deleteButton = makeConfirmableDelete(new ButtonComponent(buttonsEl), deleteTooltip, () =>
            this.deleteEntry(entry),
        );
        if (!editable) deleteButton.setDisabled(true);
    }

    // --- Mutations ---------------------------------------------------------

    private async deleteEntry(entry: ManagedEntry): Promise<void> {
        try {
            if (entry.source.kind === 'markdown') {
                await this.plugin.statblockStore.removeMarkdownEntry(entry.data);
                new Notice(`Removed "${entry.data.name}" from ${entry.data.sourceFile}.`);
            } else {
                await this.plugin.statblockStore.remove(entry.source.id, entry.data.name);
                new Notice(`Deleted "${entry.data.name}".`);
            }
        } catch (error) {
            console.error('Daggerheart | Could not delete entry:', error);
            new Notice(error instanceof Error ? error.message : 'Could not delete this entry.');
        }
        this.refreshManager();
    }

    private async duplicate(entry: ManagedEntry): Promise<void> {
        const target = isSourceWritable(entry.source) ? entry.source.id : this.plugin.getDefaultWriteSourceId();
        const existing = this.plugin.compendium.getEntriesForSource(target).map((item) => item.name);
        const name = uniqueCopyName(entry.data.name, existing);

        try {
            await this.plugin.statblockStore.upsert(target, { ...entry.data, name }, { silent: true });
            new Notice(`Created "${name}".`);
        } catch (error) {
            console.error('Daggerheart | Could not duplicate entry:', error);
            new Notice(error instanceof Error ? error.message : 'Could not duplicate this entry.');
        }
        this.refreshManager();
    }

    private promptMove(entries: ManagedEntry[]): void {
        const movable = entries.filter((entry) => isSourceWritable(entry.source));
        if (!movable.length) {
            new Notice('Read-only sources cannot be moved from.');
            return;
        }

        const originIds = new Set(movable.map((entry) => entry.source.id));
        const destinations = this.plugin
            .getWritableSources()
            .filter((source) => originIds.size > 1 || !originIds.has(source.id));
        if (!destinations.length) {
            new Notice('There is no other writable source to move into.');
            return;
        }

        new SourcePickerModal(this.app, destinations, async (destination) => {
            const bySource = new Map<string, string[]>();
            for (const entry of movable) {
                if (entry.source.id === destination.id) continue;
                const names = bySource.get(entry.source.id) ?? [];
                names.push(entry.data.name);
                bySource.set(entry.source.id, names);
            }

            try {
                for (const [fromSourceId, names] of bySource) {
                    await this.plugin.statblockStore.move(fromSourceId, destination.id, names);
                }
                this.selected.clear();
            } catch (error) {
                console.error('Daggerheart | Could not move entries:', error);
                new Notice(error instanceof Error ? error.message : 'Could not move these entries.');
            }
            this.refreshManager();
        }).open();
    }

    // --- Bulk actions ------------------------------------------------------

    private fillBulkBar(bar: HTMLElement, visible: ManagedEntry[]): void {
        const chosen = visible.filter((entry) => this.selected.has(entryKey(entry)));
        bar.createSpan({
            text: chosen.length ? `${chosen.length} selected` : 'Select entries for bulk actions',
            cls: 'dh-manage-bulk-label',
        });

        const moveButton = new ButtonComponent(bar).setButtonText('Move to…').onClick(() => this.promptMove(chosen));
        moveButton.setDisabled(!chosen.length);

        const exportable = chosen.filter((entry) => isSourceExportable(entry.source));
        const exportButton = new ButtonComponent(bar)
            .setButtonText('Export')
            .setTooltip(
                exportable.length < chosen.length
                    ? 'Personal content is excluded from the export'
                    : 'Copy the selected entries as JSON',
            )
            .onClick(() => {
                if (!exportable.length) {
                    new Notice('The selected entries are all personal content and cannot be exported.');
                    return;
                }
                void copyToClipboard(
                    JSON.stringify(
                        {
                            type: 'statblocks',
                            version: '1.2.0',
                            exportDate: new Date().toISOString(),
                            data: exportable.map((entry) => entry.data),
                        },
                        null,
                        2,
                    ),
                );
            });
        exportButton.setDisabled(!chosen.length);

        const deleteButton = new ButtonComponent(bar)
            .setButtonText(chosen.length ? `Delete ${chosen.length}` : 'Delete')
            .setWarning()
            .onClick(() => this.confirmBulkDelete(chosen));
        deleteButton.setDisabled(!chosen.length || !chosen.some((entry) => isEntryEditable(this.plugin, entry)));
    }

    private confirmBulkDelete(chosen: ManagedEntry[]): void {
        const deletable = chosen.filter((entry) => isEntryEditable(this.plugin, entry));
        if (!deletable.length) {
            new Notice('The selected entries all live in read-only sources.');
            return;
        }

        const skipped = chosen.length - deletable.length;
        const message =
            `Delete ${deletable.length} ${deletable.length === 1 ? 'entry' : 'entries'}?` +
            (skipped ? ` ${skipped} read-only ${skipped === 1 ? 'entry' : 'entries'} will be left alone.` : '') +
            ' This cannot be undone.';

        new ConfirmationModal(this.app, message, async () => {
            const bySource = new Map<string, string[]>();
            const noteEntries: StatblockData[] = [];
            for (const entry of deletable) {
                if (entry.source.kind === 'markdown') {
                    noteEntries.push(entry.data);
                    continue;
                }
                const names = bySource.get(entry.source.id) ?? [];
                names.push(entry.data.name);
                bySource.set(entry.source.id, names);
            }

            let removed = 0;
            try {
                for (const [sourceId, names] of bySource) {
                    removed += await this.plugin.statblockStore.removeMany(sourceId, names);
                }

                // Removing a block renumbers every later block in the same
                // note, so delete from the bottom up to keep indices valid.
                const ordered = [...noteEntries].sort(
                    (a, b) =>
                        (a.sourceFile ?? '').localeCompare(b.sourceFile ?? '') ||
                        (b.sourceBlockIndex ?? 0) - (a.sourceBlockIndex ?? 0),
                );
                for (const data of ordered) {
                    await this.plugin.statblockStore.removeMarkdownEntry(data);
                    removed += 1;
                }

                new Notice(`Deleted ${removed} ${removed === 1 ? 'entry' : 'entries'}.`);
            } catch (error) {
                console.error('Daggerheart | Bulk delete failed:', error);
                new Notice(error instanceof Error ? error.message : 'Could not delete these entries.');
            }
            this.selected.clear();
            this.refreshManager();
        }).open();
    }
}
