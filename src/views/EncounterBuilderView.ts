import { App, ItemView, WorkspaceLeaf, Notice, Menu, setIcon } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { StatblockData, AdversaryInstance, SavedEncounter, Countdown, Condition } from '../../types';
import { renderStatblockCard } from '../rendering/statblock';
import {
    EncounterBudgetModal, CustomConditionModal, EditAdversaryModal,
    NameEncounterModal, ManageEncountersModal
} from '../modals/index';

const DAGGERHEART_CONDITIONS: Condition[] = [
    { name: "Hidden", description: "While you’re out of sight from all enemies and they don’t otherwise know your location, you gain the Hidden condition. Any rolls against a Hidden adversary have disadvantage. After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." },
    { name: "Restrained", description: "Restrained characters can’t move, but you can still take actions from their current position." },
    { name: "Vulnerable", description: "When a adversary is Vulnerable, all rolls targeting them have advantage." }
];

export const ENCOUNTER_BUILDER_VIEW_TYPE = "dh-encounter-builder-view";

export class EncounterBuilderView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    compendiumAdversaries: StatblockData[] = [];
    activeEncounterAdversaries: AdversaryInstance[] = [];

    currentEncounterId: string | null = null;
    private uiContainer: HTMLElement | null = null;
    private isCompendiumVisible: boolean = true;
    private isCountdownsPopupVisible: boolean = false;
    private compendiumSearchTerm: string = "";
    private selectedTiers: Set<number> = new Set();
    private selectedTypes: Set<string> = new Set();

    private countdownsPopup: HTMLElement | null = null;
    private draggedCountdownId: string | null = null;
    private draggedGroupId: string | null = null;

    private boundHandleRequestConditionMenu: (e: Event) => void;
    private boundHandleRemoveConditionEvent: (e: Event) => void;
    private boundHandleRemoveInstanceEvent: (e: Event) => void;
    private boundHandleEditInstanceEvent: (e: Event) => void;
    private boundHandleDragStart: (e: DragEvent) => void;
    private boundHandleDragOver: (e: DragEvent) => void;
    private boundHandleDrop: (e: DragEvent) => void;
    private boundHandleDragEnd: (e: DragEvent) => void;

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.boundHandleRequestConditionMenu = this.handleRequestConditionMenu.bind(this);
        this.boundHandleRemoveConditionEvent = this.handleRemoveConditionEvent.bind(this);
        this.boundHandleRemoveInstanceEvent = this.handleRemoveInstanceEvent.bind(this);
        this.boundHandleEditInstanceEvent = this.handleEditInstanceEvent.bind(this);
        this.boundHandleDragStart = this.handleDragStart.bind(this);
        this.boundHandleDragOver = this.handleDragOver.bind(this);
        this.boundHandleDrop = this.handleDrop.bind(this);
        this.boundHandleDragEnd = this.handleDragEnd.bind(this);
    }

    getViewType(): string { return ENCOUNTER_BUILDER_VIEW_TYPE; }

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
            if (persistedState.currentEncounterId) this.currentEncounterId = persistedState.currentEncounterId;
            this.isCompendiumVisible = typeof persistedState.isCompendiumVisible === 'boolean' ? persistedState.isCompendiumVisible : true;
            this.isCountdownsPopupVisible = typeof persistedState.isCountdownsPopupVisible === 'boolean' ? persistedState.isCountdownsPopupVisible : false;
            this.compendiumSearchTerm = typeof persistedState.compendiumSearchTerm === 'string' ? persistedState.compendiumSearchTerm : "";
            if (Array.isArray(persistedState.selectedTiers)) this.selectedTiers = new Set(persistedState.selectedTiers);
            if (Array.isArray(persistedState.selectedTypes)) this.selectedTypes = new Set(persistedState.selectedTypes);
        }

        this.ensureActiveEncounter();
        this.icon = 'swords';
        this.loadAdversariesForCurrentEncounter();
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

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
            if (typeof state.isCompendiumVisible === 'boolean') this.isCompendiumVisible = state.isCompendiumVisible;
            if (typeof state.isCountdownsPopupVisible === 'boolean') this.isCountdownsPopupVisible = state.isCountdownsPopupVisible;
            if (typeof state.compendiumSearchTerm === 'string') this.compendiumSearchTerm = state.compendiumSearchTerm;
            if (Array.isArray(state.selectedTiers)) this.selectedTiers = new Set(state.selectedTiers);
            if (Array.isArray(state.selectedTypes)) this.selectedTypes = new Set(state.selectedTypes);
        }
        this.ensureActiveEncounter();
        this.loadAdversariesForCurrentEncounter();
        if (this.uiContainer && this.contentEl.children.length > 0) this.drawUI();
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
        if (this.plugin.settings.enableCountdownTracker && this.plugin.settings.countdowns.length === 0) {
            this.handleAddCountdown(true);
        }
    }

    loadAdversariesForCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            this.activeEncounterAdversaries = encounter ? JSON.parse(JSON.stringify(encounter.adversaries)) : [];
        } else {
            this.activeEncounterAdversaries = [];
        }
    }

    async loadCompendium() {
        this.compendiumAdversaries = await this.plugin.getCompendiumAdversaries();
        this.compendiumAdversaries.sort((a, b) => a.name.localeCompare(b.name));
    }

    async autoSaveCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounterIndex = this.plugin.settings.savedEncounters.findIndex(e => e.id === this.currentEncounterId);
            if (encounterIndex !== -1) {
                this.plugin.settings.savedEncounters[encounterIndex].adversaries = JSON.parse(JSON.stringify(this.activeEncounterAdversaries));
                await this.plugin.saveSettings();
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
                        .onClick(() => { if (savedEncounter.id !== this.currentEncounterId) this.loadEncounter(savedEncounter.id); });
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
        if (button) button.classList.toggle('is-active', this.isCountdownsPopupVisible);
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

    private redrawAdversaryGroup(groupId: string) {
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        let groupContainer = encounterArea?.querySelector(`[data-group-id="${groupId}"]`) as HTMLElement;

        if (!encounterArea) { this.drawUI(); return; }
        const instancesInGroup = this.activeEncounterAdversaries.filter(inst => inst.groupId === groupId);
        if (instancesInGroup.length === 0) { groupContainer?.remove(); return; }
        if (!groupContainer) groupContainer = this.drawAdversaryGroup(groupId, encounterArea);

        const contentScroller = groupContainer.querySelector('.dh-instance-card-content');
        const scrollTop = contentScroller?.scrollTop ?? 0;
        groupContainer.empty();
        this.populateAdversaryGroupContainer(groupId, groupContainer);
        const newContentScroller = groupContainer.querySelector('.dh-instance-card-content');
        if (newContentScroller) newContentScroller.scrollTop = scrollTop;
    }

    private populateAdversaryGroupContainer(groupId: string, containerEl: HTMLElement) {
        const instancesInGroup = this.activeEncounterAdversaries.filter(inst => inst.groupId === groupId);
        if (instancesInGroup.length === 0) return;

        instancesInGroup.sort((a, b) => a.id.localeCompare(b.id));
        const firstInstanceInGroup = instancesInGroup[0];
        const instanceTypeClass = firstInstanceInGroup.type ? `dh-type-${firstInstanceInGroup.type.toLowerCase().replace(/\s+/g, '-')}` : 'dh-type-default';
        const isGroupMultiple = instancesInGroup.length > 1;
        const mainCardContainerClasses = ['dh-adversary-instance-card', instanceTypeClass];
        if (isGroupMultiple) mainCardContainerClasses.push('dh-multiple-instances');

        const mainCardContainer = containerEl.createDiv({ cls: mainCardContainerClasses.join(' ') });
        const headerControls = mainCardContainer.createDiv({ cls: 'dh-card-header-controls' });
        const dragHandle = headerControls.createDiv({ cls: 'dh-drag-handle', attr: { 'draggable': 'true', 'aria-label': 'Drag to reorder' } });
        setIcon(dragHandle, 'grip-vertical');
        const editButton = headerControls.createEl('button', { title: 'Edit Adversary', cls: 'dh-icon-button' });
        setIcon(editButton, 'pencil');
        editButton.addEventListener('click', () => {
            this.uiContainer?.dispatchEvent(new CustomEvent('dh-edit-instance', { detail: { instanceId: firstInstanceInGroup.id }, bubbles: true }));
        });

        renderStatblockCard(this.plugin, firstInstanceInGroup, mainCardContainer, true, firstInstanceInGroup.displayName,
            (newHp) => { const inst = this.activeEncounterAdversaries.find(cr => cr.id === firstInstanceInGroup.id); if (inst) inst.currentHp = newHp; this.autoSaveCurrentEncounter(); },
            (newStress) => { const inst = this.activeEncounterAdversaries.find(cr => cr.id === firstInstanceInGroup.id); if (inst) inst.currentStress = newStress; this.autoSaveCurrentEncounter(); },
            instancesInGroup.length
        );

        const addToGroupButtonContainer = mainCardContainer.createDiv({ cls: 'dh-add-to-group-button-container' });
        const addToGroupButton = addToGroupButtonContainer.createEl('button', { text: '+ Add to Group', title: `Add another ${firstInstanceInGroup.name} to this group`, cls: 'dh-add-to-group-btn' });
        addToGroupButton.addEventListener('click', () => {
            const templateAdversary = this.activeEncounterAdversaries.find(c => c.groupId === groupId);
            if (templateAdversary) {
                this.createNewInstanceFromTemplate(templateAdversary, groupId);
                this.autoSaveCurrentEncounter();
                const rightSideTrackers = this.uiContainer?.querySelector('.dh-right-side-trackers') as HTMLElement;
                if (rightSideTrackers && this.plugin.settings.enableEncounterBudget) {
                    rightSideTrackers.empty();
                    this.drawEncounterBudget(rightSideTrackers);
                    if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
                }
                this.redrawAdversaryGroup(groupId);
            } else {
                new Notice(`Could not find template adversary in group ${groupId}`);
            }
        });

        const additionalTrackersContainer = mainCardContainer.querySelector('.dh-additional-trackers-container');
        if (additionalTrackersContainer) {
            for (const instance of instancesInGroup.slice(1)) {
                this.renderAdditionalTrackerRow(instance, additionalTrackersContainer as HTMLElement);
            }
        }
    }

    private drawAdversaryGroup(groupId: string, encounterArea: HTMLElement): HTMLElement {
        const adversaryGroupContainer = encounterArea.createDiv({ cls: 'dh-adversary-group-container', attr: { 'data-group-id': groupId } });
        this.populateAdversaryGroupContainer(groupId, adversaryGroupContainer);
        return adversaryGroupContainer;
    }

    drawUI() {
        if (!this.uiContainer) return;
        this.uiContainer.empty();
        const containerWrapper = this.uiContainer.createDiv({ cls: "dh-encounter-wrapper" });
        const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
        const header = containerWrapper.createDiv({ cls: "dh-encounter-header" });
        const titleAndTrackersWrapper = header.createDiv({ cls: 'dh-title-fear-wrapper' });
        const titleText = currentEncounter ? `${currentEncounter.name}` : "No Encounter active";
        const titleEl = titleAndTrackersWrapper.createEl('h3', { text: titleText, cls: 'dh-active-encounter-title-clickable' });
        titleEl.addEventListener('click', (e) => this.showEncounterSwitcherMenu(e));
        const rightSideTrackers = titleAndTrackersWrapper.createDiv({ cls: 'dh-right-side-trackers' });
        if (this.plugin.settings.enableEncounterBudget) this.drawEncounterBudget(rightSideTrackers);
        if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
        const controls = header.createDiv({ cls: "dh-encounter-controls" });
        if (this.plugin.settings.enableCountdownTracker) {
            const countdownsButton = controls.createEl("button", { title: "Countdowns", cls: "dh-countdowns-toggle-btn dh-icon-button" });
            setIcon(countdownsButton, "timer");
            countdownsButton.addEventListener("click", () => this.toggleCountdownsPopup());
            if (this.isCountdownsPopupVisible) countdownsButton.addClass('is-active');
        }
        const toggleCompendiumButton = controls.createEl("button", { title: this.isCompendiumVisible ? "Hide Compendium" : "Show Compendium" });
        setIcon(toggleCompendiumButton, this.isCompendiumVisible ? "panel-right-close" : "panel-left-open");
        toggleCompendiumButton.addClass("dh-icon-button");
        toggleCompendiumButton.addEventListener("click", () => this.toggleCompendiumVisibility());

        const mainInterface = containerWrapper.createDiv({ cls: "dh-encounter-main-interface" });
        const activeAdversariesPanel = mainInterface.createDiv({ cls: "dh-active-adversaries-panel" });
        const encounterArea = activeAdversariesPanel.createDiv({ cls: "dh-encounter-area" });
        encounterArea.addEventListener('dragstart', this.boundHandleDragStart);
        encounterArea.addEventListener('dragover', this.boundHandleDragOver);
        encounterArea.addEventListener('drop', this.boundHandleDrop);
        encounterArea.addEventListener('dragend', this.boundHandleDragEnd);
        const groupedByGroupId: { [groupId: string]: AdversaryInstance[] } = {};
        this.activeEncounterAdversaries.forEach(instance => {
            if (!groupedByGroupId[instance.groupId]) groupedByGroupId[instance.groupId] = [];
            groupedByGroupId[instance.groupId].push(instance);
        });
        const savedOrder = currentEncounter?.adversaryGroupOrder || [];
        const actualGroupIds = Object.keys(groupedByGroupId);
        const orderedGroupIds = [...savedOrder.filter(id => actualGroupIds.includes(id))];
        actualGroupIds.forEach(id => { if (!orderedGroupIds.includes(id)) orderedGroupIds.push(id); });
        if (currentEncounter && JSON.stringify(orderedGroupIds) !== JSON.stringify(currentEncounter.adversaryGroupOrder)) {
            currentEncounter.adversaryGroupOrder = orderedGroupIds;
        }
        if (orderedGroupIds.length === 0) {
            const emptyText = currentEncounter ? `Encounter "${currentEncounter.name}" is empty. Add adversaries.` : "No active encounter or encounter is empty.";
            encounterArea.createEl("p", { text: emptyText });
        } else {
            for (const groupId of orderedGroupIds) { this.drawAdversaryGroup(groupId, encounterArea); }
        }

        const compendiumPanel = mainInterface.createDiv({ cls: "dh-compendium-panel" });
        if (!this.isCompendiumVisible) compendiumPanel.addClass('dh-compendium-panel-hidden');
        const compendiumHeader = compendiumPanel.createDiv({ cls: "dh-panel-header" });
        compendiumHeader.createEl("h3", { text: "Compendium" });
        const compendiumControls = compendiumHeader.createDiv({ cls: "dh-panel-controls" });
        const refreshBtn = compendiumControls.createEl("button", { title: "Refresh Compendium", cls: "dh-icon-button" });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.addEventListener("click", async () => { await this.loadCompendium(); this.drawUI(); new Notice("Compendium refreshed!"); });
        const searchInput = compendiumPanel.createEl("input", { type: "text", placeholder: "Search compendium...", cls: "dh-compendium-search", value: this.compendiumSearchTerm });
        searchInput.addEventListener("input", (e) => { this.compendiumSearchTerm = (e.target as HTMLInputElement).value; this.leaf.setEphemeralState(this.getState()); this.renderCompendiumList(compendiumPanel.querySelector(".dh-compendium-list") as HTMLElement); });
        const filterControls = compendiumPanel.createDiv({ cls: 'dh-filter-controls' });
        const tierSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        tierSection.createSpan({ text: 'Tier:', cls: 'dh-filter-label' });
        for (let tier = 1; tier <= 4; tier++) {
            const tierBtn = tierSection.createEl('button', { text: tier.toString(), cls: `dh-tier-button${this.selectedTiers.has(tier) ? ' active' : ''}` });
            tierBtn.addEventListener('click', () => this.toggleTier(tier));
        }
        const typeSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        typeSection.createSpan({ text: 'Type:', cls: 'dh-filter-label' });
        const typeSelect = typeSection.createEl('select', { cls: 'dh-type-select' }) as HTMLSelectElement;
        typeSelect.createEl('option', { text: 'All Types', value: '' });
        const uniqueTypes = new Set(this.compendiumAdversaries.map(c => c.type).filter((type): type is string => type !== undefined));
        Array.from(uniqueTypes).sort().forEach(type => { const option = typeSelect.createEl('option', { text: type, value: type }); option.selected = this.selectedTypes.has(type); });
        typeSelect.addEventListener('change', (e) => this.updateTypeFilter(e.target instanceof HTMLSelectElement ? [e.target.value] : []));
        const compendiumList = compendiumPanel.createDiv({ cls: "dh-compendium-list" });
        this.renderCompendiumList(compendiumList);
        this.updateCountdownsPopup();
        this.leaf.onResize();
    }

    drawEncounterBudget(parent: HTMLElement) {
        const { spent, total } = this.calculateEncounterBudget();
        const budgetTrackerEl = parent.createDiv({ cls: 'dh-budget-tracker', title: 'Click to configure encounter budget' });
        budgetTrackerEl.addEventListener('click', () => { new EncounterBudgetModal(this.app, this.plugin, () => { this.drawUI(); }).open(); });
        budgetTrackerEl.createSpan({ text: 'Budget:', cls: 'dh-budget-label' });
        const valueEl = budgetTrackerEl.createSpan({ cls: 'dh-budget-value' });
        valueEl.setText(`${spent} / ${total}`);
        if (spent > total) valueEl.addClass('dh-budget-over');
    }

    drawFearTracker(parent: HTMLElement) {
        const fearTrackerDiv = parent.createDiv({ cls: "dh-fear-tracker" });
        fearTrackerDiv.createSpan({ text: "Fear:", cls: "dh-fear-label" });
        const fearControls = fearTrackerDiv.createDiv({ cls: "dh-fear-controls" });
        const decrementBtn = fearControls.createEl("button", { text: "-", cls: "dh-fear-btn" });
        const fearValue = fearControls.createSpan({ text: this.plugin.settings.fearCounter.toString(), cls: "dh-fear-value" });
        const incrementBtn = fearControls.createEl("button", { text: "+", cls: "dh-fear-btn" });
        decrementBtn.addEventListener("click", async () => { if (this.plugin.settings.fearCounter > 0) { this.plugin.settings.fearCounter--; await this.plugin.saveSettings(); fearValue.textContent = this.plugin.settings.fearCounter.toString(); } });
        incrementBtn.addEventListener("click", async () => { this.plugin.settings.fearCounter++; await this.plugin.saveSettings(); fearValue.textContent = this.plugin.settings.fearCounter.toString(); });
    }

    populateCountdownsPopup(popupEl: HTMLElement) {
        popupEl.empty();
        const header = popupEl.createDiv({ cls: "dh-popup-header" });
        header.createEl("h4", { text: "Countdowns" });
        const controls = header.createDiv({ cls: "dh-panel-controls" });
        const addButton = controls.createEl("button", { title: "Add Countdown", cls: "dh-icon-button" });
        setIcon(addButton, "plus");
        addButton.addEventListener("click", () => this.handleAddCountdown());
        const body = popupEl.createDiv({ cls: "dh-countdowns-body" });
        if (this.plugin.settings.countdowns.length === 0) { body.createEl("p", { text: "No countdowns. Add one!", cls: "dh-no-items-message" }); }
        else { this.plugin.settings.countdowns.forEach(countdown => this.drawCountdownItem(countdown, body)); }
        body.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(body, e.clientY);
            const draggable = document.querySelector('.dh-dragging');
            if (draggable) { if (afterElement == null) { body.appendChild(draggable); } else { body.insertBefore(draggable, afterElement); } }
        });
    }

    getDragAfterElement(container: HTMLElement, y: number): Element | null {
        const draggableElements = Array.from(container.querySelectorAll('.dh-countdown-item:not(.dh-dragging)'));
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; }
            else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    drawCountdownItem(countdown: Countdown, container: HTMLElement) {
        const itemEl = container.createDiv({ cls: 'dh-countdown-item', attr: { 'data-countdown-id': countdown.id, draggable: 'true' } });
        itemEl.addEventListener('dragstart', () => { itemEl.classList.add('dh-dragging'); this.draggedCountdownId = countdown.id; });
        itemEl.addEventListener('dragend', async () => {
            itemEl.classList.remove('dh-dragging');
            if (!this.draggedCountdownId) return;
            const newOrderIds = Array.from(container.querySelectorAll('.dh-countdown-item')).map(el => el.getAttribute('data-countdown-id'));
            this.plugin.settings.countdowns.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
            this.draggedCountdownId = null;
            await this.plugin.saveSettings();
            this.updateCountdownsPopup();
        });
        const nameInput = itemEl.createEl('input', { type: 'text', value: countdown.name, cls: 'dh-countdown-name-input' });
        nameInput.addEventListener('change', () => this.handleRenameCountdown(countdown.id, nameInput.value));
        const controls = itemEl.createDiv({ cls: 'dh-countdown-controls' });
        const decrementBtn = controls.createEl('button', { text: '−', cls: 'dh-countdown-btn' });
        decrementBtn.addEventListener('click', () => this.handleCountdownValueChange(countdown.id, -1));
        controls.createSpan({ text: countdown.value.toString(), cls: 'dh-countdown-value' });
        const incrementBtn = controls.createEl('button', { text: '+', cls: 'dh-countdown-btn' });
        incrementBtn.addEventListener('click', () => this.handleCountdownValueChange(countdown.id, 1));
        const removeBtn = controls.createEl('button', { title: 'Remove Countdown', cls: 'dh-icon-button' });
        setIcon(removeBtn, 'trash');
        removeBtn.addEventListener('click', () => this.handleRemoveCountdown(countdown.id));
    }

    async handleAddCountdown(isDefault: boolean = false) {
        const newCountdown: Countdown = { id: `dh-countdown-${Date.now()}`, name: isDefault ? 'Default Countdown' : `Countdown ${this.plugin.settings.countdowns.length + 1}`, value: 0 };
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
        if (countdown && countdown.name !== newName) { countdown.name = newName; await this.plugin.saveSettings(); }
    }

    async handleCountdownValueChange(id: string, delta: number) {
        const countdown = this.plugin.settings.countdowns.find(c => c.id === id);
        if (countdown) {
            countdown.value += delta;
            await this.plugin.saveSettings();
            if (this.countdownsPopup) {
                const itemEl = this.countdownsPopup.querySelector(`[data-countdown-id="${id}"]`);
                if (itemEl) { const valueEl = itemEl.querySelector('.dh-countdown-value'); if (valueEl) valueEl.textContent = countdown.value.toString(); }
            }
        }
    }

    renderCompendiumList(listContainer: HTMLElement) {
        listContainer.empty();
        const filteredAdversaries = this.applyFilters(this.compendiumAdversaries);
        if (filteredAdversaries.length === 0) listContainer.createEl("p", { text: this.compendiumSearchTerm ? "No matching adversaries found." : "No adversaries in compendium. Check settings." });
        else filteredAdversaries.forEach(adversaryData => {
            const adversaryEntry = listContainer.createDiv({ cls: "dh-compendium-entry" });
            const nameSpan = adversaryEntry.createSpan({ text: adversaryData.name });
            if (adversaryData.isCustom) { nameSpan.addClass('dh-custom-adversary'); nameSpan.title = `Custom Adversary from ${adversaryData.sourceFile}`; }
            const addButton = adversaryEntry.createEl("button", { text: "+", title: "Add to active encounter", cls: "dh-add-compendium-btn" });
            addButton.addEventListener("click", () => this.addAdversaryToActiveEncounter(adversaryData));
        });
    }

    private applyFilters(adversaries: StatblockData[]): StatblockData[] {
        return adversaries.filter(adversary => {
            const matchesSearch = this.compendiumSearchTerm === "" || adversary.name.toLowerCase().includes(this.compendiumSearchTerm.toLowerCase());
            const matchesTier = this.selectedTiers.size === 0 || (adversary.tier !== undefined && (typeof adversary.tier === 'number' ? this.selectedTiers.has(adversary.tier) : this.selectedTiers.has(Number(adversary.tier))));
            const matchesType = this.selectedTypes.size === 0 || (adversary.type !== undefined && this.selectedTypes.has(adversary.type));
            return matchesSearch && matchesTier && matchesType;
        });
    }

    private toggleTier(tier: number) {
        if (this.selectedTiers.has(tier)) this.selectedTiers.delete(tier);
        else this.selectedTiers.add(tier);
        const tierButtons = this.uiContainer?.querySelectorAll('.dh-tier-button');
        if (tierButtons) tierButtons.forEach((btn: Element) => {
            const buttonTier = parseInt(btn.textContent || '0');
            if (this.selectedTiers.has(buttonTier)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
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
        const newEncounter: SavedEncounter = { id: newId, name: name, adversaries: [], adversaryGroupOrder: [] };
        this.plugin.settings.savedEncounters.push(newEncounter);
        this.plugin.saveSettings();
        this.currentEncounterId = newId;
        this.loadAdversariesForCurrentEncounter();
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
            if (encounterId === this.currentEncounterId) this.leaf.setEphemeralState(this.getState());
        }).open();
    }

    loadEncounter(encounterId: string) {
        if (this.currentEncounterId === encounterId) return;
        const encounterToLoad = this.plugin.settings.savedEncounters.find(e => e.id === encounterId);
        if (encounterToLoad) {
            this.currentEncounterId = encounterToLoad.id;
            this.loadAdversariesForCurrentEncounter();
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
            this.loadAdversariesForCurrentEncounter();
        }
        new Notice(`Encounter "${encounterName}" deleted.`);
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    private getAdversaryCost(type: string | undefined): number {
        if (!type) return 2;
        const t = type.toLowerCase();
        switch (t) {
            case 'minion': case 'minions': case 'social': case 'support': return 1;
            case 'horde': case 'ranged': case 'skulk': case 'standard': return 2;
            case 'leader': return 3; case 'bruiser': return 4; case 'solo': return 5;
            default: return 2;
        }
    }

    private calculateEncounterBudget(): { spent: number, total: number } {
        const config = this.plugin.settings.encounterBudgetConfig;
        const adversaries = this.activeEncounterAdversaries;
        let spent = 0;
        const adversaryTypes = new Set<string>();
        const allGroups = new Set<string>();
        let soloCount = 0;
        const minionGroups: { [groupId: string]: number } = {};
        adversaries.forEach(c => {
            allGroups.add(c.groupId);
            const typeLower = c.type?.toLowerCase();
            if (typeLower) adversaryTypes.add(typeLower);
            if (typeLower === 'solo') soloCount++;
            if (typeLower === 'minion' || typeLower === 'minions') {
                if (!minionGroups[c.groupId]) minionGroups[c.groupId] = 0;
                minionGroups[c.groupId]++;
            } else {
                spent += this.getAdversaryCost(c.type);
            }
        });
        const playerCount = config.playerCount > 0 ? config.playerCount : 1;
        for (const groupId in minionGroups) { spent += Math.ceil(minionGroups[groupId] / playerCount); }
        let total = (3 * config.playerCount) + 2;
        if (config.isEasier) total -= 1;
        if (config.isHarder) total += 2;
        if (config.isDamageBoosted) total -= 2;
        if (config.useLowerTier) total += 1;
        if (soloCount >= 2) total -= 2;
        const hasComplex = adversaryTypes.has('bruiser') || adversaryTypes.has('horde') || adversaryTypes.has('leader') || adversaryTypes.has('solo');
        if (!hasComplex && adversaries.length > 0 && allGroups.size <= 1) total += 1;
        return { spent, total };
    }

    private getHorizontalDragAfterElement(container: HTMLElement, x: number): Element | null {
        const draggableElements = Array.from(container.querySelectorAll('.dh-adversary-group-container:not(.dh-dragging)'));
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; }
            else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    private handleDragStart(e: DragEvent) {
        const target = e.target as HTMLElement;
        if (target.classList.contains('dh-drag-handle')) {
            const groupContainer = target.closest('.dh-adversary-group-container');
            if (groupContainer instanceof HTMLElement) {
                this.draggedGroupId = groupContainer.getAttribute('data-group-id');
                if (this.draggedGroupId) {
                    setTimeout(() => groupContainer.classList.add('dh-dragging'), 0);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }
            }
        } else { e.preventDefault(); }
    }

    private handleDragOver(e: DragEvent) {
        e.preventDefault();
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        if (!encounterArea || !this.draggedGroupId) return;
        const afterElement = this.getHorizontalDragAfterElement(encounterArea, e.clientX);
        const draggingElement = encounterArea.querySelector('.dh-dragging');
        if (draggingElement) { if (afterElement == null) { encounterArea.appendChild(draggingElement); } else { encounterArea.insertBefore(draggingElement, afterElement); } }
    }

    private handleDrop(e: DragEvent) {
        e.preventDefault();
        if (this.draggedGroupId) {
            const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
            const newOrderedIds = Array.from(encounterArea.querySelectorAll('.dh-adversary-group-container')).map(el => el.getAttribute('data-group-id')).filter((id): id is string => id !== null);
            const currentEncounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            if (currentEncounter) { currentEncounter.adversaryGroupOrder = newOrderedIds; this.plugin.saveSettings(); }
        }
    }

    private handleDragEnd(e: DragEvent) {
        const draggedElement = this.uiContainer?.querySelector('.dh-dragging');
        if (draggedElement) draggedElement.classList.remove('dh-dragging');
        this.draggedGroupId = null;
        this.drawUI();
    }

    handleEditInstanceEvent(e: Event) {
        const { instanceId } = (e as CustomEvent).detail;
        if (!instanceId) return;
        const instance = this.activeEncounterAdversaries.find(c => c.id === instanceId);
        if (!instance) return;
        new EditAdversaryModal(this.app, this.plugin, instance, (updatedAdversary) => {
            const groupId = instance.groupId;
            if (!groupId) return;
            this.activeEncounterAdversaries.forEach(c => {
                if (c.groupId === groupId) {
                    Object.assign(c, {
                        ...updatedAdversary,
                        id: c.id,
                        groupId: c.groupId,
                        currentHp: c.currentHp,
                        currentStress: c.currentStress,
                        displayName: c.displayName,
                        conditions: c.conditions
                    });
                }
            });
            this.updateDisplayNamesForGroup(groupId);
            this.autoSaveCurrentEncounter();
            this.redrawAdversaryGroup(groupId);
        }).open();
    }

    handleRequestConditionMenu(e: Event) {
        const { instanceId, anchor } = (e as CustomEvent).detail;
        if (!instanceId || !anchor) return;
        const menu = new Menu();
        DAGGERHEART_CONDITIONS.forEach(condition => { menu.addItem(item => item.setTitle(condition.name).onClick(() => this.addConditionToInstance(instanceId, condition))); });
        menu.addSeparator();
        menu.addItem(item => item.setTitle("Add Custom...").setIcon("plus").onClick(() => { new CustomConditionModal(this.app, (newCondition) => this.addConditionToInstance(instanceId, newCondition)).open(); }));
        const rect = (anchor as HTMLElement).getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }

    handleRemoveConditionEvent(e: Event) {
        const { instanceId, conditionName } = (e as CustomEvent).detail;
        if (!instanceId || !conditionName) return;
        const instance = this.activeEncounterAdversaries.find(c => c.id === instanceId);
        if (!instance || !instance.conditions) return;
        instance.conditions = instance.conditions.filter(c => c.name !== conditionName);
        this.autoSaveCurrentEncounter();
        this.redrawAdversaryGroup(instance.groupId);
    }

    handleRemoveInstanceEvent(e: Event) {
        this.removeAdversaryFromActiveEncounter((e as CustomEvent).detail.instanceId);
    }

    addConditionToInstance(instanceId: string, condition: Condition) {
        const instance = this.activeEncounterAdversaries.find(c => c.id === instanceId);
        if (!instance) return;
        if (!instance.conditions) instance.conditions = [];
        if (instance.conditions.some(c => c.name.toLowerCase() === condition.name.toLowerCase())) { new Notice(`"${instance.displayName}" already has the "${condition.name}" condition.`); return; }
        instance.conditions.push(condition);
        this.autoSaveCurrentEncounter();
        this.redrawAdversaryGroup(instance.groupId);
    }

    renderAdditionalTrackerRow(instance: AdversaryInstance, parentEl: HTMLElement) {
        const trackerRow = parentEl.createDiv({ cls: 'dh-additional-tracker-row' });
        const header = trackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: instance.displayName, cls: 'dh-additional-tracker-name' });
        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });
        const removeBtn = controlsWrapper.createEl('button', { text: '✕', title: "Remove this instance", cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => { this.uiContainer?.dispatchEvent(new CustomEvent('dh-remove-instance', { detail: { instanceId: instance.id }, bubbles: true })); });
        const conditionsContainer = trackerRow.createDiv({ cls: 'dh-conditions-list-container' });
        if (instance.conditions?.length) {
            const conditionsList = conditionsContainer.createDiv({ cls: 'dh-condition-tags-list' });
            instance.conditions.forEach(condition => {
                const tag = conditionsList.createDiv({ cls: 'dh-condition-tag' });
                tag.createSpan({ text: condition.name });
                const removeConditionBtn = tag.createEl('button', { cls: 'dh-remove-condition-btn', text: '×' });
                removeConditionBtn.addEventListener('click', () => { this.uiContainer?.dispatchEvent(new CustomEvent('dh-remove-condition', { detail: { instanceId: instance.id, conditionName: condition.name }, bubbles: true })); });
            });
        }
        this.plugin.createInteractiveTrack(trackerRow, 'HP', Number(instance.hp_stress.hp) || 0, `${instance.id}-hp-add`, instance.currentHp, (newHp) => { const inst = this.activeEncounterAdversaries.find(c => c.id === instance.id); if (inst) inst.currentHp = newHp; this.autoSaveCurrentEncounter(); });
        this.plugin.createInteractiveTrack(trackerRow, 'Stress', Number(instance.hp_stress.stress) || 0, `${instance.id}-stress-add`, instance.currentStress, (newStress) => { const inst = this.activeEncounterAdversaries.find(c => c.id === instance.id); if (inst) inst.currentStress = newStress; this.autoSaveCurrentEncounter(); });
    }

    private updateDisplayNamesForGroup(groupId: string) {
        const instancesInThisGroup = this.activeEncounterAdversaries.filter(inst => inst.groupId === groupId);
        instancesInThisGroup.sort((a, b) => a.id.localeCompare(b.id));
        if (instancesInThisGroup.length === 1) instancesInThisGroup[0].displayName = instancesInThisGroup[0].name;
        else instancesInThisGroup.forEach((instance, index) => { instance.displayName = `${instance.name} #${index + 1}`; });
    }

    addAdversaryToActiveEncounter(baseAdversary: StatblockData) {
        if (!this.currentEncounterId) { new Notice("Error: No active encounter. Please create or load an encounter first."); return; }
        const encounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
        if (!encounter) return;
        const newGroupId = `${baseAdversary.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
        this.createNewInstanceFromTemplate(baseAdversary, newGroupId);
        if (!encounter.adversaryGroupOrder) encounter.adversaryGroupOrder = [];
        encounter.adversaryGroupOrder.push(newGroupId);
        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    createNewInstanceFromTemplate(template: StatblockData, targetGroupId: string) {
        const newInstance: AdversaryInstance = {
            ...JSON.parse(JSON.stringify(template)),
            id: `${template.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            groupId: targetGroupId, currentHp: 0, currentStress: 0, displayName: "", conditions: [],
            hp_stress: { hp: Number(template.hp_stress.hp) || 0, stress: Number(template.hp_stress.stress) || 0, major_hp: template.hp_stress.major_hp ? Number(template.hp_stress.major_hp) : null, severe_hp: template.hp_stress.severe_hp ? Number(template.hp_stress.severe_hp) : null }
        };
        this.activeEncounterAdversaries.push(newInstance);
        this.updateDisplayNamesForGroup(targetGroupId);
    }

    removeAdversaryFromActiveEncounter(instanceId: string) {
        const instanceToRemoveIndex = this.activeEncounterAdversaries.findIndex(c => c.id === instanceId);
        if (instanceToRemoveIndex === -1) return;
        const removedInstance = this.activeEncounterAdversaries[instanceToRemoveIndex];
        const groupId = removedInstance.groupId;
        this.activeEncounterAdversaries.splice(instanceToRemoveIndex, 1);
        const isGroupEmpty = !this.activeEncounterAdversaries.some(inst => inst.groupId === groupId);
        if (isGroupEmpty) {
            const encounter = this.plugin.settings.savedEncounters.find(e => e.id === this.currentEncounterId);
            if (encounter?.adversaryGroupOrder) {
                const groupIndex = encounter.adversaryGroupOrder.indexOf(groupId);
                if (groupIndex > -1) encounter.adversaryGroupOrder.splice(groupIndex, 1);
            }
        }
        this.updateDisplayNamesForGroup(groupId);
        this.autoSaveCurrentEncounter();
        this.drawUI();
    }

    async onClose() {
        if (this.uiContainer) {
            this.uiContainer.removeEventListener('dh-request-condition-menu', this.boundHandleRequestConditionMenu);
            this.uiContainer.removeEventListener('dh-remove-condition', this.boundHandleRemoveConditionEvent);
            this.uiContainer.removeEventListener('dh-remove-instance', this.boundHandleRemoveInstanceEvent);
            this.uiContainer.removeEventListener('dh-edit-instance', this.boundHandleEditInstanceEvent);
            const encounterArea = this.uiContainer.querySelector('.dh-encounter-area');
            if (encounterArea) {
                encounterArea.removeEventListener('dragstart', this.boundHandleDragStart);
                encounterArea.removeEventListener('dragover', this.boundHandleDragOver);
                encounterArea.removeEventListener('drop', this.boundHandleDrop);
                encounterArea.removeEventListener('dragend', this.boundHandleDragEnd);
            }
        }
    }
}
