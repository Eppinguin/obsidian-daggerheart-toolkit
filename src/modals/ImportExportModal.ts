// src/modals/ImportExportModal.ts
import { App, Modal, Setting, Notice, TextAreaComponent, ButtonComponent, TextComponent, DropdownComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { ContentType, ContentTypeInfo, CONTENT_TYPE_INFO, ExportedData, exportToJsonString, copyToClipboard, saveToFile, importFromJsonString, fetchJsonFromUrl } from '../services/export-import';
import { isValidCharacterData, isValidContentData, isValidEncounterData } from '../services/content-validators';
import { v4 as uuidv4 } from 'uuid';
import { Character, SavedEncounter } from '../../types';

/**
 * Modal for unified import/export of all content types
 */
export class ImportExportModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private mode: 'import' | 'export';
    private contentType: ContentType;
    private contentTypeInfo: ContentTypeInfo;
    private contentId: string | null = null;

    // Import-specific properties
    private textAreaComponent: TextAreaComponent | null = null;
    private fileInputEl: HTMLInputElement | null = null;
    private urlInputComponent: TextComponent | null = null;
    private importButtonEl: HTMLButtonElement | null = null;

    // Export-specific properties
    private exportJsonStr: string = '';
    private contentSelection: DropdownComponent | null = null;
    private selectedContentId: string | null = null;

    // Shared state
    private isLoading: boolean = false;

    constructor(
        app: App,
        plugin: DaggerheartStatblockPlugin,
        mode: 'import' | 'export' = 'import',
        contentType: ContentType = ContentType.CHARACTER,
        contentId: string | null = null
    ) {
        super(app);
        this.plugin = plugin;
        this.mode = mode;
        this.contentType = contentType;
        this.contentTypeInfo = CONTENT_TYPE_INFO[contentType];
        this.contentId = contentId;
        this.modalEl.addClass('dh-import-export-modal');
        this.modalEl.addClass(`dh-${mode}-modal`);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        const title = this.mode === 'import'
            ? `Import ${this.contentTypeInfo.displayName}`
            : `Export ${this.contentTypeInfo.displayName}`;

        contentEl.createEl('h2', { text: title });

        // Content type selector
        this.renderContentTypeSelector(contentEl);

        if (this.mode === 'import') {
            this.renderImportUI(contentEl);
        } else {
            this.renderExportUI(contentEl);
        }

        // Close button
        const footerEl = contentEl.createDiv('modal-footer');
        new ButtonComponent(footerEl)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }

    /**
     * Render the content type selector dropdown
     */
    private renderContentTypeSelector(contentEl: HTMLElement) {
        const contentTypeSection = new Setting(contentEl)
            .setName('Content Type')
            .setDesc('Select what type of content to import or export');

        const dropdown = new DropdownComponent(contentTypeSection.controlEl);

        // Add options for each content type
        Object.values(ContentType).forEach(type => {
            const info = CONTENT_TYPE_INFO[type];
            dropdown.addOption(type, info.displayName);
        });

        dropdown.setValue(this.contentType);
        dropdown.onChange(value => {
            this.contentType = value as ContentType;
            this.contentTypeInfo = CONTENT_TYPE_INFO[this.contentType];

            // Re-render the UI for the new content type
            contentEl.empty();
            this.onOpen();
        });

        // For compendium entries, add a note that only custom entries are shown
        if (this.mode === 'export' &&
            this.contentType !== ContentType.CHARACTER &&
            this.contentType !== ContentType.ENCOUNTER) {
            contentEl.createEl('p', {
                text: 'Note: Only custom entries (items you created) are available for export.',
                cls: 'dh-info-message'
            });
        }
    }

    /**
     * Render the import UI
     */
    private renderImportUI(contentEl: HTMLElement) {
        // Instructions
        contentEl.createEl('p', {
            text: `Import a ${this.contentTypeInfo.displayName.toLowerCase()} from a JSON file, URL, or paste JSON directly.`
        });

        // File upload section
        new Setting(contentEl)
            .setName('Upload JSON File')
            .setDesc(`Select a ${this.contentTypeInfo.displayName.toLowerCase()} JSON file to import`)
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
                    this.fileInputEl?.click();
                });

                this.fileInputEl.addEventListener('change', () => {
                    if (this.fileInputEl?.files && this.fileInputEl.files.length > 0) {
                        const file = this.fileInputEl.files[0];
                        const reader = new FileReader();

                        reader.onload = (e: ProgressEvent<FileReader>) => {
                            if (e.target && typeof e.target.result === 'string') {
                                this.textAreaComponent?.setValue(e.target.result);
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
                        const url = this.urlInputComponent?.getValue().trim();
                        if (!url) {
                            new Notice('Please enter a URL');
                            return;
                        }

                        try {
                            this.setLoading(true);
                            const jsonText = await fetchJsonFromUrl(url);
                            this.textAreaComponent?.setValue(jsonText);
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
            .setDesc(`Paste ${this.contentTypeInfo.displayName.toLowerCase()} JSON data`)
            .then(setting => {
                this.textAreaComponent = new TextAreaComponent(setting.controlEl);
                this.textAreaComponent
                    .setPlaceholder(`Paste ${this.contentTypeInfo.displayName.toLowerCase()} JSON here...`)
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
                this.importButtonEl = button.setButtonText(`Import ${this.contentTypeInfo.displayName}`)
                    .setCta()
                    .onClick(() => this.importContent())
                    .buttonEl;
                return button;
            });
    }

    /**
     * Render the export UI
     */
    private renderExportUI(contentEl: HTMLElement) {
        // Instructions
        contentEl.createEl('p', {
            text: `Choose ${this.contentTypeInfo.displayName.toLowerCase()} to export.`
        });

        // Content selection (only shown if contentId is not provided)
        if (!this.contentId) {
            this.renderContentSelectionDropdown(contentEl);
        }

        // Only show export options if we have content to export
        if (this.contentId || this.selectedContentId) {
            const effectiveContentId = this.contentId || this.selectedContentId;
            if (effectiveContentId) {
                this.prepareExportData(effectiveContentId);

                // Copy to clipboard option
                new Setting(contentEl)
                    .setName('Copy to Clipboard')
                    .setDesc(`Copy ${this.contentTypeInfo.displayName.toLowerCase()} data as JSON to your clipboard`)
                    .addButton(button => button
                        .setButtonText('Copy to Clipboard')
                        .onClick(async () => {
                            try {
                                await copyToClipboard(this.exportJsonStr);
                                new Notice(`${this.contentTypeInfo.displayName} data copied to clipboard!`);
                            } catch (err) {
                                new Notice('Failed to copy to clipboard. See console for details.');
                            }
                        }));

                // Export to file option
                new Setting(contentEl)
                    .setName('Save to File')
                    .setDesc(`Download ${this.contentTypeInfo.displayName.toLowerCase()} data as a JSON file`)
                    .addButton(button => button
                        .setButtonText('Download JSON')
                        .onClick(async () => {
                            // Get the content name for the filename
                            let safeName = 'export';

                            if (this.contentType === ContentType.CHARACTER) {
                                const character = this.plugin.getCharacters().find(c => c.id === effectiveContentId);
                                if (character) {
                                    safeName = character.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                }
                            }

                            const filename = `daggerheart_${this.contentType}_${safeName}.json`;
                            try {
                                await saveToFile(filename, this.exportJsonStr);
                                new Notice(`${this.contentTypeInfo.displayName} saved as ${filename}`);
                            } catch (err) {
                                new Notice('Failed to save file. See console for details.');
                            }
                        }));

                // Preview section is created by updateExportPreview
                this.updateExportPreview(contentEl);
            }
        } else {
            contentEl.createEl('p', {
                text: `Please select a ${this.contentTypeInfo.displayName.toLowerCase()} to export.`,
                cls: 'dh-empty-message'
            });
        }
    }

    /**
     * Render dropdown to select which content item to export
     */
    private renderContentSelectionDropdown(contentEl: HTMLElement) {
        const contentSelectSection = new Setting(contentEl)
            .setName(`Select ${this.contentTypeInfo.displayName}`)
            .setDesc(`Choose which ${this.contentTypeInfo.displayName.toLowerCase()} to export`);

        this.contentSelection = new DropdownComponent(contentSelectSection.controlEl);

        // Add placeholder option
        this.contentSelection.addOption('', `Select ${this.contentTypeInfo.displayName}...`);

        // Add content options based on type
        if (this.contentType === ContentType.CHARACTER) {
            const characters = this.plugin.getCharacters();
            characters.forEach(character => {
                this.contentSelection?.addOption(character.id, character.name);
            });

            // Set active character as default if available
            const activeCharId = this.plugin.getActiveCharacterId();
            if (activeCharId && characters.some(c => c.id === activeCharId)) {
                this.contentSelection?.setValue(activeCharId);
                this.selectedContentId = activeCharId;
                this.prepareExportData(activeCharId);
            }
        }
        else if (this.contentType === ContentType.ENCOUNTER) {
            const encounters = this.plugin.getSavedEncounters();
            if (encounters.length === 0) {
                contentEl.createEl('p', {
                    text: 'No saved encounters found.',
                    cls: 'dh-empty-message'
                });
            } else {
                encounters.forEach(encounter => {
                    this.contentSelection?.addOption(encounter.id, encounter.name);
                });

                // Set first encounter as default
                if (encounters.length > 0) {
                    this.contentSelection?.setValue(encounters[0].id);
                    this.selectedContentId = encounters[0].id;
                    this.prepareExportData(encounters[0].id);
                }
            }
        }
        else {
            // Add support for other content types
            if (this.contentType === ContentType.ADVERSARY) {
                const adversaries = this.plugin.compendium.statblocks
                    .filter(s => s.category === 'adversary' && s.isCustom === true);

                if (adversaries.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom adversaries found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    adversaries.forEach(adversary => {
                        this.contentSelection?.addOption(adversary.name, adversary.name);
                    });

                    // Set first item as default
                    if (adversaries.length > 0) {
                        this.contentSelection?.setValue(adversaries[0].name);
                        this.selectedContentId = adversaries[0].name;
                        this.prepareExportData(adversaries[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.ENVIRONMENT) {
                const environments = this.plugin.compendium.statblocks
                    .filter(s => s.category === 'environment' && s.isCustom === true);

                if (environments.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom environments found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    environments.forEach(environment => {
                        this.contentSelection?.addOption(environment.name, environment.name);
                    });

                    // Set first item as default
                    if (environments.length > 0) {
                        this.contentSelection?.setValue(environments[0].name);
                        this.selectedContentId = environments[0].name;
                        this.prepareExportData(environments[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.ABILITY) {
                const abilities = this.plugin.compendium.abilities.filter(a => a.isCustom === true);

                if (abilities.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom abilities found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    abilities.forEach(ability => {
                        this.contentSelection?.addOption(ability.name, ability.name);
                    });

                    // Set first item as default
                    if (abilities.length > 0) {
                        this.contentSelection?.setValue(abilities[0].name);
                        this.selectedContentId = abilities[0].name;
                        this.prepareExportData(abilities[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.CLASS) {
                const classes = this.plugin.compendium.classes.filter(c => c.isCustom === true);

                if (classes.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom classes found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    classes.forEach(classData => {
                        this.contentSelection?.addOption(classData.name, classData.name);
                    });

                    // Set first item as default
                    if (classes.length > 0) {
                        this.contentSelection?.setValue(classes[0].name);
                        this.selectedContentId = classes[0].name;
                        this.prepareExportData(classes[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.SUBCLASS) {
                const subclasses = this.plugin.compendium.subclasses.filter(s => s.isCustom === true);

                if (subclasses.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom subclasses found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    subclasses.forEach(subclass => {
                        this.contentSelection?.addOption(subclass.name, subclass.name);
                    });

                    // Set first item as default
                    if (subclasses.length > 0) {
                        this.contentSelection?.setValue(subclasses[0].name);
                        this.selectedContentId = subclasses[0].name;
                        this.prepareExportData(subclasses[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.ANCESTRY) {
                const ancestries = this.plugin.compendium.ancestries.filter(a => a.isCustom === true);

                if (ancestries.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom ancestries found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    ancestries.forEach(ancestry => {
                        this.contentSelection?.addOption(ancestry.name, ancestry.name);
                    });

                    // Set first item as default
                    if (ancestries.length > 0) {
                        this.contentSelection?.setValue(ancestries[0].name);
                        this.selectedContentId = ancestries[0].name;
                        this.prepareExportData(ancestries[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.COMMUNITY) {
                const communities = this.plugin.compendium.communities.filter(c => c.isCustom === true);

                if (communities.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom communities found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    communities.forEach(community => {
                        this.contentSelection?.addOption(community.name, community.name);
                    });

                    // Set first item as default
                    if (communities.length > 0) {
                        this.contentSelection?.setValue(communities[0].name);
                        this.selectedContentId = communities[0].name;
                        this.prepareExportData(communities[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.ARMOR) {
                const armors = this.plugin.compendium.armors.filter(a => a.isCustom === true);

                if (armors.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom armor items found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    armors.forEach(armor => {
                        this.contentSelection?.addOption(armor.name, armor.name);
                    });

                    // Set first item as default
                    if (armors.length > 0) {
                        this.contentSelection?.setValue(armors[0].name);
                        this.selectedContentId = armors[0].name;
                        this.prepareExportData(armors[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.WEAPON) {
                const weapons = this.plugin.compendium.weapons.filter(w => w.isCustom === true);

                if (weapons.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom weapons found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    weapons.forEach(weapon => {
                        this.contentSelection?.addOption(weapon.name, weapon.name);
                    });

                    // Set first item as default
                    if (weapons.length > 0) {
                        this.contentSelection?.setValue(weapons[0].name);
                        this.selectedContentId = weapons[0].name;
                        this.prepareExportData(weapons[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.ITEM) {
                const items = this.plugin.compendium.items.filter(i => i.isCustom === true);

                if (items.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom items found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    items.forEach(item => {
                        this.contentSelection?.addOption(item.name, item.name);
                    });

                    // Set first item as default
                    if (items.length > 0) {
                        this.contentSelection?.setValue(items[0].name);
                        this.selectedContentId = items[0].name;
                        this.prepareExportData(items[0].name);
                    }
                }
            }
            else if (this.contentType === ContentType.CONSUMABLE) {
                const consumables = this.plugin.compendium.consumables.filter(c => c.isCustom === true);

                if (consumables.length === 0) {
                    contentEl.createEl('p', {
                        text: 'No custom consumables found in compendium.',
                        cls: 'dh-empty-message'
                    });
                } else {
                    consumables.forEach(consumable => {
                        this.contentSelection?.addOption(consumable.name, consumable.name);
                    });

                    // Set first item as default
                    if (consumables.length > 0) {
                        this.contentSelection?.setValue(consumables[0].name);
                        this.selectedContentId = consumables[0].name;
                        this.prepareExportData(consumables[0].name);
                    }
                }
            }
            else {
                // For unsupported content types
                contentEl.createEl('p', {
                    text: `Export for ${this.contentTypeInfo.displayName} is not yet implemented.`,
                    cls: 'dh-warning-message'
                });
            }
        }

        this.contentSelection?.onChange(value => {
            if (value) {
                this.selectedContentId = value;
                this.prepareExportData(value);

                // Update the export UI with the selected content without rebuilding everything
                this.updateExportPreview(contentEl);
            }
        });
    }

    /**
     * Prepare export data for the selected content
     */
    private prepareExportData(contentId: string) {
        if (this.contentType === ContentType.CHARACTER) {
            const character = this.plugin.getCharacters().find(c => c.id === contentId);
            if (character) {
                this.exportJsonStr = exportToJsonString(this.contentType, character);
            }
        }
        else if (this.contentType === ContentType.ENCOUNTER) {
            const encounter = this.plugin.getSavedEncounter(contentId);
            if (encounter) {
                this.exportJsonStr = exportToJsonString(this.contentType, encounter);
            }
        }
        else if (this.contentType === ContentType.ADVERSARY) {
            const adversary = this.plugin.compendium.statblocks
                .find(s => s.category === 'adversary' && s.name === contentId);
            if (adversary) {
                this.exportJsonStr = exportToJsonString(this.contentType, adversary);
            }
        }
        else if (this.contentType === ContentType.ENVIRONMENT) {
            const environment = this.plugin.compendium.statblocks
                .find(s => s.category === 'environment' && s.name === contentId);
            if (environment) {
                this.exportJsonStr = exportToJsonString(this.contentType, environment);
            }
        }
        else if (this.contentType === ContentType.ABILITY) {
            const ability = this.plugin.compendium.abilities.find(a => a.name === contentId);
            if (ability) {
                this.exportJsonStr = exportToJsonString(this.contentType, ability);
            }
        }
        else if (this.contentType === ContentType.CLASS) {
            const classData = this.plugin.compendium.classes.find(c => c.name === contentId);
            if (classData) {
                this.exportJsonStr = exportToJsonString(this.contentType, classData);
            }
        }
        else if (this.contentType === ContentType.SUBCLASS) {
            const subclass = this.plugin.compendium.subclasses.find(s => s.name === contentId);
            if (subclass) {
                this.exportJsonStr = exportToJsonString(this.contentType, subclass);
            }
        }
        else if (this.contentType === ContentType.ANCESTRY) {
            const ancestry = this.plugin.compendium.ancestries.find(a => a.name === contentId);
            if (ancestry) {
                this.exportJsonStr = exportToJsonString(this.contentType, ancestry);
            }
        }
        else if (this.contentType === ContentType.COMMUNITY) {
            const community = this.plugin.compendium.communities.find(c => c.name === contentId);
            if (community) {
                this.exportJsonStr = exportToJsonString(this.contentType, community);
            }
        }
        else if (this.contentType === ContentType.ARMOR) {
            const armor = this.plugin.compendium.armors.find(a => a.name === contentId);
            if (armor) {
                this.exportJsonStr = exportToJsonString(this.contentType, armor);
            }
        }
        else if (this.contentType === ContentType.WEAPON) {
            const weapon = this.plugin.compendium.weapons.find(w => w.name === contentId);
            if (weapon) {
                this.exportJsonStr = exportToJsonString(this.contentType, weapon);
            }
        }
        else if (this.contentType === ContentType.ITEM) {
            const item = this.plugin.compendium.items.find(i => i.name === contentId);
            if (item) {
                this.exportJsonStr = exportToJsonString(this.contentType, item);
            }
        }
        else if (this.contentType === ContentType.CONSUMABLE) {
            const consumable = this.plugin.compendium.consumables.find(c => c.name === contentId);
            if (consumable) {
                this.exportJsonStr = exportToJsonString(this.contentType, consumable);
            }
        }
        // Add code for other content types as they're implemented
    }

    /**
     * Import the content from the textarea
     */
    private async importContent() {
        if (!this.textAreaComponent) return;

        const jsonText = this.textAreaComponent.getValue();
        if (!jsonText) {
            new Notice('Please enter JSON data to import.');
            return;
        }

        try {
            this.setLoading(true);

            // Parse the imported JSON
            console.log('Attempting to parse JSON text:', jsonText.substring(0, 200) + '...');

            const importData = importFromJsonString(jsonText);

            if (!importData) {
                console.error('Import failed: importFromJsonString returned null');
                new Notice('Invalid import data format.');
                this.setLoading(false);
                return;
            }

            console.log('Successfully parsed import data:', importData);

            // Check if the imported data type matches the selected content type
            if (importData.type !== this.contentType) {
                console.error(`Type mismatch: expected ${this.contentType}, got ${importData.type}`);
                new Notice(`Expected ${this.contentType} data but found ${importData.type} data.`);
                this.setLoading(false);
                return;
            }

            // Handle import based on content type
            if (this.contentType === ContentType.CHARACTER) {
                await this.importCharacter(importData.data as Character);
            }
            else if (this.contentType === ContentType.ENCOUNTER) {
                await this.importEncounter(importData.data as SavedEncounter);
            }
            else if (this.contentType === ContentType.ADVERSARY ||
                this.contentType === ContentType.ENVIRONMENT ||
                this.contentType === ContentType.ABILITY ||
                this.contentType === ContentType.CLASS ||
                this.contentType === ContentType.SUBCLASS ||
                this.contentType === ContentType.ANCESTRY ||
                this.contentType === ContentType.COMMUNITY ||
                this.contentType === ContentType.ARMOR ||
                this.contentType === ContentType.WEAPON ||
                this.contentType === ContentType.ITEM ||
                this.contentType === ContentType.CONSUMABLE) {
                new Notice(`Import for ${this.contentTypeInfo.displayName} is not yet fully implemented. This feature will be available in a future update.`);

                // Display the imported data in the console for debugging
                console.log(`Imported ${this.contentTypeInfo.displayName} data:`, importData.data);
            }
            else {
                new Notice(`Import for ${this.contentTypeInfo.displayName} is not yet implemented.`);
            }

            this.setLoading(false);
            this.close();

        } catch (error) {
            console.error(`Error importing ${this.contentTypeInfo.displayName}:`, error);
            new Notice(`Failed to import ${this.contentTypeInfo.displayName}. See console for details.`);
            this.setLoading(false);
        }
    }

    /**
     * Import a character
     */
    private async importCharacter(characterData: Character) {
        if (!this.isValidCharacterData(characterData)) {
            new Notice('Invalid character data.');
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
    }

    /**
     * Import an encounter
     */
    private async importEncounter(encounterData: SavedEncounter) {
        console.log('Importing encounter data:', encounterData);

        if (!this.isValidEncounterData(encounterData)) {
            console.error('Invalid encounter data:', encounterData);
            console.error('Validation failed: Check console for detailed validation results');
            new Notice('Invalid encounter data. Check console for details.');
            return;
        }

        // Generate a new ID to avoid collisions
        const existingIds = this.plugin.getSavedEncounters().map(e => e.id);
        const originalId = encounterData.id;

        // Check if encounter with same name already exists
        const existingWithSameName = this.plugin.getSavedEncounters().find(e =>
            e.name.toLowerCase() === encounterData.name.toLowerCase() && e.id !== originalId);

        if (existingWithSameName) {
            // Rename the imported encounter by adding " (Imported)" to the name
            encounterData.name = `${encounterData.name} (Imported)`;
        }

        // Always generate a new ID for imported encounters
        encounterData.id = uuidv4();

        // Save the encounter
        await this.plugin.updateSavedEncounter(encounterData);

        new Notice(`Encounter "${encounterData.name}" imported successfully!`);
    }

    /**
     * Validates that imported data is a valid character
     */
    private isValidCharacterData(data: any): boolean {
        return isValidCharacterData(data);
    }

    /**
     * Validates that imported data is a valid encounter
     */
    private isValidEncounterData(data: any): boolean {
        return isValidEncounterData(data);
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
                this.importButtonEl.textContent = `Import ${this.contentTypeInfo.displayName}`;
                this.importButtonEl.disabled = false;
            }
        }
    }

    /**
     * Update the export preview without rebuilding the entire UI
     * @param contentEl The content element
     */
    private updateExportPreview(contentEl: HTMLElement) {
        // Look for existing preview section
        let previewSection = contentEl.querySelector('.dh-preview-section');

        if (previewSection) {
            // If preview section exists, just update the code content
            const codeEl = previewSection.querySelector('code');
            if (codeEl) {
                codeEl.textContent = this.exportJsonStr;
            }
        } else {
            // If preview section doesn't exist, create it with proper styling
            previewSection = contentEl.createEl('div', { cls: 'dh-preview-section' });
            previewSection.createEl('h3', { text: 'Preview' });
            const previewEl = previewSection.createEl('pre', { cls: 'dh-export-preview' });
            previewEl.createEl('code', { text: this.exportJsonStr });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
