import { App, ButtonComponent, Modal, Notice, Setting, TextAreaComponent } from 'obsidian';
import type DaggerheartStatblockPlugin from '../../main';
import type { AllCompendiumData } from '../../types';
import { ContentType, parseImportJson } from '../../services/export-import';
import { createUserJsonSource } from '../../services/content-source';
import { StatblockImportPreviewModal } from '../StatblockImportPreviewModal';

/**
 * Import a statblock JSON file, either into an existing source or into a new
 * one created from the file.
 *
 * Parsing and conflict review are delegated to the normal import pipeline, so
 * this only chooses the destination and hands over.
 */
export class ImportSourceModal extends Modal {
    private json = '';
    private fileName = '';
    private mode: 'new' | 'existing' = 'new';
    private newLabel = '';
    private doNotDistribute = false;
    private targetSourceId: string;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        /** Called once entries have actually been saved. */
        private onImported: () => void,
        /** Closes the manager, since the review screen replaces it. */
        private closeManager: () => void,
    ) {
        super(app);
        this.targetSourceId = plugin.getDefaultWriteSourceId();
    }

    onOpen(): void {
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Import statblock JSON' });

        new Setting(contentEl)
            .setName('JSON file')
            .setDesc(this.fileName || 'Choose a file, or paste its contents below.')
            .then((setting) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.style.display = 'none';
                setting.controlEl.appendChild(input);

                new ButtonComponent(setting.controlEl).setButtonText('Choose file').onClick(() => input.click());

                input.addEventListener('change', () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (typeof event.target?.result !== 'string') return;
                        this.json = event.target.result;
                        this.fileName = file.name;
                        // A file name is the most useful default source label.
                        if (!this.newLabel) {
                            this.newLabel = file.name
                                .replace(/\.json$/i, '')
                                .replace(/[-_]+/g, ' ')
                                .trim();
                        }
                        this.render();
                    };
                    reader.readAsText(file);
                });
            });

        new Setting(contentEl).setName('Or paste JSON').then((setting) => {
            const area = new TextAreaComponent(setting.controlEl)
                .setPlaceholder('{ "type": "statblocks", ... }')
                .setValue(this.json)
                .onChange((value) => {
                    this.json = value;
                });
            area.inputEl.rows = 4;
            area.inputEl.addClass('dh-import-source-textarea');
        });

        new Setting(contentEl).setName('Destination').addDropdown((dropdown) => {
            dropdown.addOption('new', 'Create a new source');
            dropdown.addOption('existing', 'Add to an existing source');
            dropdown.setValue(this.mode);
            dropdown.onChange((value) => {
                this.mode = value as 'new' | 'existing';
                this.render();
            });
        });

        if (this.mode === 'new') {
            new Setting(contentEl).setName('New source name').addText((text) =>
                text
                    .setPlaceholder('Hope & Fear')
                    .setValue(this.newLabel)
                    .onChange((value) => {
                        this.newLabel = value;
                    }),
            );

            new Setting(contentEl)
                .setName('Personal licensed content')
                .setDesc('Excludes this source from every export and sharing option.')
                .addToggle((toggle) =>
                    toggle.setValue(this.doNotDistribute).onChange((value) => {
                        this.doNotDistribute = value;
                    }),
                );
        } else {
            new Setting(contentEl).setName('Add to').addDropdown((dropdown) => {
                for (const source of this.plugin.getWritableSources()) {
                    dropdown.addOption(source.id, source.label);
                }
                dropdown.setValue(this.targetSourceId);
                dropdown.onChange((value) => {
                    this.targetSourceId = value;
                });
            });
        }

        contentEl.createEl('p', {
            cls: 'dh-modal-notice',
            text: 'Nothing is saved until you confirm on the next screen, where conflicts can be reviewed.',
        });

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Review import')
            .setCta()
            .onClick(() => void this.submit());
    }

    private async submit(): Promise<void> {
        const json = this.json.trim();
        if (!json) {
            new Notice('Choose a file or paste some JSON first.');
            return;
        }

        let entries;
        try {
            entries = parseImportJson<AllCompendiumData>(json);
        } catch {
            new Notice('That file is not valid JSON.');
            return;
        }

        const statblocks = entries.filter(
            (entry) => entry.type === ContentType.ADVERSARY || entry.type === ContentType.ENVIRONMENT,
        );
        if (!statblocks.length) {
            new Notice('No statblocks were found in that file.');
            return;
        }

        let destinationId = this.targetSourceId;
        let pendingSource = null;
        if (this.mode === 'new') {
            const label = this.newLabel.trim();
            if (!label) {
                new Notice('Give the new source a name.');
                return;
            }
            // Built now so the review screen can name the destination, but only
            // registered if the import is actually confirmed — cancelling must
            // not leave an empty source behind.
            pendingSource = createUserJsonSource(label, this.plugin.getContentSources(), {
                doNotDistribute: this.doNotDistribute,
            });
            destinationId = pendingSource.id;
        }

        this.close();
        this.closeManager();
        // The review screen owns the outcome, so the manager is only told to
        // refresh once entries have actually been saved.
        new StatblockImportPreviewModal(this.app, this.plugin, statblocks, this.fileName || 'JSON', {
            targetSourceId: destinationId,
            pendingSource,
            onImported: () => this.onImported(),
        }).open();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
