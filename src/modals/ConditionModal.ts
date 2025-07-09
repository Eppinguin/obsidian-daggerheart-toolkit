import { App, Modal, Setting, Notice } from 'obsidian';
import { Character, Condition } from '../types';
import { DAGGERHEART_CONDITIONS } from '../constants';

export class ConditionModal extends Modal {
    character: Character;
    onSave: (character: Character) => void;

    constructor(app: App, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.character = character;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add Condition' });
        contentEl.createEl('h3', { text: 'Select Condition' });
        const predefinedContainer = contentEl.createDiv({ cls: 'dh-predefined-conditions-container' });
        DAGGERHEART_CONDITIONS.forEach(condition => {
            const isApplied = this.character.conditions?.some(c => c.name === condition.name);
            if (!isApplied) {
                const card = predefinedContainer.createDiv({ cls: 'dh-condition-card' });
                card.createEl('strong', { text: condition.name });
                card.createEl('p', { text: condition.description });
                card.addEventListener('click', () => {
                    if (!this.character.conditions) {
                        this.character.conditions = [];
                    }
                    this.character.conditions.push(condition);
                    this.onSave(this.character);
                    this.close();
                });
            }
        });

        contentEl.createEl('h3', { text: 'Add Custom Condition' });
        let customName = '';
        let customDesc = '';
        new Setting(contentEl)
            .setName('Name')
            .addText(text => text.onChange(value => customName = value.trim()));
        new Setting(contentEl)
            .setName('Description (Optional)')
            .addTextArea(text => text.onChange(value => customDesc = value.trim()));
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Add Custom')
                .setCta()
                .onClick(() => {
                    if (customName) {
                        if (!this.character.conditions) {
                            this.character.conditions = [];
                        }
                        if (this.character.conditions.some(c => c.name.toLowerCase() === customName.toLowerCase())) {
                            new Notice(`Condition "${customName}" already exists.`);
                            return;
                        }
                        this.character.conditions.push({ name: customName, description: customDesc });
                        this.onSave(this.character);
                        this.close();
                    } else {
                        new Notice('Please provide a name for the custom condition.');
                    }
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
