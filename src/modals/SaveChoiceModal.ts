// src/modals/SaveChoiceModal.ts

import { App, Modal, ButtonComponent } from 'obsidian';

export class SaveChoiceModal extends Modal {
    constructor(
        app: App,
        private newName: string,
        private onSaveAsNew: () => void,
        private onRename?: () => void, // Rename is optional
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Name Changed' });
        contentEl.createEl('p', {
            text: `You have changed the item's name to "${this.newName}". How would you like to save it?`,
        });

        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });

        // This option is always available
        new ButtonComponent(buttonContainer)
            .setButtonText('Save as New Copy')
            .setTooltip(`Creates a new entry named "${this.newName}" and leaves the original untouched.`)
            .setCta()
            .onClick(() => {
                this.onSaveAsNew();
                this.close();
            });

        // Only show the "Rename" option if the callback was provided (i.e., for custom items)
        if (this.onRename) {
            new ButtonComponent(buttonContainer)
                .setButtonText('Rename Original')
                .setTooltip('Updates the original custom item with the new name and data.')
                .onClick(() => {
                    this.onRename!();
                    this.close();
                });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
