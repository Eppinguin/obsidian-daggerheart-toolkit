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
    private nameInputComponent!: TextComponent; // Definite assignment assertion

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
                        // nameInputComponent is guaranteed to be assigned here by addText
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
                // nameInputComponent is guaranteed to be assigned here
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
                            this.onOpen();
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

// --- MODAL FOR ADD INSTANCE CHOICE ---
class AddInstanceChoiceModal extends Modal {
    onSubmit: (choice: 'existing' | 'new') => void;
    existingGroupName: string;

    constructor(app: App, existingGroupName: string, onSubmit: (choice: 'existing' | 'new') => void) {
        super(app);
        this.existingGroupName = existingGroupName;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-add-instance-choice-modal'); // Specific class
        contentEl.createEl("h3", { text: "Add Creature Instance" });
        contentEl.createEl("p", { text: `An instance of "${this.existingGroupName}" already exists.` });

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText(`Add to group "${this.existingGroupName}"`)
            .onClick(() => {
                this.onSubmit('existing');
                this.close();
            });
        new ButtonComponent(buttonContainer)
            .setButtonText("Start New Group")
            .setCta()
            .onClick(() => {
                this.onSubmit('new');
                this.close();
            });
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
            if (typeof persistedState.isCompendiumVisible === 'boolean') {
                this.isCompendiumVisible = persistedState.isCompendiumVisible;
            } else {
                this.isCompendiumVisible = true;
            }
            if (typeof persistedState.compendiumSearchTerm === 'string') {
                this.compendiumSearchTerm = persistedState.compendiumSearchTerm;
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
            compendiumSearchTerm: this.compendiumSearchTerm
        };
    }


