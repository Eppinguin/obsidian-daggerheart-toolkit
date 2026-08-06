import { ItemView, WorkspaceLeaf, Notice, Menu, setIcon } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import {
    StatblockData,
    AdversaryInstance,
    SavedEncounter,
    Countdown,
    Condition,
    CardDensity,
    CARD_DENSITY_CYCLE,
} from '../types';
import { renderStatblockCard, syncDefeatedState } from '../rendering/statblock';
import { normalizeRoleFamily } from '../rendering/statblock-type';
import { countdownState, fixedStartValue, isDiceStart, isValidStart, resetLabel } from '../services/countdown';
import { shouldScrollHorizontally, type ScrollableBox } from '../services/wheel-scroll';
import { renderConditionTags, renderConditionButton } from '../rendering/conditions';
import { renderInstanceName } from '../rendering/instance-name';
import {
    EncounterBudgetModal,
    CustomConditionModal,
    EditAdversaryModal,
    NameEncounterModal,
    ManageEncountersModal,
    ManageCompendiumModal,
    SummonPickerModal,
    SummonCountModal,
} from '../modals/index';
import type { SummonTarget } from '../services/summon-parser';
import { DAGGERHEART_CONDITIONS, DAGGERHEART_ADVERSARY_CONDITIONS } from '../constants';
import { EVENT_CREATE_COUNTDOWN, EVENT_RENAME_INSTANCE, EVENT_SPEND_FEAR, EVENT_SUMMON } from '../constants';
import { DiceTray } from '../DiceTray';
import { AdversaryScaler } from '../services/adversary-scaler';

export const ENCOUNTER_BUILDER_VIEW_TYPE = 'dh-encounter-builder-view';

/**
 * The icon and wording for each density level.
 *
 * `state` names the level the card is at and `action` what the next click does,
 * so a three-state control does not need the GM to have learned the cycle. Kept
 * as two fields rather than one sentence because the bulk button reuses the
 * action half on its own.
 */
const DENSITY_META: Record<CardDensity, { icon: string; state: string; action: string }> = {
    full: { icon: 'chevrons-down-up', state: 'Full card', action: 'click to fold the feats' },
    compact: { icon: 'chevron-up', state: 'Feats folded', action: 'click to collapse the card' },
    collapsed: { icon: 'chevron-down', state: 'Collapsed', action: 'click to expand' },
};

function densityTitle(level: CardDensity, prefix?: string): string {
    const meta = DENSITY_META[level];
    return `${prefix ?? meta.state} — ${meta.action}`;
}

function nextDensity(current: CardDensity): CardDensity {
    const i = CARD_DENSITY_CYCLE.indexOf(current);
    return CARD_DENSITY_CYCLE[(i + 1) % CARD_DENSITY_CYCLE.length];
}

