import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile, TFolder, Notice, TextComponent } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, CreatureInstance, DaggerheartPluginSettings, DEFAULT_SETTINGS, StatblockHpStress } from './types'; // Assuming types.ts is in the same directory

// --- CONSTANTS ---
export const ENCOUNTER_BUILDER_VIEW_TYPE = "dh-encounter-builder-view";

// --- ENCOUNTER VIEW CLASS ---
export class EncounterBuilderView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    compendiumCreatures: StatblockData[] = [];
    activeEncounterCreatures: CreatureInstance[] = [];
    private creatureInstanceCounters: { [key: string]: number } = {};

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return ENCOUNTER_BUILDER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Daggerheart Encounter Builder";
    }

    getIcon(): string {
        return "swords";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("dh-encounter-builder-container");

        await this.loadCompendium();
        this.drawUI(container);
    }

    async loadCompendium() {
        this.compendiumCreatures = await this.plugin.getCompendiumCreatures();
        this.compendiumCreatures.sort((a, b) => a.name.localeCompare(b.name));
    }

    drawUI(container: Element) {
        container.empty();

        const header = container.createDiv({ cls: "dh-encounter-header" });
        header.createEl("h2", { text: "Encounter Builder" });
        const controls = header.createDiv({ cls: "dh-encounter-controls" });
        const refreshButton = controls.createEl("button", { text: "Refresh Compendium" });
        refreshButton.addEventListener("click", async () => {
            await this.loadCompendium();
            this.drawUI(container);
            new Notice("Compendium refreshed!");
        });

        const mainInterface = container.createDiv({ cls: "dh-encounter-main-interface" });

        const compendiumPanel = mainInterface.createDiv({ cls: "dh-compendium-panel" });
        compendiumPanel.createEl("h3", { text: "Compendium" });
        const compendiumList = compendiumPanel.createDiv({ cls: "dh-compendium-list" });

        if (this.compendiumCreatures.length === 0) {
            compendiumList.createEl("p", { text: "No creatures found. Check plugin settings for the Compendium Folder and ensure it contains .md files with 'daggerheart-statblock' code blocks." });
        } else {
            this.compendiumCreatures.forEach(creatureData => {
                const creatureEntry = compendiumList.createDiv({ cls: "dh-compendium-entry" });
                creatureEntry.createSpan({ text: creatureData.name });
                const addButton = creatureEntry.createEl("button", { text: "+", cls: "dh-add-compendium-btn" });
                addButton.addEventListener("click", () => {
                    this.addCreatureToEncounter(creatureData);
                    this.drawUI(container);
                });
            });
        }

        const encounterPanel = mainInterface.createDiv({ cls: "dh-encounter-panel" });
        encounterPanel.createEl("h3", { text: "Active Encounter" });
        const encounterArea = encounterPanel.createDiv({ cls: "dh-encounter-area" });

        if (this.activeEncounterCreatures.length === 0) {
            encounterArea.createEl("p", { text: "No creatures added to the encounter yet." });
        } else {
            // Group instances by base creature name
            const groupedInstances: { [key: string]: CreatureInstance[] } = {};
            this.activeEncounterCreatures.forEach(instance => {
                if (!groupedInstances[instance.name]) {
                    groupedInstances[instance.name] = [];
                }
                groupedInstances[instance.name].push(instance);
            });

            for (const baseName in groupedInstances) {
                const instances = groupedInstances[baseName];
                if (instances.length > 0) {
                    // Create a container for this group of creatures (main card + additional trackers)
                    const creatureGroupContainer = encounterArea.createDiv({ cls: 'dh-creature-group-container' });

                    // Render the first instance as a full card
                    const firstInstance = instances[0];
                    const instanceTypeClass = firstInstance.type ? 'dh-type-' + firstInstance.type.toLowerCase().replace(/\s+/g, '-') : 'dh-type-default';
                    const mainCardContainer = creatureGroupContainer.createDiv({ cls: `dh-creature-instance-card ${instanceTypeClass}` });

                    const removeButton = mainCardContainer.createEl("button", { text: "✕", cls: "dh-remove-instance-btn" });
                    removeButton.addEventListener("click", () => {
                        this.removeCreatureFromEncounter(firstInstance.id);
                        this.drawUI(container); // Redraw entire UI
                    });
                    this.plugin.renderStatblockCard(firstInstance, mainCardContainer, true, firstInstance.displayName);

                    // Find the placeholder for additional trackers within the rendered main card
                    const additionalTrackersContainer = mainCardContainer.querySelector('.dh-additional-trackers-container');

                    // Render subsequent instances as additional tracker rows
                    if (additionalTrackersContainer) {
                        for (let i = 1; i < instances.length; i++) {
                            this.renderAdditionalTrackerRow(instances[i], additionalTrackersContainer as HTMLElement);
                        }
                    }
                }
            }
        }
    }

    renderAdditionalTrackerRow(instance: CreatureInstance, parentEl: HTMLElement) {
        const trackerRow = parentEl.createDiv({ cls: 'dh-additional-tracker-row' });

        const header = trackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: instance.displayName, cls: 'dh-additional-tracker-name' });
        const removeBtn = header.createEl('button', { text: '✕', cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => {
            this.removeCreatureFromEncounter(instance.id);
            this.drawUI(this.containerEl.children[1]); // Redraw the whole view
        });

        this.plugin.createInteractiveTrack(trackerRow, 'HP', instance.hp_stress.hp, `${instance.id}-hp`, instance.currentHp, (newHp) => instance.currentHp = newHp);
        this.plugin.createInteractiveTrack(trackerRow, 'Stress', instance.hp_stress.stress, `${instance.id}-stress`, instance.currentStress, (newStress) => instance.currentStress = newStress);
    }


    addCreatureToEncounter(baseCreature: StatblockData) {
        const baseNameKey = baseCreature.name; // Use the original name as the key for grouping
        if (!this.creatureInstanceCounters[baseNameKey]) {
            this.creatureInstanceCounters[baseNameKey] = 0;
        }
        this.creatureInstanceCounters[baseNameKey]++;
        const instanceNumber = this.creatureInstanceCounters[baseNameKey];

        const newInstance: CreatureInstance = {
            ...JSON.parse(JSON.stringify(baseCreature)), // Deep copy
            id: `${baseCreature.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${instanceNumber}`,
            currentHp: baseCreature.hp_stress.hp,
            currentStress: baseCreature.hp_stress.stress,
            displayName: `${baseCreature.name} #${instanceNumber}`,
            // 'name' property from baseCreature is already part of the spread
        };
        this.activeEncounterCreatures.push(newInstance);
    }

    removeCreatureFromEncounter(instanceId: string) {
        this.activeEncounterCreatures = this.activeEncounterCreatures.filter(c => c.id !== instanceId);
        // Note: creatureInstanceCounters are not decremented here to simplify logic. 
        // If an instance is removed and a new one of the same type is added, it will get a new higher number.
        // This is generally fine.
    }

    async onClose() {
        // Clean up
    }
}

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;

    async onload() {
        console.log('Loading Daggerheart Statblock Plugin (TypeScript Version)');
        await this.loadSettings();

        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el, ctx) => {
            try {
                const cleanedSource = source.replace(/\u00A0/g, ' ');
                const data = YAML.load(cleanedSource) as StatblockData;

                if (!data || typeof data !== 'object') {
                    throw new Error("Parsed data is not a valid object.");
                }
                this.renderStatblockCard(data, el, false, data.name);
            } catch (e: any) {
                console.error('Daggerheart Statblock: Error processing code block.', e);
                const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
                errorEl.setText(`Error rendering Daggerheart Statblock:\n${e.message}\n\nSource:\n${source}`);
            }
        });

        this.registerView(
            ENCOUNTER_BUILDER_VIEW_TYPE,
            (leaf) => new EncounterBuilderView(leaf, this)
        );

        this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-daggerheart-encounter-builder',
            name: 'Open Encounter Builder',
            callback: () => {
                this.activateView();
            },
        });

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

    async getCompendiumCreatures(): Promise<StatblockData[]> {
        const creatures: StatblockData[] = [];
        const folderPath = this.settings.compendiumFolder;

        if (!folderPath) {
            new Notice("Compendium folder not set in Daggerheart plugin settings.");
            return [];
        }

        const abstractFileOrFolder = this.app.vault.getAbstractFileByPath(folderPath);

        if (!abstractFileOrFolder) {
            new Notice(`Compendium path "${folderPath}" not found.`);
            return [];
        }

        if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            const fileContent = await this.app.vault.cachedRead(abstractFileOrFolder);
            this.extractStatblocksFromFile(fileContent, abstractFileOrFolder.path, creatures);
        } else if (abstractFileOrFolder instanceof TFolder) {
            const files = abstractFileOrFolder.children.filter(
                (file): file is TFile => file instanceof TFile && file.extension === 'md'
            );
            for (const file of files) {
                const fileContent = await this.app.vault.cachedRead(file);
                this.extractStatblocksFromFile(fileContent, file.path, creatures);
            }
        } else {
            new Notice(`Compendium path "${folderPath}" is not a valid Markdown file or folder.`);
            return [];
        }
        return creatures;
    }

    private extractStatblocksFromFile(content: string, filePath: string, creaturesArray: StatblockData[]) {
        const codeBlockRegex = /```daggerheart-statblock\s*([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            try {
                const yamlContent = match[1].replace(/\u00A0/g, ' ');
                const statblock = YAML.load(yamlContent) as StatblockData;
                if (statblock && statblock.name && statblock.hp_stress) {
                    statblock.sourceFile = filePath;
                    statblock.hp_stress.hp = Number(statblock.hp_stress.hp);
                    statblock.hp_stress.stress = Number(statblock.hp_stress.stress);
                    if (statblock.hp_stress.minor_hp) statblock.hp_stress.minor_hp = Number(statblock.hp_stress.minor_hp);
                    if (statblock.hp_stress.major_hp) statblock.hp_stress.major_hp = Number(statblock.hp_stress.major_hp);
                    creaturesArray.push(statblock);
                }
            } catch (e: any) {
                console.warn(`Daggerheart: Failed to parse YAML for a statblock in ${filePath}: ${e.message}.`);
            }
        }
    }

    renderStatblockCard(data: StatblockData | CreatureInstance, containerEl: HTMLElement, isInstance: boolean = false, displayName?: string) {
        if (!isInstance) { // For direct ```daggerheart-statblock``` rendering in notes
            containerEl.empty();
        }
        // For instance cards, containerEl IS the .dh-creature-instance-card. Content goes into .dh-instance-card-content

        const statblockContentDiv = isInstance ? containerEl.createDiv({ cls: 'dh-instance-card-content' }) : containerEl.createDiv({ cls: 'dh-statblock' });
        // If it's an instance, the main containerEl already has .dh-creature-instance-card. We add content to it.
        // If not an instance, containerEl is the code block's parent, and we create .dh-statblock inside.

        if (data.image && isInstance) {
            const imgContainer = containerEl.createDiv({ cls: 'dh-card-image-container', prepend: true }); // Prepend to be at the top of the card
            imgContainer.createEl('img', { attr: { src: data.image, alt: data.name }, cls: 'dh-card-image' });
        }

        const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
        const nameToDisplay = displayName || data.name;

        if (nameToDisplay) {
            const nameEl = headerDiv.createSpan({ cls: 'dh-name' });
            nameEl.setText(`${nameToDisplay.toUpperCase()}`);
        }

        if (isInstance) {
            let roleTagText = "";
            if (data.tier) roleTagText += `Tier ${data.tier} `;
            if (data.type) roleTagText += data.type.toUpperCase();
            if (roleTagText.trim()) {
                const roleTagDiv = statblockContentDiv.createDiv({ text: roleTagText.trim(), cls: 'dh-card-role-text' });
                headerDiv.insertAdjacentElement('afterend', roleTagDiv);
            }
        } else if (data.title) {
            headerDiv.createSpan({ text: ` ${data.title.toUpperCase()}`, cls: 'dh-title' });
        }


        if (!isInstance && data.tier) {
            const metaDiv = statblockContentDiv.createDiv({ cls: 'dh-meta' });
            metaDiv.createSpan({ text: `Tier ${data.tier}`, cls: 'dh-tier' });
            if (data.type) metaDiv.createSpan({ text: data.type, cls: 'dh-type' });
        }
        if (!isInstance && data.description) {
            statblockContentDiv.createDiv({ text: data.description, cls: 'dh-description' });
        }

        if (!isInstance && data.motives_tactics && Array.isArray(data.motives_tactics) && data.motives_tactics.length > 0) {
            const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics:' });
            motivesDiv.appendText(` ${data.motives_tactics.join(', ')}`);
        }

        const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
        if (data.difficulty !== undefined) {
            coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
        }
        if (data.attack) {
            let modifierText = data.attack.modifier !== undefined && data.attack.modifier !== null
                ? String(data.attack.modifier) : 'N/A';
            if (modifierText !== 'N/A' && !modifierText.startsWith('+') && !modifierText.startsWith('-')) {
                const numModifier = parseFloat(modifierText);
                if (!isNaN(numModifier) && numModifier > 0) {
                    modifierText = `+${modifierText}`;
                }
            }
            let attackDisplay = "";
            if (isInstance) {
                attackDisplay = `<strong>${data.attack.name || 'Attack'}:</strong> ${data.attack.range || ''} – ${data.attack.damage || ''} (ATK ${modifierText})`;
            } else {
                attackDisplay = `<strong>ATK:</strong> ${modifierText} | <strong>${data.attack.name || 'Attack'}:</strong> ${data.attack.range || ''} | ${data.attack.damage || ''}`;
            }
            const attackSpan = coreStatsLine.createSpan({ cls: 'dh-attack-details-span' });
            attackSpan.innerHTML = attackDisplay;
        }

        if (!isInstance && data.experience && typeof data.experience === 'object') {
            const expDiv = statblockContentDiv.createDiv({ cls: 'dh-experience' });
            let expString = '<strong>Experience:</strong> ';
            const expParts = [];
            for (const key in data.experience) {
                if (Object.prototype.hasOwnProperty.call(data.experience, key)) {
                    expParts.push(`${key.charAt(0).toUpperCase() + key.slice(1)} +${data.experience[key]}`);
                }
            }
            expString += expParts.join(', ');
            expDiv.innerHTML = expString;
        }

        if (data.features && Array.isArray(data.features) && data.features.length > 0) {
            const featuresSectionDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
            featuresSectionDiv.createDiv({ text: 'FEATURES', cls: isInstance ? 'dh-instance-features-title' : 'dh-features-title' });

            const featuresListUl = featuresSectionDiv.createEl('ul', { cls: 'dh-features-list' });
            data.features.forEach(feature => {
                if (typeof feature !== 'object' || !feature.name) return;
                const featureLi = featuresListUl.createEl('li');

                const headerContainer = featureLi.createDiv({ cls: 'dh-feature-header-container' });

                let featureHeaderString = `<strong>${feature.name}`;
                if (feature.cost !== undefined && feature.cost !== null && typeof feature.cost === 'number') {
                    featureHeaderString += ` (${feature.cost})`;
                }
                featureHeaderString += `</strong>`;
                if (feature.type) {
                    featureHeaderString += ` - ${feature.type}`;
                }

                const nameSpan = headerContainer.createSpan({ cls: 'dh-feature-name' });
                nameSpan.innerHTML = featureHeaderString;

                let fullDescriptionText = "";
                if (feature.countdown) {
                    const countdownStr = `Countdown (${feature.countdown}).`;
                    const descToCheck = feature.description ? String(feature.description).toLowerCase().trim() : "";
                    const countdownKeyPhrase = `countdown (${String(feature.countdown).toLowerCase().trim()})`;
                    if (!descToCheck.includes(countdownKeyPhrase)) {
                        fullDescriptionText += `${countdownStr} `;
                    }
                }
                if (feature.description) {
                    fullDescriptionText += feature.description;
                }

                if (isInstance) {
                    if (fullDescriptionText.trim()) {
                        const toggle = headerContainer.createSpan({ cls: 'dh-feature-toggle', text: ' [+]' });
                        toggle.setAttribute('aria-expanded', 'false');
                        toggle.setAttribute('role', 'button');
                        const descDiv = featureLi.createDiv({ cls: 'dh-feature-description dh-feature-description-hidden' });
                        descDiv.setText(fullDescriptionText.trim());
                        toggle.addEventListener('click', (event) => {
                            event.stopPropagation();
                            const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                            toggle.setText(isHidden ? ' [+]' : ' [-]');
                            toggle.setAttribute('aria-expanded', String(!isHidden));
                        });
                    }
                } else {
                    nameSpan.innerHTML += ':';
                    if (fullDescriptionText.trim()) {
                        const descDiv = featureLi.createDiv({ cls: 'dh-feature-description' });
                        descDiv.setText(fullDescriptionText.trim());
                    }
                }
            });
        }

        if (data.hp_stress && typeof data.hp_stress === 'object') {
            const hpStressContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });
            if (!isInstance) { // Only show main HP & STRESS title for full statblocks
                hpStressContainer.createEl('h4', { text: 'HP & STRESS', cls: 'dh-hp-stress-title' });
            }

            const hpMax = Number(data.hp_stress.hp) || 0;
            const stressMax = Number(data.hp_stress.stress) || 0;

            const summaryLineHP = hpStressContainer.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineHP.innerHTML = `<span class="dh-summary-label">HP:</span> <span class="dh-summary-value">${hpMax}</span>`;

            const thresholdsInlineContainer = summaryLineHP.createSpan({ cls: 'dh-thresholds-inline' });
            if (data.hp_stress.minor_hp !== undefined && data.hp_stress.minor_hp !== null) {
                thresholdsInlineContainer.createSpan({ text: 'Minor', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.minor_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (data.hp_stress.major_hp !== undefined && data.hp_stress.major_hp !== null) {
                thresholdsInlineContainer.createSpan({ text: 'Major', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.major_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (Object.prototype.hasOwnProperty.call(data.hp_stress, 'severe_hp') || data.hp_stress.minor_hp || data.hp_stress.major_hp) {
                thresholdsInlineContainer.createSpan({ text: 'Severe', cls: 'dh-threshold-box dh-threshold-box-label' });
            }

            const summaryLineStress = hpStressContainer.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineStress.innerHTML = `<span class="dh-summary-label">Stress:</span> <span class="dh-summary-value">${stressMax}</span>`;

            // Only render interactive tracks for the specific instance being displayed by this function call
            // (which is the first instance if isInstance is true, or not an instance at all)
            if (isInstance) { // This means it's the main card for an instance group
                const creatureInstance = data as CreatureInstance;
                this.createInteractiveTrack(hpStressContainer, 'HP', hpMax, `${creatureInstance.id}-hp`, creatureInstance.currentHp, (newHp) => creatureInstance.currentHp = newHp);
                this.createInteractiveTrack(hpStressContainer, 'Stress', stressMax, `${creatureInstance.id}-stress`, creatureInstance.currentStress, (newStress) => creatureInstance.currentStress = newStress);

                // Add the placeholder for additional trackers
                hpStressContainer.createDiv({ cls: 'dh-additional-trackers-container' });
            }
        }
    }

    createInteractiveTrack(
        parentEl: HTMLElement,
        label: string,
        maxValue: number,
        trackIdPrefix: string,
        currentValue: number,
        updateCallback: (newValue: number) => void
    ) {
        const trackDiv = parentEl.createDiv({ cls: `dh-interactive-track dh-${label.toLowerCase()}-track` });
        trackDiv.createSpan({ text: label.toUpperCase(), cls: 'dh-track-label' });
        const controlsDiv = trackDiv.createDiv({ cls: 'dh-track-controls' });
        const decrementButton = controlsDiv.createEl('button', { text: '−', cls: 'dh-track-btn dh-track-btn-decrement' });
        const pipsContainer = controlsDiv.createDiv({ cls: 'dh-pips-container' });
        const pips: HTMLDivElement[] = [];

        const updatePipsAndState = (newVal: number) => {
            let actualNewValue = Math.max(0, Math.min(newVal, maxValue));
            pips.forEach((p, idx) => {
                if (idx < actualNewValue) p.classList.add('dh-pip-marked');
                else p.classList.remove('dh-pip-marked');
            });
            updateCallback(actualNewValue);
        };

        for (let i = 0; i < maxValue; i++) {
            const pip = pipsContainer.createDiv({ cls: 'dh-pip' });
            pip.dataset.index = i.toString();
            if (i < currentValue) {
                pip.classList.add('dh-pip-marked');
            }
            pip.addEventListener('click', () => {
                const clickedIndex = parseInt(pip.dataset.index!);
                const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
                if (pip.classList.contains('dh-pip-marked') && clickedIndex === currentMarkedCount - 1 && currentMarkedCount === clickedIndex + 1) {
                    updatePipsAndState(clickedIndex);
                } else {
                    updatePipsAndState(clickedIndex + 1);
                }
            });
            pips.push(pip);
        }

        const incButton = controlsDiv.createEl('button', { text: '+', cls: 'dh-track-btn dh-track-btn-increment' });

        decrementButton.addEventListener('click', () => {
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            if (currentMarkedCount > 0) {
                updatePipsAndState(currentMarkedCount - 1);
            }
        });

        incButton.addEventListener('click', () => {
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            if (currentMarkedCount < maxValue) {
                updatePipsAndState(currentMarkedCount + 1);
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        console.log('Unloading Daggerheart Statblock Plugin');
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
    }
}

class DaggerheartSettingTab extends PluginSettingTab {
    plugin: DaggerheartStatblockPlugin;

    constructor(app: App, plugin: DaggerheartStatblockPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Daggerheart Statblock Settings' });

        new Setting(containerEl)
            .setName('Compendium Folder')
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Creatures"). Leave empty to disable compendium.')
            .addText((text: TextComponent) => {
                text
                    .setPlaceholder('Example: Path/To/Creatures')
                    .setValue(this.plugin.settings.compendiumFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.compendiumFolder = value.trim();
                        await this.plugin.saveSettings();
                        const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                        if (view instanceof EncounterBuilderView) {
                            await view.loadCompendium();
                            view.drawUI(view.containerEl.children[1]);
                        }
                    });
            });
    }
}
