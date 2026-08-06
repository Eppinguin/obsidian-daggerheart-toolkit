import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import { Condition } from '../types';
import { CONDITION_COLORS } from '../constants';

export class CustomConditionModal extends Modal {
    onSubmit: (condition: Condition) => void;

    constructor(app: App, onSubmit: (condition: Condition) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-name-modal');
        contentEl.createEl('h2', { text: 'Add Custom Condition' });

        let name = '';
        let description = '';
        let color = '';

        new Setting(contentEl)
            .setName('Condition Name')
            .addText((text) => text.setPlaceholder('e.g., On Fire').onChange((value) => (name = value.trim())));

        new Setting(contentEl)
            .setName('Description')
            .addTextArea((text) =>
                text
                    .setPlaceholder('e.g., Takes 1 damage at the start of its turn.')
                    .onChange((value) => (description = value.trim())),
            );

        new Setting(contentEl)
            .setName('Colour')
            .setDesc('Colour-coded conditions are easier to read at a glance during play.')
            .addDropdown((dropdown) => {
                dropdown.addOption('', 'Neutral');
                CONDITION_COLORS.forEach((c) => dropdown.addOption(c, c[0].toUpperCase() + c.slice(1)));
                dropdown.setValue('').onChange((value) => (color = value));
            });

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText('Add')
            .setCta()
            .onClick(() => {
                if (!name) {
                    new Notice('Condition name is required.');
                    return;
                }
                this.onSubmit({
                    name,
                    description,
                    isCustom: true,
                    ...(color ? { color } : {}),
                });
                this.close();
            });
        new ButtonComponent(buttonContainer).setButtonText('Cancel').onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
