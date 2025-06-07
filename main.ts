import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './src/view';
import { getCompendiumCreatures } from './src/parsing';
import { renderStatblockCard, createInteractiveTrack } from './src/rendering';

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    isDiceRollerEnabled: boolean = false;

    async onload() {
        console.log('Loading Daggerheart Statblock Plugin');
        await this.loadSettings();

        // Check if the Dice Roller plugin and its API are available.
        this.isDiceRollerEnabled = (this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api != null;
        if (this.isDiceRollerEnabled) {
            console.log('Daggerheart: Dice Roller plugin detected.');
        } else {
            console.log('Daggerheart: Dice Roller plugin not detected. Dice rolling will be disabled.');
        }


        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el, ctx) => {
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
        });

        this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new EncounterBuilderView(leaf, this));
        this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => this.activateView());
        this.addCommand({ id: 'open-daggerheart-encounter-builder', name: 'Open Encounter Builder', callback: () => this.activateView() });
        this.addSettingTab(new DaggerheartSettingTab(this.app, this));
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);

        await this.app.workspace.getRightLeaf(false)?.setViewState({
            type: ENCOUNTER_BUILDER_VIEW_TYPE,
            active: true,
        });
        const leaves = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    getCompendiumCreatures() {
        return getCompendiumCreatures(this);
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

        new Setting(containerEl)
            .setName('Compendium Folder')
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Creatures"). Leave empty to disable user compendium.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Example: Path/To/Creatures')
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
            .setName('Show Description on Instance Cards')
            .setDesc('If enabled, the full description will be shown on creature cards in the encounter builder.')
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
            .setDesc('If enabled, feature descriptions will be expanded by default on creature cards.')
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
    }
}
