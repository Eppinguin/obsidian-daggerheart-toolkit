import { App, Modal, Setting, Menu, MenuItem, TextComponent, setIcon } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { Character, CompendiumItem, WeaponItem, ArmorItem } from '../../types';

export class AddItemModal extends Modal {
    private searchInput: TextComponent;
    private activeFiltersContainer: HTMLElement;
    private listEl: HTMLElement;

    // Filter state
    private searchTerm: string = '';
    private selectedCategories: Set<string> = new Set();
    private selectedTiers: Set<number> = new Set();
    private selectedBurdens: Set<string> = new Set();
    private selectedTraits: Set<string> = new Set();
    private selectedSlots: Set<string> = new Set();

    // Available filter options
    private availableTiers: number[] = [];
    private availableTraits: string[] = [];

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private character: Character,
        private onAdd: (item: CompendiumItem) => void,
        private onCustom: () => void
    ) {
        super(app);
        this.modalEl.addClass('dh-add-item-modal');

        // Pre-calculate available filter options
        const allItems = this.plugin.characterCompendium.getAllItems();
        const tiers = new Set<number>();
        const traits = new Set<string>();
        allItems.forEach(item => {
            if ('tier' in item && typeof item.tier === 'string') {
                tiers.add(parseInt(item.tier));
            }
            if (item._type === 'weapon' && 'trait' in item) {
                traits.add((item as WeaponItem).trait);
            }
        });
        this.availableTiers = Array.from(tiers).sort((a, b) => a - b);
        this.availableTraits = Array.from(traits).sort();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Add Item from Compendium" });

        // --- Top Bar: Search, Filters, Custom Button ---
        const topBar = contentEl.createDiv({ cls: 'dh-modal-topbar' });

        // Search Input
        const searchContainer = topBar.createDiv({ cls: 'search-input-container' });
        this.searchInput = new TextComponent(searchContainer)
            .setPlaceholder("Search by name...");
        this.searchInput.onChange((value) => {
            this.searchTerm = value.toLowerCase();
            this.renderList();
        });
        this.searchInput.inputEl.addClass('dh-full-width-input');

        // Main Actions Container
        const actionsContainer = topBar.createDiv({ cls: 'modal-actions-container' });

        // Filter Button
        const filterButton = actionsContainer.createEl('button');
        filterButton.ariaLabel = "Filter items";
        setIcon(filterButton, 'filter');
        filterButton.addEventListener('click', (event) => this.showFilterMenu(event));

        // Custom Item Button
        actionsContainer.createEl('button', { text: 'Create Custom' }).addEventListener('click', () => {
            this.close();
            this.onCustom();
        });

        // --- Active Filters Display ---
        this.activeFiltersContainer = contentEl.createDiv({ cls: 'dh-active-filters-container' });
        this.renderActiveFilters();

        // --- Item List ---
        this.listEl = contentEl.createDiv({ cls: 'dh-modal-list' });
        this.renderList();
    }

    private showFilterMenu(event: MouseEvent) {
        const menu = new Menu();

        const addMultiSelectSubMenu = (
            title: string,
            options: (string | number)[],
            selectedSet: Set<any>,
            onUpdate: (value: any) => void
        ) => {
            menu.addItem((item) => {
                item.setTitle(title).setIcon('list-tree');
                const subMenu = (item as any).setSubmenu() as Menu;
                options.forEach(option => {
                    subMenu.addItem((subItem: MenuItem) => {
                        subItem
                            .setTitle(String(option))
                            .setChecked(selectedSet.has(option))
                            .onClick(() => {
                                onUpdate(option);
                            });
                    });
                });
            });
        };

        const createToggleHandler = (set: Set<any>) => (value: any) => {
            if (set.has(value)) {
                set.delete(value);
            } else {
                set.add(value);
            }
            this.renderActiveFilters();
            this.renderList();
        };

        addMultiSelectSubMenu('Category', ['weapon', 'armor', 'item', 'consumable'], this.selectedCategories, createToggleHandler(this.selectedCategories));
        addMultiSelectSubMenu('Tier', this.availableTiers, this.selectedTiers, createToggleHandler(this.selectedTiers));

        const showWeaponFilters = this.selectedCategories.size === 0 || this.selectedCategories.has('weapon');
        if (showWeaponFilters) {
            menu.addSeparator();
            addMultiSelectSubMenu('Burden', ['One-Handed', 'Two-Handed'], this.selectedBurdens, createToggleHandler(this.selectedBurdens));
            addMultiSelectSubMenu('Trait', this.availableTraits, this.selectedTraits, createToggleHandler(this.selectedTraits));
            addMultiSelectSubMenu('Slot', ['Primary', 'Secondary'], this.selectedSlots, createToggleHandler(this.selectedSlots));
        }

        menu.showAtMouseEvent(event);
    }

    private renderActiveFilters() {
        this.activeFiltersContainer.empty();

        const createTag = (type: string, value: string | number) => {
            const tagEl = this.activeFiltersContainer.createDiv({ cls: 'dh-active-filter-tag' });
            const displayType = type.charAt(0).toUpperCase() + type.slice(1);
            const displayValue = String(value).charAt(0).toUpperCase() + String(value).slice(1);

            tagEl.createSpan({ text: `${displayType}:`, cls: 'dh-filter-tag-type' });
            tagEl.createSpan({ text: displayValue, cls: 'dh-filter-tag-value' });
            const removeBtn = tagEl.createEl('button', { cls: 'dh-remove-filter-btn' });
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', () => {
                let set: Set<any> | null = null;
                switch (type.toLowerCase()) {
                    case 'category': set = this.selectedCategories; break;
                    case 'tier': set = this.selectedTiers; break;
                    case 'burden': set = this.selectedBurdens; break;
                    case 'trait': set = this.selectedTraits; break;
                    case 'slot': set = this.selectedSlots; break;
                }
                if (set) {
                    set.delete(value);
                    this.renderActiveFilters();
                    this.renderList();
                }
            });
        };

        this.selectedCategories.forEach(v => createTag('category', v));
        this.selectedTiers.forEach(v => createTag('tier', v));
        this.selectedBurdens.forEach(v => createTag('burden', v));
        this.selectedTraits.forEach(v => createTag('trait', v));
        this.selectedSlots.forEach(v => createTag('slot', v));
    }

    private renderList() {
        this.listEl.empty();
        const allItems = this.plugin.characterCompendium.getAllItems();

        const filtered = allItems.filter(item => {
            if (this.searchTerm && !item.name.toLowerCase().includes(this.searchTerm)) {
                return false;
            }

            // Note: `item._type` is already lowercase from the compendium loader
            const categoryMatch = this.selectedCategories.size === 0 || this.selectedCategories.has(item._type);
            if (!categoryMatch) return false;

            if (item._type === 'armor' || item._type === 'weapon') {
                const tierMatch = this.selectedTiers.size === 0 || this.selectedTiers.has(parseInt(item.tier));
                if (!tierMatch) return false;
            }

            if (item._type !== 'weapon') {
                if (this.selectedBurdens.size > 0 || this.selectedTraits.size > 0 || this.selectedSlots.size > 0) {
                    return false;
                }
            } else {
                const weapon = item as WeaponItem;
                const burdenMatch = this.selectedBurdens.size === 0 || this.selectedBurdens.has(weapon.burden);
                if (!burdenMatch) return false;

                const traitMatch = this.selectedTraits.size === 0 || this.selectedTraits.has(weapon.trait);
                if (!traitMatch) return false;

                const slotMatch = this.selectedSlots.size === 0 || this.selectedSlots.has(weapon.primary_or_secondary);
                if (!slotMatch) return false;
            }

            return true;
        });

        if (filtered.length === 0) {
            this.listEl.createEl('p', { text: 'No items match your search.' });
            return;
        }

        filtered.forEach(item => {
            const itemEl = this.listEl.createDiv({ cls: 'dh-modal-list-item' });

            const mainInfo = itemEl.createDiv({ cls: 'dh-modal-item-main' });
            mainInfo.createEl('h4', { text: item.name });

            const detailsEl = mainInfo.createDiv({ cls: 'dh-modal-item-details' });
            const createTag = (text: string, hover?: string) => {
                const tag = detailsEl.createSpan({ cls: 'dh-item-tag', text });
                if (hover) tag.title = hover;
                return tag;
            };

            switch (item._type) {
                case 'weapon': {
                    const weapon = item as WeaponItem;
                    createTag(`T${weapon.tier}`, "Tier");
                    createTag('Weapon', "Category");
                    createTag(weapon.burden);
                    createTag(weapon.range);
                    createTag(weapon.trait, 'Primary Trait');
                    createTag(weapon.primary_or_secondary);
                    if (weapon.feat_name) {
                        createTag(`Feat: ${weapon.feat_name}`, weapon.feat_text).addClass('dh-item-feature');
                    }
                    break;
                }
                case 'armor': {
                    const armor = item as ArmorItem;
                    createTag(`T${armor.tier}`, "Tier");
                    createTag('Armor', "Category");
                    createTag(`${armor.base_score} AS`, 'Armor Score');
                    createTag(`${armor.base_thresholds}`, 'Major/Severe Thresholds');
                    if (armor.feat_name) {
                        createTag(`Feat: ${armor.feat_name}`, armor.feat_text).addClass('dh-item-feature');
                    }
                    break;
                }
                case 'consumable':
                case 'item': {
                    createTag(item._type.charAt(0).toUpperCase() + item._type.slice(1), "Category");
                    if (item.description) {
                        itemEl.createEl('p', { text: item.description, cls: 'dh-item-description' });
                    }
                    break;
                }
            }
            itemEl.addEventListener('click', () => {
                this.onAdd(item);
                this.close();
            });
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
