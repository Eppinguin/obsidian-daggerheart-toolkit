import { App, ButtonComponent, Notice, setIcon } from 'obsidian';
import type DaggerheartStatblockPlugin from '../../main';
import { ContentSource, isSourceExportable } from '../../services/content-source';
import { saveToFile } from '../../services/export-import';
import { ConfirmationModal } from '../ConfirmationModal';
import { AddSourceModal, MarkdownSourceModal, MergeSourceModal, SourceSettingsModal } from './SourceModals';
import { ImportSourceModal } from './ImportSourceModal';
import { describeSource, makeConfirmableDelete } from './shared';

/**
 * Add, configure, reorder, merge, and remove content sources.
 *
 * Order in this list is precedence: sources further down win when two define
 * the same statblock name, which the list states explicitly rather than leaving
 * the user to infer it.
 */
export class SourcesTab {
    constructor(
        private app: App,
        private plugin: DaggerheartStatblockPlugin,
        private closeManager: () => void,
        private refreshManager: () => void,
    ) {}

    render(parent: HTMLElement): void {
        const body = parent.createDiv({ cls: 'dh-manage-tab-body' });

        body.createEl('p', {
            cls: 'dh-manage-hint',
            text: 'Sources lower in this list take precedence: when two define the same name, the lower one is used.',
        });

        const sources = this.plugin.getContentSources();
        const listEl = body.createDiv({ cls: 'dh-manage-list dh-source-list' });
        sources.forEach((source, index) => this.renderRow(listEl, source, index, sources.length));

        const actions = body.createDiv({ cls: 'dh-manage-source-actions' });
        new ButtonComponent(actions)
            .setButtonText('Add JSON source')
            .setTooltip("Create an empty JSON file in the plugin's user_data folder")
            .setCta()
            .onClick(() => new AddSourceModal(this.app, this.plugin, () => this.refreshManager()).open());
        new ButtonComponent(actions)
            .setButtonText('Add Markdown folder')
            .setTooltip('Read statblocks from notes in a vault folder')
            .onClick(() => new MarkdownSourceModal(this.app, this.plugin, () => this.refreshManager()).open());
        new ButtonComponent(actions)
            .setButtonText('Import JSON…')
            .setTooltip('Import a statblock file as a new source or into an existing one')
            .onClick(() =>
                new ImportSourceModal(
                    this.app,
                    this.plugin,
                    () => this.refreshManager(),
                    () => this.closeManager(),
                ).open(),
            );
    }

