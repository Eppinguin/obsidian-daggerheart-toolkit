import { App, ButtonComponent, Modal, Notice, Setting, TFolder } from 'obsidian';
import type DaggerheartStatblockPlugin from '../../main';
import {
    ContentSource,
    createMarkdownSource,
    createUserJsonSource,
    isSourceWritable,
    normalizeFolderPath,
} from '../../services/content-source';
import type { MergeConflictStrategy } from '../../services/statblock-store';

/** Create a new user_data JSON source, optionally marked as personal content. */
export class AddSourceModal extends Modal {
    private label = '';
    private doNotDistribute = false;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private onCreated: () => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add content source' });

        new Setting(contentEl)
            .setName('Name')
            .setDesc('Shown on entries from this source, e.g. "Hope & Fear".')
            .addText((text) =>
                text.setPlaceholder('Hope & Fear').onChange((value) => {
                    this.label = value;
                }),
            );

        new Setting(contentEl)
            .setName('Personal licensed content')
            .setDesc(
                'Excludes this source from every export and sharing option. Use for content you own but may not redistribute.',
            )
            .addToggle((toggle) =>
                toggle.setValue(this.doNotDistribute).onChange((value) => {
                    this.doNotDistribute = value;
                }),
            );

        contentEl.createEl('p', {
            cls: 'dh-modal-notice',
            text:
                "Files live in the plugin's user_data folder, which is excluded from git. " +
                'It is also cleared when the plugin is reinstalled, so export a backup before reinstalling.',
        });

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
                const label = this.label.trim();
                if (!label) {
                    new Notice('Give the source a name.');
                    return;
                }
                const source = createUserJsonSource(label, this.plugin.getContentSources(), {
                    doNotDistribute: this.doNotDistribute,
                });
                await this.plugin.addContentSource(source);
                new Notice(`Added source "${source.label}".`);
                this.close();
                this.onCreated();
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** Rename a JSON source and change whether it holds personal content. */
export class SourceSettingsModal extends Modal {
    private label: string;
    private doNotDistribute: boolean;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private source: ContentSource,
        private onDone: () => void,
    ) {
        super(app);
        this.label = source.label;
        this.doNotDistribute = source.doNotDistribute === true;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Edit ${this.source.label}` });

        new Setting(contentEl).setName('Name').addText((text) =>
            text.setValue(this.label).onChange((value) => {
                this.label = value;
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

        // The file name is fixed at creation: renaming it would orphan the data
        // already written there, which is not worth the risk for a cosmetic id.
        new Setting(contentEl).setName('File').setDesc(`user_data/${this.source.path}`).setDisabled(true);

        if (!this.doNotDistribute && this.source.doNotDistribute) {
            contentEl.createEl('p', {
                cls: 'dh-modal-notice',
                text: 'Turning this off will make these entries available to export and share again.',
            });
        }

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Save')
            .setCta()
            .onClick(async () => {
                const label = this.label.trim();
                if (!label) {
                    new Notice('Give the source a name.');
                    return;
                }
                await this.plugin.updateContentSource(this.source.id, {
                    label,
                    doNotDistribute: this.doNotDistribute,
                });
                new Notice(`Updated "${label}".`);
                this.close();
                this.onDone();
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Add or edit a Markdown folder source.
 *
 * Folders live in the vault, so this captures a path and a display name and
 * nothing else.
 */
export class MarkdownSourceModal extends Modal {
    private path: string;
    private label: string;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private onDone: () => void,
        private existing?: ContentSource,
    ) {
        super(app);
        this.path = existing?.path ?? '';
        this.label = existing?.label ?? '';
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', {
            text: this.existing ? 'Edit Markdown folder' : 'Add Markdown folder',
        });

        // Suggesting real folders avoids the most common failure here, which is
        // a path that simply does not resolve and silently yields no entries.
        const folders = this.app.vault
            .getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && !!file.path && file.path !== '/')
            .map((folder) => folder.path)
            .sort((a, b) => a.localeCompare(b));
        const datalistId = 'dh-folder-options';

        new Setting(contentEl)
            .setName('Folder')
            .setDesc('Vault-relative path, e.g. "Daggerheart/Homebrew". Nested folders are included.')
            .addText((text) => {
                text.setPlaceholder('Daggerheart/Homebrew')
                    .setValue(this.path)
                    .onChange((value) => {
                        this.path = value;
                    });
                text.inputEl.setAttribute('list', datalistId);
            });

        const datalist = contentEl.createEl('datalist');
        datalist.id = datalistId;
        for (const folder of folders) datalist.createEl('option', { value: folder });

        new Setting(contentEl)
            .setName('Name')
            .setDesc('Shown on entries from this folder. Defaults to the folder name.')
            .addText((text) =>
                text
                    .setPlaceholder('Homebrew')
                    .setValue(this.label)
                    .onChange((value) => {
                        this.label = value;
                    }),
            );

        contentEl.createEl('p', {
            cls: 'dh-modal-notice',
            text:
                'Statblocks are read from fenced daggerheart-statblock blocks in these notes, ' +
                'and edits are written back into the same block.',
        });

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText(this.existing ? 'Save' : 'Add folder')
            .setCta()
            .onClick(() => void this.submit(folders));
    }

    private async submit(knownFolders: string[]): Promise<void> {
        const path = normalizeFolderPath(this.path);
        if (!path) {
            new Notice('Enter a folder path.');
            return;
        }
        if (!knownFolders.includes(path)) {
            new Notice(`No folder named "${path}" exists in this vault.`);
            return;
        }

        const clash = this.plugin
            .getContentSources()
            .find(
                (source) =>
                    source.kind === 'markdown' &&
                    source.id !== this.existing?.id &&
                    normalizeFolderPath(source.path) === path,
            );
        if (clash) {
            new Notice(`"${clash.label}" already reads that folder.`);
            return;
        }

        const label = this.label.trim() || path.split('/').pop() || path;
        if (this.existing) {
            await this.plugin.updateContentSource(this.existing.id, { path, label, enabled: true });
            new Notice(`Updated "${label}".`);
        } else {
            const source = createMarkdownSource(path, this.plugin.getContentSources(), label);
            await this.plugin.addContentSource(source);
            new Notice(`Now reading statblocks from "${path}".`);
        }
        this.close();
        this.onDone();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** Move every entry from one source into another, then optionally remove it. */
export class MergeSourceModal extends Modal {
    private targetId = '';
    private strategy: MergeConflictStrategy = 'rename';
    private deleteAfter: boolean;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private source: ContentSource,
        private onDone: () => void,
    ) {
        super(app);
        this.deleteAfter = source.removable;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Merge ${this.source.label}` });

        const count = this.plugin.compendium.getEntriesForSource(this.source.id).length;
        const destinations = this.plugin.getWritableSources().filter((source) => source.id !== this.source.id);
        if (!destinations.length) {
            contentEl.createEl('p', { text: 'There is no other writable source to merge into.' });
            const only = contentEl.createDiv({ cls: 'dh-modal-buttons' });
            new ButtonComponent(only).setButtonText('Close').onClick(() => this.close());
            return;
        }
        this.targetId = destinations[0].id;

        contentEl.createEl('p', {
            text: `Moves ${count} ${count === 1 ? 'entry' : 'entries'} out of "${this.source.label}".`,
        });

        new Setting(contentEl).setName('Merge into').addDropdown((dropdown) => {
            for (const destination of destinations) dropdown.addOption(destination.id, destination.label);
            dropdown.setValue(this.targetId);
            dropdown.onChange((value) => {
                this.targetId = value;
                this.renderWarning();
            });
        });

        new Setting(contentEl).setName('If a name already exists').addDropdown((dropdown) => {
            dropdown.addOption('rename', 'Keep both, rename the incoming one');
            dropdown.addOption('replace', 'Replace the existing entry');
            dropdown.addOption('skip', 'Keep the existing entry');
            dropdown.setValue(this.strategy);
            dropdown.onChange((value) => {
                this.strategy = value as MergeConflictStrategy;
            });
        });

        // A read-only origin is copied from rather than emptied, so offering to
        // delete it afterwards would be misleading.
        if (isSourceWritable(this.source) && this.source.removable) {
            new Setting(contentEl).setName('Remove the empty source afterwards').addToggle((toggle) =>
                toggle.setValue(this.deleteAfter).onChange((value) => {
                    this.deleteAfter = value;
                }),
            );
        } else {
            this.deleteAfter = false;
        }

        contentEl.createDiv({ cls: 'dh-merge-warning' });
        this.renderWarning();

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Merge')
            .setCta()
            .onClick(() => void this.submit());
    }

    /** Warn before personal content is moved somewhere it could be exported. */
    private renderWarning(): void {
        const holder = this.contentEl.querySelector('.dh-merge-warning');
        if (!(holder instanceof HTMLElement)) return;
        holder.empty();

        const target = this.plugin.getSource(this.targetId);
        if (this.source.doNotDistribute && target && !target.doNotDistribute) {
            holder.createEl('p', {
                cls: 'dh-modal-notice dh-modal-notice-warning',
                text:
                    `"${this.source.label}" is personal content but "${target.label}" is not. ` +
                    'After merging, these entries can be exported and shared.',
            });
        }
    }

    private async submit(): Promise<void> {
        try {
            const result = await this.plugin.statblockStore.mergeSource(this.source.id, this.targetId, this.strategy);

            if (this.deleteAfter) {
                const left = await this.plugin.statblockStore.readSource(this.source.id);
                if (!left.length) await this.plugin.statblockStore.deleteSource(this.source.id);
            }

            const parts = [`${result.moved} moved`];
            if (result.renamed) parts.push(`${result.renamed} renamed`);
            if (result.replaced) parts.push(`${result.replaced} replaced`);
            if (result.skipped) parts.push(`${result.skipped} skipped`);
            new Notice(`Merged into ${this.plugin.getSource(this.targetId)?.label}: ${parts.join(', ')}.`);
            this.close();
            this.onDone();
        } catch (error) {
            console.error('Daggerheart | Merge failed:', error);
            new Notice(error instanceof Error ? error.message : 'Could not merge these sources.');
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