    ensureActiveEncounter() {
        if (this.plugin.settings.savedEncounters.length === 0) {
            this.handleNewEncounter(true, "My First Encounter");
        } else if (!this.currentEncounterId || !this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId)) {
            this.currentEncounterId = this.plugin.settings.savedEncounters[0].id;
        }
    }

    loadCreaturesForCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            if (encounter) {
                this.activeEncounterCreatures = JSON.parse(JSON.stringify(encounter.creatures));
            } else {
                this.activeEncounterCreatures = [];
            }
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

        menu.addItem((item) =>
            item
                .setTitle("Create New Encounter...")
                .setIcon("plus-circle")
                .onClick(() => {
                    this.handleNewEncounter();
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Manage Saved Encounters...")
                .setIcon("settings")
                .onClick(() => {
                    new ManageEncountersModal(this.app, this).open();
                })
        );


        if (this.plugin.settings.savedEncounters.length > 0) {
            menu.addSeparator();
            this.plugin.settings.savedEncounters.forEach((savedEncounter) => {
                menu.addItem((item) => {
                    item.setTitle(savedEncounter.name)
                        .setIcon(savedEncounter.id === this.currentEncounterId ? "check" : "")
                        .onClick(() => {
                            if (savedEncounter.id !== this.currentEncounterId) {
                                this.loadEncounter(savedEncounter.id);
                            }
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
        const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);

        const header = this.uiContainer.createDiv({ cls: "dh-encounter-header" });
        header.createEl("h2", { text: "Daggerheart Encounters" });

        const controls = header.createDiv({ cls: "dh-encounter-controls" });

        const toggleCompendiumButton = controls.createEl("button", {
            title: this.isCompendiumVisible ? "Hide Compendium" : "Show Compendium"
        });
        setIcon(toggleCompendiumButton, this.isCompendiumVisible ? "panel-right-close" : "panel-left-open");
        toggleCompendiumButton.addClass("dh-icon-button");
        toggleCompendiumButton.addEventListener("click", () => this.toggleCompendiumVisibility());

        const mainInterface = this.uiContainer.createDiv({ cls: "dh-encounter-main-interface" });

        const activeCreaturesPanel = mainInterface.createDiv({ cls: "dh-active-creatures-panel" });
        const activeEncounterTitleText = currentEncounter ? currentEncounter.name : "No Encounter Selected";
        const activeEncounterTitleEl = activeCreaturesPanel.createEl("h3", {
            text: `Active: ${activeEncounterTitleText}`,
            cls: 'dh-active-encounter-title-clickable'
        });
        activeEncounterTitleEl.addEventListener('click', (mouseEvent: MouseEvent) => {
            this.showEncounterSwitcherMenu(mouseEvent);
        });

        const encounterArea = activeCreaturesPanel.createDiv({ cls: "dh-encounter-area" });
        if (this.activeEncounterCreatures.length === 0 && currentEncounter) {
            encounterArea.createEl("p", { text: `Encounter "${currentEncounter.name}" is empty. Add creatures from the compendium.` });
        } else if (this.activeEncounterCreatures.length === 0 && !currentEncounter) {
            encounterArea.createEl("p", { text: "No active encounter or encounter is empty." });
        } else {
            const groupedByGroupId: { [groupId: string]: CreatureInstance[] } = {};
            this.activeEncounterCreatures.forEach(instance => {
                if (!groupedByGroupId[instance.groupId]) {
                    groupedByGroupId[instance.groupId] = [];
                }
                groupedByGroupId[instance.groupId].push(instance);
            });

            for (const groupId in groupedByGroupId) {
                const instancesInGroup = groupedByGroupId[groupId];
                if (instancesInGroup.length > 0) {
                    const creatureGroupContainer = encounterArea.createDiv({ cls: 'dh-creature-group-container' });
                    const firstInstance = instancesInGroup[0];
                    const instanceTypeClass = firstInstance.type ? 'dh-type-' + firstInstance.type.toLowerCase().replace(/\s+/g, '-') : 'dh-type-default';
                    const mainCardContainer = creatureGroupContainer.createDiv({ cls: `dh-creature-instance-card ${instanceTypeClass}` });

                    const removeGroupButton = mainCardContainer.createEl("button", { text: "✕", title: `Remove all ${firstInstance.name}s`, cls: "dh-remove-instance-btn" });
                    removeGroupButton.addEventListener("click", () => {
                        this.removeCreatureGroupFromActiveEncounter(firstInstance.groupId);
                    });
                    this.plugin.renderStatblockCard(firstInstance, mainCardContainer, true, firstInstance.displayName,
                        (newHp) => {
                            const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstance.id);
                            if (inst) inst.currentHp = newHp;
                            this.autoSaveCurrentEncounter();
                        },
                        (newStress) => {
                            const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstance.id);
                            if (inst) inst.currentStress = newStress;
                            this.autoSaveCurrentEncounter();
                        }
                    );

                    const additionalTrackersContainer = mainCardContainer.querySelector('.dh-additional-trackers-container');
                    if (additionalTrackersContainer) {
                        for (let i = 1; i < instancesInGroup.length; i++) {
                            this.renderAdditionalTrackerRow(instancesInGroup[i], additionalTrackersContainer as HTMLElement);
                        }
                    }
                }
            }
        }

        const compendiumPanel = mainInterface.createDiv({ cls: "dh-compendium-panel" });
        if (!this.isCompendiumVisible) {
            compendiumPanel.addClass('dh-compendium-panel-hidden');
        }
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

        const searchInput = compendiumPanel.createEl("input", {
            type: "text",
            placeholder: "Search compendium...",
            cls: "dh-compendium-search"
        });
        searchInput.value = this.compendiumSearchTerm;
        searchInput.addEventListener("input", (e) => {
            this.compendiumSearchTerm = (e.target as HTMLInputElement).value;
            this.leaf.setEphemeralState(this.getState());
            this.renderCompendiumList(compendiumPanel.querySelector(".dh-compendium-list") as HTMLElement);
        });

        const compendiumList = compendiumPanel.createDiv({ cls: "dh-compendium-list" });
        this.renderCompendiumList(compendiumList);

        this.leaf.onResize();
    }

    renderCompendiumList(listContainer: HTMLElement) {
        listContainer.empty();
        const searchTerm = this.compendiumSearchTerm.toLowerCase();
        const filteredCreatures = this.compendiumCreatures.filter(creature =>
            creature.name.toLowerCase().includes(searchTerm)
        );

        if (filteredCreatures.length === 0) {
            listContainer.createEl("p", { text: searchTerm ? "No matching creatures found." : "No creatures in compendium. Check settings." });
        } else {
            filteredCreatures.forEach(creatureData => {
                const creatureEntry = listContainer.createDiv({ cls: "dh-compendium-entry" });
                creatureEntry.createSpan({ text: creatureData.name });
                const addButton = creatureEntry.createEl("button", { text: "+", title: "Add to active encounter", cls: "dh-add-compendium-btn" });
                addButton.addEventListener("click", () => {
                    this.addCreatureToActiveEncounter(creatureData);
                });
            });
        }
    }

    handleNewEncounter(isDefaultCreation: boolean = false, defaultName?: string) {
        const existingNames = this.plugin.settings.savedEncounters.map(e => e.name);
        let newEncounterNameBase = defaultName || "New Encounter";
        let newEncounterName = newEncounterNameBase;
        let counter = 1;

        while (existingNames.includes(newEncounterName)) {
            newEncounterName = `${newEncounterNameBase} ${counter++}`;
        }

        if (isDefaultCreation) {
            this.saveNewEncounter(newEncounterName);
        } else {
            new NameEncounterModal(this.app, this.plugin, "Create New Encounter", existingNames, newEncounterName, (name) => {
                this.saveNewEncounter(name);
            }).open();
        }
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

    handleDeleteEncounter(encounterId: string) {
        const encounterIndex = this.plugin.settings.savedEncounters.findIndex(e => e.id === encounterId);
        if (encounterIndex === -1) return;

        const encounterName = this.plugin.settings.savedEncounters[encounterIndex].name;
        this.plugin.settings.savedEncounters.splice(encounterIndex, 1);
        this.plugin.saveSettings();

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
        removeBtn.addEventListener('click', () => {
            this.removeCreatureFromActiveEncounter(instance.id, false);
        });

        this.plugin.createInteractiveTrack(trackerRow, 'HP', instance.hp_stress.hp, `${instance.id}-hp`, instance.currentHp,
            (newHp) => {
                const inst = this.activeEncounterCreatures.find(c => c.id === instance.id);
                if (inst) inst.currentHp = newHp;
                this.autoSaveCurrentEncounter();
            }
        );
        this.plugin.createInteractiveTrack(trackerRow, 'Stress', instance.hp_stress.stress, `${instance.id}-stress`, instance.currentStress,
            (newStress) => {
                const inst = this.activeEncounterCreatures.find(c => c.id === instance.id);
                if (inst) inst.currentStress = newStress;
                this.autoSaveCurrentEncounter();
            }
        );
    }

    addCreatureToActiveEncounter(baseCreature: StatblockData) {
        if (!this.currentEncounterId) {
            new Notice("Error: No active encounter. Please create or load an encounter first.");
            return;
        }

        const existingInstancesOfThisType = this.activeEncounterCreatures.filter(
            (inst) => inst.name === baseCreature.name
        );

        if (existingInstancesOfThisType.length > 0) {
            const firstGroupDisplayName = existingInstancesOfThisType[0].displayName.replace(/ #\d+$/, '');
            new AddInstanceChoiceModal(this.app, firstGroupDisplayName, (choice: 'existing' | 'new') => { // Typed 'choice'
                if (choice === 'existing') {
                    const firstGroupId = existingInstancesOfThisType[0].groupId;
                    this.createNewInstanceInGroup(baseCreature, firstGroupId);
                } else {
                    this.createNewInstanceInGroup(baseCreature, null);
                }
                this.autoSaveCurrentEncounter();
                this.drawUI();
            }).open();
        } else {
            this.createNewInstanceInGroup(baseCreature, null);
            this.autoSaveCurrentEncounter();
            this.drawUI();
        }
    }

    createNewInstanceInGroup(baseCreature: StatblockData, targetGroupId: string | null) {
        let groupIdToUse: string;
        let instanceNumberInGroup = 1;
        let displayName = baseCreature.name;

        if (targetGroupId) {
            groupIdToUse = targetGroupId;
            const instancesInThisGroup = this.activeEncounterCreatures.filter(
                (inst) => inst.groupId === groupIdToUse
            );
            instanceNumberInGroup = instancesInThisGroup.length + 1;
            displayName = `${baseCreature.name} #${instanceNumberInGroup}`;
        } else {
            groupIdToUse = `${baseCreature.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
        }

        const newInstance: CreatureInstance = {
            ...JSON.parse(JSON.stringify(baseCreature)),
            id: `${baseCreature.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            groupId: groupIdToUse,
            currentHp: 0,
            currentStress: 0,
            displayName: displayName,
        };
        this.activeEncounterCreatures.push(newInstance);
    }


    removeCreatureFromActiveEncounter(instanceId: string, isGroupRemovalTrigger: boolean = false) {
        const instanceToRemove = this.activeEncounterCreatures.find(c => c.id === instanceId);
        if (!instanceToRemove) return;

        if (isGroupRemovalTrigger) {
            this.activeEncounterCreatures = this.activeEncounterCreatures.filter(c => c.groupId !== instanceToRemove.groupId);
        } else {
            this.activeEncounterCreatures = this.activeEncounterCreatures.filter(c => c.id !== instanceId);
            const remainingInGroup = this.activeEncounterCreatures.filter(c => c.groupId === instanceToRemove.groupId);
            if (remainingInGroup.length > 0 && instanceToRemove.displayName === instanceToRemove.name) {
                remainingInGroup[0].displayName = remainingInGroup[0].name;
                for (let i = 1; i < remainingInGroup.length; i++) {
                    remainingInGroup[i].displayName = `${remainingInGroup[i].name} #${i + 1}`;
                }
            }
        }
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
        // Clean up
    }
}

// ... (DaggerheartStatblockPlugin and DaggerheartSettingTab classes - ensure they are complete from previous versions) ...
// (Make sure to include the full DaggerheartStatblockPlugin and DaggerheartSettingTab classes here)
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
                this.renderStatblockCard(data, el, false, data.name, undefined, undefined); // No callbacks for non-instance
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
        // Load SRD Adversaries if toggled
        if (this.settings.useSrdAdversaries) {
            try {
                const srdFilePath = `${this.manifest.dir}/${SRD_ADVERSARIES_FILE}`;
                console.log(`Daggerheart: Attempting to load SRD adversaries from ${srdFilePath}`);
                if (await this.app.vault.adapter.exists(srdFilePath)) {
                    const srdFileContent = await this.app.vault.adapter.read(srdFilePath);
                    // Remove BOM if present
                    const cleanedSrdContent = srdFileContent.charCodeAt(0) === 0xFEFF ? srdFileContent.substring(1) : srdFileContent;
                    const srdRawCreatures = JSON.parse(cleanedSrdContent) as any[];

                    srdRawCreatures.forEach(rawAdv => {
                        const transformed = this.parseSrdAdversaryData(rawAdv);
                        if (transformed) creatures.push(transformed);
                    });
                    console.log(`Daggerheart: Loaded ${creatures.filter(c => c.sourceFile === SRD_ADVERSARIES_FILE).length} creatures from SRD file.`);
                } else {
                    console.warn(`Daggerheart: SRD file not found at ${srdFilePath}`);
                    new Notice(`SRD adversaries file (${SRD_ADVERSARIES_FILE}) not found in plugin folder. Make sure it's named correctly and in the root of the plugin directory.`);
                }
            } catch (e: any) {
                console.error("Daggerheart: Error loading SRD adversaries:", e);
                new Notice("Error loading SRD adversaries. Check console.");
            }
        }


        // Load creatures from user-specified compendium folder
        const folderPath = this.settings.compendiumFolder;
        if (folderPath) {
            console.log(`Daggerheart: Attempting to read user compendium from path: "${folderPath}"`);
            const abstractFileOrFolder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!abstractFileOrFolder) {
                new Notice(`User compendium path "${folderPath}" not found.`);
            } else if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
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
                new Notice(`User compendium path "${folderPath}" is not a valid Markdown file or folder.`);
            }
        }

        const uniqueCreatures: StatblockData[] = [];
        const names = new Set<string>();

        creatures.forEach(c => {
            if (!names.has(c.name)) {
                uniqueCreatures.push(c);
                names.add(c.name);
            }
        });


        console.log(`Daggerheart: Total ${uniqueCreatures.length} unique creatures loaded into compendium.`);
        return uniqueCreatures;
    }

    private parseSrdAdversaryData(srd: any): StatblockData | null {
        try {
            if (!srd.name || !srd.hp || !srd.stress) {
                console.warn("SRD object missing essential fields (name, hp, stress):", srd);
                return null;
            }

            const hpStress: StatblockHpStress = {
                hp: Number(srd.hp) || 0,
                stress: Number(srd.stress) || 0,
            };
            if (srd.thresholds && typeof srd.thresholds === 'string') {
                const parts = srd.thresholds.split('/');
                if (parts.length >= 1 && parts[0].trim().toLowerCase() !== "none") hpStress.major_hp = Number(parts[0].trim()) || null; // SRD first threshold is major
                if (parts.length >= 2 && parts[1].trim().toLowerCase() !== "none") hpStress.severe_hp = Number(parts[1].trim()) || null; // SRD second is severe
            }

            const features: StatblockFeature[] = [];
            if (srd.feats && Array.isArray(srd.feats)) {
                srd.feats.forEach((feat: any) => {
                    if (feat.name && feat.text) {
                        let featNameFull = feat.name;
                        let cost: string | number | undefined = undefined;
                        let type = "Passive";
                        let nameOnly = featNameFull;

                        const typeMatch = featNameFull.match(/-\s*(Passive|Action|Reaction(?:[:\s].*)?)$/i);
                        if (typeMatch) {
                            type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase().replace(/:.*/, '').trim();
                            nameOnly = featNameFull.substring(0, typeMatch.index).trim();
                        }

                        const costMatch = nameOnly.match(/\(([^)]+)\)$/);
                        if (costMatch) {
                            const costStr = costMatch[1];
                            if (!isNaN(Number(costStr))) {
                                cost = Number(costStr);
                            } else {
                                cost = costStr;
                            }
                            nameOnly = nameOnly.substring(0, costMatch.index).trim();
                        }

                        features.push({
                            name: nameOnly.trim(),
                            type: type,
                            cost: cost,
                            description: feat.text,
                        });
                    }
                });
            }

            let experience: StatblockExperience | string | undefined;
            if (srd.experience && typeof srd.experience === 'string') {
                experience = srd.experience;
            }

            let motives_tactics: string[] | string | undefined;
            if (srd.motives_and_tactics && typeof srd.motives_and_tactics === 'string') {
                motives_tactics = srd.motives_and_tactics;
            }


            const statblock: StatblockData = {
                name: srd.name,
                tier: srd.tier ? (isNaN(Number(srd.tier)) ? srd.tier : Number(srd.tier)) : undefined,
                type: srd.type,
                description: srd.description,
                motives_tactics: motives_tactics,
                difficulty: srd.difficulty ? (isNaN(Number(srd.difficulty)) ? srd.difficulty : Number(srd.difficulty)) : undefined,
                hp_stress: hpStress,
                attack: {
                    name: srd.attack || "Attack",
                    range: srd.range || "",
                    damage: srd.damage || "",
                    modifier: srd.atk || "0"
                },
                experience: experience,
                features: features,
                sourceFile: SRD_ADVERSARIES_FILE
            };
            return statblock;
        } catch (e: any) {
            console.error("Error transforming SRD adversary data:", srd, e);
            return null;
        }
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
                    if (statblock.hp_stress.major_hp) statblock.hp_stress.major_hp = Number(statblock.hp_stress.major_hp);
                    if (statblock.hp_stress.severe_hp) statblock.hp_stress.severe_hp = Number(statblock.hp_stress.severe_hp);

                    if (typeof statblock.experience === 'string') {
                        const expObj: StatblockExperience = {};
                        const expParts = statblock.experience.split(',');
                        expParts.forEach(part => {
                            const subParts = part.trim().split(/\s+/);
                            if (subParts.length === 2 && !isNaN(Number(subParts[1]))) {
                                expObj[subParts[0]] = Number(subParts[1]);
                            }
                        });
                        statblock.experience = expObj;
                    } else if (!statblock.experience) {
                        statblock.experience = {};
                    }


                    if (typeof statblock.motives_tactics === 'string') {
                        statblock.motives_tactics = statblock.motives_tactics.split(',').map(s => s.trim());
                    } else if (!statblock.motives_tactics) {
                        statblock.motives_tactics = [];
                    }

                    creaturesArray.push(statblock);
                }
            } catch (e: any) {
                console.warn(`Daggerheart: Failed to parse YAML for a statblock in ${filePath}: ${e.message}.`);
            }
        }
    }

    renderStatblockCard(
        data: StatblockData | CreatureInstance,
        containerEl: HTMLElement,
        isInstance: boolean = false,
        displayName?: string,
        hpUpdateCallback?: (newHp: number) => void,
        stressUpdateCallback?: (newStress: number) => void
    ) {
        if (!isInstance) {
            containerEl.empty();
        }

        const statblockContentDiv = isInstance ? containerEl.createDiv({ cls: 'dh-instance-card-content' }) : containerEl.createDiv({ cls: 'dh-statblock' });

        if (data.image && isInstance) {
            const parentCard = containerEl.closest('.dh-creature-instance-card') || containerEl;
            let imgContainer = parentCard.querySelector('.dh-card-image-container') as HTMLElement;
            if (!imgContainer) {
                imgContainer = parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
            }
            imgContainer.empty();
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
        }
        // Removed 'else if (data.title)' as title is no longer used for full statblocks

        if (!isInstance && data.tier) {
            const metaDiv = statblockContentDiv.createDiv({ cls: 'dh-meta' });
            metaDiv.createSpan({ text: `Tier ${data.tier}`, cls: 'dh-tier' });
            if (data.type) metaDiv.createSpan({ text: data.type, cls: 'dh-type' });
        }
        // Show description on instance cards if setting is enabled
        if (data.description && (!isInstance || (isInstance && this.settings.showDescriptionOnCards))) {
            statblockContentDiv.createDiv({ text: data.description, cls: 'dh-description' });
        }


        if (data.motives_tactics) {
            const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
            if (motivesText && (!isInstance || (isInstance && this.settings.showMotivesOnCards))) {
                const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
                motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
                motivesDiv.appendText(motivesText);
            }
        }

        if (data.experience) {
            let expStringContent = "";
            if (typeof data.experience === 'string') {
                expStringContent = data.experience;
            } else if (typeof data.experience === 'object' && Object.keys(data.experience).length > 0) {
                expStringContent = Object.entries(data.experience)
                    .map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)} ${value}`)
                    .join(', ');
            }
            if (expStringContent && (!isInstance || (isInstance && this.settings.showExperienceOnCards))) {
                const expDiv = statblockContentDiv.createDiv({ cls: 'dh-experience' });
                expDiv.createEl('strong', { text: 'Experience: ' });
                expDiv.appendText(expStringContent);
            }
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
                } else if (feature.cost && typeof feature.cost === 'string') {
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
                    if (fullDescriptionText.trim() && this.settings.showFeatureDetailsOnCards) {
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
            if (!isInstance) {
                hpStressContainer.createEl('h4', { text: 'HP & STRESS', cls: 'dh-hp-stress-title' });
            }

            const hpMax = Number(data.hp_stress.hp) || 0;
            const stressMax = Number(data.hp_stress.stress) || 0;

            const summaryLineHP = hpStressContainer.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineHP.innerHTML = `<span class="dh-summary-label">HP:</span> <span class="dh-summary-value">${hpMax}</span>`;

            const thresholdsInlineContainer = summaryLineHP.createSpan({ cls: 'dh-thresholds-inline' });
            if (data.hp_stress.major_hp !== undefined && data.hp_stress.major_hp !== null) {
                thresholdsInlineContainer.createSpan({ text: 'Minor', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.major_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (data.hp_stress.severe_hp !== undefined && data.hp_stress.severe_hp !== null) {
                thresholdsInlineContainer.createSpan({ text: 'Major', cls: 'dh-threshold-box dh-threshold-box-label' });
                thresholdsInlineContainer.createSpan({ text: String(data.hp_stress.severe_hp), cls: 'dh-threshold-box dh-threshold-box-value' });
            }
            if (data.hp_stress.major_hp || data.hp_stress.severe_hp) {
                thresholdsInlineContainer.createSpan({ text: 'Severe', cls: 'dh-threshold-box dh-threshold-box-label dh-threshold-box-severe' });
            }


            const summaryLineStress = hpStressContainer.createDiv({ cls: 'dh-hp-stress-summary' });
            summaryLineStress.innerHTML = `<span class="dh-summary-label">Stress:</span> <span class="dh-summary-value">${stressMax}</span>`;

            if (isInstance) {
                const creatureInstance = data as CreatureInstance;
                const hpCb = hpUpdateCallback || ((newHp) => creatureInstance.currentHp = newHp);
                const stressCb = stressUpdateCallback || ((newStress) => creatureInstance.currentStress = newStress);

                this.createInteractiveTrack(hpStressContainer, 'HP', hpMax, `${creatureInstance.id}-hp`, creatureInstance.currentHp, hpCb);
                this.createInteractiveTrack(hpStressContainer, 'Stress', stressMax, `${creatureInstance.id}-stress`, creatureInstance.currentStress, stressCb);

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
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Creatures"). Leave empty to disable user compendium.')
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
                            view.drawUI();
                        }
                    });
            });

        new Setting(containerEl)
            .setName('Use SRD Adversaries')
            .setDesc(`Include the Daggerheart SRD adversaries from the plugin's "${SRD_ADVERSARIES_FILE}" file in the compendium. This file must be present in the plugin's root folder.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdAdversaries)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdAdversaries = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) {
                        await view.loadCompendium();
                        view.drawUI();
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
            .setName('Show Motives & Tactics on Instance Cards')
            .setDesc('If enabled, motives & tactics will be shown on creature cards in the encounter builder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showMotivesOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showMotivesOnCards = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Show Experience on Instance Cards')
            .setDesc('If enabled, experience details will be shown on creature cards in the encounter builder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showExperienceOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showExperienceOnCards = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));

        new Setting(containerEl)
            .setName('Show Full Feature Details on Instance Cards')
            .setDesc('If enabled, feature descriptions will be toggleable on creature cards. If disabled, only feature names/types/costs are shown.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFeatureDetailsOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showFeatureDetailsOnCards = value;
                    await this.plugin.saveSettings();
                    const view = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0]?.view;
                    if (view instanceof EncounterBuilderView) view.drawUI();
                }));
    }
}
