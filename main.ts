import { App, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf, Notice, Editor, MarkdownView, TFile, EventRef } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS, Character } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './src/views/EncounterBuilderView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './src/views/CharacterSheetView';
import { getCompendiumItems, saveItemToUserCompendium } from './src/services/compendium';
import { CharacterCompendium } from './src/services/characterCompendium';
import { renderStatblockCard } from './src/rendering/statblock';
import { createInteractiveTrack } from './src/rendering/ui-helpers';
import { AdversaryReferenceModal, EncounterLinkModal } from './src/modals/index';

// Declare a custom event for the workspace to allow views to communicate
declare module "obsidian" {
    interface Workspace {
        on(name: 'daggerheart-character-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-character-update'): void;
    }
}

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    isDiceRollerEnabled: boolean = false;
    characterCompendium: CharacterCompendium;

    private characters: Character[] = [];
    private activeCharacterId: string | null = null;

    async onload() {
        console.log('Loading Daggerheart Plugin');
        await this.loadSettings();

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

    public setActiveCharacterId(id: string | null) {
        this.activeCharacterId = id;
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

    // --- PUBLIC UTILITY METHODS ---

    public getCompendiumItems() {
        return getCompendiumItems(this);
    }

    public saveItemToUserCompendium(itemData: StatblockData) {
        return saveItemToUserCompendium(this, itemData);
    }

    public createInteractiveTrack(parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string, currentValue: number, updateCallback: (newValue: number) => void) {
        createInteractiveTrack(parentEl, label, maxValue, trackIdPrefix, currentValue, updateCallback);
    }

    public async rollDice(diceString: string) {
        if (!this.settings.enableDiceRoller || !this.isDiceRollerEnabled) {
            new Notice("Dice Roller integration is not enabled.");
            return;
        }
        const diceRollerPlugin = (this.app as any).plugins.getPlugin("obsidian-dice-roller");
        if (!diceRollerPlugin || typeof diceRollerPlugin.api?.getRoller !== 'function') {
            new Notice("Dice Roller plugin API not available.");
            return;
        }
        try {
            const roller = await diceRollerPlugin.api.getRoller(diceString);
            await roller.roll({ showDice: this.settings.useGraphicalDice, throw: this.settings.useGraphicalDice });
            if (!this.settings.useGraphicalDice) {
                new Notice(`Rolled ${diceString}: ${roller.result}`, 5000);
            }
        } catch (e) {
            console.error("Daggerheart: Error rolling dice:", e);
            new Notice(`Error rolling dice for "${diceString}".`);
        }
    }

    // --- SETTINGS & UNLOADING ---

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    onunload() {
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        this.app.workspace.detachLeavesOfType(CHARACTER_SHEET_VIEW_TYPE);
    }
}

class DaggerheartSettingTab extends PluginSettingTab {
    plugin: DaggerheartStatblockPlugin;
    constructor(app: App, plugin: DaggerheartStatblockPlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Daggerheart Statblock Settings' });

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
                        const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                        if (view instanceof EncounterBuilderView) {
                            await view.loadCompendium(); view.drawUI();
                        }
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
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) {
                        await view.loadCompendium(); view.drawUI();
                    }
                }));

        new Setting(containerEl)
            .setName('Use SRD Environments')
            .setDesc(`Include the Daggerheart SRD environments from the plugin's "environments.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdEnvironments)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdEnvironments = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) {
                        await view.loadCompendium();
                        view.drawUI();
                    }
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
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) {
                        await view.loadCompendium();
                        view.drawUI();
                    }
                }));

        containerEl.createEl('h3', { text: 'Encounter View Settings' });

        new Setting(containerEl)
            .setName('Show Description on Instance Cards')
            .setDesc('If enabled, the full description will be shown on adversary cards in the encounter builder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDescriptionOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showDescriptionOnCards = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Expand Feature Descriptions by Default')
            .setDesc('If enabled, feature descriptions will be expanded by default on adversary cards.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFeatureDetailsOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showFeatureDetailsOnCards = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Enable Fear Tracker')
            .setDesc('If enabled, a fear counter will be shown in the encounter view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableFearTracker)
                .onChange(async (value) => {
                    this.plugin.settings.enableFearTracker = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Enable Countdown Tracker')
            .setDesc('If enabled, a button to show the countdown tracker will be available in the encounter view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCountdownTracker)
                .onChange(async (value) => {
                    this.plugin.settings.enableCountdownTracker = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Enable Encounter Budget')
            .setDesc('If enabled, a Daggerheart encounter budget calculator will be shown in the encounter view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableEncounterBudget)
                .onChange(async (value) => {
                    this.plugin.settings.enableEncounterBudget = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) {
                        view.drawUI();
                    }
                }));

        containerEl.createEl('h3', { text: 'Integrations' });

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
                        new Notice('Dice Roller plugin not found. Please install it to use dice rolling features.');
                    }
                    this.display();
                }));

        if (this.plugin.settings.enableDiceRoller) {
            const diceToggle = new Setting(containerEl)
                .setName('Use Graphical Dice')
                .setDesc('If enabled, dice rolls will use graphical 3D dice (requires Dice Roller plugin).')
                .addToggle(toggle => {
                    const isPluginAvailable = this.plugin.isDiceRollerEnabled;
                    toggle
                        .setValue(isPluginAvailable ? this.plugin.settings.useGraphicalDice : false)
                        .setDisabled(!isPluginAvailable)
                        .onChange(async (value) => {
                            this.plugin.settings.useGraphicalDice = value;
                            await this.plugin.saveSettings();
                        });
                });

            if (!this.plugin.isDiceRollerEnabled) {
                diceToggle.setClass('setting-disabled');
                containerEl.createEl('div', {
                    text: 'Dice Roller plugin is not installed. Install it to enable graphical dice.',
                    cls: 'setting-item-description'
                });
            }
        }
    }
}
