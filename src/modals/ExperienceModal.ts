// src/modals/ExperienceModal.ts
import { App, Modal, Setting } from 'obsidian';
import { Character, Experience } from '../../types';

export class ExperienceModal extends Modal {
    private experienceName: string = '';
    private experienceValue: number = 2; // Default to +2 as per rules for new experiences

    constructor(
        app: App,
        private character: Character,
        private onSave: (character: Character) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add Experience' });

        new Setting(contentEl)
            .setName('Experience Name')
            .addText(text => text
                .setPlaceholder('e.g., Wilderness Survival')
                .onChange(value => this.experienceName = value));

        new Setting(contentEl)
            .setName('Value')
            .addText(text => text
                .setPlaceholder('e.g., 2')
                .setValue(String(this.experienceValue))
                .onChange(value => {
                    const parsedValue = parseInt(value);
                    if (!isNaN(parsedValue)) {
                        this.experienceValue = parsedValue;
                    }
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    if (!this.experienceName) {
                        return; // Don't save empty experiences
                    }
                    const experience: Experience = {
                        _type: 'experience',
                        id: Date.now().toString(),
                        name: this.experienceName,
                        value: this.experienceValue
                    };
                    this.character.experiences = [...(this.character.experiences || []), experience];
                    this.onSave(this.character);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
