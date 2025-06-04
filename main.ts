import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile, TFolder, Notice, TextComponent, Modal, ButtonComponent, Menu, setIcon } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, CreatureInstance, DaggerheartPluginSettings, DEFAULT_SETTINGS, SavedEncounter, StatblockFeature, StatblockExperience, StatblockHpStress } from './types';

// --- CONSTANTS ---
export const ENCOUNTER_BUILDER_VIEW_TYPE = "dh-encounter-builder-view";
const SRD_ADVERSARIES_FILE = "adversaries.json";

// --- MODAL FOR NAMING/RENAMING ENCOUNTER ---
class NameEncounterModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSubmit: (name: string) => void;
    existingNames: string[];
    currentNameValue?: string | null;
    titleText: string;
    private nameInputComponent!: TextComponent;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, title: string, existingNames: string[], currentNameVal: string | null | undefined, onSubmit: (name: string) => void) {
        super(app);
        this.plugin = plugin;
        this.titleText = title;
        this.onSubmit = onSubmit;
        this.existingNames = existingNames;
        this.currentNameValue = currentNameVal;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-name-modal');
        contentEl.createEl("h2", { text: this.titleText });

        new Setting(contentEl)
            .setName("Encounter Name")
            .addText((text) => {
                this.nameInputComponent = text;
                text.setPlaceholder("Enter encounter name")
                    .setValue(this.currentNameValue || "");
                text.inputEl.addClass('dh-modal-input');
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.submitName(this.nameInputComponent.getValue());
                    }
                });
                this.app.workspace.onLayoutReady(() => text.inputEl.focus());
            });

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
                this.submitName(this.nameInputComponent.getValue());
            });
        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                this.close();
            });
    }

    submitName(name: string) {
        const trimmedName = name.trim();
        if (!trimmedName) {
            new Notice("Encounter name cannot be empty.");
            return;
        }
        if (this.existingNames.includes(trimmedName) && trimmedName !== this.currentNameValue) {
            new Notice(`An encounter named "${trimmedName}" already exists. Choose a different name.`);
            return;
        }
        this.onSubmit(trimmedName);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- MODAL FOR MANAGING SAVED ENCOUNTERS ---
class ManageEncountersModal extends Modal {
    view: EncounterBuilderView;

    constructor(app: App, view: EncounterBuilderView) {
        super(app);
        this.view = view;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-manage-encounters-modal');
        contentEl.createEl("h2", { text: "Manage Saved Encounters" });

        const listEl = contentEl.createDiv({ cls: "dh-manage-list" });

        if (this.view.plugin.settings.savedEncounters.length === 0) {
            listEl.createEl("p", { text: "No saved encounters." });
        } else {
            this.view.plugin.settings.savedEncounters.forEach(savedEncounter => {
                const entryEl = listEl.createDiv({ cls: "dh-manage-list-item" });

                const nameContainer = entryEl.createDiv({ cls: "dh-manage-item-name-container" });
                nameContainer.createSpan({ text: savedEncounter.name, cls: "dh-manage-item-name" });

                const buttonsEl = entryEl.createDiv({ cls: "dh-manage-item-buttons" });

                new ButtonComponent(buttonsEl)
                    .setIcon("pencil")
                    .setTooltip("Rename Encounter")
                    .setClass("dh-icon-button")
                    .onClick(() => {
                        this.close();
                        this.view.handleRenameEncounter(savedEncounter.id);
                    });

                const deleteButton = new ButtonComponent(buttonsEl)
                    .setIcon("trash")
                    .setTooltip("Delete Encounter")
                    .setClass("dh-icon-button")
                    .setClass("dh-delete-btn-confirmable")
                    .onClick(async () => {
                        if (deleteButton.buttonEl.classList.contains('is-confirming-delete')) {
                            await this.view.handleDeleteEncounter(savedEncounter.id);
                            this.onOpen(); // Refresh modal
                        } else {
                            deleteButton.buttonEl.classList.add('is-confirming-delete');
                            deleteButton.setTooltip("Confirm Delete?");
                            setIcon(deleteButton.buttonEl, "check-circle");
                            setTimeout(() => {
                                if (deleteButton.buttonEl.classList.contains('is-confirming-delete')) {
                                    deleteButton.buttonEl.classList.remove('is-confirming-delete');
                                    deleteButton.setTooltip("Delete Encounter");
                                    setIcon(deleteButton.buttonEl, "trash");
                                }
                            }, 3000);
                        }
                    });
            });
        }
        const closeButtonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons', attr: { 'style': 'justify-content: center; margin-top: var(--size-4-4);' } });
        new ButtonComponent(closeButtonContainer)
            .setButtonText("Close")
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- ENCOUNTER VIEW CLASS ---
export class EncounterBuilderView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    compendiumCreatures: StatblockData[] = [];
    activeEncounterCreatures: CreatureInstance[] = [];

    currentEncounterId: string | null = null;
    private uiContainer: HTMLElement | null = null;
    private isCompendiumVisible: boolean = true;
    private compendiumSearchTerm: string = "";
    private selectedTiers: Set<number> = new Set();
    private selectedTypes: Set<string> = new Set();

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return ENCOUNTER_BUILDER_VIEW_TYPE;
    }

    getDisplayText(): string {
        if (this.currentEncounterId) {
            const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            return currentEncounter ? `Encounter: ${currentEncounter.name}` : "Daggerheart Encounters";
        }
        return "Daggerheart Encounters";
    }

    async onOpen() {
        this.uiContainer = this.containerEl.children[1] as HTMLElement;
        this.uiContainer.empty();
        this.uiContainer.addClass("dh-encounter-builder-container");

        await this.loadCompendium();

        const persistedState = this.leaf.getEphemeralState();
        if (persistedState) {
            if (persistedState.currentEncounterId) {
                this.currentEncounterId = persistedState.currentEncounterId;
            }
            this.isCompendiumVisible = typeof persistedState.isCompendiumVisible === 'boolean' ? persistedState.isCompendiumVisible : true;
            this.compendiumSearchTerm = typeof persistedState.compendiumSearchTerm === 'string' ? persistedState.compendiumSearchTerm : "";
            if (Array.isArray(persistedState.selectedTiers)) {
                this.selectedTiers = new Set(persistedState.selectedTiers);
            }
            if (Array.isArray(persistedState.selectedTypes)) {
                this.selectedTypes = new Set(persistedState.selectedTypes);
            }
        }

        this.ensureActiveEncounter();
        this.loadCreaturesForCurrentEncounter();
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    async setState(state: any, result: any) {
        if (state) {
            if (state.currentEncounterId) {
                this.currentEncounterId = state.currentEncounterId;
                if (!this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId)) {
                    this.currentEncounterId = null;
                }
            }
            if (typeof state.isCompendiumVisible === 'boolean') {
                this.isCompendiumVisible = state.isCompendiumVisible;
            }
            if (typeof state.compendiumSearchTerm === 'string') {
                this.compendiumSearchTerm = state.compendiumSearchTerm;
            }
            if (Array.isArray(state.selectedTiers)) {
                this.selectedTiers = new Set(state.selectedTiers);
            }
            if (Array.isArray(state.selectedTypes)) {
                this.selectedTypes = new Set(state.selectedTypes);
            }
        }
        this.ensureActiveEncounter();
        this.loadCreaturesForCurrentEncounter();
        if (this.uiContainer && this.contentEl.children.length > 0) {
            this.drawUI();
        }
        await super.setState(state, result);
        this.app.workspace.requestSaveLayout();
    }

    getState() {
        return {
            currentEncounterId: this.currentEncounterId,
            isCompendiumVisible: this.isCompendiumVisible,
            compendiumSearchTerm: this.compendiumSearchTerm,
            selectedTiers: Array.from(this.selectedTiers),
            selectedTypes: Array.from(this.selectedTypes)
        };
    }

    ensureActiveEncounter() {
        if (this.plugin.settings.savedEncounters.length === 0) {
            this.handleNewEncounter(true, "My First Encounter");
        } else if (!this.currentEncounterId || !this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId)) {
            this.currentEncounterId = this.plugin.settings.savedEncounters[0]?.id || null;
            if (!this.currentEncounterId && this.plugin.settings.savedEncounters.length > 0) {
                this.handleNewEncounter(true, "My First Encounter");
            }
        }
    }

    loadCreaturesForCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            this.activeEncounterCreatures = encounter ? JSON.parse(JSON.stringify(encounter.creatures)) : [];
        } else {
            this.activeEncounterCreatures = [];
        }
    }

    async loadCompendium() {
        this.compendiumCreatures = await this.plugin.getCompendiumCreatures();
        this.compendiumCreatures.sort((a, b) => a.name.localeCompare(b.name));
    }

    async autoSaveCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounterIndex = this.plugin.settings.savedEncounters.findIndex(e => e.id === this.currentEncounterId);
            if (encounterIndex !== -1) {
                this.plugin.settings.savedEncounters[encounterIndex].creatures = JSON.parse(JSON.stringify(this.activeEncounterCreatures));
                await this.plugin.saveSettings();
                console.log(`Daggerheart: Encounter "${this.plugin.settings.savedEncounters[encounterIndex].name}" (ID: ${this.currentEncounterId}) autosaved.`);
            }
        }
    }

    showEncounterSwitcherMenu(event: MouseEvent) {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Create New Encounter...").setIcon("plus-circle").onClick(() => this.handleNewEncounter()));
        menu.addItem((item) => item.setTitle("Manage Saved Encounters...").setIcon("settings").onClick(() => new ManageEncountersModal(this.app, this).open()));

        if (this.plugin.settings.savedEncounters.length > 0) {
            menu.addSeparator();
            this.plugin.settings.savedEncounters.forEach((savedEncounter) => {
                menu.addItem((item) => {
                    item.setTitle(savedEncounter.name)
                        .setIcon(savedEncounter.id === this.currentEncounterId ? "check" : "")
                        .onClick(() => {
                            if (savedEncounter.id !== this.currentEncounterId) this.loadEncounter(savedEncounter.id);
                        });
                });
            });
        }
        menu.showAtMouseEvent(event);
    }

    toggleCompendiumVisibility() {
        this.isCompendiumVisible = !this.isCompendiumVisible;
        this.leaf.setEphemeralState(this.getState());
        this.drawUI();
    }

    drawUI() {
        if (!this.uiContainer) return;
        this.uiContainer.empty();

        const containerWrapper = this.uiContainer.createDiv({ cls: "dh-encounter-wrapper" });
        const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);

        const header = containerWrapper.createDiv({ cls: "dh-encounter-header" });
        header.createEl("h2", { text: "Daggerheart Encounters" });
        const controls = header.createDiv({ cls: "dh-encounter-controls" });
        const toggleCompendiumButton = controls.createEl("button", { title: this.isCompendiumVisible ? "Hide Compendium" : "Show Compendium" });
        setIcon(toggleCompendiumButton, this.isCompendiumVisible ? "panel-right-close" : "panel-left-open");
        toggleCompendiumButton.addClass("dh-icon-button");
        toggleCompendiumButton.addEventListener("click", () => this.toggleCompendiumVisibility());

        const mainInterface = containerWrapper.createDiv({ cls: "dh-encounter-main-interface" });
        const activeCreaturesPanel = mainInterface.createDiv({ cls: "dh-active-creatures-panel" });
        const activeEncounterTitleText = currentEncounter ? currentEncounter.name : "No Encounter Selected";
        const activeEncounterTitleEl = activeCreaturesPanel.createEl("h3", { text: `Active: ${activeEncounterTitleText}`, cls: 'dh-active-encounter-title-clickable' });
        activeEncounterTitleEl.addEventListener('click', (mouseEvent: MouseEvent) => this.showEncounterSwitcherMenu(mouseEvent));

        const encounterArea = activeCreaturesPanel.createDiv({ cls: "dh-encounter-area" });
        if (this.activeEncounterCreatures.length === 0 && currentEncounter) {
            encounterArea.createEl("p", { text: `Encounter "${currentEncounter.name}" is empty. Add creatures.` });
        } else if (this.activeEncounterCreatures.length === 0 && !currentEncounter) {
            encounterArea.createEl("p", { text: "No active encounter or encounter is empty." });
        } else {
            const groupedByGroupId: { [groupId: string]: CreatureInstance[] } = {};
            this.activeEncounterCreatures.forEach(instance => {
                if (!groupedByGroupId[instance.groupId]) groupedByGroupId[instance.groupId] = [];
                groupedByGroupId[instance.groupId].push(instance);
            });

            for (const groupId in groupedByGroupId) {
                const instancesInGroup = groupedByGroupId[groupId];
                if (instancesInGroup.length > 0) {
                    instancesInGroup.sort((a, b) => a.id.localeCompare(b.id));

                    const creatureGroupContainer = encounterArea.createDiv({ cls: 'dh-creature-group-container' });
                    const firstInstanceInGroup = instancesInGroup[0];
                    const instanceTypeClass = firstInstanceInGroup.type ? 'dh-type-' + firstInstanceInGroup.type.toLowerCase().replace(/\s+/g, '-') : 'dh-type-default';

                    const isGroupMultiple = instancesInGroup.length > 1;
                    const mainCardContainerClasses = ['dh-creature-instance-card', instanceTypeClass];
                    if (isGroupMultiple) {
                        mainCardContainerClasses.push('dh-group-mode-active');
                    }
                    const mainCardContainer = creatureGroupContainer.createDiv({ cls: mainCardContainerClasses.join(' ') });

                    const removeGroupButton = mainCardContainer.createEl("button", { text: "✕", title: `Remove all ${firstInstanceInGroup.name}s`, cls: "dh-remove-instance-btn" });
                    removeGroupButton.addEventListener("click", () => this.removeCreatureGroupFromActiveEncounter(firstInstanceInGroup.groupId));

                    this.plugin.renderStatblockCard(firstInstanceInGroup, mainCardContainer, true, firstInstanceInGroup.displayName,
                        (newHp) => {
                            const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstanceInGroup.id);
                            if (inst) inst.currentHp = newHp; this.autoSaveCurrentEncounter();
                        },
                        (newStress) => {
                            const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstanceInGroup.id);
                            if (inst) inst.currentStress = newStress; this.autoSaveCurrentEncounter();
                        },
                        isGroupMultiple
                    );

                    // Add "Add to Group" button at the bottom of the main card container
                    const addToGroupButtonContainer = mainCardContainer.createDiv({ cls: 'dh-add-to-group-button-container' });
                    const addToGroupButton = addToGroupButtonContainer.createEl('button', {
                        text: '+ Add to Group',
                        title: `Add another ${firstInstanceInGroup.name} to this group`,
                        cls: 'dh-add-to-group-btn'
                    });
                    addToGroupButton.addEventListener('click', () => {
                        const baseCreatureData = this.compendiumCreatures.find(c => c.name === firstInstanceInGroup.name);
                        if (baseCreatureData) {
                            this.createNewInstanceInGroup(baseCreatureData, firstInstanceInGroup.groupId); // Pass existing groupId
                            this.autoSaveCurrentEncounter();
                            this.drawUI();
                        } else {
                            new Notice(`Error: Could not find base data for ${firstInstanceInGroup.name} in compendium.`);
                        }
                    });


                    const additionalTrackersContainer = mainCardContainer.querySelector('.dh-additional-trackers-container');
                    if (additionalTrackersContainer) {
                        additionalTrackersContainer.empty();

                        if (isGroupMultiple) {
                            for (const instance of instancesInGroup) {
                                this.renderAdditionalTrackerRow(instance, additionalTrackersContainer as HTMLElement);
                            }
                        }
                    }
                }
            }
        }

        const compendiumPanel = mainInterface.createDiv({ cls: "dh-compendium-panel" });

        if (this.plugin.settings.enableFearTracker) {
            const fearTrackerDiv = containerWrapper.createDiv({ cls: "dh-fear-tracker" });
            fearTrackerDiv.createSpan({ text: "Fear: ", cls: "dh-fear-label" });
            const fearControls = fearTrackerDiv.createDiv({ cls: "dh-fear-controls" });
            const decrementBtn = fearControls.createEl("button", { text: "-", cls: "dh-fear-btn" });
            const fearValue = fearControls.createSpan({ text: this.plugin.settings.fearCounter.toString(), cls: "dh-fear-value" });
            const incrementBtn = fearControls.createEl("button", { text: "+", cls: "dh-fear-btn" });

            decrementBtn.addEventListener("click", async () => {
                if (this.plugin.settings.fearCounter > 0) {
                    this.plugin.settings.fearCounter--;
                    await this.plugin.saveSettings();
                    fearValue.textContent = this.plugin.settings.fearCounter.toString();
                }
            });

            incrementBtn.addEventListener("click", async () => {
                this.plugin.settings.fearCounter++;
                await this.plugin.saveSettings();
                fearValue.textContent = this.plugin.settings.fearCounter.toString();
            });
        }

        if (!this.isCompendiumVisible) compendiumPanel.addClass('dh-compendium-panel-hidden');
        const compendiumHeader = compendiumPanel.createDiv({ cls: "dh-panel-header" });
        compendiumHeader.createEl("h3", { text: "Compendium" });
        const compendiumControls = compendiumHeader.createDiv({ cls: "dh-panel-controls" });
        const refreshCompendiumListButton = compendiumControls.createEl("button", { title: "Refresh Compendium" });
        setIcon(refreshCompendiumListButton, "refresh-cw");
        refreshCompendiumListButton.addClass("dh-icon-button");
        refreshCompendiumListButton.addEventListener("click", async () => {
            await this.loadCompendium();
            this.drawUI();
            new Notice("Compendium refreshed!");
        });
        const searchInput = compendiumPanel.createEl("input", { type: "text", placeholder: "Search compendium...", cls: "dh-compendium-search" });
        searchInput.value = this.compendiumSearchTerm;
        searchInput.addEventListener("input", (e) => {
            this.compendiumSearchTerm = (e.target as HTMLInputElement).value;
            this.leaf.setEphemeralState(this.getState());
            this.renderCompendiumList(compendiumPanel.querySelector(".dh-compendium-list") as HTMLElement);
        });

        // Add filter controls
        const filterControls = compendiumPanel.createDiv({ cls: 'dh-filter-controls' });

        // Tier filter
        const tierSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        tierSection.createSpan({ text: 'Tier:', cls: 'dh-filter-label' });
        for (let tier = 1; tier <= 4; tier++) {
            const tierBtn = tierSection.createEl('button', {
                text: tier.toString(),
                cls: `dh-tier-button${this.selectedTiers.has(tier) ? ' active' : ''}`
            });
            tierBtn.addEventListener('click', () => this.toggleTier(tier));
        }

        // Type filter
        const typeSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        typeSection.createSpan({ text: 'Type:', cls: 'dh-filter-label' });
        const typeSelect = typeSection.createEl('select', { cls: 'dh-type-select' }) as HTMLSelectElement;

        // Add "All Types" option
        typeSelect.createEl('option', {
            text: 'All Types',
            value: ''
        });

        // Get unique types from compendium
        const uniqueTypes = new Set(this.compendiumCreatures
            .map(c => c.type)
            .filter((type): type is string => type !== undefined));

        Array.from(uniqueTypes).sort().forEach(type => {
            const option = typeSelect.createEl('option', {
                text: type,
                value: type
            });
            option.selected = this.selectedTypes.has(type);
        });

        typeSelect.addEventListener('change', (e) => {
            const select = e.target as HTMLSelectElement;
            const selectedType = select.value;
            this.updateTypeFilter(selectedType ? [selectedType] : []);
        });
        const compendiumList = compendiumPanel.createDiv({ cls: "dh-compendium-list" });
        this.renderCompendiumList(compendiumList);

        this.leaf.onResize();
    }

    renderCompendiumList(listContainer: HTMLElement) {
        listContainer.empty();
        const filteredCreatures = this.applyFilters(this.compendiumCreatures);
        if (filteredCreatures.length === 0) {
            listContainer.createEl("p", { text: this.compendiumSearchTerm ? "No matching creatures found." : "No creatures in compendium. Check settings." });
        }
        else {
            filteredCreatures.forEach(creatureData => {
                const creatureEntry = listContainer.createDiv({ cls: "dh-compendium-entry" });
                creatureEntry.createSpan({ text: creatureData.name });
                const addButton = creatureEntry.createEl("button", { text: "+", title: "Add to active encounter", cls: "dh-add-compendium-btn" });
                addButton.addEventListener("click", () => {
                    this.addCreatureToActiveEncounter(creatureData); // This now always creates a new group
                });
            });
        }
    }

    private applyFilters(creatures: StatblockData[]): StatblockData[] {
        return creatures.filter(creature => {
            const matchesSearch = this.compendiumSearchTerm === "" ||
                creature.name.toLowerCase().includes(this.compendiumSearchTerm.toLowerCase());

            const matchesTier = this.selectedTiers.size === 0 ||
                (creature.tier !== undefined && (
                    typeof creature.tier === 'number'
                        ? this.selectedTiers.has(creature.tier)
                        : this.selectedTiers.has(Number(creature.tier))
                ));

            const matchesType = this.selectedTypes.size === 0 ||
                (creature.type !== undefined && this.selectedTypes.has(creature.type));

            return matchesSearch && matchesTier && matchesType;
        });
    }

    private toggleTier(tier: number) {
        if (this.selectedTiers.has(tier)) {
            this.selectedTiers.delete(tier);
        } else {
            this.selectedTiers.add(tier);
        }

        // Update the UI for all tier buttons
        const tierButtons = this.uiContainer?.querySelectorAll('.dh-tier-button');
        if (tierButtons) {
            tierButtons.forEach((btn: Element) => {
                const buttonTier = parseInt(btn.textContent || '0');
                if (this.selectedTiers.has(buttonTier)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        this.renderCompendiumList(this.uiContainer?.querySelector(".dh-compendium-list") as HTMLElement);
    }

    private updateTypeFilter(types: string[]) {
        this.selectedTypes = new Set(types);
        this.renderCompendiumList(this.uiContainer?.querySelector(".dh-compendium-list") as HTMLElement);
    }

    handleNewEncounter(isDefaultCreation: boolean = false, defaultName?: string) {
        const existingNames = this.plugin.settings.savedEncounters.map(e => e.name);
        let newEncounterNameBase = defaultName || "New Encounter";
        let newEncounterName = newEncounterNameBase;
        let counter = 1;
        while (existingNames.includes(newEncounterName)) newEncounterName = `${newEncounterNameBase} ${counter++}`;
        if (isDefaultCreation) this.saveNewEncounter(newEncounterName);
        else new NameEncounterModal(this.app, this.plugin, "Create New Encounter", existingNames, newEncounterName, (name) => this.saveNewEncounter(name)).open();
    }

    saveNewEncounter(name: string) {
        const newId = `dh-encounter-${Date.now()}`;
        const newEncounter: SavedEncounter = { id: newId, name: name, creatures: [] };
        this.plugin.settings.savedEncounters.push(newEncounter);
        this.plugin.saveSettings();
        this.currentEncounterId = newId;
        this.loadCreaturesForCurrentEncounter();
        new Notice(`Encounter "${name}" created and activated.`);
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    handleRenameEncounter(encounterId: string) {
        const encounterToRename = this.plugin.settings.savedEncounters.find(e => e.id === encounterId);
        if (!encounterToRename) return;

        const existingNames = this.plugin.settings.savedEncounters.map(e => e.name).filter(name => name !== encounterToRename.name);

        new NameEncounterModal(this.app, this.plugin, "Rename Encounter", existingNames, encounterToRename.name, (newName) => {
            encounterToRename.name = newName;
            this.plugin.saveSettings();
            new Notice(`Encounter renamed to "${newName}".`);
            this.drawUI();
            if (encounterId === this.currentEncounterId) {
                this.leaf.setEphemeralState(this.getState());
            }
        }).open();
    }

    loadEncounter(encounterId: string) {
        if (this.currentEncounterId === encounterId) {
            console.log("Attempted to load already active encounter.");
            return;
        }
        const encounterToLoad = this.plugin.settings.savedEncounters.find(e => e.id === encounterId);
        if (encounterToLoad) {
            this.currentEncounterId = encounterToLoad.id;
            this.loadCreaturesForCurrentEncounter();
            new Notice(`Encounter "${encounterToLoad.name}" loaded.`);
            this.drawUI();
            this.leaf.setEphemeralState(this.getState());
        } else {
            new Notice("Failed to load encounter.");
        }
    }

    async handleDeleteEncounter(encounterId: string) {
        const encounterIndex = this.plugin.settings.savedEncounters.findIndex(e => e.id === encounterId);
        if (encounterIndex === -1) return;

        const encounterName = this.plugin.settings.savedEncounters[encounterIndex].name;
        this.plugin.settings.savedEncounters.splice(encounterIndex, 1);
        await this.plugin.saveSettings();

        if (this.currentEncounterId === encounterId) {
            this.currentEncounterId = null;
            this.ensureActiveEncounter();
            this.loadCreaturesForCurrentEncounter();
        }
        new Notice(`Encounter "${encounterName}" deleted.`);
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }


    renderAdditionalTrackerRow(instance: CreatureInstance, parentEl: HTMLElement) {
        const trackerRow = parentEl.createDiv({ cls: 'dh-additional-tracker-row' });
        const header = trackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: instance.displayName, cls: 'dh-additional-tracker-name' });
        const removeBtn = header.createEl('button', { text: '✕', title: "Remove this instance", cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => this.removeCreatureFromActiveEncounter(instance.id));

        const hpMax = Number(instance.hp_stress.hp) || 0;
        const stressMax = Number(instance.hp_stress.stress) || 0;

        this.plugin.createInteractiveTrack(trackerRow, 'HP', hpMax, `${instance.id}-hp-add`, instance.currentHp,
            (newHp) => {
                const inst = this.activeEncounterCreatures.find(c => c.id === instance.id);
                if (inst) inst.currentHp = newHp; this.autoSaveCurrentEncounter();
            }
        );
        this.plugin.createInteractiveTrack(trackerRow, 'Stress', stressMax, `${instance.id}-stress-add`, instance.currentStress,
            (newStress) => {
                const inst = this.activeEncounterCreatures.find(c => c.id === instance.id);
                if (inst) inst.currentStress = newStress; this.autoSaveCurrentEncounter();
            }
        );
    }

    private updateDisplayNamesForGroup(groupId: string) {
        const instancesInThisGroup = this.activeEncounterCreatures.filter(inst => inst.groupId === groupId);
        instancesInThisGroup.sort((a, b) => a.id.localeCompare(b.id));

        if (instancesInThisGroup.length === 1) {
            instancesInThisGroup[0].displayName = instancesInThisGroup[0].name;
        } else if (instancesInThisGroup.length > 1) {
            instancesInThisGroup.forEach((instance, index) => {
                instance.displayName = `${instance.name} #${index + 1}`;
            });
        }
    }

    // This method now ALWAYS creates a new group when called from compendium
    addCreatureToActiveEncounter(baseCreature: StatblockData) {
        if (!this.currentEncounterId) {
            new Notice("Error: No active encounter. Please create or load an encounter first.");
            return;
        }
        // Always create a new group by passing null for targetGroupId
        this.createNewInstanceInGroup(baseCreature, null);
        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    createNewInstanceInGroup(baseCreature: StatblockData, targetGroupId: string | null) {
        const baseName = baseCreature.name;
        // If targetGroupId is null, it means we are creating a brand new group.
        // If targetGroupId is provided, we are adding to an existing group.
        const groupIdToUse = targetGroupId || `${baseName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

        const newInstance: CreatureInstance = {
            ...JSON.parse(JSON.stringify(baseCreature)),
            id: `${baseName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            groupId: groupIdToUse,
            currentHp: 0,
            currentStress: 0,
            displayName: "",
            hp_stress: {
                hp: Number(baseCreature.hp_stress.hp) || 0,
                stress: Number(baseCreature.hp_stress.stress) || 0,
                major_hp: baseCreature.hp_stress.major_hp ? Number(baseCreature.hp_stress.major_hp) : null,
                severe_hp: baseCreature.hp_stress.severe_hp ? Number(baseCreature.hp_stress.severe_hp) : null,
            }
        };
        this.activeEncounterCreatures.push(newInstance);
        this.updateDisplayNamesForGroup(groupIdToUse);
    }

    removeCreatureFromActiveEncounter(instanceId: string) {
        const instanceToRemoveIndex = this.activeEncounterCreatures.findIndex(c => c.id === instanceId);
        if (instanceToRemoveIndex === -1) return;

        const removedInstance = this.activeEncounterCreatures[instanceToRemoveIndex];
        const groupId = removedInstance.groupId;

        this.activeEncounterCreatures.splice(instanceToRemoveIndex, 1);
        this.updateDisplayNamesForGroup(groupId);

        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    removeCreatureGroupFromActiveEncounter(groupId: string) {
        this.activeEncounterCreatures = this.activeEncounterCreatures.filter(c => c.groupId !== groupId);
        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    clearEncounter() {
        if (this.currentEncounterId) {
            this.activeEncounterCreatures = [];
            this.autoSaveCurrentEncounter();
            this.drawUI();
            const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            new Notice(`Creatures cleared from "${currentEncounter ? currentEncounter.name : 'active encounter'}".`);
        } else {
            this.activeEncounterCreatures = [];
            this.drawUI();
            new Notice("Active encounter cleared (no saved encounter was loaded).");
        }
    }
    async onClose() {
        // Clean up if necessary
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
                if (!data || typeof data !== 'object') throw new Error("Parsed data is not a valid object.");
                this.renderStatblockCard(data, el, false, data.name);
            } catch (e: any) {
                console.error('Daggerheart Statblock: Error processing code block.', e);
                const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
                errorEl.setText(`Error rendering Daggerheart Statblock:\n${e.message}\n\nSource:\n${source}`);
            }
        });

        this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf) => new EncounterBuilderView(leaf, this));
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

    async getCompendiumCreatures(): Promise<StatblockData[]> {
        const creatures: StatblockData[] = [];
        if (this.settings.useSrdAdversaries) {
            try {
                const srdFilePath = `${this.manifest.dir}/${SRD_ADVERSARIES_FILE}`;
                if (await this.app.vault.adapter.exists(srdFilePath)) {
                    const srdFileContent = await this.app.vault.adapter.read(srdFilePath);
                    const cleanedSrdContent = srdFileContent.charCodeAt(0) === 0xFEFF ? srdFileContent.substring(1) : srdFileContent;
                    const srdRawCreatures = JSON.parse(cleanedSrdContent) as any[];
                    srdRawCreatures.forEach(rawAdv => {
                        const transformed = this.parseSrdAdversaryData(rawAdv);
                        if (transformed) creatures.push(transformed);
                    });
                } else { new Notice(`SRD file (${SRD_ADVERSARIES_FILE}) not found.`); }
            } catch (e: any) { console.error("Error loading SRD:", e); new Notice("Error SRD."); }
        }

        const folderPath = this.settings.compendiumFolder;
        if (folderPath) {
            const abstractFileOrFolder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!abstractFileOrFolder) { new Notice(`Compendium path "${folderPath}" not found.`); }
            else if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
                this.extractStatblocksFromFile(await this.app.vault.cachedRead(abstractFileOrFolder), abstractFileOrFolder.path, creatures);
            } else if (abstractFileOrFolder instanceof TFolder) {
                for (const file of abstractFileOrFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')) {
                    this.extractStatblocksFromFile(await this.app.vault.cachedRead(file), file.path, creatures);
                }
            } else { new Notice(`Compendium path "${folderPath}" is not valid.`); }
        }

        const uniqueCreatures: StatblockData[] = [];
        const names = new Set<string>();
        creatures.forEach(c => { if (!names.has(c.name)) { uniqueCreatures.push(c); names.add(c.name); } });
        return uniqueCreatures;
    }

    private parseSrdAdversaryData(srd: any): StatblockData | null {
        try {
            if (!srd.name || !srd.hp || !srd.stress) return null;
            const hpStress: StatblockHpStress = { hp: Number(srd.hp) || 0, stress: Number(srd.stress) || 0 };
            if (srd.thresholds && typeof srd.thresholds === 'string') {
                const parts = srd.thresholds.split('/');
                if (parts.length >= 1 && parts[0].trim().toLowerCase() !== "none") hpStress.major_hp = Number(parts[0].trim()) || null;
                if (parts.length >= 2 && parts[1].trim().toLowerCase() !== "none") hpStress.severe_hp = Number(parts[1].trim()) || null;
            }
            const features: StatblockFeature[] = [];
            if (srd.feats && Array.isArray(srd.feats)) {
                srd.feats.forEach((feat: any) => {
                    if (feat.name && feat.text) {
                        let featNameFull = feat.name, cost: string | number | undefined, type = "Passive", nameOnly = featNameFull;
                        const typeMatch = featNameFull.match(/-\s*(Passive|Action|Reaction(?:[:\s].*)?)$/i);
                        if (typeMatch) { type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase().replace(/:.*/, '').trim(); nameOnly = featNameFull.substring(0, typeMatch.index).trim(); }
                        const costMatch = nameOnly.match(/\(([^)]+)\)$/);
                        if (costMatch) { const costStr = costMatch[1]; cost = !isNaN(Number(costStr)) ? Number(costStr) : costStr; nameOnly = nameOnly.substring(0, costMatch.index).trim(); }
                        features.push({ name: nameOnly.trim(), type, cost, description: feat.text });
                    }
                });
            }
            return {
                name: srd.name, tier: srd.tier ? (isNaN(Number(srd.tier)) ? srd.tier : Number(srd.tier)) : undefined, type: srd.type,
                description: srd.description, motives_tactics: srd.motives_and_tactics,
                difficulty: srd.difficulty ? (isNaN(Number(srd.difficulty)) ? srd.difficulty : Number(srd.difficulty)) : undefined,
                hp_stress: hpStress,
                attack: { name: srd.attack || "Attack", range: srd.range || "", damage: srd.damage || "", modifier: srd.atk || "0" },
                experience: srd.experience, features, sourceFile: SRD_ADVERSARIES_FILE
            };
        } catch (e) { console.error("Error parsing SRD data:", srd, e); return null; }
    }

    private extractStatblocksFromFile(content: string, filePath: string, creaturesArray: StatblockData[]) {
        const codeBlockRegex = /```daggerheart-statblock\s*([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            try {
                const yamlContent = match[1].replace(/\u00A0/g, ' ');
                const statblock = YAML.load(yamlContent) as StatblockData;
                if (statblock?.name && statblock.hp_stress) {
                    statblock.sourceFile = filePath;
                    statblock.hp_stress.hp = Number(statblock.hp_stress.hp);
                    statblock.hp_stress.stress = Number(statblock.hp_stress.stress);
                    if (statblock.hp_stress.major_hp) statblock.hp_stress.major_hp = Number(statblock.hp_stress.major_hp);
                    if (statblock.hp_stress.severe_hp) statblock.hp_stress.severe_hp = Number(statblock.hp_stress.severe_hp);
                    if (typeof statblock.experience === 'string') {
                        const expObj: StatblockExperience = {};
                        statblock.experience.split(',').forEach(part => { const sp = part.trim().split(/\s+/); if (sp.length === 2 && !isNaN(Number(sp[1]))) expObj[sp[0]] = Number(sp[1]); });
                        statblock.experience = expObj;
                    } else if (!statblock.experience) statblock.experience = {};
                    statblock.motives_tactics = typeof statblock.motives_tactics === 'string' ? statblock.motives_tactics.split(',').map(s => s.trim()) : (statblock.motives_tactics || []);
                    creaturesArray.push(statblock);
                }
            } catch (e: any) { console.warn(`Failed to parse YAML in ${filePath}: ${e.message}.`); }
        }
    }

    renderStatblockCard(
        data: StatblockData | CreatureInstance,
        containerEl: HTMLElement,
        isInstance: boolean = false,
        displayName?: string,
        hpUpdateCallback?: (newHp: number) => void,
        stressUpdateCallback?: (newStress: number) => void,
        isGroupedInstance: boolean = false
    ) {
        if (!isInstance) {
            containerEl.empty();
        }

        let statblockContentDiv: HTMLElement;
        if (isInstance) {
            let existingContent = containerEl.querySelector('.dh-instance-card-content') as HTMLElement;
            if (existingContent) { existingContent.empty(); statblockContentDiv = existingContent; }
            else { statblockContentDiv = containerEl.createDiv({ cls: 'dh-instance-card-content' }); }
        } else {
            statblockContentDiv = containerEl.createDiv({ cls: 'dh-statblock' });
        }

        if (data.image && isInstance) {
            const parentCard = containerEl.closest('.dh-creature-instance-card') || containerEl;
            let imgContainer = parentCard.querySelector('.dh-card-image-container') as HTMLElement;
            if (!imgContainer) imgContainer = parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
            imgContainer.empty();
            imgContainer.createEl('img', { attr: { src: data.image, alt: data.name }, cls: 'dh-card-image' });
        }

        const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
        const nameToDisplay = displayName || data.name;
        if (nameToDisplay) headerDiv.createSpan({ cls: 'dh-name', text: nameToDisplay.toUpperCase() });

        if (isInstance) {
            let roleTagText = "";
            if (data.tier) roleTagText += `Tier ${data.tier} `;
            if (data.type) roleTagText += data.type.toUpperCase();
            if (roleTagText.trim()) {
                const roleTagDiv = statblockContentDiv.createDiv({ text: roleTagText.trim(), cls: 'dh-card-role-text' });
                headerDiv.insertAdjacentElement('afterend', roleTagDiv);
            }
        } else if (data.tier) {
            const metaDiv = statblockContentDiv.createDiv({ cls: 'dh-meta' });
            metaDiv.createSpan({ text: `Tier ${data.tier}`, cls: 'dh-tier' });
            if (data.type) metaDiv.createSpan({ text: data.type, cls: 'dh-type' });
        }

        if (data.description && (!isInstance || (isInstance && this.settings.showDescriptionOnCards))) {
            statblockContentDiv.createDiv({ text: data.description, cls: 'dh-description' });
        }

        if (data.motives_tactics) {
            const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
            if (motivesText) {
                const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
                motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
                motivesDiv.appendText(motivesText);
            }
        }

        if (data.experience) {
            let expStringContent = "";
            if (typeof data.experience === 'string') expStringContent = data.experience;
            else if (typeof data.experience === 'object' && Object.keys(data.experience).length > 0) {
                expStringContent = Object.entries(data.experience)
                    .map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)} ${value}`)
                    .join(', ');
            }
            if (expStringContent) {
                const expDiv = statblockContentDiv.createDiv({ cls: 'dh-experience' });
                expDiv.createEl('strong', { text: 'Experience: ' });
                expDiv.appendText(expStringContent);
            }
        }

        const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
        if (data.difficulty !== undefined) coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
        if (data.attack) {
            let modifierText = data.attack.modifier !== undefined && data.attack.modifier !== null ? String(data.attack.modifier) : 'N/A';
            if (modifierText !== 'N/A' && !modifierText.startsWith('+') && !modifierText.startsWith('-')) {
                const numModifier = parseFloat(modifierText);
                if (!isNaN(numModifier) && numModifier > 0) modifierText = `+${modifierText}`;
            }
            const attackDisplay = isInstance ? `<strong>${data.attack.name || 'Attack'}:</strong> ${data.attack.range || ''} – ${data.attack.damage || ''} (ATK ${modifierText})`
                : `<strong>ATK:</strong> ${modifierText} | <strong>${data.attack.name || 'Attack'}:</strong> ${data.attack.range || ''} | ${data.attack.damage || ''}`;
            coreStatsLine.createSpan({ cls: 'dh-attack-details-span' }).innerHTML = attackDisplay;
        }

        if (data.features && Array.isArray(data.features) && data.features.length > 0) {
            const featuresSectionDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
            featuresSectionDiv.createDiv({ text: 'FEATURES', cls: isInstance ? 'dh-instance-features-title' : 'dh-features-title' });
            const featuresListUl = featuresSectionDiv.createEl('ul', { cls: 'dh-features-list' });
            data.features.forEach(feature => {
                if (typeof feature !== 'object' || !feature.name) return;
                const featureLi = featuresListUl.createEl('li');
                const headerContainer = featureLi.createDiv({ cls: 'dh-feature-header-container' });
                let featureHeaderString = `<strong>${feature.name}</strong>`;
                if (feature.cost !== undefined && feature.cost !== null) featureHeaderString += ` (${feature.cost})`;
                if (feature.type) featureHeaderString += ` - ${feature.type}`;

                const nameSpan = headerContainer.createSpan({ cls: 'dh-feature-name' });
                nameSpan.innerHTML = featureHeaderString;

                let fullDescriptionText = "";
                if (feature.countdown) {
                    const countdownStr = `Countdown (${feature.countdown}).`;
                    if (!String(feature.description || "").toLowerCase().trim().includes(`countdown (${String(feature.countdown).toLowerCase().trim()})`)) {
                        fullDescriptionText += `${countdownStr} `;
                    }
                }
                if (feature.description) fullDescriptionText += feature.description;

                if (isInstance) {
                    if (fullDescriptionText.trim()) {
                        const toggle = headerContainer.createSpan({ cls: 'dh-feature-toggle', text: this.settings.showFeatureDetailsOnCards ? ' [-]' : ' [+]' });
                        toggle.setAttrs({ 'aria-expanded': String(this.settings.showFeatureDetailsOnCards), role: 'button' });
                        const descDiv = featureLi.createDiv({ cls: `dh-feature-description${this.settings.showFeatureDetailsOnCards ? '' : ' dh-feature-description-hidden'}` });
                        descDiv.setText(fullDescriptionText.trim());
                        toggle.addEventListener('click', (event) => {
                            event.stopPropagation();
                            const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                            toggle.setText(isHidden ? ' [+]' : ' [-]');
                            toggle.setAttr('aria-expanded', String(!isHidden));
                        });
                    }
                } else {
                    nameSpan.innerHTML += ':';
                    if (fullDescriptionText.trim()) featureLi.createDiv({ cls: 'dh-feature-description', text: fullDescriptionText.trim() });
                }
            });
        }

        if (data.hp_stress && typeof data.hp_stress === 'object') {
            const hpStressContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });
            const originalHpStressSummaryDiv = hpStressContainer.createDiv({ cls: 'dh-original-hp-stress-summary' });

            if (!isInstance) {
                originalHpStressSummaryDiv.createEl('h4', { text: 'HP & STRESS', cls: 'dh-hp-stress-title' });
            }

            const hpMax = Number(data.hp_stress.hp) || 0;
            const stressMax = Number(data.hp_stress.stress) || 0;

            const summaryLineHP = originalHpStressSummaryDiv.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineHP.innerHTML = `<span class="dh-summary-label">HP:</span> <span class="dh-summary-value">${hpMax}</span>`;
            const thresholdsInlineContainer = summaryLineHP.createSpan({ cls: 'dh-thresholds-inline' });
            if (data.hp_stress.major_hp != null) {
                thresholdsInlineContainer.createSpan({ text: 'Minor', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.major_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (data.hp_stress.severe_hp != null) {
                thresholdsInlineContainer.createSpan({ text: 'Major', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.severe_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (data.hp_stress.major_hp || data.hp_stress.severe_hp) {
                thresholdsInlineContainer.createSpan({ text: 'Severe', cls: 'dh-threshold-box dh-threshold-box-label dh-threshold-box-severe' });
            }

            const summaryLineStress = originalHpStressSummaryDiv.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineStress.innerHTML = `<span class="dh-summary-label">Stress:</span> <span class="dh-summary-value">${stressMax}</span>`;

            if (isInstance) {
                const creatureInstance = data as CreatureInstance;
                const hpCb = hpUpdateCallback || ((newHp) => creatureInstance.currentHp = newHp);
                const stressCb = stressUpdateCallback || ((newStress) => creatureInstance.currentStress = newStress);

                this.createInteractiveTrack(originalHpStressSummaryDiv, 'HP', hpMax, `${creatureInstance.id}-hp-main`, creatureInstance.currentHp, hpCb);
                this.createInteractiveTrack(originalHpStressSummaryDiv, 'Stress', stressMax, `${creatureInstance.id}-stress-main`, creatureInstance.currentStress, stressCb);
            }

            if (isInstance) {
                let additionalTrackersEl = statblockContentDiv.querySelector('.dh-additional-trackers-container') as HTMLElement;
                if (!additionalTrackersEl) {
                    additionalTrackersEl = statblockContentDiv.createDiv({ cls: 'dh-additional-trackers-container' });
                }
            }
        }
    }

    createInteractiveTrack(
        parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string,
        currentValue: number, updateCallback: (newValue: number) => void
    ) {
        const trackDiv = parentEl.createDiv({ cls: `dh-interactive-track dh-${label.toLowerCase()}-track` });
        trackDiv.createSpan({ text: label.toUpperCase(), cls: 'dh-track-label' });
        const controlsDiv = trackDiv.createDiv({ cls: 'dh-track-controls' });
        const decrementButton = controlsDiv.createEl('button', { text: '−', cls: 'dh-track-btn dh-track-btn-decrement' });
        const pipsContainer = controlsDiv.createDiv({ cls: 'dh-pips-container' });
        const pips: HTMLDivElement[] = [];

        const updatePipsAndState = (newVal: number) => {
            let actualNewValue = Math.max(0, Math.min(newVal, maxValue));
            pips.forEach((p, idx) => p.classList.toggle('dh-pip-marked', idx < actualNewValue));
            updateCallback(actualNewValue);
        };

        for (let i = 0; i < maxValue; i++) {
            const pip = pipsContainer.createDiv({ cls: 'dh-pip' });
            pip.dataset.index = i.toString();
            if (i < currentValue) pip.classList.add('dh-pip-marked');
            pip.addEventListener('click', () => {
                const clickedIndex = parseInt(pip.dataset.index!);
                const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
                updatePipsAndState(pip.classList.contains('dh-pip-marked') && clickedIndex === currentMarkedCount - 1 ? clickedIndex : clickedIndex + 1);
            });
            pips.push(pip);
        }

        const incButton = controlsDiv.createEl('button', { text: '+', cls: 'dh-track-btn dh-track-btn-increment' });
        decrementButton.addEventListener('click', () => {
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            if (currentMarkedCount > 0) updatePipsAndState(currentMarkedCount - 1);
        });
        incButton.addEventListener('click', () => {
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            if (currentMarkedCount < maxValue) updatePipsAndState(currentMarkedCount + 1);
        });
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
            .setDesc(`Include the Daggerheart SRD adversaries from the plugin's "${SRD_ADVERSARIES_FILE}" file.`)
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
