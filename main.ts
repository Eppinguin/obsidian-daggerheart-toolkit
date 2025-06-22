import { App, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf, Notice, Editor, MarkdownView } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './src/views/EncounterBuilderView';
import { getCompendiumItems, saveItemToUserCompendium } from './src/services/compendium';
import { renderStatblockCard } from './src/rendering/statblock';
import { createInteractiveTrack } from './src/rendering/ui-helpers';
import { AdversaryReferenceModal, EncounterLinkModal } from './src/modals/index';

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    isDiceRollerEnabled: boolean = false;

    async onload() {
        console.log('Loading Daggerheart Statblock Plugin');
        await this.loadSettings();

        this.isDiceRollerEnabled = this.settings.enableDiceRoller && (this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api != null;
        if (this.settings.enableDiceRoller) {
            if (this.isDiceRollerEnabled) {
                console.log('Daggerheart: Dice Roller plugin detected and enabled.');
            } else {
                new Notice('Dice Roller plugin not found. Please install it to use dice rolling features.');
            }
        } else {
            console.log('Daggerheart: Dice Roller integration disabled in settings.');
        }

        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el) => {
            this.processStatblock(source, el);
        });

        this.registerMarkdownCodeBlockProcessor('daggerheart-embed', (source, el) => {
            this.processEmbed(source, el);
        });

        this.registerObsidianProtocolHandler("dh-encounter", (params) => {
            const encounterId = params.id;
            if (encounterId) {
                this.activateView(encounterId);
            } else {
                new Notice("Could not find encounter ID in the link.");
            }
        });

        this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new EncounterBuilderView(leaf, this));
        this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => this.activateView());
        this.addCommand({ id: 'open-daggerheart-encounter-builder', name: 'Open Encounter Builder', callback: () => this.activateView() });
        this.addCommand({
            id: 'insert-adversary-statblock',
            name: 'Insert Adversary Statblock',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new AdversaryReferenceModal(this.app, this, (adversary) => {
                    const embedCode = `\`\`\`daggerheart-embed\nadversary: ${adversary.name}\n\`\`\``;
                    editor.replaceSelection(embedCode);
                }, 'adversary').open();
            }
        });

        this.addCommand({
            id: 'insert-environment-statblock',
            name: 'Insert Environment Statblock',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new AdversaryReferenceModal(this.app, this, (environment) => {
                    const embedCode = `\`\`\`daggerheart-embed\nenvironment: ${environment.name}\n\`\`\``;
                    editor.replaceSelection(embedCode);
                }, 'environment').open();
            }
        });

        this.addCommand({
            id: 'insert-encounter-link',
            name: 'Insert Encounter Link',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new EncounterLinkModal(this.app, this, (encounter) => {
                    const linkText = `[${encounter.name}](obsidian://dh-encounter?id=${encounter.id})`;
                    editor.replaceSelection(linkText);
                }).open();
            }
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


    async activateView(encounterId?: string) {
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

    getCompendiumItems() {
        return getCompendiumItems(this);
    }

    saveItemToUserCompendium(itemData: StatblockData) {
        return saveItemToUserCompendium(this, itemData);
    }

    createInteractiveTrack(
        parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string,
        currentValue: number, updateCallback: (newValue: number) => void
    ) {
        createInteractiveTrack(parentEl, label, maxValue, trackIdPrefix, currentValue, updateCallback);
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
    onunload() {
        console.log('Unloading Daggerheart Statblock Plugin');
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
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
