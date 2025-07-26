import { App, Modal, Setting, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { JsonAbility } from '../types';
import { SaveChoiceModal } from './SaveChoiceModal';

export class CreateCardModal extends Modal {
    private ability: Partial<JsonAbility>;
    private originalName: string;
    private isOriginalCustom: boolean;
    private effects: string = '';

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private onComplete: (ability: JsonAbility, oldName?: string) => void,
        abilityToEdit?: JsonAbility
    ) {
        super(app);
        this.ability = abilityToEdit ? { ...abilityToEdit } : {};
        this.originalName = abilityToEdit?.name || '';
        this.isOriginalCustom = !!abilityToEdit?.isCustom;
        this.effects = (abilityToEdit?.effects || []).join('\n');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('dh-create-card-modal');
        const isEditing = !!this.originalName;
        contentEl.createEl('h2', { text: isEditing ? 'Edit Custom Domain Card' : 'Create Custom Domain Card' });

        new Setting(contentEl)
            .setName('Card Name')
            .addText(text => text
                .setPlaceholder('e.g., Shadow Step')
                .setValue(this.ability.name || '')
                .onChange(value => {
                    this.ability.name = value;
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
            .setDesc('e.g., Ability, Grimoire, Spell')
            .addText(text => text
                .setPlaceholder('Ability')
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
            .setName('Effects')
            .setDesc('Define mechanical effects, one per line. e.g., "Evasion + 1"')
            .addTextArea(text => {
                text.setPlaceholder('Evasion + 1\nHP Max + 5 when Hope > 0')
                    .setValue(this.effects)
                    .onChange(value => this.effects = value);
                text.inputEl.rows = 4;
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Save Card')
                .setCta()
                .onClick(() => this.handleSave()));
    }

    private async handleSave() {
        const finalName = this.ability.name?.trim();
        if (!finalName || !this.ability.domain || !this.ability.level || !this.ability.text) {
            new Notice('Please fill out all required fields (Name, Domain, Level, Description).');
            return;
        }

        const finalAbility: JsonAbility = {
            name: finalName,
            domain: this.ability.domain,
            level: this.ability.level,
            type: this.ability.type || '',
            recall: this.ability.recall || '0',
            text: this.ability.text,
            isCustom: true,
            effects: this.effects.split('\n').map(e => e.trim()).filter(e => e),
        };

        const nameHasChanged = finalName !== this.originalName;
        const fileName = 'user-abilities.json';

        const saveAsNew = async () => {
            await this.plugin.saveCustomCompendiumData(fileName, finalAbility);
            this.onComplete(finalAbility, this.originalName);
            this.close();
        };

        const renameOriginal = async () => {
            await this.plugin.renameCustomCompendiumEntry(fileName, this.originalName, finalAbility);
            this.onComplete(finalAbility, this.originalName);
            this.close();
        };

        if (nameHasChanged && this.isOriginalCustom) {
            new SaveChoiceModal(this.app, finalName, saveAsNew, renameOriginal).open();
        } else {
            await this.plugin.saveCustomCompendiumData(fileName, finalAbility);
            this.onComplete(finalAbility, this.originalName);
            this.close();
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}