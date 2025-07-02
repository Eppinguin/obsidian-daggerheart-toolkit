import { App, Modal, Setting } from 'obsidian';
import { Character } from '../../types';

export class GoldModal extends Modal {
    private goldHandfuls: number = 0;
    private goldBags: number = 0;
    private goldChests: number = 0;

    constructor(
        app: App,
        private character: Character,
        private onSave: (character: Character) => void
    ) {
        super(app);
        this.goldHandfuls = this.character.gold?.handfuls || 0;
        this.goldBags = this.character.gold?.bags || 0;
        this.goldChests = this.character.gold?.chests || 0;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Modify Gold' });

        new Setting(contentEl)
            .setName('Chests of Gold')
            .addText(text => text
                .setValue(String(this.goldChests))
                .onChange(value => {
                    this.goldChests = parseInt(value) || 0;
                }));

        new Setting(contentEl)
            .setName('Bags of Gold')
            .addText(text => text
                .setValue(String(this.goldBags))
                .onChange(value => {
                    this.goldBags = parseInt(value) || 0;
                }));

        new Setting(contentEl)
            .setName('Handfuls of Gold')
            .addText(text => text
                .setValue(String(this.goldHandfuls))
                .onChange(value => {
                    this.goldHandfuls = parseInt(value) || 0;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    // Convert currency values, handling overflow
                    this.goldBags += Math.floor(this.goldHandfuls / 10);
                    this.goldHandfuls %= 10;
                    this.goldChests += Math.floor(this.goldBags / 10);
                    this.goldBags %= 10;

                    // Update character gold with correct type
                    this.character.gold = {
                        _type: 'gold',
                        handfuls: this.goldHandfuls,
                        bags: this.goldBags,
                        chests: this.goldChests
                    };
                    this.onSave(this.character);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
