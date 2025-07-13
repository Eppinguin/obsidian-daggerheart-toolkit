import { App, Modal, Setting, Notice, TextAreaComponent, setIcon } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, DomainCard, Experience, InherentFeature, JsonAncestry, Trait } from '../types';
import { createAvatarEditor } from '../views/components/AvatarEditor';
import { TRAIT_NAMES } from '../constants';
import { CardSwapModal } from './CardSwapModal';

/**
 * A modal for freely editing all aspects of a character sheet.
 * This modal disregards game rules and provides direct access to the character data model.
 */
export class CharacterManagerModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;
    private tempCharacter: Character;
    private sectionStates: { [title: string]: boolean } = {};

    // State for mixed ancestry editing
    private isMixedAncestry: boolean = false;
    private parentAncestry1: string = '';
    private parentAncestry2: string = '';
    private originalAncestryId: string = '';

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.onSave = onSave;
        this.tempCharacter = JSON.parse(JSON.stringify(character));
        this.originalAncestryId = character.ancestryId;
        this.modalEl.addClass('dh-character-manager-modal');

        const ancestry = this.plugin.compendium.getAncestry(this.tempCharacter.ancestryId);
        if (ancestry?.isCustom) {
            const match = ancestry.description.match(/combining the traits of (.*) and (.*)\./);
            if (match) {
                this.isMixedAncestry = true;
                this.parentAncestry1 = match[1];
                this.parentAncestry2 = match[2];
            }
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h1", { text: `Edit ${this.character.name}` });
        contentEl.createEl("p", { text: "Freely edit all aspects of your character. Changes are saved when you click the save button." });

        this.drawCoreDetails(this.createCollapsibleSection(contentEl, 'Core Details & Avatar'));
        this.drawVitals(this.createCollapsibleSection(contentEl, 'Vitals & Defenses'));
        this.drawTraits(this.createCollapsibleSection(contentEl, 'Traits'));
        this.drawHeritageAndClass(this.createCollapsibleSection(contentEl, 'Heritage & Class'));
        this.drawExperiences(this.createCollapsibleSection(contentEl, 'Experiences'));
        this.drawCardsAndFeatures(this.createCollapsibleSection(contentEl, 'Features & Cards'));
        this.drawDetails(this.createCollapsibleSection(contentEl, 'Background & Connections'));
        this.drawInventory(this.createCollapsibleSection(contentEl, 'Gold & Notes'));

        const footer = contentEl.createDiv({ cls: 'dh-modal-footer' });
        footer.createEl('button', { text: 'Save & Close', cls: 'mod-cta' }).addEventListener('click', async () => {
            if (this.isMixedAncestry) {
                if (!this.tempCharacter.ancestryId || !this.parentAncestry1 || !this.parentAncestry2) {
                    new Notice('For a mixed ancestry, please provide a name and select two parent ancestries.');
                    return;
                }

                const ancestry1 = this.plugin.compendium.getAncestry(this.parentAncestry1);
                const ancestry2 = this.plugin.compendium.getAncestry(this.parentAncestry2);

                if (!ancestry1 || !ancestry2 || !ancestry1.feats?.[0] || !ancestry2.feats?.[1]) {
                    new Notice('Could not create mixed ancestry. Please ensure both selected ancestries are valid.');
                    return;
                }

                const newMixedAncestry: JsonAncestry = {
                    name: this.tempCharacter.ancestryId,
                    description: `A unique heritage combining the traits of ${ancestry1.name} and ${ancestry2.name}.`,
                    feats: [ancestry1.feats[0], ancestry2.feats[1]],
                    isCustom: true,
                };

                // This will add or overwrite an entry with the same name.
                await this.plugin.saveCustomCompendiumData('user-ancestries.json', newMixedAncestry);
            }

            this.onSave(this.tempCharacter);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }

    private saveSectionStates() {
        const sections = this.contentEl.querySelectorAll('details.dh-manager-section');
        sections.forEach(section => {
            const detailsElement = section as HTMLDetailsElement;
            const titleEl = detailsElement.querySelector('summary > h2');
            if (titleEl && titleEl.textContent) {
                this.sectionStates[titleEl.textContent] = detailsElement.open;
            }
        });
    }

    private createCollapsibleSection(parent: HTMLElement, title: string, defaultOpen: boolean = false): HTMLElement {
        const details = parent.createEl('details', { cls: 'dh-manager-section' });
        details.open = this.sectionStates[title] ?? defaultOpen;
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

        new Setting(parent)
            .setName('Accent Color')
            .setDesc('A personal color for the character sheet.')
            .addColorPicker(picker => picker
                .setValue(this.tempCharacter.accentColor || '#e5b32a')
                .onChange(value => this.tempCharacter.accentColor = value));

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

        new Setting(grid)
            .setName("Evasion Modifier")
            .setDesc("A custom modifier applied to the character's final Evasion score.")
            .addText(text => text
                .setValue(String(this.tempCharacter.customModifiers?.evasion ?? 0))
                .onChange(value => {
                    if (!this.tempCharacter.customModifiers) this.tempCharacter.customModifiers = {};
                    this.tempCharacter.customModifiers.evasion = parseInt(value) || 0;
                }));

        new Setting(grid).setName("Armor Slots (Max)").addText(text => text.setValue(String(this.tempCharacter.armorSlots.max)).onChange(v => this.tempCharacter.armorSlots.max = parseInt(v) || 0));
        new Setting(grid).setName("Armor Slots (Current)").addText(text => text.setValue(String(this.tempCharacter.armorSlots.current)).onChange(v => this.tempCharacter.armorSlots.current = parseInt(v) || 0));

        new Setting(grid)
            .setName("Major Threshold Modifier")
            .setDesc("A custom modifier applied to the character's final Major Threshold.")
            .addText(text => text
                .setValue(String(this.tempCharacter.customModifiers?.majorThreshold ?? 0))
                .onChange(value => {
                    if (!this.tempCharacter.customModifiers) this.tempCharacter.customModifiers = {};
                    this.tempCharacter.customModifiers.majorThreshold = parseInt(value) || 0;
                }));

        new Setting(grid)
            .setName("Severe Threshold Modifier")
            .setDesc("A custom modifier applied to the character's final Severe Threshold.")
            .addText(text => text
                .setValue(String(this.tempCharacter.customModifiers?.severeThreshold ?? 0))
                .onChange(value => {
                    if (!this.tempCharacter.customModifiers) this.tempCharacter.customModifiers = {};
                    this.tempCharacter.customModifiers.severeThreshold = parseInt(value) || 0;
                }));
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
        new Setting(parent)
            .setName('Mixed Ancestry')
            .setDesc('Combine features from two different ancestries.')
            .addToggle(toggle => toggle
                .setValue(this.isMixedAncestry)
                .onChange(value => {
                    this.isMixedAncestry = value;
                    if (!value) {
                        this.tempCharacter.ancestryId = this.parentAncestry1 || this.originalAncestryId || '';
                    } else {
                        this.tempCharacter.ancestryId = this.originalAncestryId;
                    }
                    this.saveSectionStates();
                    this.onOpen();
                }));

        if (this.isMixedAncestry) {
            this.drawMixedAncestryEditor(parent);
        } else {
            this.drawSingleAncestryEditor(parent);
        }

        const grid = parent.createDiv({ cls: 'is-grid' });

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
                        this.tempCharacter.subclassId = '';
                        const newClass = this.plugin.compendium.getClass(value);
                        const newSubclass = this.plugin.compendium.getSubclass('');
                        if (!this.tempCharacter.multiclassClassId) {
                            this.tempCharacter.spellCastTrait = newSubclass?.spellcast_trait || null;
                        }
                        this.saveSectionStates();
                        this.onOpen();
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
                    .onChange(value => {
                        this.tempCharacter.subclassId = value;
                        const newSubclass = this.plugin.compendium.getSubclass(value);

                        // If single-classed, automatically update the spellcasting trait.
                        if (!this.tempCharacter.multiclassClassId) {
                            this.tempCharacter.spellCastTrait = newSubclass?.spellcast_trait || null;
                        } else {
                            // If multiclassed, re-evaluate available traits and reset if necessary.
                            const primarySubclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
                            const multiSubclass = this.plugin.compendium.getSubclass(this.tempCharacter.multiclassSubclassId || '');
                            const suggestedTraits = new Set<string>();
                            if (primarySubclass?.spellcast_trait) suggestedTraits.add(primarySubclass.spellcast_trait);
                            if (multiSubclass?.spellcast_trait) suggestedTraits.add(multiSubclass.spellcast_trait);

                            if (!this.tempCharacter.spellCastTrait || !suggestedTraits.has(this.tempCharacter.spellCastTrait)) {
                                this.tempCharacter.spellCastTrait = Array.from(suggestedTraits)[0] || null;
                            }
                        }
                        this.saveSectionStates();
                        this.onOpen();
                    });
            });

        const primarySubclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
        const multiSubclass = this.tempCharacter.multiclassSubclassId ? this.plugin.compendium.getSubclass(this.tempCharacter.multiclassSubclassId) : null;

        const suggestedTraits = new Set<string>();
        if (primarySubclass?.spellcast_trait) {
            suggestedTraits.add(primarySubclass.spellcast_trait);
        }
        if (multiSubclass?.spellcast_trait) {
            suggestedTraits.add(multiSubclass.spellcast_trait);
        }

        new Setting(grid)
            .setName('Primary Spellcasting Trait')
            .setDesc('Choose the trait for your spellcasting rolls. Your subclass(es) suggest certain traits.')
            .addDropdown(dd => {
                dd.addOption('', '--- Not Set ---');
                TRAIT_NAMES.forEach(trait => {
                    const isSuggested = suggestedTraits.has(trait);
                    const label = isSuggested ? `${trait} (Rules Suggestion)` : trait;
                    dd.addOption(trait, label);
                });

                dd.setValue(this.tempCharacter.spellCastTrait || '')
                    .onChange(value => {
                        this.tempCharacter.spellCastTrait = value || null;
                    });
            });
    }

    private drawSingleAncestryEditor(parent: HTMLElement) {
        new Setting(parent)
            .setName('Ancestry')
            .addDropdown(dd => {
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.tempCharacter.ancestryId)
                    .onChange(value => this.tempCharacter.ancestryId = value);
            });
    }

    private drawMixedAncestryEditor(parent: HTMLElement) {
        new Setting(parent)
            .setName('Heritage Name')
            .setDesc('e.g., Goblin-Orc, Half-Elf')
            .addText(text => text
                .setValue(this.tempCharacter.ancestryId)
                .onChange(value => this.tempCharacter.ancestryId = value));

        new Setting(parent)
            .setName('First Ancestry (Feature 1)')
            .addDropdown(dd => {
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.parentAncestry1)
                    .onChange(val => this.parentAncestry1 = val);
            });

        new Setting(parent)
            .setName('Second Ancestry (Feature 2)')
            .addDropdown(dd => {
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.parentAncestry2)
                    .onChange(val => this.parentAncestry2 = val);
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

    private drawCardsAndFeatures(parent: HTMLElement) {
        const container = parent.createDiv();

        new Setting(container)
            .setName('Domain Cards')
            .setDesc('Manage your character\'s available domain cards, including your loadout and vault.')
            .addButton(btn => btn
                .setButtonText('Manage Cards & Loadout')
                .setCta()
                .onClick(() => {
                    this.saveSectionStates();
                    new CardSwapModal(this.app, this.plugin, this.tempCharacter, (updatedChar) => {
                        this.onOpen();
                    }).open();
                }));

        const cardListsContainer = container.createDiv({ cls: 'dh-manager-card-lists' });

        if (!this.tempCharacter.loadout) this.tempCharacter.loadout = [];
        if (!this.tempCharacter.vault) this.tempCharacter.vault = [];

        // Loadout List
        const loadoutSection = cardListsContainer.createDiv();
        loadoutSection.createEl('h4', { text: `Loadout (${this.tempCharacter.loadout.length}/5)` });
        const loadoutList = this.createDropZone(loadoutSection, 'loadout');
        if (this.tempCharacter.loadout.length === 0) {
            loadoutList.createEl('p', { text: 'No cards in loadout.', cls: 'dh-empty-text' });
        } else {
            this.tempCharacter.loadout.forEach(card => {
                this.createCardSummary(loadoutList, card, 'loadout');
            });
        }

        // Vault List
        const vaultSection = cardListsContainer.createDiv();
        vaultSection.createEl('h4', { text: `Vault (${this.tempCharacter.vault.length})` });
        const vaultList = this.createDropZone(vaultSection, 'vault');
        if (this.tempCharacter.vault.length === 0) {
            vaultList.createEl('p', { text: 'No cards in vault.', cls: 'dh-empty-text' });
        } else {
            this.tempCharacter.vault.forEach(card => {
                this.createCardSummary(vaultList, card, 'vault');
            });
        }

        // Inherent Features (Read-only)
        const featuresSection = container.createDiv({ cls: 'dh-manager-readonly-features' });
        featuresSection.createEl('h3', { text: 'Inherent Features' });
        if (!this.tempCharacter.features || this.tempCharacter.features.length === 0) {
            featuresSection.createEl('p', { text: 'No inherent features found.', cls: 'dh-empty-text' });
        } else {
            const featuresList = featuresSection.createEl('ul');
            this.tempCharacter.features.forEach(feature => {
                const item = featuresList.createEl('li');
                item.createEl('strong', { text: feature.name });
                item.createSpan({ text: ` (${feature.source})` });
                item.createEl('div', { text: feature.description, cls: 'dh-manager-feature-desc' });
            });
        }
    }

    private createDropZone(parent: HTMLElement, type: 'loadout' | 'vault'): HTMLElement {
        const dropZone = parent.createDiv({ cls: 'dh-manager-card-list' });
        dropZone.dataset.listType = type;

        dropZone.addEventListener('dragover', (event) => {
            event.preventDefault();
            const sourceListType = event.dataTransfer?.getData('source-list');
            if (sourceListType && sourceListType !== type) {
                dropZone.addClass('is-drop-target');
            }
        });

        dropZone.addEventListener('dragleave', (event) => {
            dropZone.removeClass('is-drop-target');
        });

        dropZone.addEventListener('drop', (event) => {
            event.preventDefault();
            dropZone.removeClass('is-drop-target');

            const cardId = event.dataTransfer?.getData('text/plain');
            const sourceListType = event.dataTransfer?.getData('source-list');
            const targetListType = type;

            if (!cardId || sourceListType === targetListType) return;

            if (targetListType === 'loadout' && this.tempCharacter.loadout.length >= 5) {
                new Notice('Loadout is full (5 cards maximum).');
                return;
            }

            const sourceList = sourceListType === 'loadout' ? this.tempCharacter.loadout : this.tempCharacter.vault;
            const targetList = targetListType === 'loadout' ? this.tempCharacter.loadout : this.tempCharacter.vault;

            const cardIndex = sourceList.findIndex(c => c.id === cardId);
            if (cardIndex > -1) {
                const [cardToMove] = sourceList.splice(cardIndex, 1);
                targetList.push(cardToMove);
                this.saveSectionStates(); // Save state before re-rendering
                this.onOpen(); // Re-render the modal
            }
        });

        return dropZone;
    }

    private createCardSummary(parent: HTMLElement, card: DomainCard, listType: 'loadout' | 'vault') {
        const cardEl = parent.createDiv({ cls: 'dh-manager-card-summary' });
        cardEl.draggable = true;

        cardEl.createEl('strong', { text: card.name });
        const metaEl = cardEl.createDiv({ cls: 'dh-manager-card-meta' });
        metaEl.createSpan({ text: `Lvl ${card.level}` });
        metaEl.createSpan({ text: card.domain });
        metaEl.createSpan({ text: card.type });

        cardEl.addEventListener('dragstart', (event) => {
            if (event.dataTransfer) {
                event.dataTransfer.setData('text/plain', card.id);
                event.dataTransfer.setData('source-list', listType);
                event.dataTransfer.effectAllowed = 'move';
            }
            setTimeout(() => cardEl.addClass('is-dragging'), 0);
        });

        cardEl.addEventListener('dragend', (event) => {
            cardEl.removeClass('is-dragging');
        });
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

        new Setting(parent)
            .setName('General Notes')
            .setDesc('For quickly jotting down notes. Full inventory management is on the character sheet.')
            .addTextArea(text => text
                .setPlaceholder('e.g., Quest items, reminders...')
                .setValue(this.tempCharacter.notes || '')
                .onChange(val => this.tempCharacter.notes = val));
    }
}
