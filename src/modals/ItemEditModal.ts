// ItemEditModal.ts
import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, InventoryItem, CompendiumItem, WeaponItem, ArmorItem, JsonArmor, JsonWeapon, JsonItem, JsonConsumable } from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { SaveChoiceModal } from './SaveChoiceModal';
import { initializeInventoryItem } from '../services/effects-engine'; // Ensure this is imported

type ItemModalState = {
    instanceId: string;
    name: string;
    quantity: number;
    description?: string;
    isCustom?: boolean;
    effects?: string[];
    _type: 'item' | 'weapon' | 'armor' | 'consumable';

    // Weapon properties (for display/editing, will be parsed to damageComponents)
    tier?: string;
    trait?: string;
    range?: string;
    // This 'damage' string will be parsed into damageComponents.baseDice, baseModifier, damageType
    damage?: string;
    burden?: 'One-Handed' | 'Two-Handed';
    primary_or_secondary?: 'Primary' | 'Secondary';
    feat_name?: string;
    feat_text?: string;

    // Armor properties
    base_score?: string;
    base_thresholds?: string;

    // Consumable properties
    roll?: string;
};


export class ItemEditModal extends Modal {
    private tempItem: ItemModalState;
    private typeSpecificContainer: HTMLElement;
    private originalName: string;
    private isOriginalCustom: boolean;
    private effects: string = '';

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private character: Character, // Character is needed for getValue() in convertToInventoryItem
        private item: InventoryItem | null, // This is already an InventoryItem with CalculatedStats
        private onSave: (item: InventoryItem) => void,
        private onDelete?: () => void
    ) {
        super(app);

        if (item) {
            // Editing an existing item: convert InventoryItem to a full Compendium-like object for editing
            this.originalName = item.name;
            this.isOriginalCustom = !!item.isCustom;
            this.effects = (item.effects || []).join('\n');

            const baseState: Partial<ItemModalState> = {
                instanceId: item.instanceId,
                name: item.name,
                quantity: item.quantity,
                description: item.description,
                isCustom: item.isCustom,
                effects: item.effects,
                _type: item._type,
            };

            if (item._type === 'weapon') {
                baseState.tier = String(item.tier);
                baseState.trait = item.trait;
                baseState.range = item.range;
                // Reconstruct the damage string from components for editing
                const flatBonusDisplay = item.damageComponents.flatBonus.base !== 0 ?
                    `${item.damageComponents.flatBonus.base > 0 ? '+' : ''}${item.damageComponents.flatBonus.base}` : '';
                baseState.damage = `${item.damageComponents.baseDice}${flatBonusDisplay} ${item.damageComponents.damageType}`;
                baseState.burden = item.burden;
                baseState.primary_or_secondary = item.primaryOrSecondary;
                baseState.feat_name = item.features?.[0]?.name;
                baseState.feat_text = item.features?.[0]?.description;
            } else if (item._type === 'armor') {
                baseState.tier = String(item.tier);
                // Get base values from CalculatedStat for editing display
                baseState.base_score = String(item.baseScore.base);
                baseState.base_thresholds = `${item.baseThresholds.major.base} / ${item.baseThresholds.severe.base}`;
                baseState.feat_name = item.features?.[0]?.name;
                baseState.feat_text = item.features?.[0]?.description;
            } else if (item._type === 'consumable') {
                baseState.roll = item.roll;
            }
            this.tempItem = baseState as ItemModalState;

        } else {
            // Creating a new custom item
            this.originalName = '';
            this.isOriginalCustom = true; // New items are always custom
            this.tempItem = {
                instanceId: uuidv4(),
                _type: 'item',
                name: '',
                quantity: 1,
                isCustom: true,
                effects: [],
            };
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.item ? `Edit ${this.originalName}` : 'Add Custom Item' });

        new Setting(contentEl).setName('Name').addText(text => {
            text.setValue(this.tempItem.name || '').onChange(val => this.tempItem.name = val);
        });

        new Setting(contentEl).setName('Quantity').addText(text => {
            text.setValue(String(this.tempItem.quantity || 1)).setDisabled(this.tempItem._type !== 'item').onChange(val => {
                const num = parseInt(val);
                this.tempItem.quantity = isNaN(num) ? 1 : num;
            });
        });

        new Setting(contentEl).setName('Description').addTextArea(text => {
            text.setValue(this.tempItem.description || '').onChange(val => this.tempItem.description = val);
        });

        new Setting(contentEl).setName('Item Type').addDropdown(dd => {
            dd.addOption('item', 'Generic Item')
                .addOption('weapon', 'Weapon')
                .addOption('armor', 'Armor')
                .addOption('consumable', 'Consumable')
                .setValue(this.tempItem._type || 'item')
                .onChange(val => {
                    this.tempItem._type = val as 'item' | 'weapon' | 'armor' | 'consumable';
                    // Reset type-specific fields when changing type to avoid data carry-over issues
                    if (val === 'weapon') {
                        this.tempItem.tier = '1'; this.tempItem.trait = 'Strength'; this.tempItem.range = 'Melee';
                        this.tempItem.damage = 'd6 phy'; this.tempItem.burden = 'One-Handed';
                        this.tempItem.primary_or_secondary = 'Primary';
                        this.tempItem.feat_name = ''; this.tempItem.feat_text = '';
                    } else if (val === 'armor') {
                        this.tempItem.tier = '1'; this.tempItem.base_score = '1';
                        this.tempItem.base_thresholds = '1 / 2';
                        this.tempItem.feat_name = ''; this.tempItem.feat_text = '';
                    } else if (val === 'consumable') {
                        this.tempItem.roll = '';
                    } else if (val === 'item') {
                        // Clear specific fields
                        this.tempItem.tier = undefined; this.tempItem.trait = undefined; this.tempItem.range = undefined;
                        this.tempItem.damage = undefined; this.tempItem.burden = undefined;
                        this.tempItem.primary_or_secondary = undefined; this.tempItem.feat_name = undefined;
                        this.tempItem.feat_text = undefined; this.tempItem.base_score = undefined;
                        this.tempItem.base_thresholds = undefined; this.tempItem.roll = undefined;
                    }
                    this.onOpen(); // Re-render the modal for the new type
                });
        });

        this.typeSpecificContainer = contentEl.createDiv();
        this.renderTypeSpecificSettings();

        new Setting(contentEl)
            .setName('Effects')
            .setDesc('Define mechanical effects, one per line. e.g., "Strength + 1"\n"Weapon: "My Sword": Damage + 2" or "Weapon: "My Axe": Damage Dice Count + 1"')
            .addTextArea(text => {
                text.setPlaceholder('Strength + 1\nWeapon: "Longsword": Damage + 2')
                    .setValue(this.effects)
                    .onChange(value => this.effects = value);
                text.inputEl.rows = 4;
            });

        const footer = contentEl.createDiv({ cls: 'dh-modal-buttons' });

        if (this.onDelete && this.item) {
            new ButtonComponent(footer)
                .setButtonText('Delete')
                .setWarning()
                .onClick(() => {
                    new ConfirmationModal(this.app, 'Are you sure you want to delete this item?', async () => {
                        this.onDelete?.();
                        this.close();
                    }).open();
                });
        }

        // For new items, there's only one save option.
        if (!this.item) {
            new ButtonComponent(footer)
                .setButtonText('Save Custom Item')
                .setCta()
                .onClick(() => this.handleSave(true)); // Force save to compendium
        } else {
            new ButtonComponent(footer)
                .setButtonText("Apply to This Item Only")
                .onClick(() => this.handleSave(false));

            new ButtonComponent(footer)
                .setButtonText("Save to Compendium & Apply")
                .setCta()
                .onClick(() => this.handleSave(true));
        }
    }

    private async handleSave(saveToCompendium: boolean) {
        const finalName = this.tempItem.name?.trim();
        if (!finalName) {
            new Notice("Item name cannot be empty.");
            return;
        }

        this.tempItem.effects = this.effects.split('\n').map(e => e.trim()).filter(e => e);

        // Convert to InventoryItem first, which will also hydrate it.
        const inventoryItem = this.convertToInventoryItem();

        if (!saveToCompendium) {
            this.onSave(inventoryItem);
            this.close();
            return;
        }

        // --- Logic for saving to compendium ---
        const nameHasChanged = finalName !== this.originalName;
        // Prepare data for compendium saving (raw form)
        const compendiumItemRaw = this.prepareDataForSave();
        const fileName = this.getCompendiumFileName();

        const saveAsNew = async () => {
            await this.plugin.saveCustomCompendiumData(fileName, compendiumItemRaw);
            this.onSave(inventoryItem); // Pass the already hydrated item
            this.close();
        };

        const renameOriginal = async () => {
            await this.plugin.renameCustomCompendiumEntry(fileName, this.originalName, compendiumItemRaw);
            this.onSave(inventoryItem); // Pass the already hydrated item
            this.close();
        };

        if (nameHasChanged && this.isOriginalCustom) {
            new SaveChoiceModal(this.app, finalName, saveAsNew, renameOriginal).open();
        } else {
            // If it wasn't custom before, or the name hasn't changed, just save/overwrite.
            await this.plugin.saveCustomCompendiumData(fileName, compendiumItemRaw);
            this.onSave(inventoryItem); // Pass the already hydrated item
            this.close();
        }
    }

    private getCompendiumFileName(): string {
        switch (this.tempItem._type) {
            case 'weapon': return 'user-weapons.json';
            case 'armor': return 'user-armor.json';
            case 'consumable': return 'user-consumables.json';
            case 'item':
            default: return 'user-items.json';
        }
    }

    private prepareDataForSave(): CompendiumItem {
        const data: any = {
            name: this.tempItem.name,
            description: this.tempItem.description,
            _type: this.tempItem._type,
            isCustom: true,
            effects: this.tempItem.effects,
        };

        if (this.tempItem._type === 'weapon') {
            data.tier = this.tempItem.tier || '1';
            data.trait = this.tempItem.trait || 'Strength';
            data.range = this.tempItem.range || 'Melee';
            data.damage = this.tempItem.damage || 'd6 phy'; // Save the raw string form
            data.burden = this.tempItem.burden || 'One-Handed';
            data.primary_or_secondary = this.tempItem.primary_or_secondary || 'Primary';
            data.feat_name = this.tempItem.feat_name || '';
            data.feat_text = this.tempItem.feat_text || '';
        } else if (this.tempItem._type === 'armor') {
            data.tier = this.tempItem.tier || '1';
            data.base_score = this.tempItem.base_score || '1';
            data.base_thresholds = this.tempItem.base_thresholds || '1 / 2';
            data.feat_name = this.tempItem.feat_name || '';
            data.feat_text = this.tempItem.feat_text || '';
        } else if (this.tempItem._type === 'consumable') {
            data.roll = this.tempItem.roll || '';
        }
        return data as CompendiumItem;
    }

    private convertToInventoryItem(): InventoryItem {
        const base = {
            instanceId: this.item?.instanceId || uuidv4(),
            name: this.tempItem.name || 'Unnamed Item',
            quantity: this.tempItem.quantity || 1,
            description: this.tempItem.description,
            isCustom: this.tempItem.isCustom,
            effects: this.tempItem.effects,
        };

        let newItem: InventoryItem;

        // Start with a raw object that matches the expected input for initializeInventoryItem
        let rawItemData: any;

        if (this.tempItem._type === 'weapon') {
            rawItemData = {
                ...base,
                _type: 'weapon',
                tier: parseInt(this.tempItem.tier || '1'),
                trait: this.tempItem.trait || 'Strength',
                range: this.tempItem.range || 'Melee',
                // Crucially, pass the raw damage string here
                damage: this.tempItem.damage || 'd6 phy',
                burden: this.tempItem.burden || 'One-Handed',
                primaryOrSecondary: this.tempItem.primary_or_secondary || 'Primary',
                features: this.tempItem.feat_name ? [{ name: this.tempItem.feat_name, description: this.tempItem.feat_text || '' }] : [],
            };
        }
        else if (this.tempItem._type === 'armor') {
            const [major, severe] = (this.tempItem.base_thresholds || '1 / 2').split('/').map(s => parseInt(s.trim()));
            rawItemData = {
                ...base,
                _type: 'armor',
                tier: parseInt(this.tempItem.tier || '1'),
                baseScore: parseInt(this.tempItem.base_score || '1'), // Raw number
                baseThresholds: { major, severe }, // Raw numbers
                features: this.tempItem.feat_name ? [{ name: this.tempItem.feat_name, description: this.tempItem.feat_text || '' }] : [],
            };
        }
        else if (this.tempItem._type === 'consumable') {
            rawItemData = {
                ...base,
                _type: 'consumable',
                roll: this.tempItem.roll || '',
            };
        }
        else {
            rawItemData = { ...base, _type: 'item' };
        }

        // Hydrate the raw item data into an InventoryItem with CalculatedStat instances
        initializeInventoryItem(rawItemData);
        newItem = rawItemData as InventoryItem; // Cast to InventoryItem after hydration

        return newItem;
    }

    private renderTypeSpecificSettings() {
        this.typeSpecificContainer.empty();
        if (this.tempItem._type === 'weapon') this.renderWeaponSettings();
        else if (this.tempItem._type === 'armor') this.renderArmorSettings();
    }

    private renderWeaponSettings() {
        new Setting(this.typeSpecificContainer).setName('Tier').addText(text => text.setValue(this.tempItem.tier || '1').onChange(v => this.tempItem.tier = v));
        new Setting(this.typeSpecificContainer).setName('Weapon Trait').addDropdown(dd => { dd.addOptions({ Strength: 'Strength', Agility: 'Agility', Finesse: 'Finesse', Instinct: 'Instinct', Presence: 'Presence', Knowledge: 'Knowledge' }).setValue(this.tempItem.trait || 'Strength').onChange(v => this.tempItem.trait = v); });
        new Setting(this.typeSpecificContainer).setName('Range').addDropdown(dd => { dd.addOptions({ Melee: 'Melee', 'Very Close': 'Very Close', Close: 'Close', Far: 'Far', 'Very Far': 'Very Far' }).setValue(this.tempItem.range || 'Melee').onChange(v => this.tempItem.range = v); });
        new Setting(this.typeSpecificContainer).setName('Damage').setDesc('Format: "XdY+Z type" (e.g., "d6 phy" or "2d8+3 mag")').addText(text => text.setPlaceholder('e.g., d8+2 phy').setValue(this.tempItem.damage || 'd6 phy').onChange(v => this.tempItem.damage = v));
        new Setting(this.typeSpecificContainer).setName('Burden').addDropdown(dd => { dd.addOptions({ 'One-Handed': 'One-Handed', 'Two-Handed': 'Two-Handed' }).setValue(this.tempItem.burden || 'One-Handed').onChange(v => this.tempItem.burden = v as any); });
        new Setting(this.typeSpecificContainer).setName('Feature Name').addText(text => text.setValue(this.tempItem.feat_name || '').onChange(v => this.tempItem.feat_name = v));
        new Setting(this.typeSpecificContainer).setName('Feature Text').addTextArea(text => text.setValue(this.tempItem.feat_text || '').onChange(v => this.tempItem.feat_text = v));
    }

    private renderArmorSettings() {
        new Setting(this.typeSpecificContainer).setName('Tier').addText(text => text.setValue(this.tempItem.tier || '1').onChange(v => this.tempItem.tier = v));
        new Setting(this.typeSpecificContainer).setName('Base Armor Score').setDesc('Base numeric value for Armor Slots.').addText(text => text.setValue(this.tempItem.base_score || '1').onChange(v => this.tempItem.base_score = v));
        new Setting(this.typeSpecificContainer).setName('Base Thresholds').setDesc('Format: "Major / Severe" (e.g., "9 / 23")').addText(text => text.setPlaceholder('e.g., 9 / 23').setValue(this.tempItem.base_thresholds || '1 / 2').onChange(v => this.tempItem.base_thresholds = v));
        new Setting(this.typeSpecificContainer).setName('Feature Name').addText(text => text.setValue(this.tempItem.feat_name || '').onChange(v => this.tempItem.feat_name = v));
        new Setting(this.typeSpecificContainer).setName('Feature Text').addTextArea(text => text.setValue(this.tempItem.feat_text || '').onChange(v => this.tempItem.feat_text = v));
    }

    onClose() {
        this.contentEl.empty();
    }
}