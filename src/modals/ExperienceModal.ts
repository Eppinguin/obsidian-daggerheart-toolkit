import { App, Modal, Setting } from 'obsidian';
import { Character, Experience } from '../../types';

export class ExperienceModal extends Modal {
    private experienceName: string = '';
    private description: string = '';

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
            .setName('Description')
            .addTextArea(text => text
                .setPlaceholder('Describe the experience...')
                .onChange(value => this.description = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    const experience: Experience = {
                        _type: 'experience',
                        id: Date.now().toString(),
                        name: this.experienceName,
                        description: this.description,
                        value: 2
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
