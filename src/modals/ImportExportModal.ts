import { App, Modal, Setting, Notice, TextAreaComponent, ButtonComponent, TextComponent, DropdownComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { ContentType, exportToJsonString, copyToClipboard, saveToFile, importFromJsonString, fetchJsonFromUrl } from '../services/export-import';
import { isValidCharacterData, isValidEncounterData } from '../services/content-validators';
import { v4 as uuidv4 } from 'uuid';
import { Character, SavedEncounter, AllCompendiumData } from '../types';
import { StatblockImportPreviewModal } from './StatblockImportPreviewModal';

export interface ContentTypeInfo {
    type: ContentType;
    displayName: string;
    description: string;
    icon: string;
    collection: string;
}

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

    constructor(app: App, plugin: DaggerheartStatblockPlugin, mode: 'import' | 'export' = 'import', contentType: ContentType = ContentType.CHARACTER, contentId: string | null = null) {
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
        contentEl.createEl('h2', { text: `${this.mode === 'import' ? 'Import' : 'Export'} ${this.contentTypeInfo.displayName}` });
        this.renderContentTypeSelector(contentEl);
        if (this.mode === 'import') this.renderImportUI(contentEl);
        else this.renderExportUI(contentEl);
        const footer = contentEl.createDiv('modal-footer');
        new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
    }

    private renderContentTypeSelector(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl).setName('Content Type').setDesc('Select what type of content to import or export');
        const dropdown = new DropdownComponent(setting.controlEl);
        Object.values(ContentType).forEach(type => dropdown.addOption(type, CONTENT_TYPE_INFO[type].displayName));
        dropdown.setValue(this.contentType);
        dropdown.onChange(value => {
            this.contentType = value as ContentType;
            this.contentTypeInfo = CONTENT_TYPE_INFO[this.contentType];
            this.onOpen();
        });
        if (this.mode === 'export' && ![ContentType.CHARACTER, ContentType.ENCOUNTER].includes(this.contentType)) {
            contentEl.createEl('p', { text: 'Only custom entries are available for export.', cls: 'dh-info-message' });
        }
    }

    private renderImportUI(contentEl: HTMLElement): void {
        contentEl.createEl('p', { text: 'Import one item or a complete JSON batch. Statblocks are reviewed before anything is saved.' });
        new Setting(contentEl).setName('Upload JSON File').setDesc('Select a JSON file').then(setting => {
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
                reader.onload = event => {
                    if (typeof event.target?.result === 'string') this.textAreaComponent?.setValue(event.target.result);
                };
                reader.readAsText(file);
            });
        });

        new Setting(contentEl).setName('Import from URL').setDesc('Pastebin, GitHub raw files, and other JSON URLs').then(setting => {
            const container = setting.controlEl.createDiv({ cls: 'url-input-container' });
            this.urlInputComponent = new TextComponent(container).setPlaceholder('https://…');
            new ButtonComponent(container).setButtonText('Fetch').setCta().onClick(async () => {
                const url = this.urlInputComponent?.getValue().trim();
                if (!url) return void new Notice('Please enter a URL.');
                try {
                    this.setLoading(true);
                    this.textAreaComponent?.setValue(await fetchJsonFromUrl(url));
                    new Notice('JSON fetched successfully.');
                } catch (error) {
                    new Notice(`Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    this.setLoading(false);
                }
            });
        });

        new Setting(contentEl).setName('Paste JSON').setDesc('Paste a toolkit export, raw object, or array').then(setting => {
            this.textAreaComponent = new TextAreaComponent(setting.controlEl).setPlaceholder('Paste JSON here…');
            this.textAreaComponent.inputEl.style.width = '100%';
            this.textAreaComponent.inputEl.style.minHeight = '200px';
        });
        new Setting(contentEl).addButton(button => {
            this.importButtonEl = button.setButtonText(`Review ${this.contentTypeInfo.displayName} Import`).setCta().onClick(() => this.importContent()).buttonEl;
            return button;
        });
    }

    private renderExportUI(contentEl: HTMLElement): void {
        contentEl.createEl('p', { text: `Choose ${this.contentTypeInfo.displayName.toLowerCase()} to export.` });
        if (!this.contentId) this.renderContentSelectionDropdown(contentEl);
        const effectiveId = this.contentId || this.selectedContentId;
        if (!effectiveId) return void contentEl.createEl('p', { text: `Please select a ${this.contentTypeInfo.displayName.toLowerCase()} to export.`, cls: 'dh-empty-message' });
        const data = this.prepareExportData(effectiveId);
        if (!data) return;
        new Setting(contentEl).setName('Copy to Clipboard').addButton(button => button.setButtonText('Copy JSON').onClick(() => copyToClipboard(this.exportJsonStr)));
        new Setting(contentEl).setName('Save to File').addButton(button => button.setButtonText('Download JSON').onClick(() => {
            const safeName = String((data as any).name || 'export').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            return saveToFile(`daggerheart_${this.contentType}_${safeName}.json`, this.exportJsonStr);
        }));
        this.updateExportPreview(contentEl);
    }

    private renderContentSelectionDropdown(contentEl: HTMLElement): void {
        const setting = new Setting(contentEl).setName(`Select ${this.contentTypeInfo.displayName}`);
        this.contentSelection = new DropdownComponent(setting.controlEl).addOption('', `Select ${this.contentTypeInfo.displayName}…`);
        const collectionName = this.contentTypeInfo.collection;
        let items: { id: string; name: string }[] = [];
        if (collectionName === 'characters') items = this.plugin.getCharacters();
        else if (collectionName === 'encounters') items = this.plugin.getSavedEncounters();
        else if ((this.plugin.compendium as any)[collectionName]) {
            items = (this.plugin.compendium as any)[collectionName].filter((item: any) => item.isCustom).map((item: any) => ({ id: item.name, name: item.name }));
        }
        items.forEach(item => this.contentSelection?.addOption(item.id, item.name));
        if (items.length) {
            this.selectedContentId = items[0].id;
            this.contentSelection.setValue(items[0].id);
        } else contentEl.createEl('p', { text: 'No custom items found.', cls: 'dh-empty-message' });
        this.contentSelection.onChange(value => {
            if (!value) return;
            this.selectedContentId = value;
            this.onOpen();
        });
    }

    private prepareExportData(contentId: string): any {
        const collectionName = this.contentTypeInfo.collection;
        let data: any = null;
        if (collectionName === 'characters') data = this.plugin.getCharacters().find(item => item.id === contentId);
        else if (collectionName === 'encounters') data = this.plugin.getSavedEncounter(contentId);
        else data = (this.plugin.compendium as any)[collectionName]?.find((item: any) => item.name === contentId);
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
            const matching = entries.filter(entry => entry.type === this.contentType);
            if (!matching.length) {
                new Notice(`No ${this.contentTypeInfo.displayName.toLowerCase()} items were found in the payload.`);
                return;
            }

            if (this.contentType === ContentType.ADVERSARY || this.contentType === ContentType.ENVIRONMENT) {
                new StatblockImportPreviewModal(this.app, this.plugin, matching, 'Import Daggerheart Content').open();
                this.close();
                return;
            }

            if (this.contentType === ContentType.CHARACTER) await this.importCharacter(matching[0].data as unknown as Character);
            else if (this.contentType === ContentType.ENCOUNTER) await this.importEncounter(matching[0].data as unknown as SavedEncounter);
            else {
                for (const entry of matching) await this.importCompendiumItem(entry.data);
                new Notice(`Imported ${matching.length} ${this.contentTypeInfo.displayName.toLowerCase()} item${matching.length === 1 ? '' : 's'}.`);
            }
            if (matching.length > 1 && [ContentType.CHARACTER, ContentType.ENCOUNTER].includes(this.contentType)) new Notice('Only the first character or encounter was imported.');
            this.close();
        } catch (error) {
            console.error(`Error importing ${this.contentTypeInfo.displayName}:`, error);
            new Notice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.setLoading(false);
        }
    }

    private async importCharacter(data: Character): Promise<void> {
        if (!isValidCharacterData(data)) return void new Notice('Invalid character data.');
        if (this.plugin.getCharacters().some(item => item.name.toLowerCase() === data.name.toLowerCase())) data.name += ' (Imported)';
        data.id = uuidv4();
        await this.plugin.updateCharacter(data);
        await this.plugin.setActiveCharacterId(data.id);
        new Notice(`Character "${data.name}" imported.`);
    }

    private async importEncounter(data: SavedEncounter): Promise<void> {
        if (!isValidEncounterData(data)) return void new Notice('Invalid encounter data.');
        if (this.plugin.getSavedEncounters().some(item => item.name.toLowerCase() === data.name.toLowerCase())) data.name += ' (Imported)';
        data.id = uuidv4();
        await this.plugin.updateSavedEncounter(data);
        new Notice(`Encounter "${data.name}" imported.`);
    }

    private async importCompendiumItem(data: AllCompendiumData): Promise<void> {
        if (!data || !('name' in data) || typeof data.name !== 'string') throw new Error('Invalid compendium item.');
        const collection = (this.plugin.compendium as any)[this.contentTypeInfo.collection] as AllCompendiumData[];
        if (collection?.some(item => 'name' in item && item.name.toLowerCase() === data.name.toLowerCase())) data.name += ' (Imported)';
        (data as any).isCustom = true;
        await this.plugin.addCustomCompendiumItem(this.contentType, data);
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
