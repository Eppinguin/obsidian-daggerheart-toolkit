import { App, Modal, Setting } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import { Character, InventoryItem, ArmorItem, WeaponItem } from '../../types';
import { ConfirmationModal } from './ConfirmationModal';

export class ItemEditModal extends Modal {
    private tempItem: {
        instanceId: string;
        name: string;
        quantity: number;
        description?: string;
        _type: 'item' | 'weapon' | 'armor';
        trait?: string;
        range?: string;
        damage?: string;
        burden?: 'One-Handed' | 'Two-Handed';
        base_thresholds?: string;
        base_score?: string;
    };
    private typeSpecificContainer: HTMLElement;

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
            const { _type, instanceId, name, quantity, description } = item;
            this.tempItem = {
                _type: _type === 'consumable' ? 'item' : _type as 'item' | 'weapon' | 'armor',
                instanceId,
                name,
                quantity,
                description
            };

            if (_type === 'weapon') {
                const weaponItem = item as unknown as { trait: string; range: string; damage: string; burden: string };
                this.tempItem.trait = weaponItem.trait;
                this.tempItem.range = weaponItem.range;
                this.tempItem.damage = weaponItem.damage;
                this.tempItem.burden = weaponItem.burden === 'One-Handed' ? 'One-Handed' : 'Two-Handed';
            } else if (_type === 'armor') {
                const armorItem = item as unknown as { base_thresholds: string; base_score: string };
                this.tempItem.base_thresholds = armorItem.base_thresholds;
                this.tempItem.base_score = armorItem.base_score;
            }
        } else {
            this.tempItem = {
                instanceId: uuidv4(),
                name: '',
                _type: 'item',
                quantity: 1
            };
        }

    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.item ? `Edit ${this.item.name}` : 'Add Custom Item' });

        new Setting(contentEl).setName('Name').addText(text => {
            text.setValue(this.tempItem.name || '').onChange(val => this.tempItem.name = val);
        });

        new Setting(contentEl).setName('Quantity').addText(text => {
            text.setValue(String(this.tempItem.quantity || 1)).onChange(val => {
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
                .setValue(this.tempItem._type || 'item')
                .onChange(val => {
                    this.tempItem._type = val as 'item' | 'weapon' | 'armor';
                    this.renderTypeSpecificSettings();
                });
        });

        this.typeSpecificContainer = contentEl.createDiv();
        this.renderTypeSpecificSettings();

        const footer = new Setting(contentEl);
        if (this.onDelete && this.item) {
            footer.addButton(btn => btn
                .setButtonText('Delete')
                .setWarning()
                .onClick(() => {
                    new ConfirmationModal(this.app, 'Are you sure you want to delete this item?', async () => {
                        this.onDelete?.();
                        this.close();
                    }).open();
                }));
        }

        footer.addButton(btn => btn
            .setButtonText('Save')
            .setCta()
            .onClick(() => {
                this.onSave(this.tempItem as InventoryItem);
                this.close();
            }));
    }

    private renderTypeSpecificSettings() {
        this.typeSpecificContainer.empty();

        if (this.tempItem._type === 'weapon') {
            this.renderWeaponSettings();
        } else if (this.tempItem._type === 'armor') {
            this.renderArmorSettings();
        }
    }

    private renderWeaponSettings() {
        new Setting(this.typeSpecificContainer)
            .setName('Weapon Trait')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---')
                    .addOption('Strength', 'Strength')
                    .addOption('Agility', 'Agility')
                    .addOption('Finesse', 'Finesse')
                    .addOption('Instinct', 'Instinct')
                    .addOption('Presence', 'Presence')
                    .addOption('Knowledge', 'Knowledge')
                    .setValue(this.tempItem.trait || '')
                    .onChange(value => {
                        if (this.tempItem._type === 'weapon') {
                            this.tempItem.trait = value;
                        }
                    });
            });

        new Setting(this.typeSpecificContainer)
            .setName('Range')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---')
                    .addOption('Melee', 'Melee')
                    .addOption('Very Close', 'Very Close')
                    .addOption('Close', 'Close')
                    .addOption('Far', 'Far')
                    .addOption('Very Far', 'Very Far')
                    .setValue(this.tempItem.range || '')
                    .onChange(value => {
                        if (this.tempItem._type === 'weapon') {
                            this.tempItem.range = value;
                        }
                    });
            });

        new Setting(this.typeSpecificContainer)
            .setName('Damage')
            .addText(text => {
                text.setValue(this.tempItem.damage || '')
                    .setPlaceholder('e.g., d8+2 phy')
                    .onChange(value => {
                        if (this.tempItem._type === 'weapon') {
                            this.tempItem.damage = value;
                        }
                    });
            });

        new Setting(this.typeSpecificContainer)
            .setName('Burden')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---')
                    .addOption('One-Handed', 'One-Handed')
                    .addOption('Two-Handed', 'Two-Handed')
                    .setValue(this.tempItem.burden || '')
                    .onChange(value => {
                        if (this.tempItem._type === 'weapon' && (value === 'One-Handed' || value === 'Two-Handed')) {
                            this.tempItem.burden = value;
                        }
                    });
            });
    }

    private renderArmorSettings() {
        new Setting(this.typeSpecificContainer)
            .setName('Base Thresholds')
            .addText(text => {
                text.setValue(this.tempItem.base_thresholds || '')
                    .setPlaceholder('e.g., 9/23')
                    .onChange(value => {
                        if (this.tempItem._type === 'armor') {
                            this.tempItem.base_thresholds = value;
                        }
                    });
            });

        new Setting(this.typeSpecificContainer)
            .setName('Base Score')
            .addText(text => {
                text.setValue(this.tempItem.base_score || '')
                    .setPlaceholder('e.g., 5')
                    .onChange(value => {
                        if (this.tempItem._type === 'armor') {
                            this.tempItem.base_score = value;
                        }
                    });
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