    private renderRow(listEl: HTMLElement, source: ContentSource, index: number, total: number): void {
        const count = this.plugin.compendium.getEntriesForSource(source.id).length;
        const rowEl = listEl.createDiv({ cls: 'dh-manage-list-item dh-source-row' });
        if (!source.enabled) rowEl.addClass('is-disabled');

        // Precedence controls, reading top-to-bottom like the list itself.
        const orderEl = rowEl.createDiv({ cls: 'dh-source-order' });
        const upButton = new ButtonComponent(orderEl)
            .setIcon('chevron-up')
            .setTooltip('Lower precedence')
            .setClass('dh-icon-button')
            .onClick(() => void this.move(source.id, -1));
        if (index === 0) upButton.setDisabled(true);
        const downButton = new ButtonComponent(orderEl)
            .setIcon('chevron-down')
            .setTooltip('Higher precedence')
            .setClass('dh-icon-button')
            .onClick(() => void this.move(source.id, 1));
        if (index === total - 1) downButton.setDisabled(true);

        const nameContainer = rowEl.createDiv({ cls: 'dh-manage-item-name-container' });
        const icon = nameContainer.createSpan({ cls: 'dh-entry-icon' });
        setIcon(icon, source.kind === 'markdown' ? 'folder' : source.kind === 'builtin-srd' ? 'book' : 'file-json');
        nameContainer.createSpan({ text: source.label, cls: 'dh-manage-item-name' });
        if (source.doNotDistribute) {
            const lock = nameContainer.createSpan({ cls: 'dh-source-lock' });
            setIcon(lock, 'lock');
            lock.setAttribute('aria-label', 'Personal licensed content');
        }
        nameContainer.createSpan({
            text: describeSource(this.plugin, source),
            cls: 'dh-manage-item-meta',
        });

        const buttonsEl = rowEl.createDiv({ cls: 'dh-manage-item-buttons' });

        const toggle = rowEl.createEl('input', {
            type: 'checkbox',
            cls: 'dh-source-toggle',
            attr: { 'aria-label': source.enabled ? `Hide ${source.label}` : `Show ${source.label}` },
        });
        toggle.checked = source.enabled;
        toggle.addEventListener('change', async () => {
            await this.plugin.updateContentSource(source.id, { enabled: toggle.checked });
            this.refreshManager();
        });
        rowEl.insertBefore(toggle, nameContainer);

        // SRD sources have no editable settings beyond their toggle.
        if (source.kind !== 'builtin-srd') {
            new ButtonComponent(buttonsEl)
                .setIcon(source.kind === 'markdown' ? 'folder-pen' : 'settings')
                .setTooltip('Edit source')
                .setClass('dh-icon-button')
                .onClick(() => {
                    const done = () => this.refreshManager();
                    if (source.kind === 'markdown') {
                        new MarkdownSourceModal(this.app, this.plugin, done, source).open();
                    } else {
                        new SourceSettingsModal(this.app, this.plugin, source, done).open();
                    }
                });
        }

        if (count > 0) {
            new ButtonComponent(buttonsEl)
                .setIcon('merge')
                .setTooltip('Merge into another source')
                .setClass('dh-icon-button')
                .onClick(() => new MergeSourceModal(this.app, this.plugin, source, () => this.refreshManager()).open());
        }

        if (isSourceExportable(source) && count > 0) {
            new ButtonComponent(buttonsEl)
                .setIcon('upload')
                .setTooltip('Export this source as a backup')
                .setClass('dh-icon-button')
                .onClick(() => void this.exportSource(source));
        }

        if (source.removable) {
            makeConfirmableDelete(
                new ButtonComponent(buttonsEl),
                source.kind === 'markdown'
                    ? 'Stop reading this folder (the notes are left alone)'
                    : 'Delete this source and its file',
                () => this.confirmDelete(source, count),
            );
        }
    }

    private async move(sourceId: string, delta: number): Promise<void> {
        if (await this.plugin.moveContentSource(sourceId, delta)) this.refreshManager();
    }

    private async exportSource(source: ContentSource): Promise<void> {
        try {
            const json = await this.plugin.statblockStore.exportSource(source.id);
            await saveToFile(`${source.path.replace(/\.json$/i, '') || source.id}-backup.json`, json);
        } catch (error) {
            console.error('Daggerheart | Export failed:', error);
            new Notice(error instanceof Error ? error.message : 'Could not export this source.');
        }
    }

    private confirmDelete(source: ContentSource, count: number): void {
        // Removing a Markdown source only stops the plugin reading the folder;
        // the notes belong to the vault and are never touched.
        const message =
            source.kind === 'markdown'
                ? `Stop reading statblocks from "${source.path}"? The notes in that folder are left untouched.`
                : count > 0
                  ? `Delete "${source.label}" and its ${count} ${count === 1 ? 'entry' : 'entries'}? The file is removed from disk. This cannot be undone.`
                  : `Delete "${source.label}"? This cannot be undone.`;

        new ConfirmationModal(this.app, message, async () => {
            try {
                await this.plugin.statblockStore.deleteSource(source.id);
                new Notice(`Removed "${source.label}".`);
            } catch (error) {
                console.error('Daggerheart | Could not delete source:', error);
                new Notice(error instanceof Error ? error.message : 'Could not delete this source.');
            }
            this.refreshManager();
        }).open();
    }
}
