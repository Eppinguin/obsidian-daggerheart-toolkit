import { App, Modal, Setting, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { JsonAbility } from '../../types';

export class CreateCardModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSave: (ability: JsonAbility) => void;
    private ability: Partial<JsonAbility>;
    private isEditing: boolean;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onSave: (ability: JsonAbility) => void, abilityToEdit?: JsonAbility) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        // If we're editing, create a copy to avoid modifying the original object until saved.
        this.ability = abilityToEdit ? { ...abilityToEdit } : {};
        this.isEditing = !!abilityToEdit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('dh-create-card-modal');
        contentEl.createEl('h2', { text: this.isEditing ? 'Edit Custom Domain Card' : 'Create Custom Domain Card' });

        new Setting(contentEl)
            .setName('Card Name')
            .setDesc('The name of the feature or ability. This cannot be changed after creation.')
            .addText(text => text
                .setPlaceholder('e.g., Shadow Step')
                .setValue(this.ability.name || '')
                .setDisabled(this.isEditing) // Cannot change the name when editing
                .onChange(value => {
                    if (!this.isEditing) {
                        this.ability.name = value;
                    }
                }));

        new Setting(contentEl)
            .setName('Domain')
            .setDesc('The domain this card belongs to.')
            .addText(text => text
                .setPlaceholder('e.g., Arcana')
                .setValue(this.ability.domain || '')
                .onChange(value => this.ability.domain = value));

        new Setting(contentEl)
            .setName('Level')
            .setDesc('The level required for this card.')
            .addText(text => text
                .setPlaceholder('1')
                .setValue(this.ability.level || '')
                .onChange(value => this.ability.level = value));

        new Setting(contentEl)
            .setName('Type')
            .setDesc('e.g., Action, Reaction, Passive')
            .addText(text => text
                .setPlaceholder('Action')
                .setValue(this.ability.type || '')
                .onChange(value => this.ability.type = value));

        new Setting(contentEl)
            .setName('Recall Cost')
            .setDesc('The Stress cost to move this from Vault to Loadout.')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(this.ability.recall || '')
                .onChange(value => this.ability.recall = value));

        new Setting(contentEl)
            .setName('Description')
            .setDesc('The full text of the card. Markdown is supported.')
            .addTextArea(text => {
                text.setPlaceholder('Enter card description...')
                    .setValue(this.ability.text || '')
                    .onChange(value => this.ability.text = value);
                text.inputEl.rows = 8;
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Save Card')
                .setCta()
                .onClick(() => this.handleSave()));
    }

    private handleSave() {
        if (!this.ability.name || !this.ability.domain || !this.ability.level || !this.ability.text) {
            new Notice('Please fill out all required fields (Name, Domain, Level, Description).');
            return;
        }

        const finalAbility: JsonAbility = {
            name: this.ability.name,
            domain: this.ability.domain,
            level: this.ability.level,
            type: this.ability.type || '',
            recall: this.ability.recall || '0',
            text: this.ability.text,
        };

        this.onSave(finalAbility);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