export class EncounterBuilderView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    compendiumItems: StatblockData[] = [];
    activeEncounterItems: AdversaryInstance[] = [];
    private diceTray: DiceTray;

    currentEncounterId: string | null = null;
    private uiContainer: HTMLElement | null = null;
    private isCompendiumVisible: boolean = true;
    private isCountdownsPopupVisible: boolean = false;
    private compendiumSearchTerm: string = '';
    private selectedTiers: Set<number> = new Set();
    private selectedTypes: Set<string> = new Set();
    /** Content source filter; 'all' shows every enabled source. */
    private selectedSourceId: string = 'all';
    private compendiumItemCategory: 'all' | 'adversary' | 'environment' = 'all';

    private countdownsPopup: HTMLElement | null = null;
    private draggedCountdownId: string | null = null;
    private draggedGroupId: string | null = null;
    /**
     * Drag bookkeeping, all of it live only between dragstart and dragend.
     *
     * `dragover` fires continuously while the pointer moves, so anything it does
     * per event is done tens of times a second. Measuring the cards once at
     * dragstart (`dragCardMidpoints`) keeps that handler off the layout path
     * entirely; `dragOrderChanged` lets dragend skip the redraw when the drop
     * left the order exactly as it was.
     */
    private dragCardMidpoints: { id: string; mid: number }[] = [];
    private dragOrderChanged = false;
    private dragAutoScrollFrame: number | null = null;
    private dragPointerX = 0;

    /** Countdowns whose loop editor is open. Transient; not worth persisting. */
    private editingLoopIds: Set<string> = new Set();

    private activeScalingGroups: Set<string> = new Set();
    /**
     * How much of each card is showing, keyed by groupId. Groups absent from the
     * map are 'full'.
     *
     * Loaded from and saved to the active encounter rather than the leaf, so a
     * layout survives closing the view and restarting Obsidian, and each
     * encounter remembers its own.
     */
    private cardDensity: Map<string, CardDensity> = new Map();
    /**
     * Features the GM has toggled away from the default, keyed `groupId::name`.
     * Any HP change redraws the group, so without this every open feature would
     * snap shut on each damage tick — once per hit, mid-combat.
     */
    private toggledFeatures: Set<string> = new Set();

    // Reference to store the active popover element
    private activePopover: HTMLElement | null = null;

    private boundHandleRequestConditionMenu: (e: Event) => void;
    private boundHandleRemoveConditionEvent: (e: Event) => void;
    private boundHandleRemoveInstanceEvent: (e: Event) => void;
    private boundHandleEditInstanceEvent: (e: Event) => void;
    private boundHandleDragStart: (e: DragEvent) => void;
    private boundHandleDragOver: (e: DragEvent) => void;
    private boundHandleDrop: (e: DragEvent) => void;
    private boundHandleDragEnd: (e: DragEvent) => void;
    private boundHandleEncounterWheel: (e: WheelEvent) => void;
    private boundHandleCreateCountdownEvent: (e: Event) => void;
    private boundHandleRenameInstanceEvent: (e: Event) => void;
    private boundHandleSpendFearEvent: (e: Event) => void;
    private boundHandleSummonEvent: (e: Event) => void;

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.diceTray = new DiceTray(this.plugin);
        this.boundHandleRequestConditionMenu = this.handleRequestConditionMenu.bind(this);
        this.boundHandleRemoveConditionEvent = this.handleRemoveConditionEvent.bind(this);
        this.boundHandleRemoveInstanceEvent = this.handleRemoveInstanceEvent.bind(this);
        this.boundHandleEditInstanceEvent = this.handleEditInstanceEvent.bind(this);
        this.boundHandleDragStart = this.handleDragStart.bind(this);
        this.boundHandleDragOver = this.handleDragOver.bind(this);
        this.boundHandleDrop = this.handleDrop.bind(this);
        this.boundHandleDragEnd = this.handleDragEnd.bind(this);
        this.boundHandleEncounterWheel = this.handleEncounterWheel.bind(this);
        this.boundHandleCreateCountdownEvent = this.handleCreateCountdownEvent.bind(this);
        this.boundHandleRenameInstanceEvent = this.handleRenameInstanceEvent.bind(this);
        this.boundHandleSpendFearEvent = this.handleSpendFearEvent.bind(this);
        this.boundHandleSummonEvent = this.handleSummonEvent.bind(this);
    }

    getViewType(): string {
        return ENCOUNTER_BUILDER_VIEW_TYPE;
    }

    getDisplayText(): string {
        if (this.currentEncounterId) {
            const currentEncounter = this.plugin.getSavedEncounter(this.currentEncounterId);
            return currentEncounter ? `Encounter: ${currentEncounter.name}` : 'Daggerheart Encounters';
        }
        return 'Daggerheart Encounters';
    }

    async onOpen() {
        // Add a wrapper class to the view's root element for styling
        this.containerEl.addClass('dh-encounter-view');

        this.uiContainer = this.containerEl.children[1] as HTMLElement;
        this.uiContainer.empty();
        this.uiContainer.addClass('dh-encounter-builder-container');

        this.registerViewListeners();

        const persistedState = this.leaf.getEphemeralState();
        if (persistedState) {
            if (persistedState.currentEncounterId) this.currentEncounterId = persistedState.currentEncounterId;
            this.isCountdownsPopupVisible =
                typeof persistedState.isCountdownsPopupVisible === 'boolean'
                    ? persistedState.isCountdownsPopupVisible
                    : false;
            this.compendiumSearchTerm =
                typeof persistedState.compendiumSearchTerm === 'string' ? persistedState.compendiumSearchTerm : '';
            this.compendiumItemCategory = persistedState.compendiumItemCategory || 'all';
            if (Array.isArray(persistedState.selectedTiers)) this.selectedTiers = new Set(persistedState.selectedTiers);
            if (Array.isArray(persistedState.selectedTypes)) this.selectedTypes = new Set(persistedState.selectedTypes);
            if (typeof persistedState.selectedSourceId === 'string')
                this.selectedSourceId = persistedState.selectedSourceId;
            // Card density and feature toggles are deliberately not read here:
            // they live on the encounter now, and loadItemsForCurrentEncounter
            // hydrates them. A second copy in ephemeral state would only race
            // the saved one.
        }

        // Initialize compendium visibility from plugin settings
        this.isCompendiumVisible =
            typeof this.plugin.settings.isCompendiumVisible === 'boolean'
                ? this.plugin.settings.isCompendiumVisible
                : true;

        this.ensureActiveEncounter();
        this.icon = 'swords';
        this.loadItemsForCurrentEncounter();
        await this.loadCompendium();
        this.drawUI();
        // Render the DiceTray into the root container, not the scrolling one
        this.diceTray.render(this.containerEl);
        this.leaf.setEphemeralState(this.getState());
    }

    registerViewListeners() {
        if (!this.uiContainer) return;
        this.uiContainer.addEventListener('dh-request-condition-menu', this.boundHandleRequestConditionMenu);
        this.uiContainer.addEventListener('dh-remove-condition', this.boundHandleRemoveConditionEvent);
        this.uiContainer.addEventListener('dh-remove-instance', this.boundHandleRemoveInstanceEvent);
        this.uiContainer.addEventListener('dh-edit-instance', this.boundHandleEditInstanceEvent);
        this.uiContainer.addEventListener(EVENT_CREATE_COUNTDOWN, this.boundHandleCreateCountdownEvent);
        this.uiContainer.addEventListener(EVENT_RENAME_INSTANCE, this.boundHandleRenameInstanceEvent);
        this.uiContainer.addEventListener(EVENT_SPEND_FEAR, this.boundHandleSpendFearEvent);
        this.uiContainer.addEventListener(EVENT_SUMMON, this.boundHandleSummonEvent);

        // The tier scaler dismisses like a popover: any click outside it, or
        // Escape, closes it. Bound to the document so clicks anywhere in the
        // workspace count, not just inside this view.
        document.addEventListener('click', this.handleDismissTierScaler);
        document.addEventListener('keydown', this.handleTierScalerKeydown);

        // Settings changes (and compendium reloads) redraw the view in place, so
        // toggling a setting takes effect without reopening the leaf.
        // registerEvent ties the subscription to the view's lifecycle.
        this.registerEvent(
            this.app.workspace.on('daggerheart-compendium-update', async () => {
                // The cached list has to be re-read as well; redrawing alone
                // would repaint the same stale entries after an import.
                await this.loadCompendium();
                if (this.uiContainer) this.drawUI();
            }),
        );
    }

    async setState(state: any, result: any) {
        if (state) {
            if (state.currentEncounterId) {
                this.currentEncounterId = state.currentEncounterId;
                // Check if the encounter exists
                if (this.currentEncounterId && !this.plugin.getSavedEncounter(this.currentEncounterId)) {
                    this.currentEncounterId = null;
                }
            }
            if (typeof state.isCompendiumVisible === 'boolean') {
                // Only update the ephemeral state value, not overriding the saved plugin setting
                this.isCompendiumVisible = this.plugin.settings.isCompendiumVisible;
            }
            if (typeof state.isCountdownsPopupVisible === 'boolean')
                this.isCountdownsPopupVisible = state.isCountdownsPopupVisible;
            if (typeof state.compendiumSearchTerm === 'string') this.compendiumSearchTerm = state.compendiumSearchTerm;
            if (typeof state.compendiumItemCategory === 'string')
                this.compendiumItemCategory = state.compendiumItemCategory;
            if (Array.isArray(state.selectedTiers)) this.selectedTiers = new Set(state.selectedTiers);
            if (Array.isArray(state.selectedTypes)) this.selectedTypes = new Set(state.selectedTypes);
            if (typeof state.selectedSourceId === 'string') this.selectedSourceId = state.selectedSourceId;
            // Card density and feature toggles come from the encounter, not
            // from here — see loadItemsForCurrentEncounter.
        }
        this.ensureActiveEncounter();
        this.loadItemsForCurrentEncounter();
        if (this.uiContainer && this.contentEl.children.length > 0) {
            await this.loadCompendium();
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
            compendiumItemCategory: this.compendiumItemCategory,
            selectedTiers: Array.from(this.selectedTiers),
            selectedTypes: Array.from(this.selectedTypes),
            selectedSourceId: this.selectedSourceId,
        };
    }

    ensureActiveEncounter() {
        const savedEncounters = this.plugin.getSavedEncounters();
        if (savedEncounters.length === 0) {
            this.handleNewEncounter(true, 'My First Encounter');
        } else if (!this.currentEncounterId || !savedEncounters.find((e) => e.id === this.currentEncounterId)) {
            this.currentEncounterId = savedEncounters[0]?.id || null;
            if (!this.currentEncounterId && savedEncounters.length > 0) {
                this.handleNewEncounter(true, 'My First Encounter');
            }
        }
        if (this.plugin.settings.enableCountdownTracker && this.plugin.settings.countdowns.length === 0) {
            this.handleAddCountdown(true);
        }
    }

    loadItemsForCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounter = this.plugin.getSavedEncounter(this.currentEncounterId);
            this.activeEncounterItems = encounter ? JSON.parse(JSON.stringify(encounter.adversaries)) : [];
            this.loadCardStateFrom(encounter);
        } else {
            this.activeEncounterItems = [];
            this.cardDensity.clear();
            this.toggledFeatures.clear();
        }
    }

    /**
     * Adopt an encounter's saved card layout.
     *
     * Called wherever the encounter changes, so switching encounters shows that
     * encounter's arrangement instead of carrying the previous one's over.
     * Encounters saved before this existed have neither field and read as "all
     * cards full", which is the pre-change behaviour.
     */
    private loadCardStateFrom(encounter: SavedEncounter | null | undefined) {
        this.cardDensity.clear();
        this.toggledFeatures.clear();
        if (!encounter) return;
        for (const [groupId, density] of Object.entries(encounter.cardDensity ?? {})) {
            // Guard against a hand-edited or older file naming a level that no
            // longer exists; an unknown value would otherwise stick the card in
            // a state no CSS matches.
            if (CARD_DENSITY_CYCLE.includes(density)) this.cardDensity.set(groupId, density);
        }
        for (const key of encounter.toggledFeatures ?? []) this.toggledFeatures.add(key);
    }

    private densityFor(groupId: string): CardDensity {
        return this.cardDensity.get(groupId) ?? 'full';
    }

    /**
     * The default a feature starts at, before the GM's own choice is applied.
     *
     * `compact` folds everything; otherwise the global setting decides.
     */
    private featureBaseline(groupId: string): boolean {
        return this.densityFor(groupId) === 'compact' ? false : this.plugin.settings.showFeatureDetailsOnCards;
    }

    /**
     * Whether a feature starts open.
     *
     * `toggledFeatures` records *departures from the baseline*, not absolute
     * states, so flipping the global setting still moves every feature the GM
     * has not personally touched. Because the baseline is density-aware, a feat
     * opened by hand on a folded card is a departure from `false` — it stays
     * open across redraws and reloads while the rest of the card stays folded,
     * which is exactly the "peek at one feat" the middle mode exists for.
     */
    private isFeatureExpanded(groupId: string, featureName: string): boolean {
        const base = this.featureBaseline(groupId);
        return this.toggledFeatures.has(`${groupId}::${featureName}`) ? !base : base;
    }

    async loadCompendium() {
        this.compendiumItems = this.plugin.compendium.getStatblocks();
        this.compendiumItems.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`Daggerheart View: Loaded ${this.compendiumItems.length} compendium items.`);
    }

    async autoSaveCurrentEncounter() {
        if (this.currentEncounterId) {
            const encounter = this.plugin.getSavedEncounter(this.currentEncounterId);
            if (encounter) {
                const updatedEncounter = {
                    ...encounter,
                    adversaries: JSON.parse(JSON.stringify(this.activeEncounterItems)),
                    ...this.cardStateSnapshot(),
                };
                await this.plugin.updateSavedEncounter(updatedEncounter);
            }
        }
    }

    /**
     * The card layout, in the shape SavedEncounter stores it.
     *
     * Only groups that have moved off 'full' are written, so an encounter the GM
     * never rearranged stays clean in encounters.json rather than carrying a
     * "full" entry per card.
     */
    private cardStateSnapshot(): Pick<SavedEncounter, 'cardDensity' | 'toggledFeatures'> {
        const cardDensity: Record<string, CardDensity> = {};
        for (const [groupId, density] of this.cardDensity) {
            if (density !== 'full') cardDensity[groupId] = density;
        }
        return { cardDensity, toggledFeatures: Array.from(this.toggledFeatures) };
    }

    /**
     * Persist a layout change. Rides the same save path as an HP tick, which
     * already runs on every point of damage, so this adds no new write pressure.
     */
    private persistCardState() {
        this.autoSaveCurrentEncounter();
    }

    showEncounterSwitcherMenu(event: MouseEvent) {
        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle('Create New Encounter...')
                .setIcon('plus-circle')
                .onClick(() => this.handleNewEncounter()),
        );
        menu.addItem((item) =>
            item
                .setTitle('Manage Saved Encounters...')
                .setIcon('settings')
                .onClick(() => new ManageEncountersModal(this.app, this).open()),
        );

        const savedEncounters = this.plugin.getSavedEncounters();
        if (savedEncounters.length > 0) {
            menu.addSeparator();
            savedEncounters.forEach((savedEncounter) => {
                menu.addItem((item) => {
                    item.setTitle(savedEncounter.name)
                        .setIcon(savedEncounter.id === this.currentEncounterId ? 'check' : '')
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

        // Save the state to the plugin settings
        this.plugin.settings.isCompendiumVisible = this.isCompendiumVisible;
        this.plugin.saveSettings();

        // Update the ephemeral state
        this.leaf.setEphemeralState(this.getState());
        this.drawUI();
    }

    toggleCountdownsPopup() {
        this.isCountdownsPopupVisible = !this.isCountdownsPopupVisible;
        this.leaf.setEphemeralState(this.getState());
        this.updateCountdownsPopup();
    }

    /**
     * Redraw the countdown list in place.
     *
     * Ticking a countdown to zero, resetting it, or closing the loop editor all
     * change how a row renders, but tearing the popup down to do that threw away
     * the scroll position — so acting on a countdown near the bottom of a long
     * list jumped back to the top. Only the list body is rebuilt, and its scroll
     * offset is carried across.
     */
    refreshCountdownsList() {
        const body = this.countdownsPopup?.querySelector('.dh-countdowns-body') as HTMLElement | null;
        if (!body) {
            this.updateCountdownsPopup();
            return;
        }
        const scrollTop = body.scrollTop;
        this.fillCountdownsBody(body);
        // Restore unless something in the rebuilt list took focus and scrolled
        // itself into view — opening the loop editor should be allowed to bring
        // its field into sight.
        if (!body.contains(document.activeElement)) body.scrollTop = scrollTop;
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

    private async scaleGroup(groupId: string, targetTier: number) {
        // Find all instances in this group
        const groupIndices: number[] = [];
        this.activeEncounterItems.forEach((item, index) => {
            if (item.groupId === groupId) groupIndices.push(index);
        });

        if (groupIndices.length === 0) return;

        const before = this.activeEncounterItems[groupIndices[0]];
        const beforeSummary = {
            name: before.displayName || before.name,
            tier: Number(before.tier) || 0,
            hp: Number(before.hp_stress?.hp) || 0,
            damage: before.attack?.damage ?? '',
        };

        // Scale each one
        groupIndices.forEach((index) => {
            const original = this.activeEncounterItems[index];
            const scaled = AdversaryScaler.scale(original, targetTier);
            this.activeEncounterItems[index] = scaled;
        });

        // Scaling rewrites HP, damage and feature text at once. Summarise what
        // actually moved, so the GM can trust the change without diffing the
        // card against a statblock they no longer have on screen.
        const after = this.activeEncounterItems[groupIndices[0]];
        const changes: string[] = [];
        const afterHp = Number(after.hp_stress?.hp) || 0;
        if (afterHp !== beforeSummary.hp) changes.push(`HP ${beforeSummary.hp} → ${afterHp}`);
        const afterDamage = after.attack?.damage ?? '';
        if (afterDamage && afterDamage !== beforeSummary.damage) {
            changes.push(`damage ${beforeSummary.damage} → ${afterDamage}`);
        }
        new Notice(
            `${beforeSummary.name}: tier ${beforeSummary.tier} → ${targetTier}` +
                (changes.length ? `\n${changes.join(', ')}` : ''),
        );

        await this.autoSaveCurrentEncounter();

        // Redraw
        this.redrawItemGroup(groupId);

        // Also update budget since costs might change (although cost is type based mostly)
        const encounterHeader = this.uiContainer?.querySelector('.dh-encounter-header');
        if (encounterHeader) {
            const rightSideTrackers = encounterHeader.querySelector('.dh-right-side-trackers') as HTMLElement;
            if (rightSideTrackers && this.plugin.settings.enableEncounterBudget) {
                rightSideTrackers.empty();
                this.drawEncounterBudget(rightSideTrackers);
                if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
            }
        }
    }

    private redrawItemGroup(groupId: string) {
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        let groupContainer = encounterArea?.querySelector(`[data-group-id="${groupId}"]`) as HTMLElement;

        if (!encounterArea) {
            this.drawUI();
            return;
        }
        const instancesInGroup = this.activeEncounterItems.filter((inst) => inst.groupId === groupId);
        if (instancesInGroup.length === 0) {
            groupContainer?.remove();
            return;
        }
        if (!groupContainer) groupContainer = this.drawItemGroup(groupId, encounterArea);

        const contentScroller = groupContainer.querySelector('.dh-instance-card-content');
        const scrollTop = contentScroller?.scrollTop ?? 0;
        groupContainer.empty();
        this.populateItemGroupContainer(groupId, groupContainer);
        const newContentScroller = groupContainer.querySelector('.dh-instance-card-content');
        if (newContentScroller) newContentScroller.scrollTop = scrollTop;
    }

    private populateItemGroupContainer(groupId: string, containerEl: HTMLElement) {
        const instancesInGroup = this.activeEncounterItems.filter((inst) => inst.groupId === groupId);
        if (instancesInGroup.length === 0) return;

        instancesInGroup.sort((a, b) => a.id.localeCompare(b.id));
        const firstInstanceInGroup = instancesInGroup[0];
        const instanceTypeClass = `dh-type-${normalizeRoleFamily(firstInstanceInGroup.type)}`;
        const isGroupMultiple = instancesInGroup.length > 1;
        const mainCardContainerClasses = ['dh-adversary-instance-card', instanceTypeClass];
        if (isGroupMultiple) mainCardContainerClasses.push('dh-multiple-instances');

        const mainCardContainer = containerEl.createDiv({ cls: mainCardContainerClasses.join(' ') });
        // Collapsing hides the statblock, and with it the adversary's name. This
        // compact title only renders in that state, so the card still says what
        // it is and the controls have something to sit beside.
        mainCardContainer.createDiv({
            cls: 'dh-card-collapsed-title',
            text: firstInstanceInGroup.name,
        });

        const headerControls = mainCardContainer.createDiv({ cls: 'dh-card-header-controls' });
        const dragHandle = headerControls.createDiv({
            cls: 'dh-drag-handle',
            attr: { draggable: 'true', 'aria-label': 'Drag to reorder' },
        });
        setIcon(dragHandle, 'grip-vertical');

        // One button cycles the card's density rather than two toggling separate
        // things: the three levels are a single "how much do I need to see"
        // axis, and one control means no mode to remember being in.
        //
        // First in the cluster, beside the drag handle: it is a view control the
        // GM hits repeatedly during play, so it sits with the other harmless
        // controls rather than next to edit and delete.
        const density = this.densityFor(groupId);
        const densityBtn = headerControls.createEl('button', {
            cls: 'dh-icon-button dh-prose-toggle-btn',
            attr: { type: 'button', title: densityTitle(density) },
        });
        densityBtn.dataset.density = density;
        setIcon(densityBtn, DENSITY_META[density].icon);
        densityBtn.addEventListener('click', () => {
            this.setGroupDensity(groupId, nextDensity(this.densityFor(groupId)));
        });

        const editButton = headerControls.createEl('button', {
            title: 'Edit Item',
            cls: 'dh-icon-button',
        });
        setIcon(editButton, 'pencil');
        editButton.addEventListener('click', () => {
            this.uiContainer?.dispatchEvent(
                new CustomEvent('dh-edit-instance', {
                    detail: { instanceId: firstInstanceInGroup.id },
                    bubbles: true,
                }),
            );
        });

        // --- Tier Scaling Controls ---
        if (firstInstanceInGroup.category === 'adversary') {
            const currentTier = Number(firstInstanceInGroup.tier) || 0;
            // The tier the adversary was published at. Scaling always derives
            // from this, so it is the anchor the GM needs to see to know whether
            // a card has been changed and what "back to normal" means.
            const baseTier =
                Number((firstInstanceInGroup._originalStats as AdversaryInstance | undefined)?.tier ?? currentTier) ||
                0;
            const isScaled = currentTier !== baseTier;

            const toggleScaleBtn = headerControls.createEl('button', {
                cls: 'dh-icon-button dh-scale-toggle-btn',
                attr: {
                    type: 'button',
                    title: isScaled
                        ? `Scaled to tier ${currentTier} (normally tier ${baseTier})`
                        : 'Scale this adversary to another tier',
                },
            });
            setIcon(toggleScaleBtn, 'trending-up');
            if (this.activeScalingGroups.has(groupId)) toggleScaleBtn.addClass('is-active');
            // A scaled adversary no longer matches its statblock, which is worth
            // seeing without opening the controls.
            toggleScaleBtn.toggleClass('is-scaled', isScaled);

            const tierControls = headerControls.createDiv({ cls: 'dh-tier-controls' });
            tierControls.toggleClass('is-visible', this.activeScalingGroups.has(groupId));

            // Tiers are picked directly rather than stepped through: it is one
            // click to any tier, and the row shows at a glance where this
            // adversary sits and where it started.
            for (let tier = 1; tier <= 4; tier++) {
                const tierBtn = tierControls.createEl('button', {
                    cls: 'dh-tier-btn',
                    text: String(tier),
                    attr: {
                        type: 'button',
                        title: tier === baseTier ? `Tier ${tier} (original)` : `Scale to tier ${tier}`,
                        'aria-pressed': String(tier === currentTier),
                    },
                });
                tierBtn.toggleClass('is-current', tier === currentTier);
                tierBtn.toggleClass('is-base', tier === baseTier);
                tierBtn.addEventListener('click', (e) => {
                    // Stopped here rather than relying on the row's own listener:
                    // scaleGroup redraws the card, so this button's ancestors may
                    // be detached before the event finishes bubbling to them.
                    e.stopPropagation();
                    if (tier === currentTier) return;
                    this.scaleGroup(groupId, tier);
                });
            }

            if (isScaled) {
                const resetBtn = tierControls.createEl('button', {
                    cls: 'dh-icon-button dh-tier-reset-btn',
                    attr: { type: 'button', title: `Reset to tier ${baseTier}` },
                });
                setIcon(resetBtn, 'rotate-ccw');
                resetBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.scaleGroup(groupId, baseTier);
                });
            }

            toggleScaleBtn.addEventListener('click', (e) => {
                // Without this the click reaches the document handler below and
                // immediately closes what it just opened.
                e.stopPropagation();
                const nowActive = !this.activeScalingGroups.has(groupId);
                // Only one scaler open at a time: it is a popover, and leaving
                // several open clutters the encounter area.
                this.closeAllTierScalers();
                if (nowActive) {
                    this.activeScalingGroups.add(groupId);
                    tierControls.addClass('is-visible');
                    toggleScaleBtn.addClass('is-active');
                }
                this.syncCardControlsWidth(mainCardContainer);
                this.leaf.setEphemeralState(this.getState());
            });

            // Clicks inside the row are the GM using it, not dismissing it.
            tierControls.addEventListener('click', (e) => e.stopPropagation());
        }

        // Last in the cluster, furthest from the collapse toggle the GM reaches
        // for during play. (The tier row above is positioned out of flow, so it
        // does not sit between this and the other buttons.)
        const deleteGroupButton = headerControls.createEl('button', {
            title: 'Remove from Encounter',
            cls: 'dh-icon-button dh-card-delete-btn',
        });
        setIcon(deleteGroupButton, 'trash');
        deleteGroupButton.addEventListener('click', () => {
            this.removeGroupFromEncounter(groupId);
        });

        // Reserve space for the controls that float over the card title.
        this.syncCardControlsWidth(mainCardContainer);

        renderStatblockCard(
            this.plugin,
            firstInstanceInGroup,
            mainCardContainer,
            true,
            firstInstanceInGroup.displayName,
            (newHp) => {
                const inst = this.activeEncounterItems.find((cr) => cr.id === firstInstanceInGroup.id);
                if (inst) inst.currentHp = newHp;
                this.autoSaveCurrentEncounter();
            },
            (newStress) => {
                const inst = this.activeEncounterItems.find((cr) => cr.id === firstInstanceInGroup.id);
                if (inst) inst.currentStress = newStress;
                this.autoSaveCurrentEncounter();
            },
            instancesInGroup.length,
            {
                isExpanded: (feature) => this.isFeatureExpanded(groupId, feature.name),
                onToggle: (feature, expanded) => {
                    const key = `${groupId}::${feature.name}`;
                    // Compared against the density-aware baseline, not the raw
                    // setting: on a folded card the baseline is "closed", so
                    // peeking at one feat records a departure and survives the
                    // redraw that every HP tick triggers. Comparing to the
                    // setting instead deleted the key and lost the peek.
                    if (expanded === this.featureBaseline(groupId)) this.toggledFeatures.delete(key);
                    else this.toggledFeatures.add(key);
                    this.persistCardState();
                },
            },
        );

        // The single hook the CSS keys on. Set after the body renders, since
        // renderStatblockCard rebuilds the content div underneath it.
        this.syncDensityAttr(mainCardContainer, groupId);

        if (firstInstanceInGroup.category === 'adversary') {
            const addToGroupButtonContainer = mainCardContainer.createDiv({
                cls: 'dh-add-to-group-button-container',
            });
            const addToGroupButton = addToGroupButtonContainer.createEl('button', {
                text: '+ Add to Group',
                title: `Add another ${firstInstanceInGroup.name} to this group`,
                cls: 'dh-add-to-group-btn',
            });
            addToGroupButton.addEventListener('click', () => {
                const templateAdversary = this.activeEncounterItems.find((c) => c.groupId === groupId);
                if (templateAdversary) {
                    this.createNewInstanceFromTemplate(templateAdversary, groupId);
                    this.autoSaveCurrentEncounter();
                    const rightSideTrackers = this.uiContainer?.querySelector('.dh-right-side-trackers') as HTMLElement;
                    if (rightSideTrackers && this.plugin.settings.enableEncounterBudget) {
                        rightSideTrackers.empty();
                        this.drawEncounterBudget(rightSideTrackers);
                        if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
                    }
                    this.redrawItemGroup(groupId);
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
    }

    /**
     * Turn vertical wheel movement into horizontal scrolling.
     *
     * The encounter area is a single non-wrapping row, so a mouse with only a
     * vertical wheel has no way to reach the cards past the right edge. A
     * trackpad already sends horizontal deltas and is left alone.
     *
     * Cards scroll internally, so this defers whenever the pointer is over a
     * region that can still absorb the scroll itself — otherwise reading down a
     * long feature list would drag the whole encounter sideways instead.
     */
    private handleEncounterWheel(e: WheelEvent) {
        const scroller = e.currentTarget as HTMLElement;

        // Collect the scrollable boxes between the pointer and the row, so the
        // decision itself stays testable without a DOM.
        const chain: ScrollableBox[] = [];
        let node = e.target as HTMLElement | null;
        while (node && node !== scroller) {
            chain.push({
                scrollTop: node.scrollTop,
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
                overflowY: getComputedStyle(node).overflowY,
            });
            node = node.parentElement;
        }

        const areaOverflows = scroller.scrollWidth > scroller.clientWidth;
        if (!shouldScrollHorizontally(e, chain, areaOverflows)) return;

        e.preventDefault();
        scroller.scrollLeft += e.deltaY;
    }

    /**
     * Closes every open tier scaler. The row is a popover, so it dismisses on
     * any click outside it, on Escape, and when another one is opened.
     */
    private closeAllTierScalers() {
        if (this.activeScalingGroups.size === 0) return;
        this.activeScalingGroups.clear();
        this.uiContainer
            ?.querySelectorAll('.dh-tier-controls.is-visible')
            .forEach((el) => el.removeClass('is-visible'));
        this.uiContainer
            ?.querySelectorAll('.dh-scale-toggle-btn.is-active')
            .forEach((el) => el.removeClass('is-active'));
        // The cluster narrows again, so the card titles regain their space.
        this.uiContainer
            ?.querySelectorAll('.dh-adversary-instance-card')
            .forEach((el) => this.syncCardControlsWidth(el as HTMLElement));
        this.leaf.setEphemeralState(this.getState());
    }

    /**
     * Publish a card's density to the DOM: one attribute on the card, which is
     * the only thing the collapse CSS matches on. Replaces toggling classes
     * across descendants, which could not express a third level.
     */
    private syncDensityAttr(cardEl: HTMLElement, groupId: string) {
        const density = this.densityFor(groupId);
        cardEl.dataset.density = density;
        const btn = cardEl.querySelector('.dh-prose-toggle-btn') as HTMLElement | null;
        if (btn) {
            btn.dataset.density = density;
            btn.title = densityTitle(density);
            setIcon(btn, DENSITY_META[density].icon);
        }
    }

    /**
     * Move one card to a density level.
     *
     * Redraws the group rather than only swapping the attribute: `full` and
     * `compact` differ in which feature descriptions are rendered open, and that
     * is decided during render.
     */
    private setGroupDensity(groupId: string, density: CardDensity) {
        if (density === 'full') this.cardDensity.delete(groupId);
        else this.cardDensity.set(groupId, density);
        // Per-feature choices are departures from the density's baseline, so a
        // level change would flip their meaning: feats peeked open on a folded
        // card would come back as the only *closed* ones once the card expands.
        // Cycling is an explicit "set this whole card", so the peeks retire.
        this.clearFeatureToggles(groupId);
        this.persistCardState();
        this.redrawItemGroup(groupId);
        this.updateCycleAllButton();
    }

    /** Drop every per-feature override belonging to one card. */
    private clearFeatureToggles(groupId: string) {
        const prefix = `${groupId}::`;
        for (const key of this.toggledFeatures) {
            if (key.startsWith(prefix)) this.toggledFeatures.delete(key);
        }
    }

    /** Every groupId currently on the board, in render order. */
    private groupIds(): string[] {
        const seen = new Set<string>();
        for (const item of this.activeEncounterItems) {
            if (item.groupId) seen.add(item.groupId);
        }
        return Array.from(seen);
    }

    /**
     * Advance every card one step, starting from the level most of them are at.
     *
     * Taking the majority rather than a stored global level means the button
     * always visibly changes something: on a board the GM has arranged by hand,
     * one press pulls the stragglers into line with the rest and the next moves
     * them all on together.
     */
    private cycleAllDensity() {
        const groupIds = this.groupIds();
        if (groupIds.length === 0) return;

        const counts = new Map<CardDensity, number>();
        for (const groupId of groupIds) {
            const d = this.densityFor(groupId);
            counts.set(d, (counts.get(d) ?? 0) + 1);
        }
        // Ties resolve towards the earlier level in the cycle, so a split board
        // moves in the direction of folding rather than jumping to expanded.
        let dominant: CardDensity = 'full';
        let best = -1;
        for (const level of CARD_DENSITY_CYCLE) {
            const n = counts.get(level) ?? 0;
            if (n > best) {
                best = n;
                dominant = level;
            }
        }

        const target = nextDensity(dominant);
        for (const groupId of groupIds) {
            if (target === 'full') this.cardDensity.delete(groupId);
            else this.cardDensity.set(groupId, target);
            this.clearFeatureToggles(groupId);
        }
        this.persistCardState();
        for (const groupId of groupIds) this.redrawItemGroup(groupId);
        this.updateCycleAllButton();
    }

    /** Keep the header button's icon and tooltip pointing at what it will do next. */
    private updateCycleAllButton() {
        const btn = this.uiContainer?.querySelector('.dh-density-cycle-all-btn') as HTMLElement | null;
        if (!btn) return;
        const groupIds = this.groupIds();
        const allSame =
            groupIds.length > 0 && groupIds.every((id) => this.densityFor(id) === this.densityFor(groupIds[0]));
        const level = allSame ? this.densityFor(groupIds[0]) : 'full';
        setIcon(btn, DENSITY_META[level].icon);
        // On a mixed board the next press pulls the stragglers into line rather
        // than moving everything on a step, so the tooltip does not promise a
        // level it will not reach.
        btn.title = allSame
            ? densityTitle(level, `All cards: ${DENSITY_META[level].state.toLowerCase()}`)
            : 'Cycle every card';
    }

    private handleDismissTierScaler = (_e: MouseEvent) => {
        if (this.activeScalingGroups.size === 0) return;
        // Clicks on the row or its toggle are handled by their own listeners,
        // which stop propagation; anything reaching here is outside.
        this.closeAllTierScalers();
    };

    private handleTierScalerKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.activeScalingGroups.size > 0) {
            this.closeAllTierScalers();
        }
    };

    /**
     * Publishes the width of a card's floating control cluster so the title can
     * keep clear of it.
     *
     * The controls are absolutely positioned over the card, and the cluster is
     * not a fixed size: it gains a tier-scaling row when that is opened, and the
     * scale controls are absent on environments. A hardcoded reserve therefore
     * either wastes space or lets the title run underneath the buttons.
     */
    private syncCardControlsWidth(cardEl: HTMLElement) {
        const controls = cardEl.querySelector('.dh-card-header-controls') as HTMLElement | null;
        if (!controls) return;
        // Measured after layout, or the buttons report a zero width on first paint.
        requestAnimationFrame(() => {
            // The tier row is positioned out of flow beneath the cluster, so it
            // does not affect how much clearance the title needs.
            const width = Math.ceil(controls.getBoundingClientRect().width);
            if (width > 0) {
                cardEl.style.setProperty('--dh-card-controls-w', `${width + 12}px`);
            }
        });
    }

    private drawItemGroup(groupId: string, encounterArea: HTMLElement): HTMLElement {
        const itemGroupContainer = encounterArea.createDiv({
            cls: 'dh-adversary-group-container',
            attr: { 'data-group-id': groupId },
        });
        this.populateItemGroupContainer(groupId, itemGroupContainer);
        return itemGroupContainer;
    }

    drawUI() {
        if (!this.uiContainer) return;
        this.uiContainer.empty();
        const containerWrapper = this.uiContainer.createDiv({ cls: 'dh-encounter-wrapper' });
        const currentEncounter = this.currentEncounterId
            ? this.plugin.getSavedEncounter(this.currentEncounterId)
            : null;

        const header = containerWrapper.createDiv({ cls: 'dh-encounter-header' });
        const titleAndTrackersWrapper = header.createDiv({ cls: 'dh-title-fear-wrapper' });
        const titleText = currentEncounter ? `${currentEncounter.name}` : 'No Encounter active';
        const titleEl = titleAndTrackersWrapper.createEl('h3', {
            text: titleText,
            cls: 'dh-active-encounter-title-clickable',
        });
        titleEl.addEventListener('click', (e) => this.showEncounterSwitcherMenu(e));
        const rightSideTrackers = titleAndTrackersWrapper.createDiv({ cls: 'dh-right-side-trackers' });
        if (this.plugin.settings.enableEncounterBudget) this.drawEncounterBudget(rightSideTrackers);
        if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
        const controls = header.createDiv({ cls: 'dh-encounter-controls' });
        // Bulk density, beside the other view toggles. Setting a whole board at
        // once is the common move when a fight starts or ends; doing it card by
        // card across a dozen groups is not.
        const cycleAllButton = controls.createEl('button', {
            cls: 'dh-icon-button dh-density-cycle-all-btn',
            attr: { type: 'button', title: 'Cycle every card' },
        });
        setIcon(cycleAllButton, 'chevrons-down-up');
        cycleAllButton.addEventListener('click', () => this.cycleAllDensity());
        if (this.plugin.settings.enableCountdownTracker) {
            const countdownsButton = controls.createEl('button', {
                title: 'Countdowns',
                cls: 'dh-countdowns-toggle-btn dh-icon-button',
            });
            setIcon(countdownsButton, 'timer');
            countdownsButton.addEventListener('click', () => this.toggleCountdownsPopup());
            if (this.isCountdownsPopupVisible) countdownsButton.addClass('is-active');
        }
        const toggleCompendiumButton = controls.createEl('button', {
            title: this.isCompendiumVisible ? 'Hide Compendium' : 'Show Compendium',
        });
        setIcon(toggleCompendiumButton, this.isCompendiumVisible ? 'panel-right-close' : 'panel-left-open');
        toggleCompendiumButton.addClass('dh-icon-button');
        toggleCompendiumButton.addEventListener('click', () => this.toggleCompendiumVisibility());

        const mainInterface = containerWrapper.createDiv({ cls: 'dh-encounter-main-interface' });
        const activeAdversariesPanel = mainInterface.createDiv({ cls: 'dh-active-adversaries-panel' });
        const encounterArea = activeAdversariesPanel.createDiv({ cls: 'dh-encounter-area' });
        encounterArea.addEventListener('dragstart', this.boundHandleDragStart);
        encounterArea.addEventListener('dragover', this.boundHandleDragOver);
        encounterArea.addEventListener('drop', this.boundHandleDrop);
        encounterArea.addEventListener('dragend', this.boundHandleDragEnd);
        encounterArea.addEventListener('wheel', this.boundHandleEncounterWheel, { passive: false });
        const groupedByGroupId: { [groupId: string]: AdversaryInstance[] } = {};
        this.activeEncounterItems.forEach((instance) => {
            if (!groupedByGroupId[instance.groupId]) groupedByGroupId[instance.groupId] = [];
            groupedByGroupId[instance.groupId].push(instance);
        });
        const savedOrder = currentEncounter?.adversaryGroupOrder || [];
        const actualGroupIds = Object.keys(groupedByGroupId);
        const orderedGroupIds = savedOrder.filter((id) => actualGroupIds.includes(id));
        actualGroupIds.forEach((id) => {
            if (!orderedGroupIds.includes(id)) orderedGroupIds.push(id);
        });
        if (
            currentEncounter &&
            JSON.stringify(orderedGroupIds) !== JSON.stringify(currentEncounter.adversaryGroupOrder)
        ) {
            currentEncounter.adversaryGroupOrder = orderedGroupIds;
        }
        if (orderedGroupIds.length === 0) {
            const emptyText = currentEncounter
                ? `Encounter "${currentEncounter.name}" is empty. Add adversaries or environments.`
                : 'No active encounter or encounter is empty.';
            encounterArea.createEl('p', { text: emptyText });
        } else {
            for (const groupId of orderedGroupIds) {
                this.drawItemGroup(groupId, encounterArea);
            }
        }
        this.updateCycleAllButton();

        const compendiumPanel = mainInterface.createDiv({ cls: 'dh-compendium-panel' });
        if (!this.isCompendiumVisible) compendiumPanel.addClass('dh-compendium-panel-hidden');
        const compendiumHeader = compendiumPanel.createDiv({ cls: 'dh-panel-header' });
        compendiumHeader.createEl('h3', { text: 'Compendium' });
        const compendiumControls = compendiumHeader.createDiv({ cls: 'dh-panel-controls' });
        const manageBtn = compendiumControls.createEl('button', {
            title: 'Manage Compendium',
            cls: 'dh-icon-button',
        });
        setIcon(manageBtn, 'library');
        manageBtn.addEventListener('click', () => new ManageCompendiumModal(this.app, this.plugin).open());
        const refreshBtn = compendiumControls.createEl('button', {
            title: 'Refresh Compendium',
            cls: 'dh-icon-button',
        });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', async () => {
            await this.loadCompendium();
            this.drawUI();
            new Notice('Compendium refreshed!');
        });
        const searchInput = compendiumPanel.createEl('input', {
            type: 'text',
            placeholder: 'Search compendium...',
            cls: 'dh-compendium-search',
            value: this.compendiumSearchTerm,
        });
        searchInput.addEventListener('input', (e) => {
            this.compendiumSearchTerm = (e.target as HTMLInputElement).value;
            this.leaf.setEphemeralState(this.getState());
            this.renderCompendiumList(compendiumPanel.querySelector('.dh-compendium-list') as HTMLElement);
        });
        const filterControls = compendiumPanel.createDiv({ cls: 'dh-filter-controls' });

        const categorySection = filterControls.createDiv({ cls: 'dh-filter-section' });
        categorySection.createSpan({ text: 'Category:', cls: 'dh-filter-label' });
        const categorySelect = categorySection.createEl('select', { cls: 'dh-type-select' });
        const categories: Record<string, string> = {
            all: 'All Items',
            adversary: 'Adversaries',
            environment: 'Environments',
        };
        for (const [key, value] of Object.entries(categories)) {
            const option = categorySelect.createEl('option', { text: value, value: key });
            if (key === this.compendiumItemCategory) option.selected = true;
        }
        categorySelect.addEventListener('change', (e) => {
            this.compendiumItemCategory = (e.target as HTMLSelectElement).value as 'all' | 'adversary' | 'environment';
            this.leaf.setEphemeralState(this.getState());
            this.renderCompendiumList(compendiumPanel.querySelector('.dh-compendium-list') as HTMLElement);
        });

        const tierSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        tierSection.createSpan({ text: 'Tier:', cls: 'dh-filter-label' });
        for (let tier = 1; tier <= 4; tier++) {
            const tierBtn = tierSection.createEl('button', {
                text: tier.toString(),
                cls: `dh-tier-button${this.selectedTiers.has(tier) ? ' active' : ''}`,
            });
            tierBtn.addEventListener('click', () => this.toggleTier(tier));
        }

        const typeSection = filterControls.createDiv({ cls: 'dh-filter-section' });
        typeSection.createSpan({ text: 'Type:', cls: 'dh-filter-label' });
        const typeSelect = typeSection.createEl('select', {
            cls: 'dh-type-select',
        }) as HTMLSelectElement;
        typeSelect.createEl('option', { text: 'All Types', value: '' });
        const uniqueTypes = new Set(this.compendiumItems.map((c) => c.type).filter((type): type is string => !!type));
        Array.from(uniqueTypes)
            .sort()
            .forEach((type) => {
                const option = typeSelect.createEl('option', { text: type, value: type });
                if (this.selectedTypes.has(type)) option.selected = true;
            });
        typeSelect.addEventListener('change', (e) => this.updateTypeFilter((e.target as HTMLSelectElement).value));

        // Only sources that are enabled contribute entries, so listing the
        // others here would offer filters that can only ever return nothing.
        const activeSources = this.plugin.getContentSources().filter((source) => source.enabled);
        if (activeSources.length > 1) {
            const sourceSection = filterControls.createDiv({ cls: 'dh-filter-section' });
            sourceSection.createSpan({ text: 'Source:', cls: 'dh-filter-label' });
            const sourceSelect = sourceSection.createEl('select', { cls: 'dh-type-select' });
            const allOption = sourceSelect.createEl('option', { text: 'All Sources', value: 'all' });
            if (this.selectedSourceId === 'all') allOption.selected = true;
            for (const source of activeSources) {
                const option = sourceSelect.createEl('option', { text: source.label, value: source.id });
                if (source.id === this.selectedSourceId) option.selected = true;
            }
            sourceSelect.addEventListener('change', (e) => {
                this.selectedSourceId = (e.target as HTMLSelectElement).value;
                this.leaf.setEphemeralState(this.getState());
                this.renderCompendiumList(compendiumPanel.querySelector('.dh-compendium-list') as HTMLElement);
            });
        }

        const compendiumList = compendiumPanel.createDiv({ cls: 'dh-compendium-list' });
        this.renderCompendiumList(compendiumList);
        this.updateCountdownsPopup();
        this.leaf.onResize();
    }

    drawEncounterBudget(parent: HTMLElement) {
        const { spent, total } = this.calculateEncounterBudget();
        const budgetTrackerEl = parent.createDiv({
            cls: 'dh-budget-tracker',
            title: 'Click to configure encounter budget',
        });
        budgetTrackerEl.addEventListener('click', () => {
            new EncounterBudgetModal(this.app, this.plugin, () => {
                this.drawUI();
            }).open();
        });
        const readout = budgetTrackerEl.createDiv({ cls: 'dh-budget-readout' });
        readout.createSpan({ text: 'Budget:', cls: 'dh-budget-label' });
        const valueEl = readout.createSpan({ cls: 'dh-budget-value' });
        valueEl.setText(`${spent} / ${total}`);
        const over = spent > total;
        if (over) valueEl.addClass('dh-budget-over');
        budgetTrackerEl.toggleClass('is-over', over);

        // A bar makes "how full is this encounter" readable without parsing digits.
        const bar = budgetTrackerEl.createDiv({ cls: 'dh-budget-bar' });
        const fill = bar.createDiv({ cls: 'dh-budget-bar-fill' });
        const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0;
        fill.style.setProperty('--dh-budget-pct', `${pct}%`);
    }

    /** Fear caps at 12, so it reads best as pips rather than a bare number. */
    private static readonly MAX_FEAR = 12;

    /** Per-encounter Fear, falling back to the legacy global value. */
    private getFearCounter(): number {
        const encounter = this.currentEncounterId ? this.plugin.getSavedEncounter(this.currentEncounterId) : null;
        return encounter?.fearCounter ?? this.plugin.settings.fearCounter ?? 0;
    }

    private async setFearCounter(value: number) {
        const encounter = this.currentEncounterId ? this.plugin.getSavedEncounter(this.currentEncounterId) : null;
        if (encounter) {
            this.plugin.updateSavedEncounter({ ...encounter, fearCounter: value });
        }
        // Kept in sync so the value survives if no encounter is active.
        this.plugin.settings.fearCounter = value;
        await this.plugin.saveSettings();
    }

    /**
     * Fear lives in the header, which can get very narrow when the encounter
     * view is docked in a side panel. A compact numeric readout survives that;
     * twelve pips do not.
     */
    drawFearTracker(parent: HTMLElement) {
        const wrapper = parent.createDiv({ cls: 'dh-fear-tracker' });
        wrapper.createSpan({ text: 'Fear', cls: 'dh-fear-label' });

        const decrementBtn = wrapper.createEl('button', {
            cls: 'dh-fear-btn',
            text: '−',
            attr: { type: 'button', 'aria-label': 'Spend Fear' },
        });
        wrapper.createSpan({
            text: String(this.getFearCounter()),
            cls: 'dh-fear-value',
        });
        const incrementBtn = wrapper.createEl('button', {
            cls: 'dh-fear-btn',
            text: '+',
            attr: { type: 'button', 'aria-label': 'Gain Fear' },
        });

        decrementBtn.addEventListener('click', () => void this.applyFearDelta(-1));
        incrementBtn.addEventListener('click', () => void this.applyFearDelta(1));
    }

    /**
     * Applies a change to the encounter's Fear and repaints every tracker
     * showing it.
     *
     * The readout is looked up by class rather than captured when the tracker is
     * drawn: the header is rebuilt in several places, and Fear can now also be
     * spent from a feature's cost text on a card, far from the element that
     * displays it.
     *
     * Returns the amount actually applied, which is less than requested when the
     * spend would take Fear below zero.
     */
    private async applyFearDelta(delta: number): Promise<number> {
        const current = this.getFearCounter();
        const clamped = Math.max(0, Math.min(current + delta, EncounterBuilderView.MAX_FEAR));
        if (clamped === current) return 0;

        this.uiContainer?.querySelectorAll('.dh-fear-value').forEach((el) => el.setText(String(clamped)));
        await this.setFearCounter(clamped);
        return clamped - current;
    }

    /**
     * Spends Fear from a feature's "Spend a Fear" cost text.
     *
     * Refuses rather than clamping silently when there is not enough Fear: the
     * GM needs to know the feature cannot be used, and a spend that quietly
     * became smaller than the feature costs would misreport the table state.
     */
    private async handleSpendFearEvent(e: Event) {
        const { amount, context } = (e as CustomEvent).detail ?? {};
        const cost = Number(amount);
        if (!Number.isFinite(cost) || cost <= 0) return;

        if (!this.plugin.settings.enableFearTracker) {
            new Notice('Enable the Fear tracker in settings to spend Fear.');
            return;
        }

        const available = this.getFearCounter();
        if (available < cost) {
            new Notice(`Not enough Fear: ${cost} needed, ${available} available.`);
            return;
        }

        await this.applyFearDelta(-cost);
        const label = context ? ` on ${context}` : '';
        new Notice(`Spent ${cost} Fear${label}. ${available - cost} remaining.`);
    }

    /**
     * Bring a feature's summoned creatures into the encounter.
     *
     * Resolving the count is the only part that can block: a rolled quantity
     * ("summon 1d4 Vampires") goes through the dice roller so the result is
     * shared and visible, and falls back to prompting only when no roller is
     * configured. Everything else adds straight away — the point of the button
     * is that summoning mid-combat costs one click.
     */
    private async handleSummonEvent(e: Event) {
        const { target, context } = (e as CustomEvent).detail ?? {};
        if (!target?.name) return;

        const summon: SummonTarget = target;
        const adversaries = this.plugin.compendium.getStatblocks().filter((entry) => entry.category !== 'environment');

        if (summon.match) {
            await this.performSummon(summon, summon.match, context);
            return;
        }

        // Nothing resolved, so the GM chooses. The parsed phrase seeds the
        // search rather than filtering it, keeping every entry reachable.
        new SummonPickerModal(this.app, adversaries, summon.name, async (chosen) => {
            await this.performSummon(summon, chosen, context);
        }).open();
    }

    /**
     * Add `count` of `chosen` to the encounter, then report it.
     *
     * Summoning the same creature twice adds instances to the group that is
     * already on the table rather than dealing a second identical card: a
     * second Minor Demon is another body in the fight, not another statblock to
     * read. The group's existing instances keep their HP, Stress and
     * conditions; only the new arrivals are added, and they get numbered
     * alongside the ones already there.
     */
    private async performSummon(summon: SummonTarget, chosen: StatblockData, context?: string) {
        const count = await this.resolveSummonCount(summon, context);
        if (count === null) return;

        const existingGroupId = this.findGroupForStatblock(chosen);
        if (existingGroupId) {
            for (let i = 0; i < count; i++) {
                this.createNewInstanceFromTemplate(chosen, existingGroupId);
            }
            await this.autoSaveCurrentEncounter();
            this.redrawItemGroup(existingGroupId);
            this.refreshEncounterTrackers();
        } else {
            // One group, however many creatures: they arrive together and the
            // GM manages them as a unit, which is what a group already is here.
            this.addItemToActiveEncounter(chosen, count);
        }

        const label = count > 1 ? `${count}× ${chosen.name}` : chosen.name;
        const destination = existingGroupId ? ' to the existing group' : '';
        new Notice(`Summoned ${label}${destination}${context ? ` (${context})` : ''}.`);
    }

    /**
     * The group already holding this statblock, if the encounter has one.
     *
     * Matched on name rather than identity because the summoned template comes
     * from the compendium while the instances on the table are copies of it.
     * A group that has been tier-scaled is deliberately skipped: its creatures
     * no longer have the stats of the thing being summoned, so merging into it
     * would silently give the new arrivals the wrong numbers.
     */
    private findGroupForStatblock(statblock: StatblockData): string | null {
        const name = statblock.name.toLowerCase();
        const match = this.activeEncounterItems.find((instance) => {
            if (instance.name.toLowerCase() !== name) return false;
            const baseTier =
                Number((instance._originalStats as AdversaryInstance | undefined)?.tier ?? instance.tier) || 0;
            return (Number(instance.tier) || 0) === baseTier;
        });
        return match?.groupId ?? null;
    }

    /**
     * How many to add: a fixed number, or a roll when the feature calls for one.
     * Returns null when the GM cancels or the roll cannot be made.
     */
    private async resolveSummonCount(summon: SummonTarget, context?: string): Promise<number | null> {
        if (!summon.countDice) return Math.max(1, summon.count ?? 1);

        const rolled = await this.plugin.rollDice(
            summon.countDice,
            `${context ? `${context}: ` : ''}summon ${summon.name}`,
        );
        if (typeof rolled === 'number' && Number.isFinite(rolled) && rolled > 0) {
            return Math.floor(rolled);
        }

        // No dice roller configured, so the count comes from the GM's own dice.
        // Resolves only on submit; cancelling leaves the encounter untouched.
        return new Promise<number | null>((resolve) => {
            const modal = new SummonCountModal(this.app, summon.name, summon.countDice!, (count) => resolve(count));
            const originalClose = modal.onClose.bind(modal);
            modal.onClose = () => {
                originalClose();
                resolve(null);
            };
            modal.open();
        });
    }

    /** Repaint the budget and Fear trackers after the encounter's roster changes. */
    private refreshEncounterTrackers() {
        const rightSideTrackers = this.uiContainer?.querySelector('.dh-right-side-trackers') as HTMLElement;
        if (!rightSideTrackers || !this.plugin.settings.enableEncounterBudget) return;
        rightSideTrackers.empty();
        this.drawEncounterBudget(rightSideTrackers);
        if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
    }

    populateCountdownsPopup(popupEl: HTMLElement) {
        popupEl.empty();
        const header = popupEl.createDiv({ cls: 'dh-popup-header' });
        header.createEl('h4', { text: 'Countdowns' });
        this.drawCountdownComposer(popupEl);
        const body = popupEl.createDiv({ cls: 'dh-countdowns-body' });
        this.fillCountdownsBody(body);
        // On the body rather than its contents, so refilling the list does not
        // need to re-register it.
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

    /** The list itself, rebuilt on its own so the popup around it can persist. */
    private fillCountdownsBody(body: HTMLElement) {
        body.empty();
        if (this.plugin.settings.countdowns.length === 0) {
            body.createEl('p', { text: 'No countdowns. Add one!', cls: 'dh-no-items-message' });
            return;
        }
        this.plugin.settings.countdowns.forEach((countdown) => this.drawCountdownItem(countdown, body));
    }

    /**
     * The add row. A countdown the GM writes by hand gets the same capabilities
     * as one created from a statblock — a start value, and whether it loops —
     * rather than appearing at zero with no way to say either.
     */
    private drawCountdownComposer(parentEl: HTMLElement) {
        const composer = parentEl.createDiv({ cls: 'dh-countdown-composer' });

        const nameInput = composer.createEl('input', {
            type: 'text',
            cls: 'dh-countdown-composer-name',
            attr: { placeholder: 'New countdown', 'aria-label': 'Countdown name' },
        });
        const startInput = composer.createEl('input', {
            type: 'text',
            cls: 'dh-countdown-composer-start',
            attr: { placeholder: '6', 'aria-label': 'Starting value — a number or dice such as 1d6' },
        });

        let loops = false;
        const loopBtn = composer.createEl('button', {
            cls: 'dh-countdown-composer-loop',
            attr: {
                type: 'button',
                'aria-pressed': 'false',
                title: 'Reset and run again after it triggers',
            },
        });
        setIcon(loopBtn.createSpan({ cls: 'dh-countdown-loop-icon' }), 'rotate-cw');
        loopBtn.createSpan({ text: 'Loops' });
        loopBtn.addEventListener('click', () => {
            loops = !loops;
            loopBtn.toggleClass('is-active', loops);
            loopBtn.setAttribute('aria-pressed', String(loops));
        });

        const submit = async () => {
            const start = startInput.value.trim();
            const startValue = fixedStartValue(start);

            if (start && startValue === null && !isDiceStart(start)) {
                new Notice(`"${start}" is not a number or a dice roll.`);
                return;
            }

            let value = startValue ?? 0;
            // A dice start is rolled now rather than left at zero, or the
            // countdown would be born looking like it had already run out.
            if (start && startValue === null) {
                if (!this.plugin.isDiceRollerEnabled) {
                    new Notice('Dice roller not configured. Use a fixed starting number.');
                    return;
                }
                const rolled = await this.plugin.rollDice(start, `${nameInput.value.trim() || 'Countdown'} Countdown`);
                if (rolled === null || rolled === undefined) return;
                value = rolled;
            }

            await this.handleAddCountdown(false, nameInput.value.trim() || undefined, value, {
                start: start || undefined,
                loops: loops && !!start,
            });

            nameInput.value = '';
            startInput.value = '';
            loops = false;
            loopBtn.removeClass('is-active');
            loopBtn.setAttribute('aria-pressed', 'false');
            nameInput.focus();
        };

        const addBtn = composer.createEl('button', {
            text: 'Add',
            cls: 'dh-countdown-composer-add',
            attr: { type: 'button' },
        });
        addBtn.addEventListener('click', submit);
        for (const input of [nameInput, startInput]) {
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            });
        }
    }

    getDragAfterElement(container: HTMLElement, y: number): Element | null {
        const draggableElements = Array.from(container.querySelectorAll('.dh-countdown-item:not(.dh-dragging)'));
        return draggableElements.reduce<{ offset: number; element: Element | null }>(
            (closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            },
            { offset: Number.NEGATIVE_INFINITY, element: null },
        ).element;
    }

    drawCountdownItem(countdown: Countdown, container: HTMLElement) {
        // The loop editor expands underneath the row, so the draggable unit is a
        // wrapper around both rather than the row itself.
        const wrapperEl = container.createDiv({
            cls: 'dh-countdown-item',
            attr: { 'data-countdown-id': countdown.id, draggable: 'true' },
        });
        wrapperEl.addEventListener('dragstart', () => {
            wrapperEl.classList.add('dh-dragging');
            this.draggedCountdownId = countdown.id;
        });
        wrapperEl.addEventListener('dragend', async () => {
            wrapperEl.classList.remove('dh-dragging');
            if (!this.draggedCountdownId) return;
            const newOrderIds = Array.from(container.querySelectorAll('.dh-countdown-item')).map((el) =>
                el.getAttribute('data-countdown-id'),
            );
            this.plugin.settings.countdowns.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
            this.draggedCountdownId = null;
            await this.plugin.saveSettings();
            this.refreshCountdownsList();
        });

        const itemEl = wrapperEl.createDiv({ cls: 'dh-countdown-row' });
        const state = countdownState(countdown);
        // On the wrapper, so the spent highlight covers the loop editor too.
        wrapperEl.toggleClass('is-spent-loop', state === 'spent-loop');
        wrapperEl.toggleClass('is-finished', state === 'finished');

        // Value first. The −/+ and the number are what the GM clicks during
        // play; the name is reference. Leading with them keeps the controls at
        // the same left position on every row instead of shifting with the
        // length of the name beside them.
        const controls = itemEl.createDiv({ cls: 'dh-countdown-controls' });
        const decrementBtn = controls.createEl('button', { text: '−', cls: 'dh-countdown-btn' });
        decrementBtn.addEventListener('click', () => this.handleCountdownValueChange(countdown.id, -1));
        controls.createSpan({ text: countdown.value.toString(), cls: 'dh-countdown-value' });
        const incrementBtn = controls.createEl('button', { text: '+', cls: 'dh-countdown-btn' });
        incrementBtn.addEventListener('click', () => this.handleCountdownValueChange(countdown.id, 1));

        const nameWrap = itemEl.createDiv({ cls: 'dh-countdown-name-wrap' });
        const nameInput = nameWrap.createEl('input', {
            type: 'text',
            value: countdown.name,
            cls: 'dh-countdown-name-input',
        });
        nameInput.addEventListener('change', () => this.handleRenameCountdown(countdown.id, nameInput.value));

        // The loop badge and the reset control are one element: what it resets
        // to and the act of resetting are the same idea, and splitting them put
        // the value on screen twice.
        //
        // It only becomes clickable once the loop is spent, so during play it is
        // a quiet annotation and lights up exactly when it has something to do.
        // Clicking resets — it never removes the loop, which is what made an
        // earlier clickable badge dangerous. That lives in the overflow menu.
        if (countdown.loops && countdown.start) {
            const isSpent = state === 'spent-loop';
            const loopBadge = nameWrap.createEl(isSpent ? 'button' : 'span', {
                cls: 'dh-countdown-loop-badge',
                attr: isSpent
                    ? {
                          type: 'button',
                          'aria-label': resetLabel(countdown),
                          title: `${resetLabel(countdown)} — send "${countdown.name}" round again`,
                      }
                    : { title: `Loops — resets to ${countdown.start} after it triggers` },
            });
            loopBadge.toggleClass('is-spent', isSpent);
            setIcon(
                loopBadge.createSpan({ cls: 'dh-countdown-loop-icon' }),
                isSpent && isDiceStart(countdown.start) ? 'dices' : 'rotate-cw',
            );
            loopBadge.createSpan({ text: countdown.start });
            if (isSpent) loopBadge.addEventListener('click', () => this.handleResetCountdown(countdown.id));
        }

        // One overflow menu instead of a bare trash button. Deleting a countdown
        // stops being a single click next to the reset control, and toggling the
        // loop gets a visible affordance rather than being right-click only.
        const showMenu = (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();
            menu.addItem((item) =>
                item
                    .setTitle(countdown.loops ? 'Loop settings…' : 'Make this loop…')
                    .setIcon('rotate-cw')
                    .onClick(() => {
                        this.editingLoopIds.add(countdown.id);
                        this.refreshCountdownsList();
                    }),
            );
            menu.addSeparator();
            menu.addItem((item) =>
                item
                    .setTitle('Remove countdown')
                    .setIcon('trash')
                    .onClick(() => this.handleRemoveCountdown(countdown.id)),
            );
            menu.showAtMouseEvent(e);
        };

        const menuBtn = itemEl.createEl('button', {
            cls: 'dh-icon-button dh-countdown-menu-btn',
            attr: { type: 'button', 'aria-label': `Options for "${countdown.name}"`, title: 'Options' },
        });
        setIcon(menuBtn, 'more-horizontal');
        menuBtn.addEventListener('click', showMenu);
        // Right-click anywhere on the row reaches the same menu.
        itemEl.addEventListener('contextmenu', showMenu);

        if (this.editingLoopIds.has(countdown.id)) {
            this.drawCountdownLoopEditor(countdown, wrapperEl);
        }
    }

    /**
     * Loop settings, expanded under the row.
     *
     * The start value is editable here rather than inferred, which is the point:
     * a countdown that was made to loop at the wrong number used to be stuck
     * that way short of deleting and rebuilding it.
     */
    private drawCountdownLoopEditor(countdown: Countdown, parentEl: HTMLElement) {
        const editor = parentEl.createDiv({ cls: 'dh-countdown-loop-editor' });

        editor.createSpan({ cls: 'dh-countdown-loop-editor-label', text: 'Loops at' });

        const startInput = editor.createEl('input', {
            type: 'text',
            cls: 'dh-countdown-loop-editor-start',
            // Falls back to the current value as a suggestion, but visibly and
            // editably rather than being applied behind the GM's back.
            value: countdown.start ?? (countdown.value > 0 ? String(countdown.value) : ''),
            attr: { placeholder: '6', 'aria-label': 'Loop start — a number or dice such as 1d6' },
        });

        const close = () => {
            this.editingLoopIds.delete(countdown.id);
            this.refreshCountdownsList();
        };

        const save = async () => {
            const start = startInput.value.trim();
            if (!isValidStart(start)) {
                new Notice(`"${start}" is not a number or a dice roll.`);
                return;
            }
            const target = this.plugin.settings.countdowns.find((c) => c.id === countdown.id);
            if (!target) return close();
            target.start = start;
            target.loops = true;
            await this.plugin.saveSettings();
            close();
        };

        const actions = editor.createDiv({ cls: 'dh-countdown-loop-editor-actions' });

        if (countdown.loops) {
            const stopBtn = actions.createEl('button', {
                cls: 'dh-countdown-loop-editor-stop',
                text: 'Stop looping',
                attr: { type: 'button' },
            });
            stopBtn.addEventListener('click', async () => {
                const target = this.plugin.settings.countdowns.find((c) => c.id === countdown.id);
                if (target) {
                    target.loops = false;
                    await this.plugin.saveSettings();
                }
                close();
            });
        }

        const cancelBtn = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
        cancelBtn.addEventListener('click', close);

        const saveBtn = actions.createEl('button', {
            cls: 'dh-countdown-loop-editor-save',
            text: countdown.loops ? 'Save' : 'Start looping',
            attr: { type: 'button' },
        });
        saveBtn.addEventListener('click', save);

        startInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });
        startInput.focus();
        startInput.select();
    }

    async handleAddCountdown(
        isDefault: boolean = false,
        name?: string,
        value?: number,
        options: { start?: string; loops?: boolean } = {},
    ) {
        const newCountdown: Countdown = {
            id: `dh-countdown-${Date.now()}`,
            name: name || (isDefault ? 'Default Countdown' : `Countdown ${this.plugin.settings.countdowns.length + 1}`),
            value: value ?? 0,
            ...(options.start ? { start: options.start } : {}),
            ...(options.loops ? { loops: true } : {}),
        };
        this.plugin.settings.countdowns.push(newCountdown);
        await this.plugin.saveSettings();

        if (!isDefault) {
            if (!this.isCountdownsPopupVisible) {
                this.toggleCountdownsPopup();
            } else {
                this.refreshCountdownsList();
            }
        }
    }

    async handleRemoveCountdown(id: string) {
        this.plugin.settings.countdowns = this.plugin.settings.countdowns.filter((c) => c.id !== id);
        await this.plugin.saveSettings();
        this.refreshCountdownsList();
    }

    async handleRenameCountdown(id: string, newName: string) {
        const countdown = this.plugin.settings.countdowns.find((c) => c.id === id);
        if (countdown && countdown.name !== newName) {
            countdown.name = newName;
            await this.plugin.saveSettings();
        }
    }

    async handleCountdownValueChange(id: string, delta: number) {
        const countdown = this.plugin.settings.countdowns.find((c) => c.id === id);
        if (!countdown) return;

        const stateBefore = countdownState(countdown);
        countdown.value += delta;
        await this.plugin.saveSettings();

        // Crossing zero changes how the row presents itself, so it has to be
        // rebuilt rather than have its number patched. Ticking a spent loop back
        // up by hand settles the debt here, without needing the reset button.
        if (countdownState(countdown) !== stateBefore) {
            this.refreshCountdownsList();
            return;
        }

        if (this.countdownsPopup) {
            const itemEl = this.countdownsPopup.querySelector(`[data-countdown-id="${id}"]`);
            if (itemEl) {
                const valueEl = itemEl.querySelector('.dh-countdown-value');
                if (valueEl) valueEl.textContent = countdown.value.toString();
            }
        }
    }

    /**
     * Send a spent loop round again: reroll a randomized start, or restore a
     * fixed one. Rolling goes through the plugin's roller so the result is
     * visible and shared, which is the whole point of a randomized countdown.
     */
    async handleResetCountdown(id: string) {
        const countdown = this.plugin.settings.countdowns.find((c) => c.id === id);
        if (!countdown?.start) return;

        let newValue: number | null = fixedStartValue(countdown.start);

        if (newValue === null) {
            if (!this.plugin.isDiceRollerEnabled) {
                new Notice(`Dice roller not configured. Set "${countdown.name}" by hand.`);
                return;
            }
            newValue = await this.plugin.rollDice(countdown.start, `${countdown.name} Countdown`);
            if (newValue === null || newValue === undefined) return;
        }

        countdown.value = newValue;
        await this.plugin.saveSettings();
        this.refreshCountdownsList();
        new Notice(`"${countdown.name}" reset to ${newValue}.`);
    }

    renderCompendiumList(listContainer: HTMLElement) {
        listContainer.empty();
        const filteredItems = this.applyFilters(this.compendiumItems);
        if (filteredItems.length === 0) {
            listContainer.createEl('p', {
                text: 'No matching items found. Try adjusting filters or check plugin settings.',
                cls: 'dh-no-items-message',
            });
        } else {
            filteredItems.forEach((itemData) => {
                const itemEntry = listContainer.createDiv({ cls: 'dh-compendium-entry' });

                // Add click event listener for the popover
                itemEntry.addEventListener('click', (e) => {
                    // Don't show the preview if the add button was clicked.
                    // closest(), not the target's own class: entries now contain
                    // nested elements, so the click can land on a child.
                    if ((e.target as HTMLElement).closest?.('.dh-add-compendium-btn')) {
                        return;
                    }

                    // If this item already has an active popover, hide it
                    if (this.activePopover && (itemEntry as any).hasActivePopover) {
                        this.hideStatblockPreview();
                        return;
                    }

                    // If there's another popover open, hide it first
                    if (this.activePopover) {
                        this.hideStatblockPreview();
                    }

                    // Show the popover for this item
                    this.showStatblockPreview(itemData, itemEntry);

                    // Mark this item as having an active popover
                    (itemEntry as any).hasActivePopover = true;
                });

                // Category icon in a fixed leading column. Both categories get
                // one: with only environments marked the glyph had nothing to
                // align against and read as a stray mark rather than a label.
                const isEnvironment = itemData.category === 'environment';
                itemEntry.toggleClass('dh-entry-environment', isEnvironment);
                const icon = itemEntry.createSpan({
                    cls: 'dh-entry-icon',
                    attr: { 'aria-label': isEnvironment ? 'Environment' : 'Adversary' },
                });
                setIcon(icon, isEnvironment ? 'mountain-snow' : 'skull');

                const textWrap = itemEntry.createDiv({ cls: 'dh-entry-text' });
                const nameSpan = textWrap.createSpan({ text: itemData.name, cls: 'dh-entry-name' });
                // sourceFile is only ever set for Markdown entries, so the
                // source label is what actually names where this came from.
                const entrySource = this.plugin.getSource(itemData.sourceId);
                const origin = itemData.sourceFile ?? entrySource?.label;
                if (itemData.isCustom) {
                    nameSpan.addClass('dh-custom-adversary');
                    if (origin) nameSpan.title = `From ${origin}`;
                }
                if (entrySource?.doNotDistribute) {
                    const lock = nameSpan.createSpan({ cls: 'dh-source-badge-icon' });
                    setIcon(lock, 'lock');
                    nameSpan.title = `${origin ? `From ${origin}. ` : ''}Personal licensed content — excluded from export.`;
                }

                // Tier and type are already on every entry but were only visible
                // by opening the preview, though "which tier is this" is usually
                // the question being asked while building an encounter.
                const meta = [
                    itemData.tier !== undefined && itemData.tier !== null ? `Tier ${itemData.tier}` : null,
                    itemData.type || null,
                ]
                    .filter(Boolean)
                    .join(' · ');
                if (meta) textWrap.createSpan({ text: meta, cls: 'dh-entry-meta' });

                const addButton = itemEntry.createEl('button', {
                    text: '+',
                    title: 'Add to active encounter',
                    cls: 'dh-add-compendium-btn',
                });
                addButton.addEventListener('click', (_e) => {
                    // Close any open popover when adding to encounter
                    if (this.activePopover) {
                        this.hideStatblockPreview();
                    }
                    this.addItemToActiveEncounter(itemData);
                });
            });
        }
    }

    private applyFilters(items: StatblockData[]): StatblockData[] {
        return items.filter((item) => {
            const matchesCategory =
                this.compendiumItemCategory === 'all' || item.category === this.compendiumItemCategory;
            const matchesSearch =
                this.compendiumSearchTerm === '' ||
                item.name.toLowerCase().includes(this.compendiumSearchTerm.toLowerCase());
            const matchesTier =
                this.selectedTiers.size === 0 ||
                (item.tier !== undefined &&
                    (typeof item.tier === 'number'
                        ? this.selectedTiers.has(item.tier)
                        : this.selectedTiers.has(Number(item.tier))));
            const matchesType =
                this.selectedTypes.size === 0 || (item.type !== undefined && this.selectedTypes.has(item.type));
            const matchesSource = this.selectedSourceId === 'all' || item.sourceId === this.selectedSourceId;
            return matchesCategory && matchesSearch && matchesTier && matchesType && matchesSource;
        });
    }

    private toggleTier(tier: number) {
        if (this.selectedTiers.has(tier)) this.selectedTiers.delete(tier);
        else this.selectedTiers.add(tier);
        this.leaf.setEphemeralState(this.getState());
        const tierButtons = this.uiContainer?.querySelectorAll('.dh-tier-button');
        if (tierButtons)
            tierButtons.forEach((btn: Element) => {
                const buttonTier = parseInt(btn.textContent || '0');
                if (this.selectedTiers.has(buttonTier)) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        this.renderCompendiumList(this.uiContainer?.querySelector('.dh-compendium-list') as HTMLElement);
    }

    private updateTypeFilter(type: string) {
        this.selectedTypes.clear();
        if (type) {
            this.selectedTypes.add(type);
        }
        this.leaf.setEphemeralState(this.getState());
        this.renderCompendiumList(this.uiContainer?.querySelector('.dh-compendium-list') as HTMLElement);
    }

    handleNewEncounter(isDefaultCreation: boolean = false, defaultName?: string) {
        const existingNames = this.plugin.getSavedEncounters().map((e) => e.name);
        let newEncounterNameBase = defaultName || 'New Encounter';
        let newEncounterName = newEncounterNameBase;
        let counter = 1;
        while (existingNames.includes(newEncounterName)) newEncounterName = `${newEncounterNameBase} ${counter++}`;
        if (isDefaultCreation) this.saveNewEncounter(newEncounterName);
        else
            new NameEncounterModal(
                this.app,
                this.plugin,
                'Create New Encounter',
                existingNames,
                newEncounterName,
                (name) => this.saveNewEncounter(name),
            ).open();
    }

    saveNewEncounter(name: string) {
        const newId = `dh-encounter-${Date.now()}`;
        const newEncounter: SavedEncounter = {
            id: newId,
            name: name,
            adversaries: [],
            adversaryGroupOrder: [],
        };
        this.plugin.updateSavedEncounter(newEncounter);
        this.currentEncounterId = newId;
        this.loadItemsForCurrentEncounter();
        new Notice(`Encounter "${name}" created and activated.`);
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    handleRenameEncounter(encounterId: string) {
        const encounterToRename = this.plugin.getSavedEncounter(encounterId);
        if (!encounterToRename) return;
        const existingNames = this.plugin
            .getSavedEncounters()
            .map((e) => e.name)
            .filter((name) => name !== encounterToRename.name);
        new NameEncounterModal(
            this.app,
            this.plugin,
            'Rename Encounter',
            existingNames,
            encounterToRename.name,
            (newName) => {
                const updatedEncounter = { ...encounterToRename, name: newName };
                this.plugin.updateSavedEncounter(updatedEncounter);
                new Notice(`Encounter renamed to "${newName}".`);
                this.drawUI();
                if (encounterId === this.currentEncounterId) this.leaf.setEphemeralState(this.getState());
            },
        ).open();
    }

    loadEncounter(encounterId: string) {
        if (this.currentEncounterId === encounterId) return;
        const encounterToLoad = this.plugin.getSavedEncounter(encounterId);
        if (encounterToLoad) {
            this.currentEncounterId = encounterToLoad.id;
            this.loadItemsForCurrentEncounter();
            new Notice(`Encounter "${encounterToLoad.name}" loaded.`);
            this.drawUI();
            this.leaf.setEphemeralState(this.getState());
        } else {
            new Notice('Failed to load encounter.');
        }
    }

    async handleDeleteEncounter(encounterId: string) {
        const encounterToDelete = this.plugin.getSavedEncounter(encounterId);
        if (!encounterToDelete) return;
        const encounterName = encounterToDelete.name;
        await this.plugin.removeSavedEncounter(encounterId);
        if (this.currentEncounterId === encounterId) {
            this.currentEncounterId = null;
            this.ensureActiveEncounter();
            this.loadItemsForCurrentEncounter();
        }
        new Notice(`Encounter "${encounterName}" deleted.`);
        this.drawUI();
        this.leaf.setEphemeralState(this.getState());
    }

    private getAdversaryCost(type: string | undefined): number {
        if (!type) return 2;
        // Via the family slug, so the Horde variants ("Horde (3/HP)") price as
        // Hordes instead of falling through to the default.
        switch (normalizeRoleFamily(type)) {
            case 'minion':
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
                return 2;
        }
    }

    private calculateEncounterBudget(): { spent: number; total: number } {
        const config = this.plugin.settings.encounterBudgetConfig;
        const adversaries = this.activeEncounterItems.filter((i) => i.category === 'adversary');
        let spent = 0;
        const adversaryTypes = new Set<string>();
        const allGroups = new Set<string>();
        let soloCount = 0;
        const minionGroups: { [groupId: string]: number } = {};
        adversaries.forEach((c) => {
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
        for (const groupId in minionGroups) {
            spent += Math.ceil(minionGroups[groupId] / playerCount);
        }
        let total = 3 * config.playerCount + 2;
        if (config.isEasier) total -= 1;
        if (config.isHarder) total += 2;
        if (config.isDamageBoosted) total -= 2;
        if (config.useLowerTier) total += 1;
        if (soloCount >= 2) total -= 2;
        const hasComplex =
            adversaryTypes.has('bruiser') ||
            adversaryTypes.has('horde') ||
            adversaryTypes.has('leader') ||
            adversaryTypes.has('solo');
        if (!hasComplex && adversaries.length > 0 && allGroups.size <= 1) total += 1;
        return { spent, total };
    }

    /**
     * Finds the card a dragged group should be inserted before, from cached
     * midpoints rather than rects read per event.
     *
     * The encounter area is a single non-wrapping row, so the pointer's X alone
     * decides the slot. Measuring here instead would force a layout per card on
     * every `dragover` — tens of times a second, and the main reason reordering
     * used to feel choppy. The cache is refreshed only when the order actually
     * changes or the row scrolls, the two things that move the cards.
     */
    private getGroupDragAfterId(x: number): string | null {
        for (const card of this.dragCardMidpoints) {
            if (x < card.mid) return card.id;
        }
        return null;
    }

    /**
     * Caches the horizontal midpoint of every card except the one being dragged,
     * in left-to-right order — `getGroupDragAfterId` scans it and takes the first
     * card the pointer sits left of.
     */
    private measureDragTargets(encounterArea: HTMLElement) {
        this.dragCardMidpoints = Array.from(encounterArea.querySelectorAll('.dh-adversary-group-container'))
            .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('dh-drag-source'))
            .map((el) => {
                const box = el.getBoundingClientRect();
                return { id: el.getAttribute('data-group-id') ?? '', mid: box.left + box.width / 2 };
            })
            .filter((card) => card.id !== '');
    }

    private handleDragStart(e: DragEvent) {
        const target = e.target as HTMLElement;
        if (!target.classList.contains('dh-drag-handle')) {
            e.preventDefault();
            return;
        }
        const groupContainer = target.closest('.dh-adversary-group-container');
        if (!(groupContainer instanceof HTMLElement)) return;
        this.draggedGroupId = groupContainer.getAttribute('data-group-id');
        if (!this.draggedGroupId) return;

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Firefox refuses to start a drag without payload; the id is never
            // read back (the reorder is tracked in-process) but must be set.
            e.dataTransfer.setData('text/plain', this.draggedGroupId);
            // The default drag image (the card itself) is kept deliberately: it
            // is the one the browser snapshots on the compositor, and grabbing
            // the card you are actually moving is the clearest feedback.
        }

        const encounterArea = groupContainer.parentElement;
        if (!(encounterArea instanceof HTMLElement)) return;

        // Marked synchronously so the measurement below already excludes it;
        // the visual `dh-dragging` state waits a frame so the drag image is
        // snapshotted before the source card dims.
        groupContainer.classList.add('dh-drag-source');
        encounterArea.classList.add('is-dragging');
        this.dragOrderChanged = false;
        this.dragPointerX = e.clientX;
        this.measureDragTargets(encounterArea);
        requestAnimationFrame(() => groupContainer.classList.add('dh-dragging'));
        this.startDragAutoScroll(encounterArea);
    }

    private handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (!this.draggedGroupId) return;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this.dragPointerX = e.clientX;

        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area');
        if (!(encounterArea instanceof HTMLElement)) return;
        const dragging = encounterArea.querySelector('.dh-drag-source');
        if (!(dragging instanceof HTMLElement)) return;

        const afterId = this.getGroupDragAfterId(e.clientX);
        const afterElement = afterId
            ? encounterArea.querySelector(`.dh-adversary-group-container[data-group-id="${afterId}"]`)
            : null;

        // Only touch the DOM when the slot actually changes. Re-inserting a node
        // where it already sits still forces a full re-layout of the row and
        // interrupts the browser's own drag hit-testing, which read as stutter.
        if (dragging.nextElementSibling === afterElement) return;
        if (afterElement === null && dragging === encounterArea.lastElementChild) return;

        // FLIP: reordering is a DOM move, which the browser paints as an instant
        // jump. Record where the cards were, move the node, then animate each
        // displaced card from its old position to its new one so the row shifts
        // smoothly around the drag instead of snapping.
        const before = new Map<Element, number>();
        for (const card of Array.from(encounterArea.children)) {
            if (card !== dragging) before.set(card, card.getBoundingClientRect().left);
        }

        if (afterElement === null) encounterArea.appendChild(dragging);
        else encounterArea.insertBefore(dragging, afterElement);
        this.dragOrderChanged = true;

        // The dragged card stays in the flow as its own placeholder, so moving it
        // shifts every card it passed. Refresh the cached midpoints from the same
        // rects the animation needs, or the next slot decision would be made
        // against positions that no longer exist.
        this.dragCardMidpoints = [];
        for (const [card, oldLeft] of before) {
            const box = card.getBoundingClientRect();
            const id = card.getAttribute('data-group-id');
            if (id) this.dragCardMidpoints.push({ id, mid: box.left + box.width / 2 });
            const delta = oldLeft - box.left;
            if (delta === 0 || !(card instanceof HTMLElement)) continue;
            card.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], {
                duration: 160,
                easing: 'ease-out',
            });
        }
    }

    /**
     * Scrolls the encounter area while a card is dragged near either edge.
     *
     * The area scrolls horizontally and never wraps, so without this a card can
     * only be dropped among the groups that happen to be on screen when the
     * drag starts. Runs on its own animation frame because `dragover` does not
     * fire while the pointer is held still at the edge.
     */
    private startDragAutoScroll(encounterArea: HTMLElement) {
        const EDGE = 60;
        const MAX_SPEED = 18;
        const step = () => {
            if (!this.draggedGroupId) {
                this.dragAutoScrollFrame = null;
                return;
            }
            const box = encounterArea.getBoundingClientRect();
            const fromLeft = this.dragPointerX - box.left;
            const fromRight = box.right - this.dragPointerX;
            let delta = 0;
            if (fromLeft < EDGE) delta = -MAX_SPEED * (1 - Math.max(fromLeft, 0) / EDGE);
            else if (fromRight < EDGE) delta = MAX_SPEED * (1 - Math.max(fromRight, 0) / EDGE);
            if (delta !== 0) {
                const before = encounterArea.scrollLeft;
                encounterArea.scrollLeft = before + delta;
                // Scrolling moves every card, so the cached midpoints have to
                // shift with it or the drop slot would be computed against
                // stale positions.
                const moved = encounterArea.scrollLeft - before;
                if (moved !== 0) {
                    for (const card of this.dragCardMidpoints) card.mid -= moved;
                }
            }
            this.dragAutoScrollFrame = requestAnimationFrame(step);
        };
        this.stopDragAutoScroll();
        this.dragAutoScrollFrame = requestAnimationFrame(step);
    }

    private stopDragAutoScroll() {
        if (this.dragAutoScrollFrame !== null) {
            cancelAnimationFrame(this.dragAutoScrollFrame);
            this.dragAutoScrollFrame = null;
        }
    }

    private handleDrop(e: DragEvent) {
        e.preventDefault();
        if (!this.draggedGroupId || !this.dragOrderChanged) return;
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area');
        if (!(encounterArea instanceof HTMLElement)) return;
        const newOrderedIds = Array.from(encounterArea.querySelectorAll('.dh-adversary-group-container'))
            .map((el) => el.getAttribute('data-group-id'))
            .filter((id): id is string => id !== null);
        const currentEncounter = this.currentEncounterId
            ? this.plugin.getSavedEncounter(this.currentEncounterId)
            : null;
        if (currentEncounter) {
            this.plugin.updateSavedEncounter({ ...currentEncounter, adversaryGroupOrder: newOrderedIds });
        }
    }

    private handleDragEnd(e: DragEvent) {
        void e;
        this.stopDragAutoScroll();
        this.uiContainer
            ?.querySelectorAll('.dh-dragging, .dh-drag-source')
            .forEach((el) => el.classList.remove('dh-dragging', 'dh-drag-source'));
        this.uiContainer?.querySelector('.dh-encounter-area')?.classList.remove('is-dragging');
        const changed = this.dragOrderChanged;
        this.draggedGroupId = null;
        this.dragCardMidpoints = [];
        this.dragOrderChanged = false;
        // A drag that ended where it started already left the DOM correct, and
        // rebuilding the whole view would throw away scroll position and any
        // expanded feature the GM had open mid-combat.
        if (changed) this.drawUI();
    }

    handleEditInstanceEvent(e: Event) {
        const { instanceId } = (e as CustomEvent).detail;
        if (!instanceId) return;
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        if (!instance) return;
        new EditAdversaryModal(this.app, this.plugin, instance, (updatedAdversary) => {
            const groupId = instance.groupId;
            if (!groupId) return;
            this.activeEncounterItems.forEach((c) => {
                if (c.groupId === groupId) {
                    Object.assign(c, {
                        ...updatedAdversary,
                        id: c.id,
                        groupId: c.groupId,
                        currentHp: c.currentHp,
                        currentStress: c.currentStress,
                        displayName: c.displayName,
                        conditions: c.conditions,
                    });
                }
            });
            this.updateDisplayNamesForGroup(groupId);
            this.autoSaveCurrentEncounter();
            this.redrawItemGroup(groupId);
        }).open();
    }

    handleRequestConditionMenu(e: Event) {
        const { instanceId, anchor } = (e as CustomEvent).detail;
        if (!instanceId || !anchor) return;
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        const menu = new Menu();

        // Applied conditions show a checkmark and toggle off, so the menu answers
        // "what is on this adversary?" without the GM having to recall it.
        // Obsidian's Menu renders the title on one line, so the rules text goes in
        // the item's tooltip -- the chips themselves carry it too (see the
        // conditions renderer), and the full text is one hover away.
        const addConditionItem = (condition: Condition) => {
            const applied =
                instance?.conditions?.some((c) => c.name.toLowerCase() === condition.name.toLowerCase()) ?? false;
            menu.addItem((item) => {
                item.setTitle(condition.name)
                    .setIcon(condition.icon ?? 'circle-dot')
                    .setChecked(applied)
                    .onClick(() => {
                        if (applied) this.removeConditionFromInstance(instanceId, condition.name);
                        else this.addConditionToInstance(instanceId, condition);
                    });
                if (condition.description) {
                    (item as unknown as { dom?: HTMLElement }).dom?.setAttribute('title', condition.description);
                }
            });
        };

        DAGGERHEART_CONDITIONS.forEach(addConditionItem);

        // Conditions applied by specific adversary features, kept below a
        // separator so they stay distinct from the three standard ones.
        menu.addSeparator();
        DAGGERHEART_ADVERSARY_CONDITIONS.forEach(addConditionItem);

        const saved = this.plugin.settings.customConditions ?? [];
        if (saved.length) {
            menu.addSeparator();
            saved.forEach(addConditionItem);
        }

        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle('Add Custom...')
                .setIcon('plus')
                .onClick(() => {
                    new CustomConditionModal(this.app, async (newCondition) => {
                        await this.rememberCustomCondition(newCondition);
                        this.addConditionToInstance(instanceId, newCondition);
                    }).open();
                }),
        );

        const rect = (anchor as HTMLElement).getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }

    /** Persists a user-created condition so it can be reused in later sessions. */
    private async rememberCustomCondition(condition: Condition) {
        if (!this.plugin.settings.customConditions) this.plugin.settings.customConditions = [];
        const known = this.plugin.settings.customConditions;
        if (known.some((c) => c.name.toLowerCase() === condition.name.toLowerCase())) return;
        known.push({ ...condition, isCustom: true });
        await this.plugin.saveSettings();
    }

    /**
     * Re-renders just one instance's condition chips.
     *
     * Conditions used to go through redrawItemGroup(), which empties and rebuilds
     * every card in the group: every statblock, feature list and HP track. That
     * flickers and loses scroll position mid-combat. Falls back to the full redraw
     * if the container cannot be found, so a missed selector degrades rather than
     * silently doing nothing.
     */
    private refreshInstanceConditions(instanceId: string) {
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        if (!instance) return;
        const container = this.uiContainer?.querySelector(
            `.dh-conditions-container[data-instance-id="${instanceId}"]`,
        ) as HTMLElement | null;
        if (!container) {
            this.redrawItemGroup(instance.groupId);
            return;
        }
        renderConditionTags(instance, container, container);
    }

    removeConditionFromInstance(instanceId: string, conditionName: string) {
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        if (!instance?.conditions) return;
        instance.conditions = instance.conditions.filter((c) => c.name !== conditionName);
        this.autoSaveCurrentEncounter();
        this.refreshInstanceConditions(instanceId);
    }

    handleRemoveConditionEvent(e: Event) {
        const { instanceId, conditionName } = (e as CustomEvent).detail;
        if (!instanceId || !conditionName) return;
        this.removeConditionFromInstance(instanceId, conditionName);
    }

    handleRemoveInstanceEvent(e: Event) {
        this.removeInstanceFromEncounter((e as CustomEvent).detail.instanceId);
    }

    /**
     * Renames a single instance. The name element has already updated itself,
     * so this only persists the change; redrawing the group here would throw
     * away focus and flicker the card mid-edit.
     */
    handleRenameInstanceEvent(e: Event) {
        const { instanceId, name } = (e as CustomEvent).detail;
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        if (!instance || typeof name !== 'string') return;
        const trimmed = name.trim();

        if (!trimmed) {
            // Clearing the field restores the automatic name, which is the only
            // way back once an instance has been renamed.
            instance.hasCustomName = false;
            this.updateDisplayNamesForGroup(instance.groupId);
            this.autoSaveCurrentEncounter();
            this.redrawItemGroup(instance.groupId);
            return;
        }

        instance.displayName = trimmed;
        // Marks the name as deliberate so the automatic "Name #N" numbering
        // leaves it alone when the group's membership changes.
        instance.hasCustomName = true;
        this.autoSaveCurrentEncounter();
    }

    private async handleCreateCountdownEvent(e: Event) {
        const { name, value, start, loops } = (e as CustomEvent).detail;
        if (typeof name !== 'string' || typeof value !== 'number') return;

        await this.handleAddCountdown(false, name, value, {
            start: typeof start === 'string' ? start : undefined,
            loops: loops === true,
        });
        new Notice(`Countdown "${name}" created with value ${value}.`);
    }

    removeGroupFromEncounter(groupId: string) {
        if (!groupId) return;

        const groupName = this.activeEncounterItems.find((i) => i.groupId === groupId)?.name || 'Unknown Group';

        this.activeEncounterItems = this.activeEncounterItems.filter((inst) => inst.groupId !== groupId);

        // Drop the group's view state with it, so neither set accumulates keys
        // for cards that no longer exist.
        this.cardDensity.delete(groupId);
        const featurePrefix = `${groupId}::`;
        for (const key of this.toggledFeatures) {
            if (key.startsWith(featurePrefix)) this.toggledFeatures.delete(key);
        }

        const encounter = this.currentEncounterId ? this.plugin.getSavedEncounter(this.currentEncounterId) : null;
        if (encounter?.adversaryGroupOrder) {
            const groupIndex = encounter.adversaryGroupOrder.indexOf(groupId);
            if (groupIndex > -1) {
                const updatedGroupOrder = [...encounter.adversaryGroupOrder];
                updatedGroupOrder.splice(groupIndex, 1);
                const updatedEncounter = {
                    ...encounter,
                    adversaryGroupOrder: updatedGroupOrder,
                    adversaries: this.activeEncounterItems,
                };
                this.plugin.updateSavedEncounter(updatedEncounter);
            }
        }

        this.autoSaveCurrentEncounter();

        // Remove the group container from the DOM
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        if (encounterArea) {
            const groupContainer = encounterArea.querySelector(`[data-group-id="${groupId}"]`);
            if (groupContainer) {
                groupContainer.remove();
            }

            // If there are no more groups, show the empty message
            if (this.activeEncounterItems.length === 0) {
                const currentEncounter = this.currentEncounterId
                    ? this.plugin.getSavedEncounter(this.currentEncounterId)
                    : null;
                const emptyText = currentEncounter
                    ? `Encounter "${currentEncounter.name}" is empty. Add adversaries or environments.`
                    : 'No active encounter or encounter is empty.';
                encounterArea.createEl('p', { text: emptyText });
            }

            // Update trackers if needed
            if (this.plugin.settings.enableEncounterBudget) {
                const rightSideTrackers = this.uiContainer?.querySelector('.dh-right-side-trackers') as HTMLElement;
                if (rightSideTrackers) {
                    rightSideTrackers.empty();
                    this.drawEncounterBudget(rightSideTrackers);
                    if (this.plugin.settings.enableFearTracker) this.drawFearTracker(rightSideTrackers);
                }
            }
        } else {
            this.drawUI();
        }

        new Notice(`Removed ${groupName} group from encounter.`);
    }

    /**
     * Handles selecting an encounter
     * @param encounterId ID of the encounter to select
     */
    handleSelectEncounter(encounterId: string) {
        this.loadEncounter(encounterId);
    }

    addConditionToInstance(instanceId: string, condition: Condition) {
        const instance = this.activeEncounterItems.find((c) => c.id === instanceId);
        if (!instance) return;
        if (!instance.conditions) instance.conditions = [];
        if (instance.conditions.some((c) => c.name.toLowerCase() === condition.name.toLowerCase())) {
            new Notice(`"${instance.displayName}" already has the "${condition.name}" condition.`);
            return;
        }
        instance.conditions.push(condition);
        this.autoSaveCurrentEncounter();
        this.refreshInstanceConditions(instanceId);
    }

    renderAdditionalTrackerRow(instance: AdversaryInstance, parentEl: HTMLElement) {
        const trackerRow = parentEl.createDiv({ cls: 'dh-additional-tracker-row' });
        const header = trackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
        renderInstanceName(instance, header, trackerRow);
        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });
        renderConditionButton(instance.id, instance.displayName || instance.name, controlsWrapper, trackerRow);
        const removeBtn = controlsWrapper.createEl('button', {
            text: '✕',
            title: 'Remove this instance',
            cls: 'dh-remove-additional-btn',
        });
        removeBtn.addEventListener('click', () => {
            this.uiContainer?.dispatchEvent(
                new CustomEvent('dh-remove-instance', {
                    detail: { instanceId: instance.id },
                    bubbles: true,
                }),
            );
        });
        renderConditionTags(instance, trackerRow.createDiv(), trackerRow);
        if (instance.hp_stress) {
            const hpMax = Number(instance.hp_stress.hp) || 0;
            syncDefeatedState(trackerRow, instance.currentHp, hpMax);
            this.plugin.createInteractiveTrack(
                trackerRow,
                'HP',
                hpMax,
                `${instance.id}-hp-add`,
                instance.currentHp,
                (newHp) => {
                    // Dim in step with the damage rather than at the next
                    // redraw: these tracks update in place.
                    syncDefeatedState(trackerRow, newHp, hpMax);
                    const inst = this.activeEncounterItems.find((c) => c.id === instance.id);
                    if (inst) inst.currentHp = newHp;
                    this.autoSaveCurrentEncounter();
                },
            );
            this.plugin.createInteractiveTrack(
                trackerRow,
                'Stress',
                Number(instance.hp_stress.stress) || 0,
                `${instance.id}-stress-add`,
                instance.currentStress,
                (newStress) => {
                    const inst = this.activeEncounterItems.find((c) => c.id === instance.id);
                    if (inst) inst.currentStress = newStress;
                    this.autoSaveCurrentEncounter();
                },
            );
        }
    }

    /**
     * Reapplies the automatic "Name #N" numbering after the group's membership
     * changes. Instances the GM has renamed keep their name: the numbering is a
     * default, not something that should overwrite a deliberate choice.
     *
     * Numbering counts every member, renamed or not, so the numbers a GM sees
     * stay stable when one of their neighbours is renamed. An instance with no
     * name always gets one, whatever its flags say.
     */
    private updateDisplayNamesForGroup(groupId: string) {
        const instancesInThisGroup = this.activeEncounterItems.filter((inst) => inst.groupId === groupId);
        instancesInThisGroup.sort((a, b) => a.id.localeCompare(b.id));
        const single = instancesInThisGroup.length === 1;
        instancesInThisGroup.forEach((instance, index) => {
            if (instance.hasCustomName && instance.displayName?.trim()) return;
            instance.displayName = single ? instance.name : `${instance.name} #${index + 1}`;
        });
    }

    /**
     * Add an entry to the active encounter as a new group.
     *
     * `count` exists for summoning, which brings in several creatures at once:
     * they are all created before the group is drawn, so the card renders once
     * with every member already on it.
     */
    addItemToActiveEncounter(baseItem: StatblockData, count: number = 1) {
        if (!this.currentEncounterId) {
            new Notice('Error: No active encounter. Please create or load an encounter first.');
            return;
        }
        const encounter = this.plugin.getSavedEncounter(this.currentEncounterId);
        if (!encounter) return;
        const newGroupId = `${baseItem.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
        for (let i = 0; i < Math.max(1, count); i++) {
            this.createNewInstanceFromTemplate(baseItem, newGroupId);
        }

        // Create a copy of the encounter with updated group order
        const updatedGroupOrder = encounter.adversaryGroupOrder ? [...encounter.adversaryGroupOrder] : [];
        updatedGroupOrder.push(newGroupId);

        // Update the encounter
        const updatedEncounter = {
            ...encounter,
            adversaryGroupOrder: updatedGroupOrder,
            adversaries: this.activeEncounterItems,
        };
        this.plugin.updateSavedEncounter(updatedEncounter);
        encounter.adversaryGroupOrder.push(newGroupId);
        this.autoSaveCurrentEncounter();

        // Instead of redrawing the entire UI, we need to:
        // 1. Check if the UI already has encounter items
        const encounterArea = this.uiContainer?.querySelector('.dh-encounter-area') as HTMLElement;
        if (encounterArea) {
            // If there were no items previously (there's a message), we need to redraw the UI
            if (encounterArea.querySelector('p')) {
                this.drawUI();
            } else {
                // Otherwise, just draw the new group
                this.drawItemGroup(newGroupId, encounterArea);
                this.refreshEncounterTrackers();
            }
        } else {
            // If there's no encounter area, we need to draw the UI
            this.drawUI();
        }
    }

    createNewInstanceFromTemplate(template: StatblockData, targetGroupId: string) {
        const newInstance: AdversaryInstance = {
            ...JSON.parse(JSON.stringify(template)),
            id: `${template.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            groupId: targetGroupId,
            currentHp: 0,
            currentStress: 0,
            displayName: '',
            conditions: [],
            // "Add to Group" passes an existing instance as the template, so a
            // rename on that instance would otherwise be inherited here and the
            // new copy would keep an empty name instead of being numbered.
            hasCustomName: false,
        };
        if (newInstance.hp_stress) {
            newInstance.hp_stress = {
                hp: Number(template.hp_stress.hp) || 0,
                stress: Number(template.hp_stress.stress) || 0,
                major_hp: template.hp_stress.major_hp ? Number(template.hp_stress.major_hp) : null,
                severe_hp: template.hp_stress.severe_hp ? Number(template.hp_stress.severe_hp) : null,
            };
        }
        this.activeEncounterItems.push(newInstance);
        this.updateDisplayNamesForGroup(targetGroupId);
    }

    removeInstanceFromEncounter(instanceId: string) {
        const instanceToRemoveIndex = this.activeEncounterItems.findIndex((c) => c.id === instanceId);
        if (instanceToRemoveIndex === -1) return;
        const removedInstance = this.activeEncounterItems[instanceToRemoveIndex];
        const groupId = removedInstance.groupId;
        this.activeEncounterItems.splice(instanceToRemoveIndex, 1);
        const isGroupEmpty = !this.activeEncounterItems.some((inst) => inst.groupId === groupId);
        if (isGroupEmpty && this.currentEncounterId) {
            const encounter = this.plugin.getSavedEncounter(this.currentEncounterId);
            if (encounter?.adversaryGroupOrder) {
                const groupIndex = encounter.adversaryGroupOrder.indexOf(groupId);
                if (groupIndex > -1) {
                    const updatedGroupOrder = [...encounter.adversaryGroupOrder];
                    updatedGroupOrder.splice(groupIndex, 1);

                    // Update the encounter
                    const updatedEncounter = {
                        ...encounter,
                        adversaryGroupOrder: updatedGroupOrder,
                        adversaries: this.activeEncounterItems,
                    };
                    this.plugin.updateSavedEncounter(updatedEncounter);
                }
            }
        }
        this.updateDisplayNamesForGroup(groupId);
        this.autoSaveCurrentEncounter();

        // Only redraw the specific group instead of the entire UI
        if (isGroupEmpty) {
            // If the group is empty, we need to redraw the UI to remove the group container
            this.drawUI();
        } else {
            // Otherwise, just redraw the specific group
            this.redrawItemGroup(groupId);
        }
    }

    async onClose() {
        this.diceTray?.unload();
        // On the document rather than the container, so they are torn down
        // regardless of whether the container still exists.
        document.removeEventListener('click', this.handleDismissTierScaler);
        document.removeEventListener('keydown', this.handleTierScalerKeydown);
        if (this.uiContainer) {
            this.uiContainer.removeEventListener('dh-request-condition-menu', this.boundHandleRequestConditionMenu);
            this.uiContainer.removeEventListener('dh-remove-condition', this.boundHandleRemoveConditionEvent);
            this.uiContainer.removeEventListener('dh-remove-instance', this.boundHandleRemoveInstanceEvent);
            this.uiContainer.removeEventListener('dh-edit-instance', this.boundHandleEditInstanceEvent);
            this.uiContainer.removeEventListener(EVENT_CREATE_COUNTDOWN, this.boundHandleCreateCountdownEvent);
            this.uiContainer.removeEventListener(EVENT_RENAME_INSTANCE, this.boundHandleRenameInstanceEvent);
            this.uiContainer.removeEventListener(EVENT_SPEND_FEAR, this.boundHandleSpendFearEvent);
            this.uiContainer.removeEventListener(EVENT_SUMMON, this.boundHandleSummonEvent);
            const encounterArea = this.uiContainer.querySelector<HTMLElement>('.dh-encounter-area');
            if (encounterArea) {
                encounterArea.removeEventListener('dragstart', this.boundHandleDragStart);
                encounterArea.removeEventListener('dragover', this.boundHandleDragOver);
                encounterArea.removeEventListener('drop', this.boundHandleDrop);
                encounterArea.removeEventListener('dragend', this.boundHandleDragEnd);
                encounterArea.removeEventListener('wheel', this.boundHandleEncounterWheel);
            }

            // Force cleanup of any active popover
            if (this.activePopover) {
                document.removeEventListener('click', this.handleDocumentClick);
                this.activePopover.remove();
                this.activePopover = null;
            }
        }
    }
    showStatblockPreview(itemData: StatblockData, targetEl: HTMLElement) {
        // Remove any existing popover
        this.hideStatblockPreview();

        // Create a new popover container
        this.activePopover = document.createElement('div');
        this.activePopover.classList.add('dh-statblock-preview-popover');
        document.body.appendChild(this.activePopover);

        // Create a container for the statblock content (scrolling is handled in CSS)
        const contentContainer = this.activePopover.createDiv({ cls: 'dh-popover-content' });

        // Render the statblock in the popover
        renderStatblockCard(this.plugin, itemData, contentContainer, false, itemData.name);

        // Position the popover to the left of the target element
        const targetRect = targetEl.getBoundingClientRect();
        const compendiumList = targetEl.closest('.dh-compendium-list');

        if (compendiumList) {
            const compendiumRect = compendiumList.getBoundingClientRect();

            // Calculate the left position (to the left of the compendium entry)
            let leftPos = compendiumRect.left - 440; // Position to the left with some margin, adjusted for wider popover

            // If positioning to the left would go off-screen, position to the right instead
            if (leftPos < 10) {
                leftPos = compendiumRect.right + 10; // Position to the right with some margin
            }

            this.activePopover.style.left = `${leftPos}px`;
            this.activePopover.style.top = `${targetRect.top}px`;

            // Ensure popover doesn't go off the top of the screen
            const popoverRect = this.activePopover.getBoundingClientRect();
            if (popoverRect.top < 10) {
                this.activePopover.style.top = '10px';
            }

            // Ensure popover doesn't go off the bottom of the screen
            const viewportHeight = window.innerHeight;
            if (popoverRect.bottom > viewportHeight - 10) {
                this.activePopover.style.top = `${viewportHeight - popoverRect.height - 10}px`;
            }
        }

        // Add a click event listener to the document to close the popover when clicking outside
        setTimeout(() => {
            document.addEventListener('click', this.handleDocumentClick);
        }, 0);
    }

    private handleDocumentClick = (e: MouseEvent) => {
        // Skip if no active popover
        if (!this.activePopover) return;

        // Check if the click was inside the popover
        if (this.activePopover.contains(e.target as Node)) {
            return;
        }

        // Check if the click was on a compendium entry - we don't close in that case
        // as the click handler for that entry will handle showing its own popover
        const clickedOnCompendiumEntry = (e.target as Element)?.closest?.('.dh-compendium-entry');
        if (clickedOnCompendiumEntry) {
            return;
        }

        // If we get here, the click was outside the popover and not on a compendium entry
        this.hideStatblockPreview();
    };

    hideStatblockPreview() {
        if (this.activePopover) {
            document.removeEventListener('click', this.handleDocumentClick);
            this.activePopover.remove();
            this.activePopover = null;

            // Clear the active popover flag from all compendium entries
            const entries = this.uiContainer?.querySelectorAll('.dh-compendium-entry');
            if (entries) {
                entries.forEach((entry) => {
                    (entry as any).hasActivePopover = false;
                });
            }
        }
    }
}
