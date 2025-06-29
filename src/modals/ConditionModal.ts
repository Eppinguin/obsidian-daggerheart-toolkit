import { App, Modal, Setting } from 'obsidian';
import { Character, Condition } from '../../types';
import { DAGGERHEART_CONDITIONS } from '../constants';

export class ConditionModal extends Modal {
    private selectedCondition: string = '';
    private customCondition: string = '';
    private rounds: number = 0;

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
        contentEl.createEl('h2', { text: 'Add Condition' });

        new Setting(contentEl)
            .setName('Condition')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                dd.addOption('custom', '- Custom Condition -');
                DAGGERHEART_CONDITIONS.forEach(c => dd.addOption(c.toString(), c.toString()));
                dd.onChange(value => {
                    this.selectedCondition = value;
                    this.customCondition = '';
                });
            });

        new Setting(contentEl)
            .setName('Custom Condition')
            .addText(text => text
                .setPlaceholder('Enter custom condition')
                .onChange(value => this.customCondition = value));

        new Setting(contentEl)
            .setName('Duration (rounds)')
            .addText(text => text
                .setPlaceholder('0 for permanent')
                .setValue('0')
                .onChange(value => this.rounds = parseInt(value) || 0));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    const condition = {
                        name: this.selectedCondition === 'custom' ? this.customCondition : this.selectedCondition,
                        description: '',
                        duration: this.rounds || 0
                    };
                    this.character.conditions = [...(this.character.conditions || []), condition];
                    this.onSave(this.character);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
