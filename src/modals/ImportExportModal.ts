import {
    App,
    Modal,
    Setting,
    Notice,
    TextAreaComponent,
    ButtonComponent,
    TextComponent,
    DropdownComponent,
} from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import {
    ContentType,
    exportToJsonString,
    copyToClipboard,
    saveToFile,
    importFromJsonString,
    fetchJsonFromUrl,
} from '../services/export-import';
import { isValidEncounterData } from '../services/content-validators';
import { isSourceExportable } from '../services/content-source';
import { v4 as uuidv4 } from 'uuid';
import { SavedEncounter } from '../types';
import { StatblockImportPreviewModal } from './StatblockImportPreviewModal';

export interface ContentTypeInfo {
    type: ContentType;
    displayName: string;
    description: string;
    icon: string;
    collection: string;
}

export const CONTENT_TYPE_INFO: Record<ContentType, ContentTypeInfo> = {
    [ContentType.ENCOUNTER]: {
        type: ContentType.ENCOUNTER,
        displayName: 'Encounter',
        description: 'Export or import saved encounters',
        icon: 'swords',
        collection: 'encounters',
    },
    [ContentType.ADVERSARY]: {
        type: ContentType.ADVERSARY,
        displayName: 'Adversary',
        description: 'Export or import adversary statblocks',
        icon: 'skull',
        collection: 'statblocks',
    },
    [ContentType.ENVIRONMENT]: {
        type: ContentType.ENVIRONMENT,
        displayName: 'Environment',
        description: 'Export or import environment statblocks',
        icon: 'mountain-snow',
        collection: 'statblocks',
    },
};

