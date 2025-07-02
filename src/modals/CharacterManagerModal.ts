import { App, Modal, Setting, Notice, TextAreaComponent, setIcon } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import { Character, DomainCard, Experience, Trait } from '../../types';
import { createAvatarEditor } from '../views/components/AvatarEditor';
import { TRAIT_NAMES } from '../constants';

/**
 * A modal for freely editing all aspects of a character sheet.
 * This modal disregards game rules and provides direct access to the character data model.
 */
export class CharacterManagerModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;
    private tempCharacter: Character;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        // Deep copy to avoid modifying the original character object until save
        this.tempCharacter = JSON.parse(JSON.stringify(character));
        this.onSave = onSave;
        this.modalEl.addClass('dh-character-manager-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h1", { text: `Edit ${this.character.name}` });
        contentEl.createEl("p", { text: "Freely edit all aspects of your character. Changes are saved when you click the save button." });

        // Create collapsible sections for better organization
        this.drawCoreDetails(this.createCollapsibleSection(contentEl, 'Core Details & Avatar'));
        this.drawVitals(this.createCollapsibleSection(contentEl, 'Vitals & Defenses'));
        this.drawTraits(this.createCollapsibleSection(contentEl, 'Traits'));
        this.drawHeritageAndClass(this.createCollapsibleSection(contentEl, 'Heritage & Class'));
        this.drawExperiences(this.createCollapsibleSection(contentEl, 'Experiences'));
        this.drawFeatures(this.createCollapsibleSection(contentEl, 'Features & Cards'));
        this.drawDetails(this.createCollapsibleSection(contentEl, 'Background & Connections'));
        this.drawInventory(this.createCollapsibleSection(contentEl, 'Gold'));

        // Save button
        const footer = contentEl.createDiv({ cls: 'dh-modal-footer' });
        footer.createEl('button', { text: 'Save & Close', cls: 'mod-cta' }).addEventListener('click', () => {
            this.onSave(this.tempCharacter);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }

    /**
     * Helper to create a standardized collapsible section.
     * @param parent The parent element.
     * @param title The title for the section header.
     * @returns The container element within the collapsible section to which settings can be added.
     */
    private createCollapsibleSection(parent: HTMLElement, title: string): HTMLElement {
        const details = parent.createEl('details', { cls: 'dh-manager-section' });
        details.open = false; // Start collapsed
        const summary = details.createEl('summary');
        summary.createEl('h2', { text: title });
        return details.createDiv();
    }

    private drawCoreDetails(parent: HTMLElement) {
        new Setting(parent)
            .setName('Character Name')
            .addText(text => text
                .setValue(this.tempCharacter.name)
                .onChange(value => this.tempCharacter.name = value));

        const grid = parent.createDiv({ cls: 'is-grid' });
        new Setting(grid)
            .setName('Level')
            .addText(text => text
                .setValue(String(this.tempCharacter.level))
                .onChange(value => this.tempCharacter.level = parseInt(value) || 1));

        new Setting(grid)
            .setName('Proficiency')
            .addText(text => text
                .setValue(String(this.tempCharacter.proficiency))
                .onChange(value => this.tempCharacter.proficiency = parseInt(value) || 1));

        new Setting(parent)
            .setName('Pronouns (Subject/Object)')
            .addText(text => text
                .setPlaceholder('they')
                .setValue(this.tempCharacter.pronouns.subject)
                .onChange(value => this.tempCharacter.pronouns.subject = value))
            .addText(text => text
                .setPlaceholder('them')
                .setValue(this.tempCharacter.pronouns.object)
                .onChange(value => this.tempCharacter.pronouns.object = value));

        createAvatarEditor(
            this.app,
            parent,
            this.tempCharacter.avatarUrl || '',
            this.tempCharacter.avatarTransform,
            (newUrl) => {
                this.tempCharacter.avatarUrl = newUrl || null;
                this.tempCharacter.avatarTransform = undefined;
            },
            (newTransform) => {
                this.tempCharacter.avatarTransform = newTransform;
            }
        );
    }

    private drawVitals(parent: HTMLElement) {
        const grid = parent.createDiv({ cls: 'is-grid' });
        new Setting(grid).setName("Max HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.max)).onChange(v => this.tempCharacter.hitPoints.max = parseInt(v) || 0));
        new Setting(grid).setName("Current HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.current)).onChange(v => this.tempCharacter.hitPoints.current = parseInt(v) || 0));
        new Setting(grid).setName("Max Stress").addText(text => text.setValue(String(this.tempCharacter.stress.max)).onChange(v => this.tempCharacter.stress.max = parseInt(v) || 0));
        new Setting(grid).setName("Current Stress").addText(text => text.setValue(String(this.tempCharacter.stress.current)).onChange(v => this.tempCharacter.stress.current = parseInt(v) || 0));
        new Setting(grid).setName("Max Hope").addText(text => text.setValue(String(this.tempCharacter.hope.max)).onChange(v => this.tempCharacter.hope.max = parseInt(v) || 0));
        new Setting(grid).setName("Current Hope").addText(text => text.setValue(String(this.tempCharacter.hope.current)).onChange(v => this.tempCharacter.hope.current = parseInt(v) || 0));
        new Setting(grid).setName("Evasion").addText(text => text.setValue(String(this.tempCharacter.evasion)).onChange(v => this.tempCharacter.evasion = parseInt(v) || 0));
        new Setting(grid).setName("Armor Slots (Max)").addText(text => text.setValue(String(this.tempCharacter.armorSlots.max)).onChange(v => this.tempCharacter.armorSlots.max = parseInt(v) || 0));
        new Setting(grid).setName("Armor Slots (Current)").addText(text => text.setValue(String(this.tempCharacter.armorSlots.current)).onChange(v => this.tempCharacter.armorSlots.current = parseInt(v) || 0));
        new Setting(grid).setName("Major Threshold").addText(text => text.setValue(String(this.tempCharacter.damageThresholds.major)).onChange(v => this.tempCharacter.damageThresholds.major = parseInt(v) || 0));
        new Setting(grid).setName("Severe Threshold").addText(text => text.setValue(String(this.tempCharacter.damageThresholds.severe)).onChange(v => this.tempCharacter.damageThresholds.severe = parseInt(v) || 0));
    }

    private drawTraits(parent: HTMLElement) {
        const grid = parent.createDiv({ cls: 'is-grid' });
        TRAIT_NAMES.forEach(traitName => {
            new Setting(grid)
                .setName(traitName)
                .addText(text => text
                    .setValue(String(this.tempCharacter.traits[traitName].value))
                    .onChange(value => this.tempCharacter.traits[traitName].value = parseInt(value) || 0)
                );
        });
    }

    private drawHeritageAndClass(parent: HTMLElement) {
        const grid = parent.createDiv({ cls: 'is-grid' });
        new Setting(grid)
            .setName('Ancestry')
            .addDropdown(dd => {
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.tempCharacter.ancestryId)
                    .onChange(value => this.tempCharacter.ancestryId = value);
            });

        new Setting(grid)
            .setName('Community')
            .addDropdown(dd => {
                this.plugin.compendium.communities.forEach(c => dd.addOption(c.name, c.name));
                dd.setValue(this.tempCharacter.communityId)
                    .onChange(value => this.tempCharacter.communityId = value);
            });

        new Setting(grid)
            .setName('Class')
            .addDropdown(dd => {
                this.plugin.compendium.classes.forEach(c => dd.addOption(c.name, c.name));
                dd.setValue(this.tempCharacter.classId)
                    .onChange(value => {
                        this.tempCharacter.classId = value;
                        this.tempCharacter.subclassId = ''; // Clear subclass to avoid invalid combos
                        this.onOpen(); // Redraw to update subclass dropdown
                    });
            });

        new Setting(grid)
            .setName('Subclass')
            .addDropdown(dd => {
                const charClass = this.plugin.compendium.getClass(this.tempCharacter.classId);
                dd.addOption('', 'None');
                if (charClass) {
                    const subclasses = [this.plugin.compendium.getSubclass(charClass.subclass_1), this.plugin.compendium.getSubclass(charClass.subclass_2)].filter(s => s);
                    subclasses.forEach(subclass => {
                        if (subclass) dd.addOption(subclass.name, subclass.name);
                    });
                }
                dd.setValue(this.tempCharacter.subclassId)
                    .onChange(value => this.tempCharacter.subclassId = value);
            });
    }

    private drawExperiences(parent: HTMLElement) {
        const experiencesContainer = parent.createDiv();

        const redraw = () => {
            experiencesContainer.empty();
            if (!this.tempCharacter.experiences) this.tempCharacter.experiences = [];

            this.tempCharacter.experiences.forEach((exp, index) => {
                const setting = new Setting(experiencesContainer)
                    .addText(text => text
                        .setPlaceholder('Experience Name')
                        .setValue(exp.name)
                        .onChange(value => exp.name = value))
                    .addText(text => text
                        .setPlaceholder('Value')
                        .setValue(String(exp.value))
                        .onChange(value => exp.value = parseInt(value) || 0))
                    .addExtraButton(btn => btn
                        .setIcon('trash')
                        .setTooltip('Remove Experience')
                        .onClick(() => {
                            this.tempCharacter.experiences.splice(index, 1);
                            redraw();
                        }));
                setting.nameEl.setText(`Experience ${index + 1}`);
            });

            new Setting(parent).addButton(btn => btn.setButtonText("Add Experience").onClick(() => {
                this.tempCharacter.experiences.push({ _type: 'experience', id: uuidv4(), name: '', value: 0 });
                redraw();
            })).settingEl.style.borderTop = 'none';
        };
        redraw();
    }

    private drawFeatures(parent: HTMLElement) {
        const container = parent.createDiv();

        const redraw = () => {
            container.empty();
            if (!this.tempCharacter.vault) { this.tempCharacter.vault = []; }
            const allCards = [...this.tempCharacter.features, ...this.tempCharacter.vault];

            if (allCards.length === 0) {
                container.createEl('p', { text: 'No features or cards.' });
            }

            allCards.forEach(card => {
                const cardDetails = container.createEl('details', { cls: 'dh-manager-section' });
                const summaryEl = cardDetails.createEl('summary');
                const h2El = summaryEl.createEl('h2', { text: card.name });
                const cardContainer = cardDetails.createDiv();
                cardContainer.addClass('dh-manager-card-editor');

                new Setting(cardContainer)
                    .setName('Name')
                    .addText(text => text.setValue(card.name).onChange(val => {
                        card.name = val;
                        h2El.setText(val);
                    }));

                new Setting(cardContainer)
                    .setName('Description')
                    .addTextArea(text => text.setValue(card.description).onChange(val => card.description = val));

                const grid = cardContainer.createDiv({ cls: 'is-grid' });
                new Setting(grid).setName('Level').addText(text => text.setValue(String(card.level)).onChange(val => card.level = parseInt(val) || 0));
                new Setting(grid).setName('Domain').addText(text => text.setValue(card.domain).onChange(val => card.domain = val));
                new Setting(grid).setName('Type').addText(text => text.setValue(card.type).onChange(val => card.type = val));
                new Setting(grid).setName('Recall Cost').addText(text => text.setValue(String(card.recall)).onChange(val => card.recall = parseInt(val) || 0));

                const isInLoadout = this.tempCharacter.features.some(f => f.id === card.id);
                const locationToggle = new Setting(cardContainer)
                    .setName('Location')
                    .setDesc(isInLoadout ? 'In Loadout' : 'In Vault')
                    .addToggle(toggle => toggle
                        .setValue(isInLoadout)
                        .onChange(inLoadout => {
                            if (inLoadout) {
                                // Move from vault to loadout
                                const cardIndex = this.tempCharacter.vault.findIndex(c => c.id === card.id);
                                if (cardIndex > -1) {
                                    const [movedCard] = this.tempCharacter.vault.splice(cardIndex, 1);
                                    this.tempCharacter.features.push(movedCard);
                                }
                            } else {
                                // Move from loadout to vault
                                const cardIndex = this.tempCharacter.features.findIndex(c => c.id === card.id);
                                if (cardIndex > -1) {
                                    const [movedCard] = this.tempCharacter.features.splice(cardIndex, 1);
                                    this.tempCharacter.vault.push(movedCard);
                                }
                            }
                            locationToggle.setDesc(inLoadout ? 'In Loadout' : 'In Vault');
                        })
                    );

                new Setting(cardContainer).addButton(btn => btn
                    .setButtonText('Delete Card')
                    .setWarning()
                    .onClick(() => {
                        this.tempCharacter.features = this.tempCharacter.features.filter(f => f.id !== card.id);
                        this.tempCharacter.vault = this.tempCharacter.vault.filter(v => v.id !== card.id);
                        redraw();
                    }));
            });

            new Setting(parent).addButton(btn => btn.setButtonText("Add New Card").onClick(() => {
                const newCard: DomainCard = {
                    _type: 'domainCard',
                    id: uuidv4(),
                    name: 'New Card',
                    description: '',
                    level: 1,
                    domain: '',
                    type: 'Ability',
                    recall: 0,
                };
                this.tempCharacter.vault.push(newCard);
                redraw();
            })).settingEl.style.borderTop = 'none';
        };
        redraw();
    }

    private drawDetails(parent: HTMLElement) {
        const container = parent.createDiv();
        container.createEl('h3', { text: 'Background' });
        if (!this.tempCharacter.background) this.tempCharacter.background = [];
        this.tempCharacter.background.forEach((bg) => {
            new Setting(container)
                .setName(`Q: ${bg.question}`)
                .addTextArea(text => text
                    .setPlaceholder('Answer...')
                    .setValue(bg.answer)
                    .onChange(val => bg.answer = val));
        });

        container.createEl('h3', { text: 'Connections' });
        if (!this.tempCharacter.connections) this.tempCharacter.connections = [];
        this.tempCharacter.connections.forEach((conn) => {
            new Setting(container)
                .setName(`Q: ${conn.question}`)
                .addTextArea(text => text
                    .setPlaceholder('Answer...')
                    .setValue(conn.answer)
                    .onChange(val => conn.answer = val));
        });
    }

    private drawInventory(parent: HTMLElement) {
        new Setting(parent)
            .setName('Gold (Handfuls/Bags/Chests)')
            .addText(text => text.setPlaceholder('H').setValue(String(this.tempCharacter.gold.handfuls)).onChange(v => this.tempCharacter.gold.handfuls = parseInt(v) || 0))
            .addText(text => text.setPlaceholder('B').setValue(String(this.tempCharacter.gold.bags)).onChange(v => this.tempCharacter.gold.bags = parseInt(v) || 0))
            .addText(text => text.setPlaceholder('C').setValue(String(this.tempCharacter.gold.chests)).onChange(v => this.tempCharacter.gold.chests = parseInt(v) || 0));

        // new Setting(parent)
        //     .setName('General Notes')
        //     .setDesc('For quickly jotting down notes. Full inventory management is on the character sheet.')
        //     .addTextArea(text => text
        //         .setPlaceholder('e.g., Quest items, reminders...')
        //         .setValue(this.tempCharacter.notes || '')
        //         .onChange(val => this.tempCharacter.notes = val));
    }
}
