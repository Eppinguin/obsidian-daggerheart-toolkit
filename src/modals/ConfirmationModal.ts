import { App, Modal, Setting } from 'obsidian';

export class ConfirmationModal extends Modal {
    constructor(
        app: App,
        private message: string,
        private onConfirm: () => Promise<void>
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('p', { text: this.message });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Confirm')
                .setCta()
                .onClick(async () => {
                    await this.onConfirm();
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
