import { App, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf, Notice, Editor, TFile, EventRef, Modal, Menu } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS, Character, JsonAbility, JsonClass, JsonSubclass, JsonAncestry } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './src/views/EncounterBuilderView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './src/views/CharacterSheetView';
import { DaggerheartCompendium } from './src/services/compendium';
import { renderStatblockCard } from './src/rendering/statblock';
import { createInteractiveTrack } from './src/rendering/ui-helpers';
import { AdversaryReferenceModal, EncounterLinkModal, CompendiumEntryTypeSuggester } from './src/modals/index';
import * as dddice from './src/services/dddice-service';
import { ITheme, ThreeDDice } from 'dddice-js';
import { displayRollNotice } from './src/services/dice-helpers';

declare module "obsidian" {
    interface Workspace {
        on(name: 'daggerheart-character-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-character-update'): void;
        on(name: 'daggerheart-compendium-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-compendium-update'): void;
    }
}

const USER_COMPENDIUM_FOLDER = 'user_compendium';

function getThemePreviewUrl(theme: ITheme): string | undefined {
    const preview = theme?.preview;
    if (typeof preview !== 'object' || preview === null) return undefined;
    if (typeof preview.preview === 'string' && preview.preview) return preview.preview;
    if (typeof preview['preview.png'] === 'string' && preview['preview.png']) return preview['preview.png'];
    for (const key in preview) {
        if (Object.prototype.hasOwnProperty.call(preview, key)) {
            const value = preview[key];
            if (typeof value === 'string' && value.startsWith('http')) return value;
        }
    }
    return undefined;
}

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    compendium: DaggerheartCompendium;
    isDiceRollerEnabled: boolean = false;
    private dddiceInstance: ThreeDDice | undefined;
    private dddiceCanvas: HTMLCanvasElement | null = null;
    private boundDddiceClear: (() => void) | null = null;
    private characters: Character[] = [];
    private activeCharacterId: string | null = null;

    async onload() {
        console.log('Loading Daggerheart Plugin');
        await this.loadSettings();
        this.activeCharacterId = this.settings.activeCharacterId;

        this.handleDddiceInitialization();

        this.compendium = new DaggerheartCompendium(this);
        await this.compendium.load();
        await this.loadCharacters();

        this.isDiceRollerEnabled = this.settings.enableDiceRoller && !!(this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api;

        this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new EncounterBuilderView(leaf, this));
        this.registerView(CHARACTER_SHEET_VIEW_TYPE, (leaf: WorkspaceLeaf) => new CharacterSheetView(leaf, this));

        this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => this.activateEncounterBuilderView());
        this.addRibbonIcon('user-round', 'Open Daggerheart Characters', () => this.activateCharacterSheetView());
        this.addCommand({ id: 'open-daggerheart-encounter-builder', name: 'Open Encounter Builder', callback: () => this.activateEncounterBuilderView() });
        this.addCommand({ id: 'open-daggerheart-character-sheet', name: 'Open Characters', callback: () => this.activateCharacterSheetView() });

        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el) => { this.processStatblock(source, el); });
        this.registerMarkdownCodeBlockProcessor('daggerheart-embed', (source, el) => { this.processEmbed(source, el); });
        this.addCommand({ id: 'insert-adversary-statblock', name: 'Insert Adversary Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (adversary) => editor.replaceSelection(`\`\`\`daggerheart-embed\nadversary: ${adversary.name}\n\`\`\``), 'adversary').open(); } });
        this.addCommand({ id: 'insert-environment-statblock', name: 'Insert Environment Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (environment) => editor.replaceSelection(`\`\`\`daggerheart-embed\nenvironment: ${environment.name}\n\`\`\``), 'environment').open(); } });
        this.addCommand({ id: 'insert-encounter-link', name: 'Insert Encounter Link', editorCallback: (editor: Editor) => { new EncounterLinkModal(this.app, this, (encounter) => editor.replaceSelection(`[${encounter.name}](obsidian://dh-encounter?id=${encounter.id})`)).open(); } });

        this.addCommand({
            id: 'add-custom-compendium-entry',
            name: 'Create or Edit Compendium Entry',
            callback: () => {
                new CompendiumEntryTypeSuggester(this.app, this).open();
            },
        });

        this.addSettingTab(new DaggerheartSettingTab(this.app, this));
    }

    async processStatblock(source: string, el: HTMLElement) {
        try {
            const cleanedSource = source.replace(/\u00A0/g, ' ');
            const data = YAML.load(cleanedSource) as StatblockData;
            if (!data || typeof data !== 'object') throw new Error("Parsed data is not a valid object.");
            renderStatblockCard(this, data, el, false, data.name);
        } catch (e: any) {
            console.error('Daggerheart Statblock: Error processing code block.', e);
            const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
            errorEl.setText(`Error rendering Daggerheart Statblock:\n${e.message}\n\nSource:\n${source}`);
        }
    }

    async processEmbed(source: string, el: HTMLElement) {
        try {
            const params = source.split('\n').reduce((acc, line) => {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length > 0) {
                    acc[key.trim()] = valueParts.join(':').trim();
                }
                return acc;
            }, {} as Record<string, string>);

            const items = this.compendium.getStatblocks();
            let itemToRender: StatblockData | undefined;
            let itemName: string | undefined;
            let itemType: 'adversary' | 'environment' = 'adversary';

            if (params.adversary) {
                itemName = params.adversary;
                itemType = 'adversary';
                itemToRender = items.find(i => i.name.toLowerCase() === itemName?.toLowerCase() && i.category === 'adversary');
            } else if (params.environment) {
                itemName = params.environment;
                itemType = 'environment';
                itemToRender = items.find(i => i.name.toLowerCase() === itemName?.toLowerCase() && i.category === 'environment');
            }

            if (itemToRender) {
                renderStatblockCard(this, itemToRender, el, false);
            } else if (itemName) {
                el.createEl('div', { text: `Could not find ${itemType} "${itemName}" in compendium.` });
            } else {
                el.createEl('div', { text: 'Invalid embed. Use "adversary: [Name]" or "environment: [Name]".' });
            }
        } catch (e: any) {
            console.error('Daggerheart Embed: Error processing embed block.', e);
            const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
            errorEl.setText(`Error rendering Daggerheart embed:\n${e.message}`);
        }
    }

    private async loadCharacters() {
        const path = `${this.manifest.dir}/characters.json`;
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const data = await this.app.vault.adapter.read(path);
                this.characters = JSON.parse(data);
                if (this.characters.length > 0 && !this.activeCharacterId) {
                    this.activeCharacterId = this.characters[0].id;
                }
            } catch (e) {
                console.error("Daggerheart: Error loading characters.json. It might be corrupted.", e);
                this.characters = [];
            }
        } else {
            this.characters = [];
        }
    }

    private async saveCharacters() {
        const path = `${this.manifest.dir}/characters.json`;
        await this.app.vault.adapter.write(path, JSON.stringify(this.characters, null, 2));
    }

    public getCharacters(): Character[] { return this.characters; }
    public getCharacter(id: string): Character | undefined { return this.characters.find(c => c.id === id); }
    public getActiveCharacter(): Character | undefined {
        if (!this.activeCharacterId) return undefined;
        return this.characters.find(c => c.id === this.activeCharacterId);
    }
    public getActiveCharacterId(): string | null { return this.activeCharacterId; }

    public async setActiveCharacterId(id: string | null) {
        this.activeCharacterId = id;
        this.settings.activeCharacterId = id;
        await this.saveSettings();
        this.app.workspace.trigger('daggerheart-character-update');
    }

    public async updateCharacter(character: Character) {
        const index = this.characters.findIndex(c => c.id === character.id);
        if (index > -1) {
            this.characters[index] = character;
        } else {
            this.characters.push(character);
        }
        await this.saveCharacters();
        this.app.workspace.trigger('daggerheart-character-update');
    }

    public async deleteCharacter(id: string) {
        this.characters = this.characters.filter(c => c.id !== id);
        if (this.activeCharacterId === id) {
            this.activeCharacterId = this.characters.length > 0 ? this.characters[0].id : null;
        }
        await this.saveCharacters();
        this.app.workspace.trigger('daggerheart-character-update');
    }

    async activateEncounterBuilderView(encounterId?: string) {
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        await this.app.workspace.getRightLeaf(false)?.setViewState({
            type: ENCOUNTER_BUILDER_VIEW_TYPE,
            active: true,
            state: { currentEncounterId: encounterId }
        });
        const leaves = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    async activateCharacterSheetView() {
        this.app.workspace.detachLeavesOfType(CHARACTER_SHEET_VIEW_TYPE);
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: CHARACTER_SHEET_VIEW_TYPE,
                active: true,
            });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    handleDddiceInitialization() { /* ... unchanged ... */ }
    destroyDddiceInstance() { /* ... unchanged ... */ }

    private async ensureUserCompendiumFolderExists() {
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}`;
        if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.adapter.mkdir(path);
        }
    }

    public async triggerCompendiumUpdate() {
        await this.compendium.load();
        this.app.workspace.trigger('daggerheart-character-update');
        this.app.workspace.trigger('daggerheart-compendium-update');
    }

    public async saveCustomCompendiumData(fileName: string, dataToSave: any) {
        await this.ensureUserCompendiumFolderExists();
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}/${fileName}`;
        let compendium: any[] = [];
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const rawData = await this.app.vault.adapter.read(path);
                if (rawData.trim() !== '') {
                    compendium = JSON.parse(rawData);
                }
            } catch (e) {
                new Notice(`Error reading ${fileName}. Check console. Overwriting.`);
                compendium = [];
            }
        }

        dataToSave.isCustom = true; // Ensure flag is set on save

        const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === dataToSave.name.toLowerCase());
        if (existingIndex > -1) {
            compendium[existingIndex] = dataToSave;
            new Notice(`Updated custom entry: ${dataToSave.name}`);
        } else {
            compendium.push(dataToSave);
            new Notice(`Saved new custom entry: ${dataToSave.name}`);
        }

        await this.app.vault.adapter.write(path, JSON.stringify(compendium, null, 2));
        await this.triggerCompendiumUpdate();
    }

    public async renameCustomCompendiumEntry(fileName: string, oldName: string, newData: any) {
        await this.ensureUserCompendiumFolderExists();
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}/${fileName}`;
        let compendium: any[] = [];
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const rawData = await this.app.vault.adapter.read(path);
                if (rawData.trim() !== '') {
                    compendium = JSON.parse(rawData);
                }
            } catch (e) {
                new Notice(`Error reading ${fileName}. Cannot rename.`);
                return;
            }
        }

        newData.isCustom = true; // Ensure flag is set on rename

        const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === oldName.toLowerCase());

        if (existingIndex !== -1) {
            compendium[existingIndex] = newData;
            await this.app.vault.adapter.write(path, JSON.stringify(compendium, null, 2));
            new Notice(`Renamed "${oldName}" to "${newData.name}".`);
        } else {
            await this.saveCustomCompendiumData(fileName, newData);
        }

        await this.triggerCompendiumUpdate();
    }

    public createInteractiveTrack(parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string, currentValue: number, updateCallback: (newValue: number) => void) {
        createInteractiveTrack(parentEl, label, maxValue, trackIdPrefix, currentValue, updateCallback);
    }

    public async rollDice(diceString: string, context: string, traitName?: string) { /* ... unchanged ... */ }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.handleDddiceInitialization();
    }

    onunload() {
        this.destroyDddiceInstance();
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        this.app.workspace.detachLeavesOfType(CHARACTER_SHEET_VIEW_TYPE);
    }
}

class DaggerheartSettingTab extends PluginSettingTab {
    plugin: DaggerheartStatblockPlugin;
    private isDddiceConnecting: boolean = false;

    constructor(app: App, plugin: DaggerheartStatblockPlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Daggerheart Settings' });

        this.renderCompendiumSettings(containerEl);
        this.renderEncounterViewSettings(containerEl);
        this.renderIntegrationSettings(containerEl);
    }

    renderCompendiumSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Compendium Settings' });
        new Setting(containerEl)
            .setName('Compendium Folder')
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Adversaries"). Leave empty to disable user compendium from markdown.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Example: Path/To/Adversaries')
                    .setValue(this.plugin.settings.compendiumFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.compendiumFolder = value.trim();
                        await this.plugin.saveSettings();
                        this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                    });
            });

        new Setting(containerEl)
            .setName('Use SRD Adversaries')
            .setDesc(`Include the Daggerheart SRD adversaries from the plugin's "adversaries.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdAdversaries)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdAdversaries = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));

        new Setting(containerEl)
            .setName('Use SRD Environments')
            .setDesc(`Include the Daggerheart SRD environments from the plugin's "environments.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdEnvironments)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdEnvironments = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));
    }

    renderEncounterViewSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Encounter View Settings' });
        new Setting(containerEl)
            .setName('Show Description on Instance Cards')
            .setDesc('If enabled, the full description will be shown on adversary cards in the encounter builder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDescriptionOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showDescriptionOnCards = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));
    }

    renderIntegrationSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Integrations' });

        new Setting(containerEl)
            .setName('Dice Provider')
            .setDesc('Choose which service to use for rolling dice.')
            .addDropdown(dropdown => dropdown
                .addOption('dice-roller', 'Obsidian Dice Roller')
                .addOption('dddice', 'dddice.com')
                .setValue(this.plugin.settings.diceProvider)
                .onChange(async (value: 'dice-roller' | 'dddice') => {
                    this.plugin.settings.diceProvider = value;
                    await this.plugin.saveSettings();
                    this.display(); // Re-render settings
                }));

        if (this.plugin.settings.diceProvider === 'dddice') {
            this.renderDddiceSettings(containerEl);
        } else {
            this.renderDiceRollerSettings(containerEl);
        }
    }

    renderDiceRollerSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Enable Dice Roller Integration')
            .setDesc('Enable integration with the Dice Roller plugin for rolling dice in statblocks.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDiceRoller)
                .onChange(async (value) => {
                    this.plugin.settings.enableDiceRoller = value;
                    await this.plugin.saveSettings();
                    this.plugin.isDiceRollerEnabled = value && (this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api != null;
                    if (value && !this.plugin.isDiceRollerEnabled) {
                        new Notice('Dice Roller plugin not found or is disabled. Please install and enable it.');
                    }
                    this.display();
                }));

        if (this.plugin.settings.enableDiceRoller) {
            const isPluginAvailable = this.plugin.isDiceRollerEnabled;
            new Setting(containerEl)
                .setName('Use Graphical Dice')
                .setDesc('If enabled, dice rolls will use graphical 3D dice (requires Dice Roller plugin).')
                .addToggle(toggle => {
                    toggle
                        .setValue(isPluginAvailable && this.plugin.settings.useGraphicalDice)
                        .setDisabled(!isPluginAvailable)
                        .onChange(async (value) => {
                            this.plugin.settings.useGraphicalDice = value;
                            await this.plugin.saveSettings();
                        });
                })
                .then(setting => {
                    if (setting.controlEl.parentElement && !isPluginAvailable) {
                        setting.controlEl.parentElement.addClass('setting-disabled');
                    }
                });
        }
    }

    renderDddiceSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('dddice API Key')
            .setDesc(createFragment((frag) => {
                frag.appendText('Your dddice.com API key. Get one from your ');
                frag.createEl('a', { text: 'account page', attr: { href: 'https://dddice.com/account/developer', target: '_blank' } });
                frag.appendText('.');
            }))
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.dddice.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.dddice.apiKey = value.trim();
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText(this.isDddiceConnecting ? "Connecting..." : "Connect & Fetch Data")
                .setDisabled(this.isDddiceConnecting)
                .onClick(async () => {
                    this.isDddiceConnecting = true;
                    this.display();

                    try {
                        const apiKey = this.plugin.settings.dddice.apiKey;
                        if (!apiKey) {
                            new Notice("Please enter a dddice API key.");
                            return;
                        }

                        const dddiceApi = dddice.initializeDddiceApi(apiKey);
                        const [rooms, themes] = await Promise.all([
                            dddice.fetchDddiceRooms(dddiceApi),
                            dddice.fetchDddiceThemes(dddiceApi)
                        ]);

                        this.plugin.settings.dddice.rooms = rooms.map(r => ({ slug: r.slug, name: r.name }));
                        this.plugin.settings.dddice.themes = themes;

                        if (!this.plugin.settings.dddice.rooms.some(r => r.slug === this.plugin.settings.dddice.room)) {
                            this.plugin.settings.dddice.room = null;
                        }

                        await this.plugin.saveSettings();
                        new Notice("Successfully connected to dddice!");
                    } catch (e) {
                        new Notice("Failed to connect to dddice. Check API key and console.", 4000);
                        console.error(e);
                    } finally {
                        this.isDddiceConnecting = false;
                        this.display();
                    }
                }));

        const isConnected = this.plugin.settings.dddice.apiKey && this.plugin.settings.dddice.themes.length > 0;
        if (isConnected) {
            new Setting(containerEl)
                .setName('Render dice in Obsidian')
                .setDesc('If enabled, 3D dice will be rendered over the Obsidian window.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.dddice.renderInObsidian)
                    .onChange(async (value) => {
                        this.plugin.settings.dddice.renderInObsidian = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('dddice Room')
                .setDesc('Select the room to send dice rolls to.')
                .addDropdown(dropdown => {
                    dropdown.addOption('', 'Select a room...');
                    this.plugin.settings.dddice.rooms.forEach(room => dropdown.addOption(room.slug, room.name));
                    dropdown.setValue(this.plugin.settings.dddice.room || '')
                        .onChange(async (value) => {
                            this.plugin.settings.dddice.room = value;
                            await this.plugin.saveSettings();
                        });
                });

            this.renderThemeSelector(containerEl, 'Default Theme', 'theme');
            this.renderThemeSelector(containerEl, 'Hope Die Theme', 'hopeTheme');
            this.renderThemeSelector(containerEl, 'Fear Die Theme', 'fearTheme');
        }
    }

    renderThemeSelector(containerEl: HTMLElement, title: string, settingKey: 'theme' | 'hopeTheme' | 'fearTheme') {
        const setting = new Setting(containerEl).setName(title);

        const themeContainer = setting.controlEl.createDiv({ cls: 'dh-theme-selector-container' });

        const selectedTheme = this.plugin.settings.dddice.themes.find(t => t.id === this.plugin.settings.dddice[settingKey]);

        const card = themeContainer.createDiv({ cls: 'dh-theme-card is-selected-card' });
        if (selectedTheme) {
            const previewUrl = getThemePreviewUrl(selectedTheme);
            if (previewUrl) {
                card.createEl('img', {
                    attr: { src: previewUrl, alt: selectedTheme.name || 'Theme preview' },
                    cls: 'dh-theme-preview'
                });
            } else {
                card.createDiv({ text: 'No Preview', cls: 'dh-theme-name' });
            }
            card.createDiv({ text: selectedTheme.name, cls: 'dh-theme-name' });
        } else {
            card.createDiv({ text: 'Select a theme', cls: 'dh-theme-name' });
        }

        const changeButton = themeContainer.createEl('button', { text: 'Change' });
        changeButton.addEventListener('click', () => {
            new ThemeSelectionModal(this.app, this.plugin, settingKey, (themeId) => {
                this.plugin.settings.dddice[settingKey] = themeId;
                this.plugin.saveSettings();
                this.display();
            }).open();
        });
    }
}

class ThemeSelectionModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    settingKey: 'theme' | 'hopeTheme' | 'fearTheme';
    onSelect: (themeId: string) => void;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, settingKey: 'theme' | 'hopeTheme' | 'fearTheme', onSelect: (themeId: string) => void) {
        super(app);
        this.plugin = plugin;
        this.settingKey = settingKey;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-theme-modal');
        contentEl.createEl('h2', { text: `Select ${this.settingKey.replace('Theme', '')} Theme` });

        const themeGrid = contentEl.createDiv({ cls: 'dh-theme-grid' });
        const themes = this.plugin.settings.dddice.themes;

        if (themes.length === 0) {
            themeGrid.createEl('p', { text: 'No themes found. Please connect to dddice first.' });
            return;
        }

        themes.forEach(theme => {
            const card = themeGrid.createDiv({ cls: 'dh-theme-card' });
            if (this.plugin.settings.dddice[this.settingKey] === theme.id) {
                card.addClass('is-selected');
            }

            const previewUrl = getThemePreviewUrl(theme);
            if (previewUrl) {
                card.createEl('img', {
                    attr: { src: previewUrl, alt: theme.name || 'Theme preview' },
                    cls: 'dh-theme-preview'
                });
            } else {
                card.createDiv({ text: 'No Preview', cls: 'dh-theme-name' });
            }
            card.createDiv({ text: theme.name, cls: 'dh-theme-name' });

            card.onClickEvent(() => {
                this.onSelect(theme.id);
                this.close();
            });
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}
