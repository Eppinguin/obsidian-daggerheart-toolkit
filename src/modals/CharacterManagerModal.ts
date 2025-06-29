import { App, Modal, Setting } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { Character } from '../../types';
import { createAvatarEditor } from '../views/components/AvatarEditor';

export class CharacterManagerModal extends Modal {
    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private character: Character,
        private onSave: (updatedChar: Character) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Edit ${this.character.name}` });

        // Name
        new Setting(contentEl)
            .setName('Character Name')
            .addText(text => text
                .setValue(this.character.name)
                .onChange(value => this.character.name = value));

        // Pronouns
        new Setting(contentEl)
            .setName('Subject Pronoun')
            .addText(text => text
                .setValue(this.character.pronouns.subject)
                .onChange(value => this.character.pronouns.subject = value));

        new Setting(contentEl)
            .setName('Object Pronoun')
            .addText(text => text
                .setValue(this.character.pronouns.object)
                .onChange(value => this.character.pronouns.object = value));

        // Avatar Section
        contentEl.createEl('h3', { text: 'Character Avatar' });
        contentEl.createEl('p', { text: 'Add an avatar image for your character. This is optional.' });

        createAvatarEditor(
            contentEl,
            this.character.avatarUrl || '',
            this.character.avatarTransform,
            (newUrl) => this.character.avatarUrl = newUrl,
            (newTransform) => this.character.avatarTransform = newTransform
        );

        // Save Button
        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save Changes')
                .setCta()
                .onClick(() => {
                    this.onSave(this.character);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
