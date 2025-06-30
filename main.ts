import { App, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf, Notice, Editor, TFile, EventRef, Modal } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS, Character, JsonAbility } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './src/views/EncounterBuilderView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './src/views/CharacterSheetView';
import { getCompendiumItems, saveItemToUserCompendium } from './src/services/compendium';
import { CharacterCompendium } from './src/services/characterCompendium';
import { renderStatblockCard } from './src/rendering/statblock';
import { renderRollableContent, createInteractiveTrack } from './src/rendering/ui-helpers';
import { AdversaryReferenceModal, EncounterLinkModal } from './src/modals/index';
import * as dddice from './src/services/dddice-service';
import { ITheme, ThreeDDice } from 'dddice-js';
import { displayRollNotice } from './src/services/dice-helpers';


// Declare a custom event for the workspace to allow views to communicate
declare module "obsidian" {
    interface Workspace {
        on(name: 'daggerheart-character-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-character-update'): void;
    }
}

// Helper function to get the correct theme preview URL
function getThemePreviewUrl(theme: ITheme): string | undefined {
    const preview = theme?.preview;
    if (typeof preview !== 'object' || preview === null) {
        return undefined;
    }

    if (typeof preview.preview === 'string' && preview.preview) {
        return preview.preview;
    }
    if (typeof preview['preview.png'] === 'string' && preview['preview.png']) {
        return preview['preview.png'];
    }

    for (const key in preview) {
        if (Object.prototype.hasOwnProperty.call(preview, key)) {
            const value = preview[key];
            if (typeof value === 'string' && value.startsWith('http')) {
                return value;
            }
        }
    }

    return undefined;
}

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    isDiceRollerEnabled: boolean = false;
    characterCompendium: CharacterCompendium;

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

        this.characterCompendium = new CharacterCompendium(this);
        await this.characterCompendium.load();
        await this.loadCharacters();

        this.isDiceRollerEnabled = this.settings.enableDiceRoller && !!(this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api;

        // Register Views
        this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new EncounterBuilderView(leaf, this));
        this.registerView(CHARACTER_SHEET_VIEW_TYPE, (leaf: WorkspaceLeaf) => new CharacterSheetView(leaf, this));

        // Add Ribbon Icons & Commands
        this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => this.activateEncounterBuilderView());
        this.addRibbonIcon('user-round', 'Open Daggerheart Characters', () => this.activateCharacterSheetView());
        this.addCommand({ id: 'open-daggerheart-encounter-builder', name: 'Open Encounter Builder', callback: () => this.activateEncounterBuilderView() });
        this.addCommand({ id: 'open-daggerheart-character-sheet', name: 'Open Characters', callback: () => this.activateCharacterSheetView() });

        // Register Markdown Processors and related commands
        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el) => { this.processStatblock(source, el); });
        this.registerMarkdownCodeBlockProcessor('daggerheart-embed', (source, el) => { this.processEmbed(source, el); });
        this.addCommand({ id: 'insert-adversary-statblock', name: 'Insert Adversary Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (adversary) => editor.replaceSelection(`\`\`\`daggerheart-embed\nadversary: ${adversary.name}\n\`\`\``), 'adversary').open(); } });
        this.addCommand({ id: 'insert-environment-statblock', name: 'Insert Environment Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (environment) => editor.replaceSelection(`\`\`\`daggerheart-embed\nenvironment: ${environment.name}\n\`\`\``), 'environment').open(); } });
        this.addCommand({ id: 'insert-encounter-link', name: 'Insert Encounter Link', editorCallback: (editor: Editor) => { new EncounterLinkModal(this.app, this, (encounter) => editor.replaceSelection(`[${encounter.name}](obsidian://dh-encounter?id=${encounter.id})`)).open(); } });

        this.addSettingTab(new DaggerheartSettingTab(this.app, this));
    }

    // --- DATA PROCESSING METHODS ---

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

            const items = await this.getCompendiumItems();
            let itemToRender: StatblockData | undefined;
            let itemName: string | undefined;
            let itemType: 'adversary' | 'environment' | 'item' = 'item';

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

    // --- CHARACTER DATA MANAGEMENT ---

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

    // --- VIEW ACTIVATION ---

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

    // --- DDDICE RENDERER MANAGEMENT ---

    handleDddiceInitialization() {
        this.destroyDddiceInstance();

        const { diceProvider, dddice } = this.settings;
        if (diceProvider !== 'dddice' || !dddice.apiKey || !dddice.renderInObsidian || !dddice.room) {
            return;
        }

        try {
            this.dddiceCanvas = document.body.createEl('canvas', { attr: { id: 'dddice-canvas' } });
            this.dddiceCanvas.style.cssText = 'top:0px; left:0; position:fixed; pointer-events:none; z-index:100000; width:100vw; height:100vh;';

            this.dddiceInstance = new ThreeDDice().initialize(this.dddiceCanvas, dddice.apiKey, undefined, 'Daggerheart-Obsidian');
            this.dddiceInstance.connect(dddice.room);
            this.dddiceInstance.start();

            this.boundDddiceClear = () => {
                if (this.dddiceInstance && !this.dddiceInstance.isDiceThrowing) {
                    this.dddiceInstance.clear();
                }
            };

            document.body.addEventListener('click', this.boundDddiceClear);

            console.log("dddice renderer initialized.");
        } catch (e) {
            console.error("Failed to initialize dddice renderer:", e);
            this.destroyDddiceInstance();
        }
    }

    destroyDddiceInstance() {
        if (this.dddiceInstance) {
            this.dddiceInstance.stop();
            if (this.dddiceInstance.api) {
                this.dddiceInstance.api.disconnect();
            }
            this.dddiceInstance = undefined;
        }
        if (this.dddiceCanvas) {
            if (this.boundDddiceClear) {
                document.body.removeEventListener('click', this.boundDddiceClear);
                this.boundDddiceClear = null;
            }
            this.dddiceCanvas.remove();
            this.dddiceCanvas = null;
        }
    }

    // --- PUBLIC UTILITY METHODS ---

    public getCompendiumItems() {
        return getCompendiumItems(this);
    }

    public saveItemToUserCompendium(itemData: StatblockData) {
        return saveItemToUserCompendium(this, itemData);
    }

    public async saveAbilityToUserCompendium(abilityData: JsonAbility) {
        const path = `${this.manifest.dir}/${this.settings.userAbilitiesFile}`;
        let userAbilities: JsonAbility[] = [];

        if (await this.app.vault.adapter.exists(path)) {
            try {
                const data = await this.app.vault.adapter.read(path);
                userAbilities = JSON.parse(data);
            } catch (e) {
                console.error(`Daggerheart: Error reading or parsing ${this.settings.userAbilitiesFile}`, e);
                new Notice(`Could not read existing user abilities file. Starting fresh.`);
                userAbilities = [];
            }
        }

        // Avoid duplicates by name (case-insensitive)
        const existingIndex = userAbilities.findIndex(a => a.name.toLowerCase() === abilityData.name.toLowerCase());
        if (existingIndex > -1) {
            userAbilities[existingIndex] = abilityData;
            new Notice(`Updated custom card: ${abilityData.name}`);
        } else {
            userAbilities.push(abilityData);
            new Notice(`Saved new custom card: ${abilityData.name}`);
        }

        await this.app.vault.adapter.write(path, JSON.stringify(userAbilities, null, 2));

        // Reload compendium to reflect changes immediately
        await this.characterCompendium.load();
    }

    public createInteractiveTrack(parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string, currentValue: number, updateCallback: (newValue: number) => void) {
        createInteractiveTrack(parentEl, label, maxValue, trackIdPrefix, currentValue, updateCallback);
    }

    public async rollDice(diceString: string, context: string, traitName?: string) {
        if (this.settings.diceProvider === 'dddice') {
            await dddice.rollWithDddice(this.settings.dddice, diceString, context, this.dddiceInstance, traitName);
        } else {
            if (!this.settings.enableDiceRoller || !this.isDiceRollerEnabled) {
                new Notice("Dice Roller integration is not enabled in plugin settings.");
                return;
            }
            const diceRollerPlugin = (this.app as any).plugins.getPlugin("obsidian-dice-roller");
            if (!diceRollerPlugin || typeof diceRollerPlugin.api?.getRoller !== 'function') {
                new Notice("Dice Roller plugin API not available or plugin is disabled.", 4000);
                return;
            }
            try {
                const roller = await diceRollerPlugin.api.getRoller(diceString);
                await roller.roll({ showDice: this.settings.useGraphicalDice, throw: this.settings.useGraphicalDice });
                if (!this.settings.useGraphicalDice) {
                    // Use our standardized display function
                    const isDaggerheartActionRoll = diceString.toLowerCase().startsWith("1d12+1d12");

                    if (isDaggerheartActionRoll) {
                        // Parse the roll result for Hope/Fear dice
                        const match = roller.result.match(/^(\d+)\s*\+\s*(\d+)(?:\s*\+\s*(.+))?$/);
                        if (match) {
                            const hopeValue = parseInt(match[1]);
                            const fearValue = parseInt(match[2]);
                            const outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Critical!");

                            // Format the result like dddice does
                            let resultDisplay = `${hopeValue}[Hope]+${fearValue}[Fear]`;

                            // Check if there are additional components (advantage/disadvantage/modifiers)
                            if (match[3]) {
                                const advantage = match[3].match(/(\d+)/);
                                if (diceString.includes('+1d6') && advantage) {
                                    resultDisplay += `+${advantage[1]}[Advantage]`;
                                } else if (diceString.includes('-1d6') && advantage) {
                                    resultDisplay += `-${advantage[1]}[Disadvantage]`;
                                } else if (traitName) {
                                    // Add trait modifier with trait name
                                    resultDisplay += `+${match[3]}[${traitName}]`;
                                } else {
                                    resultDisplay += `+${match[3]}`;
                                }
                            }

                            // Get the total by parsing the number after the = sign
                            const total = roller.result.replace(/\s/g, '').split('=')[1];

                            displayRollNotice(context, resultDisplay, total, outcome);
                        } else {
                            // Fallback for unexpected formats
                            displayRollNotice(context, roller.result, roller.result.replace(/\s/g, '').split('=').pop() || '');
                        }
                    } else {
                        // For non-Daggerheart rolls, use our standardized display function
                        const resultParts = roller.result.split('=');
                        if (resultParts.length > 1) {
                            const equation = resultParts[0].trim();
                            const total = resultParts[1].trim();
                            displayRollNotice(context, equation, total);
                        } else {
                            // Fallback for unexpected formats
                            displayRollNotice(context, roller.result, roller.result.replace(/\s/g, '').split('=').pop() || '');
                        }
                    }
                }
            } catch (e) {
                console.error("Daggerheart: Error rolling dice with Dice Roller:", e);
                new Notice(`Error rolling dice for "${diceString}".`);
            }
        }
    }

    // --- SETTINGS & UNLOADING ---

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
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Adversaries"). Leave empty to disable user compendium.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Example: Path/To/Adversaries')
                    .setValue(this.plugin.settings.compendiumFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.compendiumFolder = value.trim();
                        await this.plugin.saveSettings();
                        this.triggerEncounterBuilderUpdate();
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
                    this.triggerEncounterBuilderUpdate();
                }));

        new Setting(containerEl)
            .setName('Use SRD Environments')
            .setDesc(`Include the Daggerheart SRD environments from the plugin's "environments.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdEnvironments)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdEnvironments = value;
                    await this.plugin.saveSettings();
                    this.triggerEncounterBuilderUpdate();
                }));

        new Setting(containerEl)
            .setName('User Compendium File')
            .setDesc('The name of the JSON file in the plugin folder for storing custom adversaries. It will be created if it doesn\'t exist.')
            .addText(text => text
                .setValue(this.plugin.settings.userCompendiumFile)
                .onChange(async (value) => {
                    this.plugin.settings.userCompendiumFile = value.trim() || DEFAULT_SETTINGS.userCompendiumFile;
                    if (!this.plugin.settings.userCompendiumFile.toLowerCase().endsWith('.json')) {
                        this.plugin.settings.userCompendiumFile += '.json';
                    }
                    await this.plugin.saveSettings();
                    this.triggerEncounterBuilderUpdate();
                }));

        new Setting(containerEl)
            .setName('User Abilities File')
            .setDesc('The name of the JSON file in the plugin folder for storing custom domain cards. It will be created if it doesn\'t exist.')
            .addText(text => text
                .setValue(this.plugin.settings.userAbilitiesFile)
                .onChange(async (value) => {
                    this.plugin.settings.userAbilitiesFile = value.trim() || DEFAULT_SETTINGS.userAbilitiesFile;
                    if (!this.plugin.settings.userAbilitiesFile.toLowerCase().endsWith('.json')) {
                        this.plugin.settings.userAbilitiesFile += '.json';
                    }
                    await this.plugin.saveSettings();
                    await this.plugin.characterCompendium.load();
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
                    this.triggerEncounterBuilderUpdate(true);
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
                frag.createEl('a', { text: 'account page', attr: { href: '[https://dddice.com/account/developer](https://dddice.com/account/developer)', target: '_blank' } });
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

    private triggerEncounterBuilderUpdate(drawOnly = false) {
        const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
        if (view instanceof EncounterBuilderView) {
            if (drawOnly) {
                view.drawUI();
            } else {
                (async () => {
                    await view.loadCompendium();
                    view.drawUI();
                })();
            }
        }
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