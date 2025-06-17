import { App, ItemView, WorkspaceLeaf, Notice, Modal, TextComponent, ButtonComponent, Menu, setIcon, Setting } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { StatblockData, CreatureInstance, SavedEncounter, Countdown, Condition, EncounterBudgetConfig, StatblockFeature } from '../types';
import { renderStatblockCard } from './rendering';


// --- ENCOUNTER BUDGET MODAL ---
class EncounterBudgetModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSave: () => void;
    config: EncounterBudgetConfig;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        // Clone the config to avoid modifying it directly until saved
        this.config = JSON.parse(JSON.stringify(plugin.settings.encounterBudgetConfig));
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-budget-modal');
        contentEl.createEl("h2", { text: "Encounter Budget Settings" });

        new Setting(contentEl)
            .setName("Player Characters")
            .setDesc("The number of PCs in the combat.")
            .addText(text => text
                .setPlaceholder('4')
                .setValue(this.config.playerCount.toString())
                .onChange(value => {
                    const count = parseInt(value);
                    if (!isNaN(count) && count >= 0) {
                        this.config.playerCount = count;
                    }
                }));

        contentEl.createEl('h4', { text: 'Battle Point Adjustments' });

        new Setting(contentEl)
            .setName('Easier/Shorter Fight (-1)')
            .setDesc('Reduces total Battle Points for a quicker encounter.')
            .addToggle(toggle => toggle
                .setValue(this.config.isEasier)
                .onChange(value => {
                    this.config.isEasier = value;
                    if (value) this.config.isHarder = false; // Mutually exclusive
                    this.onOpen(); // Re-render to update the other toggle
                }));

        new Setting(contentEl)
            .setName('Harder/Longer Fight (+2)')
            .setDesc('Increases total Battle Points for a more challenging encounter.')
            .addToggle(toggle => toggle
                .setValue(this.config.isHarder)
                .onChange(value => {
                    this.config.isHarder = value;
                    if (value) this.config.isEasier = false; // Mutually exclusive
                    this.onOpen(); // Re-render to update the other toggle
                }));

        new Setting(contentEl)
            .setName('Boosted Damage (-2)')
            .setDesc('Applies if you add +1d4 (or +2) to all adversary damage rolls.')
            .addToggle(toggle => toggle
                .setValue(this.config.isDamageBoosted)
                .onChange(value => this.config.isDamageBoosted = value));

        new Setting(contentEl)
            .setName('Lower Tier Adversary (+1)')
            .setDesc('Applies if you choose an adversary from a lower tier than the party.')
            .addToggle(toggle => toggle
                .setValue(this.config.useLowerTier)
                .onChange(value => this.config.useLowerTier = value));

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText("Save & Close")
            .setCta()
            .onClick(() => {
                this.plugin.settings.encounterBudgetConfig = this.config;
                this.plugin.saveSettings();
                this.onSave();
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}


// --- CUSTOM CONDITION MODAL ---
class CustomConditionModal extends Modal {
    onSubmit: (condition: Condition) => void;

    constructor(app: App, onSubmit: (condition: Condition) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-name-modal');
        contentEl.createEl("h2", { text: "Add Custom Condition" });

        let name = '';
        let description = '';

        new Setting(contentEl)
            .setName("Condition Name")
            .addText(text => text.setPlaceholder("e.g., On Fire")
                .onChange(value => name = value.trim()));

        new Setting(contentEl)
            .setName("Description")
            .addTextArea(text => text.setPlaceholder("e.g., Takes 1 damage at the start of its turn.")
                .onChange(value => description = value.trim()));

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText("Add")
            .setCta()
            .onClick(() => {
                if (!name) {
                    new Notice("Condition name is required.");
                    return;
                }
                this.onSubmit({ name, description });
                this.close();
            });
        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- EDIT ADVERSARY MODAL ---
class EditAdversaryModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    creature: CreatureInstance;
    onSubmit: (updatedCreature: CreatureInstance) => void;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, creature: CreatureInstance, onSubmit: (updatedCreature: CreatureInstance) => void) {
        super(app);
        this.plugin = plugin;
        this.creature = JSON.parse(JSON.stringify(creature)); // Deep clone to avoid direct mutation
        this.onSubmit = onSubmit;
    }

    onOpen() {
        this.modalEl.addClass('dh-edit-adversary-modal-root');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-edit-adversary-modal');

        // Create header
        const headerEl = contentEl.createDiv({ cls: 'modal-header' });
        headerEl.createEl("h2", { text: `Edit ${this.creature.name}` });

        // Create scrollable content area
        const contentBodyEl = contentEl.createDiv({ cls: 'modal-body' });

        // Basic Info
        new Setting(contentBodyEl).setName("Name").addText(text => text.setValue(this.creature.name).onChange(val => this.creature.name = val));
        new Setting(contentBodyEl).setName("Image URL").addText(text => text.setValue(this.creature.image || '').onChange(val => this.creature.image = val));
        new Setting(contentBodyEl).setName("Tier").addText(text => text.setValue(String(this.creature.tier || '')).onChange(val => this.creature.tier = val));
        new Setting(contentBodyEl).setName("Type").addText(text => text.setValue(this.creature.type || '').onChange(val => this.creature.type = val));
        new Setting(contentBodyEl).setName("Description").addTextArea(text => text.setValue(this.creature.description || '').onChange(val => this.creature.description = val));

        let motives = Array.isArray(this.creature.motives_tactics) ? this.creature.motives_tactics.join(', ') : this.creature.motives_tactics || '';
        new Setting(contentBodyEl).setName("Motives & Tactics").setDesc("Comma-separated").addTextArea(text => text.setValue(motives).onChange(val => this.creature.motives_tactics = val.split(',').map(s => s.trim())));

        // Stats
        contentBodyEl.createEl('h3', { text: "Statistics" });
        new Setting(contentBodyEl).setName("Difficulty").addText(text => text.setValue(String(this.creature.difficulty || '')).onChange(val => this.creature.difficulty = val));
        new Setting(contentBodyEl).setName("Max HP").addText(text => text.setValue(String(this.creature.hp_stress.hp)).onChange(val => this.creature.hp_stress.hp = Number(val) || 0));
        new Setting(contentBodyEl).setName("Max Stress").addText(text => text.setValue(String(this.creature.hp_stress.stress)).onChange(val => this.creature.hp_stress.stress = Number(val) || 0));
        new Setting(contentBodyEl).setName("Major HP Threshold").addText(text => text.setValue(String(this.creature.hp_stress.major_hp || '')).onChange(val => this.creature.hp_stress.major_hp = Number(val) || null));
        new Setting(contentBodyEl).setName("Severe HP Threshold").addText(text => text.setValue(String(this.creature.hp_stress.severe_hp || '')).onChange(val => this.creature.hp_stress.severe_hp = Number(val) || null));

        // Attack
        contentBodyEl.createEl('h3', { text: "Attack" });
        if (!this.creature.attack) this.creature.attack = { name: 'Attack', range: '', damage: '', modifier: '0' };
        new Setting(contentBodyEl).setName("Attack Name").addText(text => text.setValue(this.creature.attack?.name || '').onChange(val => { if (this.creature.attack) this.creature.attack.name = val; }));
        new Setting(contentBodyEl).setName("Range").addText(text => text.setValue(this.creature.attack?.range || '').onChange(val => { if (this.creature.attack) this.creature.attack.range = val; }));
        new Setting(contentBodyEl).setName("Damage").addText(text => text.setValue(this.creature.attack?.damage || '').onChange(val => { if (this.creature.attack) this.creature.attack.damage = val; }));
        new Setting(contentBodyEl).setName("Modifier").addText(text => text.setValue(String(this.creature.attack?.modifier || '0')).onChange(val => { if (this.creature.attack) this.creature.attack.modifier = val; }));

        // Features
        contentBodyEl.createEl('h3', { text: "Features" });
        const featuresContainer = contentBodyEl.createDiv({ cls: 'dh-features-editor' });
        this.renderFeaturesEditor(featuresContainer);

        // --- Footer with Buttons ---
        const footerEl = contentEl.createDiv({ cls: 'modal-footer' });
        const buttonContainer = footerEl.createDiv({ cls: 'dh-modal-buttons' });

        new ButtonComponent(buttonContainer)
            .setButtonText("Save to Compendium")
            .setTooltip("Saves this adversary to your custom JSON file and closes")
            .onClick(async () => {
                await this.plugin.saveCreatureToUserCompendium(this.creature);
                this.onSubmit(this.creature);
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Apply & Close")
            .setTooltip("Applies changes to this instance only and closes")
            .setCta()
            .onClick(() => {
                this.onSubmit(this.creature);
                this.close();
            });
    }

    renderFeaturesEditor(container: HTMLElement) {
        container.empty();
        if (!this.creature.features) this.creature.features = [];

        this.creature.features.forEach((feature, index) => {
            const featureEl = container.createDiv({ cls: 'dh-feature-editor-item' });
            new Setting(featureEl).setName(`Feature #${index + 1} Name`).addText(text => text.setValue(feature.name).onChange(val => feature.name = val));
            new Setting(featureEl).setName("Type").addText(text => text.setValue(feature.type).onChange(val => feature.type = val));
            new Setting(featureEl).setName("Cost").addText(text => text.setValue(String(feature.cost || '')).onChange(val => feature.cost = val));
            new Setting(featureEl).setName("Description").addTextArea(text => text.setValue(feature.description).onChange(val => feature.description = val));
            const featureControls = featureEl.createDiv({ cls: 'dh-feature-controls' });
            new ButtonComponent(featureControls).setIcon("trash").setTooltip("Remove Feature").onClick(() => {
                if (this.creature.features) {
                    this.creature.features.splice(index, 1);
                    this.renderFeaturesEditor(container);
                }
            });
        });

        new ButtonComponent(container)
            .setButtonText("Add Feature")
            .onClick(() => {
                if (!this.creature.features) {
                    this.creature.features = [];
                }
                this.creature.features.push({ name: 'New Feature', type: 'Passive', description: '' });
                this.renderFeaturesEditor(container);
            });
    }

    onClose() {
        this.modalEl.removeClass('dh-edit-adversary-modal-root');
        this.contentEl.empty();
    }
}


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

// --- CONSTANTS ---
const DAGGERHEART_CONDITIONS: Condition[] = [
    { name: "Hidden", description: "While you’re out of sight from all enemies and they don’t otherwise know your location, you gain the Hidden condition. Any rolls against a Hidden creature have disadvantage. After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." },
    { name: "Restrained", description: "Restrained characters can’t move, but you can still take actions from their current position." },
    { name: "Vulnerable", description: "When a creature is Vulnerable, all rolls targeting them have advantage." }
];


// --- ENCOUNTER VIEW CLASS ---
export const ENCOUNTER_BUILDER_VIEW_TYPE = "dh-encounter-builder-view";

export class EncounterBuilderView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    compendiumCreatures: StatblockData[] = [];
    activeEncounterCreatures: CreatureInstance[] = [];

    currentEncounterId: string | null = null;
    private uiContainer: HTMLElement | null = null;
    private isCompendiumVisible: boolean = true;
    private isCountdownsPopupVisible: boolean = false;
    private compendiumSearchTerm: string = "";
    private selectedTiers: Set<number> = new Set();
    private selectedTypes: Set<string> = new Set();

    private countdownsPopup: HTMLElement | null = null;
    private draggedCountdownId: string | null = null;

    // Properties to hold bound event handler functions
    private boundHandleRequestConditionMenu: (e: Event) => void;
    private boundHandleRemoveConditionEvent: (e: Event) => void;
    private boundHandleRemoveInstanceEvent: (e: Event) => void;
    private boundHandleEditInstanceEvent: (e: Event) => void;

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;

        // Bind event handlers in the constructor to ensure 'this' context is correct
        // and to have a stable function reference for adding/removing listeners.
        this.boundHandleRequestConditionMenu = this.handleRequestConditionMenu.bind(this);
        this.boundHandleRemoveConditionEvent = this.handleRemoveConditionEvent.bind(this);
        this.boundHandleRemoveInstanceEvent = this.handleRemoveInstanceEvent.bind(this);
        this.boundHandleEditInstanceEvent = this.handleEditInstanceEvent.bind(this);
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

        this.registerViewListeners();

        await this.loadCompendium();

        const persistedState = this.leaf.getEphemeralState();
        if (persistedState) {
            if (persistedState.currentEncounterId) {
                this.currentEncounterId = persistedState.currentEncounterId;
            }
            this.isCompendiumVisible = typeof persistedState.isCompendiumVisible === 'boolean' ? persistedState.isCompendiumVisible : true;
            this.isCountdownsPopupVisible = typeof persistedState.isCountdownsPopupVisible === 'boolean' ? persistedState.isCountdownsPopupVisible : false;
            this.compendiumSearchTerm = typeof persistedState.compendiumSearchTerm === 'string' ? persistedState.compendiumSearchTerm : "";
            if (Array.isArray(persistedState.selectedTiers)) {
                this.selectedTiers = new Set(persistedState.selectedTiers);
            }
            if (Array.isArray(persistedState.selectedTypes)) {
                this.selectedTypes = new Set(persistedState.selectedTypes);
            }
        }

        this.ensureActiveEncounter();
        this.icon = 'swords';
        this.loadCreaturesForCurrentEncounter();
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    // Sets up the main event listeners for the view
    registerViewListeners() {
        if (!this.uiContainer) return;
        this.uiContainer.addEventListener('dh-request-condition-menu', this.boundHandleRequestConditionMenu);
        this.uiContainer.addEventListener('dh-remove-condition', this.boundHandleRemoveConditionEvent);
        this.uiContainer.addEventListener('dh-remove-instance', this.boundHandleRemoveInstanceEvent);
        this.uiContainer.addEventListener('dh-edit-instance', this.boundHandleEditInstanceEvent);
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
            if (typeof state.isCountdownsPopupVisible === 'boolean') {
                this.isCountdownsPopupVisible = state.isCountdownsPopupVisible;
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
            isCountdownsPopupVisible: this.isCountdownsPopupVisible,
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
        // Ensure at least one default countdown if enabled
        if (this.plugin.settings.enableCountdownTracker && this.plugin.settings.countdowns.length === 0) {
            this.handleAddCountdown(true);
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

    toggleCountdownsPopup() {
        this.isCountdownsPopupVisible = !this.isCountdownsPopupVisible;
        this.leaf.setEphemeralState(this.getState());
        this.updateCountdownsPopup();
    }

    updateCountdownsPopup() {
        if (this.countdownsPopup) {
            this.countdownsPopup.remove();
            this.countdownsPopup = null;
        }

        const button = this.uiContainer?.querySelector('.dh-countdowns-toggle-btn');
        if (button) {
            button.classList.toggle('is-active', this.isCountdownsPopupVisible);
        }

        if (!this.isCountdownsPopupVisible) return;

        const parent = this.uiContainer?.querySelector('.dh-encounter-wrapper');
        if (!parent || !button) return;

        this.countdownsPopup = parent.createDiv({ cls: 'dh-countdowns-popup' });
        this.populateCountdownsPopup(this.countdownsPopup);

        const buttonRect = button.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        this.countdownsPopup.style.top = `${buttonRect.bottom - parentRect.top + 5}px`;
        this.countdownsPopup.style.right = `${parentRect.right - buttonRect.right}px`;
    }

    private redrawCreatureGroup(groupId: string) {
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        let groupContainer = encounterArea?.querySelector(`[data-group-id="${groupId}"]`) as HTMLElement;

        if (!encounterArea) {
            this.drawUI();
            return;
        }

        const instancesInGroup = this.activeEncounterCreatures.filter(inst => inst.groupId === groupId);

        if (instancesInGroup.length === 0) {
            groupContainer?.remove();
            return;
        }

        if (!groupContainer) {
            groupContainer = this.drawCreatureGroup(groupId, encounterArea);
        }

        const contentScroller = groupContainer.querySelector('.dh-instance-card-content');
        const scrollTop = contentScroller?.scrollTop ?? 0;

        groupContainer.empty();
        this.populateCreatureGroupContainer(groupId, groupContainer);

        const newContentScroller = groupContainer.querySelector('.dh-instance-card-content');
        if (newContentScroller) {
            newContentScroller.scrollTop = scrollTop;
        }
    }

    private populateCreatureGroupContainer(groupId: string, containerEl: HTMLElement) {
        const instancesInGroup = this.activeEncounterCreatures.filter(inst => inst.groupId === groupId);
        if (instancesInGroup.length === 0) return;

        instancesInGroup.sort((a, b) => a.id.localeCompare(b.id));
        const firstInstanceInGroup = instancesInGroup[0];

        const instanceTypeClass = firstInstanceInGroup.type ?
            'dh-type-' + firstInstanceInGroup.type.toLowerCase().replace(/\s+/g, '-') :
            'dh-type-default';

        const isGroupMultiple = instancesInGroup.length > 1;
        const mainCardContainerClasses = ['dh-creature-instance-card', instanceTypeClass];
        if (isGroupMultiple) mainCardContainerClasses.push('dh-multiple-instances');

        const mainCardContainer = containerEl.createDiv({ cls: mainCardContainerClasses.join(' ') });

        // Add edit button to the main card header
        const headerControls = mainCardContainer.createDiv({ cls: 'dh-card-header-controls' });
        const editButton = headerControls.createEl('button', { title: 'Edit Adversary', cls: 'dh-icon-button' });
        setIcon(editButton, 'pencil');
        editButton.addEventListener('click', () => {
            const event = new CustomEvent('dh-edit-instance', {
                detail: { instanceId: firstInstanceInGroup.id },
                bubbles: true
            });
            this.uiContainer?.dispatchEvent(event);
        });

        renderStatblockCard(
            this.plugin,
            firstInstanceInGroup,
            mainCardContainer,
            true,
            firstInstanceInGroup.displayName,
            (newHp) => {
                const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstanceInGroup.id);
                if (inst) inst.currentHp = newHp;
                this.autoSaveCurrentEncounter();
            },
            (newStress) => {
                const inst = this.activeEncounterCreatures.find(cr => cr.id === firstInstanceInGroup.id);
                if (inst) inst.currentStress = newStress;
                this.autoSaveCurrentEncounter();
            },
            instancesInGroup.length
        );

        const addToGroupButtonContainer = mainCardContainer.createDiv({
            cls: 'dh-add-to-group-button-container'
        });
        const addToGroupButton = addToGroupButtonContainer.createEl('button', {
            text: '+ Add to Group',
            title: `Add another ${firstInstanceInGroup.name} to this group`,
            cls: 'dh-add-to-group-btn'
        });

        addToGroupButton.addEventListener('click', () => {
            const baseCreatureData = this.compendiumCreatures.find(c => c.name === firstInstanceInGroup.name);
            if (baseCreatureData) {
                this.createNewInstanceInGroup(baseCreatureData, groupId);
                this.autoSaveCurrentEncounter();
                // Update the encounter budget display
                const rightSideTrackers = this.uiContainer?.querySelector('.dh-right-side-trackers') as HTMLElement;
                if (rightSideTrackers && this.plugin.settings.enableEncounterBudget) {
                    rightSideTrackers.empty();
                    this.drawEncounterBudget(rightSideTrackers);
                    if (this.plugin.settings.enableFearTracker) {
                        this.drawFearTracker(rightSideTrackers);
                    }
                }
                this.redrawCreatureGroup(groupId);
            } else {
                new Notice(`Could not find creature data for ${firstInstanceInGroup.name}`);
            }
        });

        const additionalTrackersContainer = mainCardContainer.querySelector('.dh-additional-trackers-container');
        if (additionalTrackersContainer) {
            for (const instance of instancesInGroup.slice(1)) {
                this.renderAdditionalTrackerRow(instance, additionalTrackersContainer as HTMLElement);
            }
        }
    }

    private drawCreatureGroup(groupId: string, encounterArea: HTMLElement): HTMLElement {
        const creatureGroupContainer = encounterArea.createDiv({
            cls: 'dh-creature-group-container',
            attr: { 'data-group-id': groupId }
        });
        this.populateCreatureGroupContainer(groupId, creatureGroupContainer);
        return creatureGroupContainer;
    }

    drawUI() {
        if (!this.uiContainer) return;
        this.uiContainer.empty();

        const containerWrapper = this.uiContainer.createDiv({ cls: "dh-encounter-wrapper" });
        containerWrapper.style.position = 'relative';
        const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);

        const header = containerWrapper.createDiv({ cls: "dh-encounter-header" });
        const titleAndTrackersWrapper = header.createDiv({ cls: 'dh-title-fear-wrapper' });

        const titleText = currentEncounter ? `${currentEncounter.name}` : "No Encounter active";
        const titleEl = titleAndTrackersWrapper.createEl('h3', { text: titleText, cls: 'dh-active-encounter-title-clickable' });
        titleEl.addEventListener('click', (e) => this.showEncounterSwitcherMenu(e));

        const rightSideTrackers = titleAndTrackersWrapper.createDiv({ cls: 'dh-right-side-trackers' });

        if (this.plugin.settings.enableEncounterBudget) {
            this.drawEncounterBudget(rightSideTrackers);
        }

        if (this.plugin.settings.enableFearTracker) {
            this.drawFearTracker(rightSideTrackers);
        }

        const controls = header.createDiv({ cls: "dh-encounter-controls" });

        if (this.plugin.settings.enableCountdownTracker) {
            const countdownsButton = controls.createEl("button", { title: "Countdowns", cls: "dh-countdowns-toggle-btn dh-icon-button" });
            setIcon(countdownsButton, "timer");
            countdownsButton.addEventListener("click", () => this.toggleCountdownsPopup());
            if (this.isCountdownsPopupVisible) {
                countdownsButton.addClass('is-active');
            }
        }

        const toggleCompendiumButton = controls.createEl("button", { title: this.isCompendiumVisible ? "Hide Compendium" : "Show Compendium" });
        setIcon(toggleCompendiumButton, this.isCompendiumVisible ? "panel-right-close" : "panel-left-open");
        toggleCompendiumButton.addClass("dh-icon-button");
        toggleCompendiumButton.addEventListener("click", () => this.toggleCompendiumVisibility());

        const mainInterface = containerWrapper.createDiv({ cls: "dh-encounter-main-interface" });
        const activeCreaturesPanel = mainInterface.createDiv({ cls: "dh-active-creatures-panel" });

        const encounterArea = activeCreaturesPanel.createDiv({ cls: "dh-encounter-area" });
        encounterArea.empty(); // Clear any existing content

        const groupedByGroupId: { [groupId: string]: CreatureInstance[] } = {};
        this.activeEncounterCreatures.forEach(instance => {
            if (!groupedByGroupId[instance.groupId]) groupedByGroupId[instance.groupId] = [];
            groupedByGroupId[instance.groupId].push(instance);
        });

        if (Object.keys(groupedByGroupId).length === 0) {
            if (currentEncounter) {
                encounterArea.createEl("p", { text: `Encounter "${currentEncounter.name}" is empty. Add creatures.` });
            } else {
                encounterArea.createEl("p", { text: "No active encounter or encounter is empty." });
            }
        } else {
            for (const groupId in groupedByGroupId) {
                this.drawCreatureGroup(groupId, encounterArea);
            }
        }

        const compendiumPanel = mainInterface.createDiv({ cls: "dh-compendium-panel" });

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

        const filterControls = compendiumPanel.createDiv({ cls: 'dh-filter-controls' });

        const tierSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        tierSection.createSpan({ text: 'Tier:', cls: 'dh-filter-label' });
        for (let tier = 1; tier <= 4; tier++) {
            const tierBtn = tierSection.createEl('button', {
                text: tier.toString(),
                cls: `dh-tier-button${this.selectedTiers.has(tier) ? ' active' : ''}`
            });
            tierBtn.addEventListener('click', () => this.toggleTier(tier));
        }

        const typeSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        typeSection.createSpan({ text: 'Type:', cls: 'dh-filter-label' });
        const typeSelect = typeSection.createEl('select', { cls: 'dh-type-select' }) as HTMLSelectElement;

        typeSelect.createEl('option', { text: 'All Types', value: '' });

        const uniqueTypes = new Set(this.compendiumCreatures
            .map(c => c.type)
            .filter((type): type is string => type !== undefined));

        Array.from(uniqueTypes).sort().forEach(type => {
            const option = typeSelect.createEl('option', { text: type, value: type });
            option.selected = this.selectedTypes.has(type);
        });

        typeSelect.addEventListener('change', (e) => {
            const select = e.target as HTMLSelectElement;
            const selectedType = select.value;
            this.updateTypeFilter(selectedType ? [selectedType] : []);
        });
        const compendiumList = compendiumPanel.createDiv({ cls: "dh-compendium-list" });
        this.renderCompendiumList(compendiumList);

        this.updateCountdownsPopup();

        this.leaf.onResize();
    }

    drawEncounterBudget(parent: HTMLElement) {
        const { spent, total } = this.calculateEncounterBudget();
        const budgetTrackerEl = parent.createDiv({
            cls: 'dh-budget-tracker',
            title: 'Click to configure encounter budget'
        });
        budgetTrackerEl.addEventListener('click', () => {
            new EncounterBudgetModal(this.app, this.plugin, () => {
                this.drawUI(); // Redraw everything when modal saves
            }).open();
        });

        budgetTrackerEl.createSpan({ text: 'Budget:', cls: 'dh-budget-label' });
        const valueEl = budgetTrackerEl.createSpan({ cls: 'dh-budget-value' });
        valueEl.setText(`${spent} / ${total}`);

        if (spent > total) {
            valueEl.addClass('dh-budget-over');
        }
    }

    drawFearTracker(parent: HTMLElement) {
        const fearTrackerDiv = parent.createDiv({ cls: "dh-fear-tracker" });
        fearTrackerDiv.createSpan({ text: "Fear:", cls: "dh-fear-label" });
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

    populateCountdownsPopup(popupEl: HTMLElement) {
        popupEl.empty();
        const header = popupEl.createDiv({ cls: "dh-popup-header" });
        header.createEl("h4", { text: "Countdowns" });
        const controls = header.createDiv({ cls: "dh-panel-controls" });
        const addButton = controls.createEl("button", { title: "Add Countdown" });
        setIcon(addButton, "plus");
        addButton.addClass("dh-icon-button");
        addButton.addEventListener("click", () => this.handleAddCountdown());

        const body = popupEl.createDiv({ cls: "dh-countdowns-body" });
        if (this.plugin.settings.countdowns.length === 0) {
            body.createEl("p", { text: "No countdowns. Add one!", cls: "dh-no-items-message" });
        } else {
            this.plugin.settings.countdowns.forEach(countdown => this.drawCountdownItem(countdown, body));
        }

        body.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(body, e.clientY);
            const draggable = document.querySelector('.dh-dragging');
            if (draggable) {
                if (afterElement == null) {
                    body.appendChild(draggable);
                } else {
                    body.insertBefore(draggable, afterElement);
                }
            }
        });
    }

    getDragAfterElement(container: HTMLElement, y: number): Element | null {
        const draggableElements = Array.from(container.querySelectorAll('.dh-countdown-item:not(.dh-dragging)'));

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    drawCountdownItem(countdown: Countdown, container: HTMLElement) {
        const itemEl = container.createDiv({ cls: 'dh-countdown-item', attr: { 'data-countdown-id': countdown.id, draggable: 'true' } });

        itemEl.addEventListener('dragstart', () => {
            itemEl.classList.add('dh-dragging');
            this.draggedCountdownId = countdown.id;
        });

        itemEl.addEventListener('dragend', async () => {
            itemEl.classList.remove('dh-dragging');
            if (!this.draggedCountdownId) return;

            const newOrderIds = Array.from(container.querySelectorAll('.dh-countdown-item')).map(el => el.getAttribute('data-countdown-id'));

            this.plugin.settings.countdowns.sort((a, b) => {
                return newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id);
            });

            this.draggedCountdownId = null;
            await this.plugin.saveSettings();
            this.updateCountdownsPopup();
        });


        const nameInput = itemEl.createEl('input', {
            type: 'text',
            value: countdown.name,
            cls: 'dh-countdown-name-input'
        });
        nameInput.addEventListener('change', () => {
            this.handleRenameCountdown(countdown.id, nameInput.value);
        });

        const controls = itemEl.createDiv({ cls: 'dh-countdown-controls' });

        const decrementBtn = controls.createEl('button', { text: '−', cls: 'dh-countdown-btn' });
        decrementBtn.addEventListener('click', () => {
            this.handleCountdownValueChange(countdown.id, -1);
        });

        controls.createSpan({ text: countdown.value.toString(), cls: 'dh-countdown-value' });

        const incrementBtn = controls.createEl('button', { text: '+', cls: 'dh-countdown-btn' });
        incrementBtn.addEventListener('click', () => {
            this.handleCountdownValueChange(countdown.id, 1);
        });

        const removeBtn = controls.createEl('button', { title: 'Remove Countdown', cls: 'dh-icon-button' });
        setIcon(removeBtn, 'trash');
        removeBtn.addEventListener('click', () => {
            this.handleRemoveCountdown(countdown.id);
        });
    }

    async handleAddCountdown(isDefault: boolean = false) {
        const newCountdown: Countdown = {
            id: `dh-countdown-${Date.now()}`,
            name: isDefault ? 'Default Countdown' : `Countdown ${this.plugin.settings.countdowns.length + 1}`,
            value: 0
        };
        this.plugin.settings.countdowns.push(newCountdown);
        await this.plugin.saveSettings();
        if (!isDefault) this.updateCountdownsPopup();
    }

    async handleRemoveCountdown(id: string) {
        this.plugin.settings.countdowns = this.plugin.settings.countdowns.filter(c => c.id !== id);
        await this.plugin.saveSettings();
        this.updateCountdownsPopup();
    }

    async handleRenameCountdown(id: string, newName: string) {
        const countdown = this.plugin.settings.countdowns.find(c => c.id === id);
        if (countdown && countdown.name !== newName) {
            countdown.name = newName;
            await this.plugin.saveSettings();
        }
    }

    async handleCountdownValueChange(id: string, delta: number) {
        const countdown = this.plugin.settings.countdowns.find(c => c.id === id);
        if (countdown) {
            countdown.value += delta;
            await this.plugin.saveSettings();
            if (this.countdownsPopup) {
                const itemEl = this.countdownsPopup.querySelector(`[data-countdown-id="${id}"]`);
                if (itemEl) {
                    const valueEl = itemEl.querySelector('.dh-countdown-value');
                    if (valueEl) valueEl.textContent = countdown.value.toString();
                }
            }
        }
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
                const nameSpan = creatureEntry.createSpan({ text: creatureData.name });
                if (creatureData.isCustom) {
                    nameSpan.addClass('dh-custom-creature');
                    nameSpan.title = `Custom Adversary from ${creatureData.sourceFile}`;
                }
                const addButton = creatureEntry.createEl("button", { text: "+", title: "Add to active encounter", cls: "dh-add-compendium-btn" });
                addButton.addEventListener("click", () => {
                    this.addCreatureToActiveEncounter(creatureData);
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
        if (this.currentEncounterId === encounterId) return;

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

    // --- BUDGET CALCULATION ---

    private getAdversaryCost(type: string | undefined): number {
        if (!type) return 2; // Default to standard if type is missing
        const t = type.toLowerCase();
        switch (t) {
            case 'minion':
            case 'minions':
                return 1;
            case 'social':
            case 'support':
                return 1;
            case 'horde':
            case 'ranged':
            case 'skulk':
            case 'standard':
                return 2;
            case 'leader':
                return 3;
            case 'bruiser':
                return 4;
            case 'solo':
                return 5;
            default:
                return 2; // Treat unknown types as 'Standard'
        }
    }

    private calculateEncounterBudget(): { spent: number, total: number } {
        const config = this.plugin.settings.encounterBudgetConfig;
        const creatures = this.activeEncounterCreatures;

        // Calculate spent points
        let spent = 0;
        const adversaryTypes = new Set<string>();
        const allGroups = new Set<string>();
        let soloCount = 0;
        const minionGroups: { [groupId: string]: number } = {};

        creatures.forEach(c => {
            allGroups.add(c.groupId);
            const typeLower = c.type?.toLowerCase();
            if (typeLower) adversaryTypes.add(typeLower);
            if (typeLower === 'solo') soloCount++;

            if (typeLower === 'minion' || typeLower === 'minions') {
                if (!minionGroups[c.groupId]) {
                    minionGroups[c.groupId] = 0;
                }
                minionGroups[c.groupId]++;
            } else {
                spent += this.getAdversaryCost(c.type);
            }
        });

        // Calculate minion cost based on group size vs party size
        const playerCount = config.playerCount > 0 ? config.playerCount : 1;
        for (const groupId in minionGroups) {
            const count = minionGroups[groupId];
            spent += Math.ceil(count / playerCount);
        }

        // Calculate total budget
        let total = (3 * config.playerCount) + 2;

        // Manual Adjustments from modal
        if (config.isEasier) total -= 1;
        if (config.isHarder) total += 2;
        if (config.isDamageBoosted) total -= 2;
        if (config.useLowerTier) total += 1;

        // Automatic Adjustments based on encounter composition
        if (soloCount >= 2) {
            total -= 2;
        }
        const hasComplex = adversaryTypes.has('bruiser') || adversaryTypes.has('horde') || adversaryTypes.has('leader') || adversaryTypes.has('solo');
        const groupCount = allGroups.size;

        if (!hasComplex && creatures.length > 0 && groupCount <= 1) {
            total += 1;
        }

        return { spent, total };
    }

    // --- EVENT HANDLING ---

    handleEditInstanceEvent(e: Event) {
        const customEvent = e as CustomEvent;
        const { instanceId } = customEvent.detail;
        if (!instanceId) return;

        const instance = this.activeEncounterCreatures.find(c => c.id === instanceId);
        if (!instance) return;

        new EditAdversaryModal(this.app, this.plugin, instance, (updatedCreature) => {
            const groupId = instance.groupId;
            if (!groupId) return; // Should always have a group ID

            // Update all instances in the group with the new base data
            this.activeEncounterCreatures.forEach(c => {
                if (c.groupId === groupId) {
                    c.name = updatedCreature.name;
                    c.isCustom = updatedCreature.isCustom;
                    c.sourceFile = updatedCreature.sourceFile;
                    c.image = updatedCreature.image;
                    c.tier = updatedCreature.tier;
                    c.type = updatedCreature.type;
                    c.description = updatedCreature.description;
                    c.motives_tactics = JSON.parse(JSON.stringify(updatedCreature.motives_tactics || []));
                    c.difficulty = updatedCreature.difficulty;
                    c.hp_stress = JSON.parse(JSON.stringify(updatedCreature.hp_stress));
                    c.attack = JSON.parse(JSON.stringify(updatedCreature.attack));
                    c.features = JSON.parse(JSON.stringify(updatedCreature.features || []));
                }
            });

            this.updateDisplayNamesForGroup(groupId);
            this.autoSaveCurrentEncounter();
            this.redrawCreatureGroup(groupId);
        }).open();
    }


    handleRequestConditionMenu(e: Event) {
        const customEvent = e as CustomEvent;
        const { instanceId, anchor } = customEvent.detail;
        if (!instanceId || !anchor) return;

        const menu = new Menu();

        DAGGERHEART_CONDITIONS.forEach(condition => {
            menu.addItem(item => item
                .setTitle(condition.name)
                .onClick(() => this.addConditionToInstance(instanceId, condition)));
        });

        menu.addSeparator();

        menu.addItem(item => item
            .setTitle("Add Custom...")
            .setIcon("plus")
            .onClick(() => {
                new CustomConditionModal(this.app, (newCondition) => {
                    this.addConditionToInstance(instanceId, newCondition);
                }).open();
            }));

        const rect = (anchor as HTMLElement).getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }

    handleRemoveConditionEvent(e: Event) {
        const customEvent = e as CustomEvent;
        const { instanceId, conditionName } = customEvent.detail;
        if (!instanceId || !conditionName) return;

        const instance = this.activeEncounterCreatures.find(c => c.id === instanceId);
        if (!instance || !instance.conditions) return;

        instance.conditions = instance.conditions.filter(c => c.name !== conditionName);
        this.autoSaveCurrentEncounter();
        this.redrawCreatureGroup(instance.groupId);
    }

    handleRemoveInstanceEvent(e: Event) {
        const customEvent = e as CustomEvent;
        const { instanceId } = customEvent.detail;
        if (!instanceId) return;

        this.removeCreatureFromActiveEncounter(instanceId);
    }

    addConditionToInstance(instanceId: string, condition: Condition) {
        const instance = this.activeEncounterCreatures.find(c => c.id === instanceId);
        if (!instance) return;

        if (!instance.conditions) {
            instance.conditions = [];
        }

        if (instance.conditions.some(c => c.name.toLowerCase() === condition.name.toLowerCase())) {
            new Notice(`"${instance.displayName}" already has the "${condition.name}" condition.`);
            return;
        }

        instance.conditions.push(condition);
        this.autoSaveCurrentEncounter();
        this.redrawCreatureGroup(instance.groupId);
    }

    renderAdditionalTrackerRow(instance: CreatureInstance, parentEl: HTMLElement) {
        const trackerRow = parentEl.createDiv({ cls: 'dh-additional-tracker-row' });

        const header = trackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: instance.displayName, cls: 'dh-additional-tracker-name' });

        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });

        const removeBtn = controlsWrapper.createEl('button', { text: '✕', title: "Remove this instance", cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => {
            const event = new CustomEvent('dh-remove-instance', {
                detail: { instanceId: instance.id },
                bubbles: true
            });
            this.uiContainer?.dispatchEvent(event);
        });

        const conditionsContainer = trackerRow.createDiv({ cls: 'dh-conditions-list-container' });
        if (instance.conditions && instance.conditions.length > 0) {
            const conditionsList = conditionsContainer.createDiv({ cls: 'dh-condition-tags-list' });
            instance.conditions.forEach(condition => {
                const tag = conditionsList.createDiv({ cls: 'dh-condition-tag' });
                tag.createSpan({ text: condition.name });
                const removeConditionBtn = tag.createEl('button', { cls: 'dh-remove-condition-btn', text: '×' });
                removeConditionBtn.addEventListener('click', () => {
                    const event = new CustomEvent('dh-remove-condition', {
                        detail: { instanceId: instance.id, conditionName: condition.name },
                        bubbles: true
                    });
                    this.uiContainer?.dispatchEvent(event);
                });
            });
        }

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

    addCreatureToActiveEncounter(baseCreature: StatblockData) {
        if (!this.currentEncounterId) {
            new Notice("Error: No active encounter. Please create or load an encounter first.");
            return;
        }
        const newGroupId = `${baseCreature.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
        this.createNewInstanceInGroup(baseCreature, newGroupId);
        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    createNewInstanceInGroup(baseCreature: StatblockData, targetGroupId: string) {
        const newInstance: CreatureInstance = {
            ...JSON.parse(JSON.stringify(baseCreature)),
            id: `${baseCreature.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            groupId: targetGroupId,
            currentHp: 0,
            currentStress: 0,
            displayName: "",
            conditions: [], // Initialize conditions array
            hp_stress: {
                hp: Number(baseCreature.hp_stress.hp) || 0,
                stress: Number(baseCreature.hp_stress.stress) || 0,
                major_hp: baseCreature.hp_stress.major_hp ? Number(baseCreature.hp_stress.major_hp) : null,
                severe_hp: baseCreature.hp_stress.severe_hp ? Number(baseCreature.hp_stress.severe_hp) : null,
            }
        };
        this.activeEncounterCreatures.push(newInstance);
        this.updateDisplayNamesForGroup(targetGroupId);
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
        const groupContainer = this.containerEl.querySelector(`[data-group-id="${groupId}"]`);
        if (groupContainer) {
            this.activeEncounterCreatures = this.activeEncounterCreatures.filter(c => c.groupId !== groupId);
            this.autoSaveCurrentEncounter();
            this.drawUI();
        }
    }

    async onClose() {
        if (this.uiContainer) {
            this.uiContainer.removeEventListener('dh-request-condition-menu', this.boundHandleRequestConditionMenu);
            this.uiContainer.removeEventListener('dh-remove-condition', this.boundHandleRemoveConditionEvent);
            this.uiContainer.removeEventListener('dh-remove-instance', this.boundHandleRemoveInstanceEvent);
            this.uiContainer.removeEventListener('dh-edit-instance', this.boundHandleEditInstanceEvent);
        }
    }
}