export class ImportExportModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private mode: 'import' | 'export';
    private contentType: ContentType;
    private contentTypeInfo: ContentTypeInfo;
    private contentId: string | null;
    private textAreaComponent: TextAreaComponent | null = null;
    private fileInputEl: HTMLInputElement | null = null;
    private urlInputComponent: TextComponent | null = null;
    private importButtonEl: HTMLButtonElement | null = null;
    private exportJsonStr = '';
    private contentSelection: DropdownComponent | null = null;
    private selectedContentId: string | null = null;

    constructor(
        app: App,
        plugin: DaggerheartStatblockPlugin,
        mode: 'import' | 'export' = 'import',
        contentType: ContentType = ContentType.ENCOUNTER,
        contentId: string | null = null,
    ) {
        super(app);
        this.plugin = plugin;
        this.mode = mode;
        this.contentType = contentType;
        this.contentTypeInfo = CONTENT_TYPE_INFO[contentType];
        this.contentId = contentId;
        this.modalEl.addClass('dh-import-export-modal', `dh-${mode}-modal`);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', {
            text: `${this.mode === 'import' ? 'Import' : 'Export'} ${this.contentTypeInfo.displayName}`,
        });
        this.renderContentTypeSelector(contentEl);
        if (this.mode === 'import') this.renderImportUI(contentEl);
        else this.renderExportUI(contentEl);
        const footer = contentEl.createDiv('modal-footer');
        new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
    }

    private renderContentTypeSelector(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl)
            .setName('Content Type')
            .setDesc('Select what type of content to import or export');
        const dropdown = new DropdownComponent(setting.controlEl);
        Object.values(ContentType).forEach((type) => dropdown.addOption(type, CONTENT_TYPE_INFO[type].displayName));
        dropdown.setValue(this.contentType);
        dropdown.onChange((value) => {
            this.contentType = value as ContentType;
            this.contentTypeInfo = CONTENT_TYPE_INFO[this.contentType];
            this.onOpen();
        });
        if (this.mode === 'export' && this.contentType !== ContentType.ENCOUNTER) {
            contentEl.createEl('p', {
                text: 'Only custom entries are available for export.',
                cls: 'dh-info-message',
            });
        }
    }

    private renderImportUI(contentEl: HTMLElement): void {
        contentEl.createEl('p', {
            text: 'Import one item or a complete JSON batch. Statblocks are reviewed before anything is saved.',
        });
        new Setting(contentEl)
            .setName('Upload JSON File')
            .setDesc('Select a JSON file')
            .then((setting) => {
                this.fileInputEl = document.createElement('input');
                this.fileInputEl.type = 'file';
                this.fileInputEl.accept = '.json';
                this.fileInputEl.style.display = 'none';
                setting.controlEl.appendChild(this.fileInputEl);
                const upload = document.createElement('button');
                upload.textContent = 'Choose File';
                upload.className = 'mod-cta';
                setting.controlEl.appendChild(upload);
                upload.addEventListener('click', () => this.fileInputEl?.click());
                this.fileInputEl.addEventListener('change', () => {
                    const file = this.fileInputEl?.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (typeof event.target?.result === 'string')
                            this.textAreaComponent?.setValue(event.target.result);
                    };
                    reader.readAsText(file);
                });
            });

        new Setting(contentEl)
            .setName('Import from URL')
            .setDesc('Pastebin, GitHub raw files, and other JSON URLs')
            .then((setting) => {
                const container = setting.controlEl.createDiv({ cls: 'url-input-container' });
                this.urlInputComponent = new TextComponent(container).setPlaceholder('https://…');
                new ButtonComponent(container)
                    .setButtonText('Fetch')
                    .setCta()
                    .onClick(async () => {
                        const url = this.urlInputComponent?.getValue().trim();
                        if (!url) return void new Notice('Please enter a URL.');
                        try {
                            this.setLoading(true);
                            this.textAreaComponent?.setValue(await fetchJsonFromUrl(url));
                            new Notice('JSON fetched successfully.');
                        } catch (error) {
                            new Notice(
                                `Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`,
                            );
                        } finally {
                            this.setLoading(false);
                        }
                    });
            });

        new Setting(contentEl)
            .setName('Paste JSON')
            .setDesc('Paste a toolkit export, raw object, or array')
            .then((setting) => {
                this.textAreaComponent = new TextAreaComponent(setting.controlEl).setPlaceholder('Paste JSON here…');
                this.textAreaComponent.inputEl.style.width = '100%';
                this.textAreaComponent.inputEl.style.minHeight = '200px';
            });
        new Setting(contentEl).addButton((button) => {
            this.importButtonEl = button
                .setButtonText(`Review ${this.contentTypeInfo.displayName} Import`)
                .setCta()
                .onClick(() => this.importContent()).buttonEl;
            return button;
        });
    }

    private renderExportUI(contentEl: HTMLElement): void {
        contentEl.createEl('p', {
            text: `Choose ${this.contentTypeInfo.displayName.toLowerCase()} to export.`,
        });
        if (!this.contentId) this.renderContentSelectionDropdown(contentEl);
        const effectiveId = this.contentId || this.selectedContentId;
        if (!effectiveId)
            return void contentEl.createEl('p', {
                text: `Please select a ${this.contentTypeInfo.displayName.toLowerCase()} to export.`,
                cls: 'dh-empty-message',
            });
        const data = this.prepareExportData(effectiveId);
        if (!data) return;
        new Setting(contentEl)
            .setName('Copy to Clipboard')
            .addButton((button) =>
                button.setButtonText('Copy JSON').onClick(() => copyToClipboard(this.exportJsonStr)),
            );
        new Setting(contentEl).setName('Save to File').addButton((button) =>
            button.setButtonText('Download JSON').onClick(() => {
                const safeName = String((data as any).name || 'export')
                    .replace(/[^a-z0-9]/gi, '_')
                    .toLowerCase();
                return saveToFile(`daggerheart_${this.contentType}_${safeName}.json`, this.exportJsonStr);
            }),
        );
        this.updateExportPreview(contentEl);
    }

    private renderContentSelectionDropdown(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl).setName(`Select ${this.contentTypeInfo.displayName}`);
        this.contentSelection = new DropdownComponent(setting.controlEl).addOption(
            '',
            `Select ${this.contentTypeInfo.displayName}…`,
        );
        const collectionName = this.contentTypeInfo.collection;
        let items: { id: string; name: string }[] = [];
        if (collectionName === 'encounters') items = this.plugin.getSavedEncounters();
        else if ((this.plugin.compendium as any)[collectionName]) {
            // Entries belonging to personal licensed sources are never offered
            // for export, no matter how the modal was opened.
            items = (this.plugin.compendium as any)[collectionName]
                .filter((item: any) => item.isCustom && isSourceExportable(this.plugin.getSource(item.sourceId)))
                .map((item: any) => ({ id: item.name, name: item.name }));
        }
        items.forEach((item) => this.contentSelection?.addOption(item.id, item.name));
        if (items.length) {
            this.selectedContentId = items[0].id;
            this.contentSelection.setValue(items[0].id);
        } else contentEl.createEl('p', { text: 'No custom items found.', cls: 'dh-empty-message' });
        this.contentSelection.onChange((value) => {
            if (!value) return;
            this.selectedContentId = value;
            this.onOpen();
        });
    }

    private prepareExportData(contentId: string): any {
        const collectionName = this.contentTypeInfo.collection;
        let data: any = null;
        if (collectionName === 'encounters') data = this.plugin.getSavedEncounter(contentId);
        else data = (this.plugin.compendium as any)[collectionName]?.find((item: any) => item.name === contentId);

        // Second guard: the dropdown already hides personal content, but this
        // path can also be reached with an id supplied by the caller.
        if (data && collectionName !== 'encounters' && !isSourceExportable(this.plugin.getSource(data.sourceId))) {
            new Notice(`"${data.name}" is personal content and cannot be exported.`);
            return null;
        }

        if (data) this.exportJsonStr = exportToJsonString(this.contentType, data);
        return data;
    }

    private async importContent(): Promise<void> {
        const json = this.textAreaComponent?.getValue().trim();
        if (!json) return void new Notice('Please enter JSON data to import.');
        try {
            this.setLoading(true);
            const entries = importFromJsonString(json);
            if (!entries?.length) return;
            const matching = entries.filter((entry) => entry.type === this.contentType);
            if (!matching.length) {
                new Notice(`No ${this.contentTypeInfo.displayName.toLowerCase()} items were found in the payload.`);
                return;
            }

            if (this.contentType === ContentType.ADVERSARY || this.contentType === ContentType.ENVIRONMENT) {
                new StatblockImportPreviewModal(this.app, this.plugin, matching, 'Import Daggerheart Content').open();
                this.close();
                return;
            }

            await this.importEncounter(matching[0].data as unknown as SavedEncounter);
            if (matching.length > 1 && this.contentType === ContentType.ENCOUNTER)
                new Notice('Only the first encounter was imported.');
            this.close();
        } catch (error) {
            console.error(`Error importing ${this.contentTypeInfo.displayName}:`, error);
            new Notice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.setLoading(false);
        }
    }

    private async importEncounter(data: SavedEncounter): Promise<void> {
        if (!isValidEncounterData(data)) return void new Notice('Invalid encounter data.');
        if (this.plugin.getSavedEncounters().some((item) => item.name.toLowerCase() === data.name.toLowerCase()))
            data.name += ' (Imported)';
        data.id = uuidv4();
        await this.plugin.updateSavedEncounter(data);
        new Notice(`Encounter "${data.name}" imported.`);
    }

    private setLoading(loading: boolean): void {
        if (!this.importButtonEl) return;
        this.importButtonEl.disabled = loading;
        this.importButtonEl.textContent = loading ? 'Reading…' : `Review ${this.contentTypeInfo.displayName} Import`;
    }

    private updateExportPreview(contentEl: HTMLElement): void {
        const section = contentEl.createDiv('dh-preview-section');
        section.createEl('h3', { text: 'Preview' });
        section.createEl('pre', { cls: 'dh-export-preview' }).createEl('code', { text: this.exportJsonStr });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
