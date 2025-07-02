// src/modals/ImportCharacterModal.ts
import { App, Modal, Setting, Notice, TextAreaComponent, ButtonComponent, TextComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { Character } from '../../types';
import { importFromJsonString, isValidCharacterData, fetchJsonFromUrl } from '../services/export-import';
import { v4 as uuidv4 } from 'uuid';

/**
 * Modal for importing a character from JSON
 */
export class ImportCharacterModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private textAreaComponent: TextAreaComponent;
    private fileInputEl: HTMLInputElement;
    private urlInputComponent: TextComponent;
    private importButtonEl: HTMLButtonElement;
    private isLoading: boolean = false;

    constructor(app: App, plugin: DaggerheartStatblockPlugin) {
        super(app);
        this.plugin = plugin;
        this.modalEl.addClass('dh-import-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Import Character' });

        // Instructions
        contentEl.createEl('p', {
            text: 'Import a character from a JSON file, URL, or paste JSON directly.'
        });

        // File upload section
        new Setting(contentEl)
            .setName('Upload JSON File')
            .setDesc('Select a character JSON file to import')
            .then(setting => {
                this.fileInputEl = document.createElement('input');
                this.fileInputEl.type = 'file';
                this.fileInputEl.accept = '.json';
                this.fileInputEl.style.display = 'none';

                setting.controlEl.appendChild(this.fileInputEl);

                const uploadButtonEl = document.createElement('button');
                uploadButtonEl.textContent = 'Choose File';
                uploadButtonEl.className = 'mod-cta';
                setting.controlEl.appendChild(uploadButtonEl);

                uploadButtonEl.addEventListener('click', () => {
                    this.fileInputEl.click();
                });

                this.fileInputEl.addEventListener('change', () => {
                    if (this.fileInputEl.files && this.fileInputEl.files.length > 0) {
                        const file = this.fileInputEl.files[0];
                        const reader = new FileReader();

                        reader.onload = (e: ProgressEvent<FileReader>) => {
                            if (e.target && typeof e.target.result === 'string') {
                                this.textAreaComponent.setValue(e.target.result);
                            }
                        };

                        reader.readAsText(file);
                    }
                });
            });

        // Import from URL section
        new Setting(contentEl)
            .setName('Import from URL')
            .setDesc('Enter a URL to a raw JSON file (Pastebin, GitHub, etc.)')
            .then(setting => {
                const urlContainer = setting.controlEl.createDiv({ cls: 'url-input-container' });

                this.urlInputComponent = new TextComponent(urlContainer);
                this.urlInputComponent
                    .setPlaceholder('https://pastebin.com/raw/...')
                    .setValue('');

                const fetchButton = new ButtonComponent(urlContainer);
                fetchButton
                    .setButtonText('Fetch')
                    .setCta()
                    .onClick(async () => {
                        const url = this.urlInputComponent.getValue().trim();
                        if (!url) {
                            new Notice('Please enter a URL');
                            return;
                        }

                        try {
                            this.setLoading(true);
                            const jsonText = await fetchJsonFromUrl(url);
                            this.textAreaComponent.setValue(jsonText);
                            new Notice('Successfully fetched data from URL');
                        } catch (error) {
                            console.error('Error fetching from URL:', error);
                            new Notice(`Failed to fetch data: ${error.message}`);
                        } finally {
                            this.setLoading(false);
                        }
                    });
            });

        // URL examples
        const examplesDiv = contentEl.createDiv({ cls: 'dh-url-examples' });
        examplesDiv.createEl('p', {
            text: 'Supported URL formats:',
            cls: 'dh-examples-title'
        });

        const exampleList = examplesDiv.createEl('ul');
        exampleList.createEl('li', {
            text: 'Pastebin: https://pastebin.com/xyz or https://pastebin.com/raw/xyz'
        });
        exampleList.createEl('li', {
            text: 'GitHub: https://github.com/user/repo/blob/main/file.json'
        });
        exampleList.createEl('li', {
            text: 'GitHub Gist: https://gist.github.com/user/gistid'
        });
        exampleList.createEl('li', {
            text: 'Any direct URL to a JSON file'
        });

        // Paste JSON section
        new Setting(contentEl)
            .setName('Paste JSON')
            .setDesc('Paste character JSON data')
            .then(setting => {
                this.textAreaComponent = new TextAreaComponent(setting.controlEl);
                this.textAreaComponent
                    .setPlaceholder('Paste character JSON here...')
                    .setValue('')
                    .then(component => {
                        component.inputEl.style.width = '100%';
                        component.inputEl.style.height = '200px';
                        component.inputEl.style.minHeight = '200px';
                    });
            });

        // Import button
        new Setting(contentEl)
            .addButton(button => {
                this.importButtonEl = button.setButtonText('Import Character')
                    .setCta()
                    .onClick(() => this.importCharacter())
                    .buttonEl;
                return button;
            });

        // Close button
        const footerEl = contentEl.createDiv('modal-footer');
        new ButtonComponent(footerEl)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }

    private async importCharacter() {
        const jsonText = this.textAreaComponent.getValue();
        if (!jsonText) {
            new Notice('Please enter JSON data to import.');
            return;
        }

        try {
            this.setLoading(true);

            const importData = importFromJsonString<Character>(jsonText);

            if (!importData) {
                new Notice('Invalid import data format.');
                this.setLoading(false);
                return;
            }

            if (importData.type !== 'character') {
                new Notice(`Expected character data but found ${importData.type} data.`);
                this.setLoading(false);
                return;
            }

            const characterData = importData.data;

            if (!isValidCharacterData(characterData)) {
                new Notice('Invalid character data.');
                this.setLoading(false);
                return;
            }

            // Generate a new ID to avoid collisions
            const existingIds = this.plugin.getCharacters().map(c => c.id);
            const originalId = characterData.id;

            // Check if character with same name already exists
            const existingWithSameName = this.plugin.getCharacters().find(c =>
                c.name.toLowerCase() === characterData.name.toLowerCase() && c.id !== originalId);

            if (existingWithSameName) {
                // Rename the imported character by adding " (Imported)" to the name
                characterData.name = `${characterData.name} (Imported)`;
            }

            // Always generate a new ID for imported characters
            characterData.id = uuidv4();

            // Save the character
            await this.plugin.updateCharacter(characterData);
            await this.plugin.setActiveCharacterId(characterData.id);

            new Notice(`Character "${characterData.name}" imported successfully!`);
            this.setLoading(false);
            this.close();

        } catch (error) {
            console.error('Error importing character:', error);
            new Notice('Failed to import character. See console for details.');
            this.setLoading(false);
        }
    }

    /**
     * Set the loading state and update the UI accordingly
     */
    private setLoading(loading: boolean) {
        this.isLoading = loading;

        if (this.importButtonEl) {
            if (loading) {
                this.importButtonEl.textContent = 'Loading...';
                this.importButtonEl.disabled = true;
            } else {
                this.importButtonEl.textContent = 'Import Character';
                this.importButtonEl.disabled = false;
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
