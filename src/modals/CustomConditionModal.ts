import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import { Condition } from '../../types';

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
        contentEl.createEl("h2", { text: "Add Custom Condition" });

        let name = '';
        let description = '';

        new Setting(contentEl)
            .setName("Condition Name")
            .addText(text => text.setPlaceholder("e.g., On Fire")
                .onChange(value => name = value.trim()));

        new Setting(contentEl)
            .setName("Description")
            .addTextArea(text => text.setPlaceholder("e.g., Takes 1 damage at the start of its turn.")
                .onChange(value => description = value.trim()));

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText("Add")
            .setCta()
            .onClick(() => {
                if (!name) {
                    new Notice("Condition name is required.");
                    return;
                }
                this.onSubmit({ name, description });
                this.close();
            });
        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
