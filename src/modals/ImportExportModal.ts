// src/modals/ImportExportModal.ts
import { App, Modal, Setting, Notice, TextAreaComponent, ButtonComponent, TextComponent, DropdownComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { ContentType, exportToJsonString, copyToClipboard, saveToFile, importFromJsonString, fetchJsonFromUrl } from '../services/export-import';
import { isValidCharacterData, isValidContentData, isValidEncounterData } from '../services/content-validators';
import { v4 as uuidv4 } from 'uuid';
import { Character, SavedEncounter, AllCompendiumData } from '../types';

/**
 * Content type metadata, defined locally for the modal's UI needs.
 */
export interface ContentTypeInfo {
    type: ContentType;
    displayName: string;
    description: string;
    icon: string;
    collection: string;
}

/**
 * Content type info lookup, defined locally for the modal's UI needs.
 */
export const CONTENT_TYPE_INFO: Record<ContentType, ContentTypeInfo> = {
    [ContentType.CHARACTER]: { type: ContentType.CHARACTER, displayName: 'Character', description: 'Export or import character sheets', icon: 'user', collection: 'characters' },
    [ContentType.ENCOUNTER]: { type: ContentType.ENCOUNTER, displayName: 'Encounter', description: 'Export or import saved encounters', icon: 'swords', collection: 'encounters' },
    [ContentType.ADVERSARY]: { type: ContentType.ADVERSARY, displayName: 'Adversary', description: 'Export or import adversary statblocks', icon: 'skull', collection: 'statblocks' },
    [ContentType.ENVIRONMENT]: { type: ContentType.ENVIRONMENT, displayName: 'Environment', description: 'Export or import environment statblocks', icon: 'mountain-snow', collection: 'statblocks' },
    [ContentType.ABILITY]: { type: ContentType.ABILITY, displayName: 'Ability', description: 'Export or import abilities', icon: 'zap', collection: 'abilities' },
    [ContentType.CLASS]: { type: ContentType.CLASS, displayName: 'Class', description: 'Export or import classes', icon: 'shield', collection: 'classes' },
    [ContentType.SUBCLASS]: { type: ContentType.SUBCLASS, displayName: 'Subclass', description: 'Export or import subclasses', icon: 'shield-half', collection: 'subclasses' },
    [ContentType.ANCESTRY]: { type: ContentType.ANCESTRY, displayName: 'Ancestry', description: 'Export or import ancestries', icon: 'dna', collection: 'ancestries' },
    [ContentType.COMMUNITY]: { type: ContentType.COMMUNITY, displayName: 'Community', description: 'Export or import communities', icon: 'home', collection: 'communities' },
    [ContentType.ARMOR]: { type: ContentType.ARMOR, displayName: 'Armor', description: 'Export or import armor', icon: 'shield', collection: 'armors' },
    [ContentType.WEAPON]: { type: ContentType.WEAPON, displayName: 'Weapon', description: 'Export or import weapons', icon: 'sword', collection: 'weapons' },
    [ContentType.ITEM]: { type: ContentType.ITEM, displayName: 'Item', description: 'Export or import items', icon: 'backpack', collection: 'items' },
    [ContentType.CONSUMABLE]: { type: ContentType.CONSUMABLE, displayName: 'Consumable', description: 'Export or import consumables', icon: 'potion', collection: 'consumables' }
};

/**
 * Modal for unified import/export of all content types
 */
export class ImportExportModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private mode: 'import' | 'export';
    private contentType: ContentType;
    private contentTypeInfo: ContentTypeInfo;
    private contentId: string | null = null;

    // Import-specific properties
    private textAreaComponent: TextAreaComponent | null = null;
    private fileInputEl: HTMLInputElement | null = null;
    private urlInputComponent: TextComponent | null = null;
    private importButtonEl: HTMLButtonElement | null = null;

    // Export-specific properties
    private exportJsonStr: string = '';
    private contentSelection: DropdownComponent | null = null;
    private selectedContentId: string | null = null;

    // Shared state
    private isLoading: boolean = false;

    constructor(
        app: App,
        plugin: DaggerheartStatblockPlugin,
        mode: 'import' | 'export' = 'import',
        contentType: ContentType = ContentType.CHARACTER,
        contentId: string | null = null
    ) {
        super(app);
        this.plugin = plugin;
        this.mode = mode;
        this.contentType = contentType;
        this.contentTypeInfo = CONTENT_TYPE_INFO[contentType];
        this.contentId = contentId;
        this.modalEl.addClass('dh-import-export-modal');
        this.modalEl.addClass(`dh-${mode}-modal`);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const title = this.mode === 'import'
            ? `Import ${this.contentTypeInfo.displayName}`
            : `Export ${this.contentTypeInfo.displayName}`;

        contentEl.createEl('h2', { text: title });

        this.renderContentTypeSelector(contentEl);

        if (this.mode === 'import') {
            this.renderImportUI(contentEl);
        } else {
            this.renderExportUI(contentEl);
        }

        const footerEl = contentEl.createDiv('modal-footer');
        new ButtonComponent(footerEl)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }

    /**
     * Render the content type selector dropdown
     */
    private renderContentTypeSelector(contentEl: HTMLElement) {
        const contentTypeSection = new Setting(contentEl)
            .setName('Content Type')
            .setDesc('Select what type of content to import or export');

        const dropdown = new DropdownComponent(contentTypeSection.controlEl);

        Object.values(ContentType).forEach(type => {
            const info = CONTENT_TYPE_INFO[type];
            dropdown.addOption(type, info.displayName);
        });

        dropdown.setValue(this.contentType);
        dropdown.onChange(value => {
            this.contentType = value as ContentType;
            this.contentTypeInfo = CONTENT_TYPE_INFO[this.contentType];

            this.onOpen();
        });

        if (this.mode === 'export' &&
            this.contentType !== ContentType.CHARACTER &&
            this.contentType !== ContentType.ENCOUNTER) {
            contentEl.createEl('p', {
                text: 'Note: Only custom entries (items you created) are available for export.',
                cls: 'dh-info-message'
            });
        }
    }

    /**
     * Render the import UI
     */
    private renderImportUI(contentEl: HTMLElement) {
        contentEl.createEl('p', {
            text: `Import a ${this.contentTypeInfo.displayName.toLowerCase()} from a JSON file, URL, or paste JSON directly.`
        });

        new Setting(contentEl)
            .setName('Upload JSON File')
            .setDesc(`Select a ${this.contentTypeInfo.displayName.toLowerCase()} JSON file to import`)
            .then(setting => {
                this.fileInputEl = document.createElement('input');
                this.fileInputEl.type = 'file';
                this.fileInputEl.accept = '.json';
                this.fileInputEl.style.display = 'none';

                setting.controlEl.appendChild(this.fileInputEl);

                const uploadButtonEl = document.createElement('button');
                uploadButtonEl.textContent = 'Choose File';
                uploadButtonEl.className = 'mod-cta';
                setting.controlEl.appendChild(uploadButtonEl);

                uploadButtonEl.addEventListener('click', () => {
                    this.fileInputEl?.click();
                });

                this.fileInputEl.addEventListener('change', () => {
                    if (this.fileInputEl?.files && this.fileInputEl.files.length > 0) {
                        const file = this.fileInputEl.files[0];
                        const reader = new FileReader();

                        reader.onload = (e: ProgressEvent<FileReader>) => {
                            if (e.target && typeof e.target.result === 'string') {
                                this.textAreaComponent?.setValue(e.target.result);
                            }
                        };
                        reader.readAsText(file);
                    }
                });
            });

        new Setting(contentEl)
            .setName('Import from URL')
            .setDesc('Enter a URL to a raw JSON file (Pastebin, GitHub, etc.)')
            .then(setting => {
                const urlContainer = setting.controlEl.createDiv({ cls: 'url-input-container' });

                this.urlInputComponent = new TextComponent(urlContainer);
                this.urlInputComponent
                    .setPlaceholder('https://pastebin.com/raw/...')
                    .setValue('');

                const fetchButton = new ButtonComponent(urlContainer);
                fetchButton
                    .setButtonText('Fetch')
                    .setCta()
                    .onClick(async () => {
                        const url = this.urlInputComponent?.getValue().trim();
                        if (!url) {
                            new Notice('Please enter a URL');
                            return;
                        }

                        try {
                            this.setLoading(true);
                            const jsonText = await fetchJsonFromUrl(url);
                            this.textAreaComponent?.setValue(jsonText);
                            new Notice('Successfully fetched data from URL');
                        } catch (error) {
                            console.error('Error fetching from URL:', error);
                            new Notice(`Failed to fetch data: ${error.message}`);
                        } finally {
                            this.setLoading(false);
                        }
                    });
            });

        new Setting(contentEl)
            .setName('Paste JSON')
            .setDesc(`Paste ${this.contentTypeInfo.displayName.toLowerCase()} JSON data`)
            .then(setting => {
                this.textAreaComponent = new TextAreaComponent(setting.controlEl);
                this.textAreaComponent
                    .setPlaceholder(`Paste ${this.contentTypeInfo.displayName.toLowerCase()} JSON here...`)
                    .setValue('')
                    .then(component => {
                        component.inputEl.style.width = '100%';
                        component.inputEl.style.height = '200px';
                        component.inputEl.style.minHeight = '200px';
                    });
            });

        new Setting(contentEl)
            .addButton(button => {
                this.importButtonEl = button.setButtonText(`Import ${this.contentTypeInfo.displayName}`)
                    .setCta()
                    .onClick(() => this.importContent())
                    .buttonEl;
                return button;
            });
    }

    /**
     * Render the export UI
     */
    private renderExportUI(contentEl: HTMLElement) {
        contentEl.createEl('p', {
            text: `Choose ${this.contentTypeInfo.displayName.toLowerCase()} to export.`
        });

        if (!this.contentId) {
            this.renderContentSelectionDropdown(contentEl);
        }

        if (this.contentId || this.selectedContentId) {
            const effectiveContentId = this.contentId || this.selectedContentId;
            if (effectiveContentId) {
                this.prepareExportData(effectiveContentId);

                new Setting(contentEl)
                    .setName('Copy to Clipboard')
                    .setDesc(`Copy ${this.contentTypeInfo.displayName.toLowerCase()} data as JSON to your clipboard`)
                    .addButton(button => button
                        .setButtonText('Copy to Clipboard')
                        .onClick(async () => {
                            await copyToClipboard(this.exportJsonStr);
                        }));

                new Setting(contentEl)
                    .setName('Save to File')
                    .setDesc(`Download ${this.contentTypeInfo.displayName.toLowerCase()} data as a JSON file`)
                    .addButton(button => button
                        .setButtonText('Download JSON')
                        .onClick(async () => {
                            let safeName = 'export';
                            if ('name' in this.prepareExportData(effectiveContentId)) {
                                safeName = this.prepareExportData(effectiveContentId).name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                            }
                            const filename = `daggerheart_${this.contentType}_${safeName}.json`;
                            await saveToFile(filename, this.exportJsonStr);
                        }));

                this.updateExportPreview(contentEl);
            }
        } else {
            contentEl.createEl('p', {
                text: `Please select a ${this.contentTypeInfo.displayName.toLowerCase()} to export.`,
                cls: 'dh-empty-message'
            });
        }
    }

    /**
     * Render dropdown to select which content item to export
     */
    private renderContentSelectionDropdown(contentEl: HTMLElement) {
        const contentSelectSection = new Setting(contentEl)
            .setName(`Select ${this.contentTypeInfo.displayName}`)
            .setDesc(`Choose which ${this.contentTypeInfo.displayName.toLowerCase()} to export`);

        this.contentSelection = new DropdownComponent(contentSelectSection.controlEl);
        this.contentSelection.addOption('', `Select ${this.contentTypeInfo.displayName}...`);

        let items: { id: string; name: string }[] = [];
        const collectionName = this.contentTypeInfo.collection;

        if (collectionName === 'characters') {
            items = this.plugin.getCharacters();
        } else if (collectionName === 'encounters') {
            items = this.plugin.getSavedEncounters();
        } else if ((this.plugin.compendium as any)[collectionName]) {
            items = (this.plugin.compendium as any)[collectionName]
                .filter((item: any) => item.isCustom)
                .map((item: any) => ({ id: item.name, name: item.name }));
        }

        if (items.length === 0) {
            contentEl.createEl('p', {
                text: `No custom ${this.contentTypeInfo.displayName.toLowerCase()} items found.`,
                cls: 'dh-empty-message'
            });
        } else {
            items.forEach(item => {
                this.contentSelection?.addOption(item.id, item.name);
            });
            // Set first item as default
            this.contentSelection?.setValue(items[0].id);
            this.selectedContentId = items[0].id;
            this.prepareExportData(items[0].id);
        }

        this.contentSelection?.onChange(value => {
            if (value) {
                this.selectedContentId = value;
                this.onOpen();
            }
        });
    }

    /**
     * Prepare export data for the selected content
     */
    private prepareExportData(contentId: string): any {
        const collectionName = this.contentTypeInfo.collection;
        let dataToExport: any = null;

        if (collectionName === 'characters') {
            dataToExport = this.plugin.getCharacters().find(c => c.id === contentId);
        } else if (collectionName === 'encounters') {
            dataToExport = this.plugin.getSavedEncounter(contentId);
        } else if ((this.plugin.compendium as any)[collectionName]) {
            dataToExport = (this.plugin.compendium as any)[collectionName].find((item: any) => item.name === contentId);
        }

        if (dataToExport) {
            this.exportJsonStr = exportToJsonString(this.contentType, dataToExport);
        }
        return dataToExport;
    }

    /**
     * Import the content from the textarea
     */
    private async importContent() {
        if (!this.textAreaComponent) return;

        const jsonText = this.textAreaComponent.getValue();
        if (!jsonText) {
            new Notice('Please enter JSON data to import.');
            return;
        }

        try {
            this.setLoading(true);

            const importDataArray = importFromJsonString(jsonText);

            if (!importDataArray || importDataArray.length === 0) {
                new Notice('Invalid or empty import data.');
                this.setLoading(false);
                return;
            }

            const importData = importDataArray[0];

            if (importData.type !== this.contentType) {
                new Notice(`Expected ${this.contentTypeInfo.displayName} data but found ${importData.type} data.`);
                this.setLoading(false);
                return;
            }

            // Route to the correct import handler
            if (this.contentType === ContentType.CHARACTER) {
                await this.importCharacter(importData.data as unknown as Character);
            } else if (this.contentType === ContentType.ENCOUNTER) {
                await this.importEncounter(importData.data as unknown as SavedEncounter);
            } else {
                await this.importCompendiumItem(importData.data);
            }

            this.close();

        } catch (error) {
            console.error(`Error importing ${this.contentTypeInfo.displayName}:`, error);
            new Notice(`Failed to import ${this.contentTypeInfo.displayName}. See console for details.`);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Import a character (special case)
     */
    private async importCharacter(characterData: Character) {
        if (!isValidCharacterData(characterData)) {
            new Notice('Invalid character data.');
            return;
        }

        const existing = this.plugin.getCharacters().find(c =>
            c.name.toLowerCase() === characterData.name.toLowerCase());
        if (existing) {
            characterData.name = `${characterData.name} (Imported)`;
        }
        characterData.id = uuidv4();

        await this.plugin.updateCharacter(characterData);
        await this.plugin.setActiveCharacterId(characterData.id);

        new Notice(`Character "${characterData.name}" imported successfully!`);
    }

    /**
     * Import an encounter (special case)
     */
    private async importEncounter(encounterData: SavedEncounter) {
        if (!isValidEncounterData(encounterData)) {
            new Notice('Invalid encounter data.');
            return;
        }

        const existing = this.plugin.getSavedEncounters().find(e =>
            e.name.toLowerCase() === encounterData.name.toLowerCase());
        if (existing) {
            encounterData.name = `${encounterData.name} (Imported)`;
        }
        encounterData.id = uuidv4();

        await this.plugin.updateSavedEncounter(encounterData);

        new Notice(`Encounter "${encounterData.name}" imported successfully!`);
    }

    /**
     * Imports any generic compendium item.
     * @param itemData The compendium item to import.
     */
    private async importCompendiumItem(itemData: AllCompendiumData) {
        const collectionName = this.contentTypeInfo.collection;
        const collection = (this.plugin.compendium as any)[collectionName] as AllCompendiumData[];

        if (!collection || !('name' in itemData) || typeof itemData.name !== 'string') {
            new Notice('Error: Could not import item. Invalid data structure.');
            return;
        }

        const existing = collection.find(item => 'name' in item && item.name.toLowerCase() === itemData.name.toLowerCase());
        if (existing) {
            itemData.name = `${itemData.name} (Imported)`;
        }

        (itemData as any).isCustom = true;

        // NOTE: You will need to implement this method in your main plugin file.
        // It should add the item to the correct compendium array and save the user's JSON file.
        await this.plugin.addCustomCompendiumItem(this.contentType, itemData);

        new Notice(`${this.contentTypeInfo.displayName} "${itemData.name}" imported successfully!`);
    }

    /**
     * Set the loading state and update the UI accordingly
     */
    private setLoading(loading: boolean) {
        this.isLoading = loading;
        if (this.importButtonEl) {
            this.importButtonEl.textContent = loading ? 'Loading...' : `Import ${this.contentTypeInfo.displayName}`;
            this.importButtonEl.disabled = loading;
        }
    }

    /**
     * Update the export preview without rebuilding the entire UI
     */
    private updateExportPreview(contentEl: HTMLElement) {
        let previewSection = contentEl.querySelector('.dh-preview-section');
        if (!previewSection) {
            previewSection = contentEl.createEl('div', { cls: 'dh-preview-section' });
            previewSection.createEl('h3', { text: 'Preview' });
            previewSection.createEl('pre', { cls: 'dh-export-preview' })
                .createEl('code');
        }

        const codeEl = previewSection.querySelector('code');
        if (codeEl) {
            codeEl.textContent = this.exportJsonStr;
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}