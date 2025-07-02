// src/modals/ExportCharacterModal.ts
import { App, Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { Character } from '../../types';
import { exportToJsonString, copyToClipboard, saveToFile } from '../services/export-import';

/**
 * Modal for exporting a character to JSON
 */
export class ExportCharacterModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private character: Character;
    private exportJsonStr: string;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.exportJsonStr = exportToJsonString('character', character);
        this.modalEl.addClass('dh-export-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: `Export Character: ${this.character.name}` });

        // Instructions
        contentEl.createEl('p', {
            text: `Choose how you'd like to export ${this.character.name}.`
        });

        // Copy to clipboard option
        new Setting(contentEl)
            .setName('Copy to Clipboard')
            .setDesc('Copy character data as JSON to your clipboard')
            .addButton(button => button
                .setButtonText('Copy to Clipboard')
                .onClick(async () => {
                    try {
                        await copyToClipboard(this.exportJsonStr);
                        new Notice('Character data copied to clipboard!');
                    } catch (err) {
                        new Notice('Failed to copy to clipboard. See console for details.');
                    }
                }));

        // Export to file option
        new Setting(contentEl)
            .setName('Save to File')
            .setDesc('Download character data as a JSON file')
            .addButton(button => button
                .setButtonText('Download JSON')
                .onClick(async () => {
                    const safeFilename = this.character.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const filename = `daggerheart_character_${safeFilename}.json`;
                    try {
                        await saveToFile(filename, this.exportJsonStr);
                        new Notice(`Character saved as ${filename}`);
                    } catch (err) {
                        new Notice('Failed to save file. See console for details.');
                    }
                }));

        // Preview section
        contentEl.createEl('h3', { text: 'Preview' });
        const previewEl = contentEl.createEl('pre', { cls: 'dh-export-preview' });
        previewEl.createEl('code', { text: this.exportJsonStr });

        // Close button
        const footerEl = contentEl.createDiv('modal-footer');
        new ButtonComponent(footerEl)
            .setButtonText('Close')
            .onClick(() => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
