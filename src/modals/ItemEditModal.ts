import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, InventoryItem, CompendiumItem, WeaponItem, ArmorItem, JsonArmor, JsonWeapon, JsonItem, JsonConsumable } from '../../types';
import { ConfirmationModal } from './ConfirmationModal';
import { SaveChoiceModal } from './SaveChoiceModal';

// A flattened state object for the modal to handle any type of item being edited.
type ItemModalState = {
    instanceId: string;
    name: string;
    quantity: number;
    description?: string;
    isCustom?: boolean;
    _type: 'item' | 'weapon' | 'armor' | 'consumable';

    // Weapon properties
    tier?: string;
    trait?: string;
    range?: string;
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

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private character: Character,
        private item: InventoryItem | null,
        private onSave: (item: InventoryItem) => void,
        private onDelete?: () => void
    ) {
        super(app);

        if (item) {
            // Editing an existing item: convert InventoryItem to a full Compendium-like object for editing
            this.originalName = item.name;
            this.isOriginalCustom = !!item.isCustom;

            const baseState: Partial<ItemModalState> = {
                instanceId: item.instanceId,
                name: item.name,
                quantity: item.quantity,
                description: item.description,
                isCustom: item.isCustom,
                _type: item._type,
            };

            if (item._type === 'weapon') {
                baseState.tier = String(item.tier);
                baseState.trait = item.trait;
                baseState.range = item.range;
                baseState.damage = item.damage;
                baseState.burden = item.burden;
                baseState.primary_or_secondary = item.primaryOrSecondary;
                baseState.feat_name = item.features?.[0]?.name;
                baseState.feat_text = item.features?.[0]?.description;
            } else if (item._type === 'armor') {
                baseState.tier = String(item.tier);
                baseState.base_score = String(item.baseScore);
                baseState.base_thresholds = `${item.baseThresholds.major} / ${item.baseThresholds.severe}`;
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
                    this.onOpen(); // Re-render the modal for the new type
                });
        });

        this.typeSpecificContainer = contentEl.createDiv();
        this.renderTypeSpecificSettings();

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

        if (!saveToCompendium) {
            this.onSave(this.convertToInventoryItem());
            this.close();
            return;
        }

        // --- Logic for saving to compendium ---
        const nameHasChanged = finalName !== this.originalName;
        const compendiumItem = this.prepareDataForSave();
        const fileName = this.getCompendiumFileName();

        // The item instance in the inventory should now be marked as custom
        this.tempItem.isCustom = true;

        const saveAsNew = async () => {
            await this.plugin.saveCustomCompendiumData(fileName, compendiumItem);
            this.onSave(this.convertToInventoryItem());
            this.close();
        };

        const renameOriginal = async () => {
            await this.plugin.renameCustomCompendiumEntry(fileName, this.originalName, compendiumItem);
            this.onSave(this.convertToInventoryItem());
            this.close();
        };

        if (nameHasChanged && this.isOriginalCustom) {
            new SaveChoiceModal(this.app, finalName, saveAsNew, renameOriginal).open();
        } else {
            // If it wasn't custom before, or the name hasn't changed, just save/overwrite.
            await this.plugin.saveCustomCompendiumData(fileName, compendiumItem);
            this.onSave(this.convertToInventoryItem());
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
        };

        if (this.tempItem._type === 'weapon') {
            data.tier = this.tempItem.tier || '1';
            data.trait = this.tempItem.trait || 'Strength';
            data.range = this.tempItem.range || 'Melee';
            data.damage = this.tempItem.damage || 'd6';
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
        };

        if (this.tempItem._type === 'weapon') {
            const [damageDice, damageType] = (this.tempItem.damage || 'd6').split(' ');
            return {
                ...base,
                _type: 'weapon',
                tier: parseInt(this.tempItem.tier || '1'),
                trait: this.tempItem.trait || 'Strength',
                range: this.tempItem.range || 'Melee',
                damage: this.tempItem.damage || 'd6',
                burden: this.tempItem.burden || 'One-Handed',
                primaryOrSecondary: this.tempItem.primary_or_secondary || 'Primary',
                damageDice,
                damageType: damageType || 'phy',
                features: this.tempItem.feat_name ? [{ name: this.tempItem.feat_name, description: this.tempItem.feat_text || '' }] : [],
            };
        }

        if (this.tempItem._type === 'armor') {
            const [major, severe] = (this.tempItem.base_thresholds || '1 / 2').split('/').map(s => parseInt(s.trim()));
            return {
                ...base,
                _type: 'armor',
                tier: parseInt(this.tempItem.tier || '1'),
                baseScore: parseInt(this.tempItem.base_score || '1'),
                baseThresholds: { major, severe },
                features: this.tempItem.feat_name ? [{ name: this.tempItem.feat_name, description: this.tempItem.feat_text || '' }] : [],
            };
        }

        if (this.tempItem._type === 'consumable') {
            return {
                ...base,
                _type: 'consumable',
                roll: this.tempItem.roll || '',
            };
        }

        return { ...base, _type: 'item' };
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
        new Setting(this.typeSpecificContainer).setName('Damage').addText(text => text.setPlaceholder('e.g., d8+2 phy').setValue(this.tempItem.damage || '').onChange(v => this.tempItem.damage = v));
        new Setting(this.typeSpecificContainer).setName('Burden').addDropdown(dd => { dd.addOptions({ 'One-Handed': 'One-Handed', 'Two-Handed': 'Two-Handed' }).setValue(this.tempItem.burden || 'One-Handed').onChange(v => this.tempItem.burden = v as any); });
        new Setting(this.typeSpecificContainer).setName('Feature Name').addText(text => text.setValue(this.tempItem.feat_name || '').onChange(v => this.tempItem.feat_name = v));
        new Setting(this.typeSpecificContainer).setName('Feature Text').addTextArea(text => text.setValue(this.tempItem.feat_text || '').onChange(v => this.tempItem.feat_text = v));
    }

    private renderArmorSettings() {
        new Setting(this.typeSpecificContainer).setName('Tier').addText(text => text.setValue(this.tempItem.tier || '1').onChange(v => this.tempItem.tier = v));
        new Setting(this.typeSpecificContainer).setName('Base Armor Score').addText(text => text.setValue(this.tempItem.base_score || '').onChange(v => this.tempItem.base_score = v));
        new Setting(this.typeSpecificContainer).setName('Base Thresholds').addText(text => text.setPlaceholder('e.g., 9 / 23').setValue(this.tempItem.base_thresholds || '').onChange(v => this.tempItem.base_thresholds = v));
        new Setting(this.typeSpecificContainer).setName('Feature Name').addText(text => text.setValue(this.tempItem.feat_name || '').onChange(v => this.tempItem.feat_name = v));
        new Setting(this.typeSpecificContainer).setName('Feature Text').addTextArea(text => text.setValue(this.tempItem.feat_text || '').onChange(v => this.tempItem.feat_text = v));
    }

    onClose() {
        this.contentEl.empty();
    }
}
