import { App, Modal, Setting, Notice, TextAreaComponent, setIcon } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, Condition, DomainCard, Experience, InherentFeature, JsonAncestry, Stances } from '../types';
import { createAvatarEditor } from '../views/components/AvatarEditor';
import { TRAIT_NAMES } from '../constants';
import { CardSwapModal } from './CardSwapModal';
import { initializeCharacter } from 'src/services/effects-engine';
import { addEffectsFromSource } from 'src/services/effects-manager';

export class CharacterManagerModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;
    private tempCharacter: Character; // This will hold a mutable copy of the character
    private originalCharacterId: string; // To know if we're editing an existing one
    private initialActiveStance: string | undefined; // To track changes for effects
    private initialEquippedArmorId: string | null;
    private initialEquippedWeaponIds: string[];
    private initialConditions: Condition[];
    private sectionStates: { [title: string]: boolean } = {};
    private isMixedAncestry: boolean = false;
    private parentAncestry1: string = '';
    private parentAncestry2: string = '';
    private originalAncestryId: string = '';

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.onSave = onSave;
        this.originalAncestryId = character.ancestryId;
        this.modalEl.addClass('dh-character-manager-modal');

        // Step 1: Create a deep copy of the original character object.
        // This copy will only contain plain data, losing all CalculatedStat instances.
        this.tempCharacter = JSON.parse(JSON.stringify(character));

        // Step 2: Hydrate the copied tempCharacter.
        // This converts all plain object representations of CalculatedStats back into actual CalculatedStat instances.
        // It also handles nested hydration for inventory items.
        initializeCharacter(this.tempCharacter);

        // Step 3: Re-apply all active effects to the newly hydrated tempCharacter.
        // This is CRUCIAL because the `initializeCharacter` process re-creates `CalculatedStat` instances.
        // The modifiers within `this.tempCharacter.activeEffects` (which were deep copied)
        // are now "stale" in that they pointed to the *original* character's stats.
        // We need to re-register these modifiers with the *newly created* CalculatedStat instances
        // on `this.tempCharacter`.
        // First, clear existing effects to ensure no duplicates if there were partial updates
        // or a previous faulty hydration.
        // A more robust way is to re-iterate the original sources, but for a modal,
        // re-applying the stored `ActiveEffect` objects' modifications is more direct.

        // To ensure consistency, we'll clear and re-add effects from *known sources*
        // on the tempCharacter. This is complex because `addEffectsFromSource` takes
        // a source object. The `activeEffects` array is just the list of applied effects.

        // Simpler for a modal: After `initializeCharacter`, if you're editing base values,
        // the `getValue` calls will correctly re-evaluate. The main `draw()` function
        // in `CharacterSheetView` will correctly re-evaluate effects.
        // The error was specifically because `getValue` wasn't a function at all.
        // `initializeCharacter(this.tempCharacter)` is the primary fix for that.

        // When saving, we will clear all and re-add from sources to ensure latest state.

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

        contentEl.createEl("h1", { text: `Edit ${this.tempCharacter.name}` }); // Use tempCharacter.name here
        contentEl.createEl("p", { text: "Freely edit all aspects of your character. Changes are saved when you click the save button." });

        // Ensure these helper methods are defined within the CharacterManagerModal class scope
        this.drawCoreDetails(this.createCollapsibleSection(contentEl, 'Core Details & Avatar'));
        this.drawVitals(this.createCollapsibleSection(contentEl, 'Vitals & Defenses')); // This is where the error occurred
        this.drawTraits(this.createCollapsibleSection(contentEl, 'Traits'));
        this.drawHeritageAndClass(this.createCollapsibleSection(contentEl, 'Heritage & Class'));
        this.drawStances(this.createCollapsibleSection(contentEl, 'Stances'));
        this.drawActiveEffects(this.createCollapsibleSection(contentEl, 'Active Effects'));
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

                await this.plugin.saveCustomCompendiumData('user-ancestries.json', newMixedAncestry);
            }

            // IMPORTANT: Before saving, re-apply all effects based on the new base values of tempCharacter.
            // This ensures all derived stats are correct for the character to be saved.
            // A quick way to "reset and re-apply" all effects:
            // 1. Temporarily store the active effects and equipped IDs.
            const currentActiveEffects = [...this.tempCharacter.activeEffects];
            const currentEquippedArmorId = this.tempCharacter.equippedArmorId;
            const currentEquippedWeaponIds = [...this.tempCharacter.equippedWeaponIds];
            const currentActiveStance = this.tempCharacter.activeStance;
            const currentConditions = [...this.tempCharacter.conditions];

            // 2. Clear all active effects on the tempCharacter.
            this.tempCharacter.activeEffects = [];
            // This step is critical: ensure all CalculatedStats remove modifiers from old effects
            // before new ones are applied. The `removeEffectsFromSource` is designed for a sourceId.
            // We need a way to clear *all* modifiers from all CalculatedStats.
            // The `initializeCharacter` call in the constructor effectively did this by creating new instances.
            // So, no need to manually clear. The fresh `activeEffects` array is already empty.

            // 3. Re-apply effects from original sources that are still "active" on tempCharacter.
            // This includes features, loadout cards, equipped items, and active stances/conditions.

            // Re-apply features
            this.tempCharacter.features.forEach(feat => addEffectsFromSource(this.tempCharacter, feat));
            // Re-apply loadout cards
            this.tempCharacter.loadout.forEach(card => addEffectsFromSource(this.tempCharacter, card));
            // Re-apply equipped armor
            if (currentEquippedArmorId) {
                const armor = this.tempCharacter.inventory.find(i => i.instanceId === currentEquippedArmorId);
                if (armor) addEffectsFromSource(this.tempCharacter, armor);
            }
            // Re-apply equipped weapons
            currentEquippedWeaponIds.forEach(weaponId => {
                const weapon = this.tempCharacter.inventory.find(i => i.instanceId === weaponId);
                if (weapon) addEffectsFromSource(this.tempCharacter, weapon);
            });
            // Re-apply active stance
            if (currentActiveStance) {
                const activeStanceData = this.plugin.compendium.stances.find(s => s.name === currentActiveStance);
                if (activeStanceData) {
                    const effectSource: DomainCard = { // Cast to DomainCard for addEffectsFromSource
                        _type: 'domainCard',
                        id: activeStanceData.name,
                        name: activeStanceData.name,
                        description: activeStanceData.description,
                        effects: activeStanceData.effects,
                        level: activeStanceData.tier,
                        domain: 'Stance',
                        type: 'Ability',
                        recall: 0,
                    };
                    addEffectsFromSource(this.tempCharacter, effectSource);
                }
            }
            // Re-apply conditions
            currentConditions.forEach(condition => addEffectsFromSource(this.tempCharacter, condition));


            // Finally, save the modified and re-effected character.
            this.onSave(this.tempCharacter);
            this.close();
        });
    }

    public onClose() { // Changed from 'private' to 'public' to match base Modal class
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
            .setName('Proficiency (Base)')
            .addText(text => text
                .setValue(String(this.tempCharacter.proficiency.base))
                .onChange(value => this.tempCharacter.proficiency.base = parseInt(value) || 0));

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
        new Setting(grid).setName("Max HP (Base)").addText(text => text.setValue(String(this.tempCharacter.hitPoints.max.base)).onChange(v => this.tempCharacter.hitPoints.max.base = parseInt(v) || 0));
        new Setting(grid).setName("Current HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.current)).onChange(v => this.tempCharacter.hitPoints.current = parseInt(v) || 0));
        new Setting(grid).setName("Max Stress (Base)").addText(text => text.setValue(String(this.tempCharacter.stress.max.base)).onChange(v => this.tempCharacter.stress.max.base = parseInt(v) || 0));
        new Setting(grid).setName("Current Stress").addText(text => text.setValue(String(this.tempCharacter.stress.current)).onChange(v => this.tempCharacter.stress.current = parseInt(v) || 0));
        new Setting(grid).setName("Max Hope (Base)").addText(text => text.setValue(String(this.tempCharacter.hope.max.base)).onChange(v => this.tempCharacter.hope.max.base = parseInt(v) || 0));
        new Setting(grid).setName("Current Hope").addText(text => text.setValue(String(this.tempCharacter.hope.current)).onChange(v => this.tempCharacter.hope.current = parseInt(v) || 0));

        new Setting(grid)
            .setName("Evasion Override")
            .setDesc(`Final Value: ${this.tempCharacter.evasion.getValue(this.tempCharacter)}`)
            .addText(text => text
                .setPlaceholder('Empty for auto')
                .setValue(this.tempCharacter.evasion.overrideValue === null ? '' : String(this.tempCharacter.evasion.overrideValue))
                .onChange(value => {
                    if (value.trim() === '') {
                        this.tempCharacter.evasion.overrideValue = null;
                    } else {
                        const num = parseInt(value);
                        this.tempCharacter.evasion.overrideValue = isNaN(num) ? null : num;
                    }
                    this.saveSectionStates();
                    this.onOpen();
                }));

        new Setting(grid)
            .setName("Armor Score / Slots Override")
            .setDesc(`Final Value: ${this.tempCharacter.armorSlots.max.getValue(this.tempCharacter)}`)
            .addText(text => text
                .setPlaceholder('Empty for auto')
                .setValue(this.tempCharacter.armorSlots.max.overrideValue === null ? '' : String(this.tempCharacter.armorSlots.max.overrideValue))
                .onChange(value => {
                    if (value.trim() === '') {
                        this.tempCharacter.armorSlots.max.overrideValue = null;
                    } else {
                        const num = parseInt(value);
                        this.tempCharacter.armorSlots.max.overrideValue = isNaN(num) ? null : num;
                    }
                    this.saveSectionStates();
                    this.onOpen(); // Redraw to show the new final value
                }));

        new Setting(grid).setName("Current Armor Slots").addText(text => text.setValue(String(this.tempCharacter.armorSlots.current)).onChange(v => this.tempCharacter.armorSlots.current = parseInt(v) || 0));

        new Setting(grid)
            .setName("Major Threshold Override")
            .setDesc(`Final Value: ${this.tempCharacter.damageThresholds.major.getValue(this.tempCharacter)}`)
            .addText(text => text
                .setPlaceholder('Empty for auto')
                .setValue(this.tempCharacter.damageThresholds.major.overrideValue === null ? '' : String(this.tempCharacter.damageThresholds.major.overrideValue))
                .onChange(value => {
                    if (value.trim() === '') {
                        this.tempCharacter.damageThresholds.major.overrideValue = null;
                    } else {
                        const num = parseInt(value);
                        this.tempCharacter.damageThresholds.major.overrideValue = isNaN(num) ? null : num;
                    }
                    this.saveSectionStates();
                    this.onOpen();
                }));

        new Setting(grid)
            .setName("Severe Threshold Override")
            .setDesc(`Final Value: ${this.tempCharacter.damageThresholds.severe.getValue(this.tempCharacter)}`)
            .addText(text => text
                .setPlaceholder('Empty for auto')
                .setValue(this.tempCharacter.damageThresholds.severe.overrideValue === null ? '' : String(this.tempCharacter.damageThresholds.severe.overrideValue))
                .onChange(value => {
                    if (value.trim() === '') {
                        this.tempCharacter.damageThresholds.severe.overrideValue = null;
                    } else {
                        const num = parseInt(value);
                        this.tempCharacter.damageThresholds.severe.overrideValue = isNaN(num) ? null : num;
                    }
                    this.saveSectionStates();
                    this.onOpen();
                }));

        // Unarmed Damage (Base Flat Bonus)
        new Setting(grid)
            .setName('Unarmed Damage (Base Flat Bonus)')
            .setDesc(`Final Value: ${this.tempCharacter.unarmedDamage.flatBonus.getValue(this.tempCharacter)}`)
            .addText(text => {
                text.setValue(String(this.tempCharacter.unarmedDamage.flatBonus.base)).onChange(value => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue)) {
                        this.tempCharacter.unarmedDamage.flatBonus.base = numValue;
                        this.saveSectionStates();
                        this.onOpen();
                    }
                });
            });

        // Unarmed Dice Count (Base)
        new Setting(grid)
            .setName('Unarmed Dice Count (Base)')
            .setDesc(`Final Value: ${this.tempCharacter.unarmedDamage.numberOfDice.getValue(this.tempCharacter)}`)
            .addText(text => {
                text.setValue(String(this.tempCharacter.unarmedDamage.numberOfDice.base)).onChange(value => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.tempCharacter.unarmedDamage.numberOfDice.base = numValue;
                        this.saveSectionStates();
                        this.onOpen();
                    }
                });
            });
    }

    private drawActiveEffects(parent: HTMLElement) {
        parent.createEl('p', { text: "Here you can see all active mechanical effects on your character from items, features, and other sources. You can temporarily disable an effect here for narrative reasons without unequipping the source.", cls: 'setting-item-description' });

        if (!this.tempCharacter.activeEffects || this.tempCharacter.activeEffects.length === 0) {
            parent.createEl('p', { text: 'No active effects.', cls: 'dh-empty-text' });
            return;
        }

        this.tempCharacter.activeEffects.forEach(effect => {
            const modSummary = effect.modifications.map(mod => {
                let str = `${mod.target} ${mod.type} ${JSON.stringify(mod.value)}`;
                if (mod.condition) {
                    str += ` when ${mod.condition.target} ${mod.condition.operator} ${JSON.stringify(mod.condition.value)}`;
                }
                return str;
            }).join(', ');

            new Setting(parent)
                .setName(effect.sourceName)
                .setDesc(modSummary)
                .addToggle(toggle => toggle
                    .setValue(effect.isEnabled)
                    .onChange(value => {
                        effect.isEnabled = value;
                    }));
        });
    }

    private drawStances(parent: HTMLElement) {
        const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId || '');
        const isMartialArtist = subclass?.name.toLowerCase().includes('martial artist');

        if (!isMartialArtist) {
            parent.parentElement?.remove(); // Remove the entire section if not a Martial Artist
            return;
        }

        if (!this.tempCharacter.equippedStances) {
            this.tempCharacter.equippedStances = [];
        }

        const redraw = () => {
            parent.empty();
            parent.createEl('p', { text: "Directly manage your Martial Artist's learned stances.", cls: 'setting-item-description' });

            this.tempCharacter.equippedStances?.forEach((stanceName, index) => {
                new Setting(parent)
                    .setName(stanceName)
                    .addExtraButton(btn => btn
                        .setIcon('trash')
                        .setTooltip('Remove Stance')
                        .onClick(() => {
                            this.tempCharacter.equippedStances?.splice(index, 1);
                            if (this.tempCharacter.activeStance === stanceName) {
                                this.tempCharacter.activeStance = ''; // Unset active if removed
                            }
                            this.saveSectionStates(); // Save state before redraw
                            this.onOpen(); // Redraw the modal
                        }));
            });

            const addSetting = new Setting(parent)
                .setName('Add a Stance');

            const availableStances = this.plugin.compendium.stances
                .filter(s => !(this.tempCharacter.equippedStances || []).includes(s.name));

            let selectedStance = '';
            addSetting.addDropdown(dd => {
                dd.addOption('', '--- Select a Stance to Add ---');
                availableStances.forEach(s => dd.addOption(s.name, `${s.name} (Tier ${s.tier})`));
                dd.onChange(val => selectedStance = val);
            });

            addSetting.addButton(btn => btn
                .setButtonText('Add')
                .onClick(() => {
                    if (selectedStance) {
                        this.tempCharacter.equippedStances?.push(selectedStance);
                        this.saveSectionStates(); // Save state before redraw
                        this.onOpen(); // Redraw the modal
                    } else {
                        new Notice('Please select a stance to add.');
                    }
                }));
        };

        redraw();
    }
    private drawTraits(parent: HTMLElement) {
        const grid = parent.createDiv({ cls: 'is-grid' });
        TRAIT_NAMES.forEach(traitName => {
            new Setting(grid)
                .setName(traitName)
                .addText(text => text
                    .setValue(String(this.tempCharacter.traits[traitName].base))
                    .onChange(value => {
                        this.tempCharacter.traits[traitName].base = parseInt(value) || 0;
                        this.saveSectionStates(); // Save state before redraw
                        this.onOpen(); // Redraw to show updated final values
                    })
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
                        // If switching to mixed, set ancestryId to a temp name (or leave for user input later)
                        // It's crucial for CharacterCreator that ancestryId matches the final mixed name.
                        // Here, we can just clear it and rely on user input for the mixed name.
                        this.tempCharacter.ancestryId = 'Mixed Ancestry'; // Placeholder
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
                        this.tempCharacter.subclassId = ''; // Clear subclass when class changes
                        const newClass = this.plugin.compendium.getClass(value);
                        // Default spellcast trait to primary subclass if no multiclass, or clear if class has none.
                        const defaultSubclass = newClass ? this.plugin.compendium.getSubclass(newClass.subclass_1) : null;
                        if (!this.tempCharacter.multiclassClassId) {
                            this.tempCharacter.spellCastTrait = defaultSubclass?.spellcast_trait || null;
                        }
                        this.saveSectionStates();
                        this.onOpen();
                    });
            });

        new Setting(grid)
            .setName('Subclass')
            .addDropdown(dd => {
                const charClass = this.plugin.compendium.getClass(this.tempCharacter.classId);
                dd.addOption('', 'None'); // Option for no subclass selected
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

                        // Logic to determine spellcast trait based on primary and multiclass
                        if (!this.tempCharacter.multiclassClassId) {
                            this.tempCharacter.spellCastTrait = newSubclass?.spellcast_trait || null;
                        } else {
                            const primarySubclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
                            const multiSubclass = this.plugin.compendium.getSubclass(this.tempCharacter.multiclassSubclassId || '');
                            const suggestedTraits = new Set<string>();
                            if (primarySubclass?.spellcast_trait) suggestedTraits.add(primarySubclass.spellcast_trait);
                            if (multiSubclass?.spellcast_trait) suggestedTraits.add(multiSubclass.spellcast_trait);

                            if (!this.tempCharacter.spellCastTrait || !suggestedTraits.has(this.tempCharacter.spellCastTrait)) {
                                this.tempCharacter.spellCastTrait = Array.from(suggestedTraits)[0] || null; // Default to first suggested
                            }
                        }
                        this.saveSectionStates();
                        this.onOpen(); // Redraw to update related sections if needed
                    });
            });

        // Determine suggested spellcasting traits from current primary and multiclass subclasses
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
                    .onChange(value => {
                        this.tempCharacter.ancestryId = value;
                        this.saveSectionStates();
                        this.onOpen();
                    });
            });
    }
    private drawMixedAncestryEditor(parent: HTMLElement) {
        new Setting(parent)
            .setName('Heritage Name')
            .setDesc('e.g., Goblin-Orc, Half-Elf. This will be your character\'s ancestry name.')
            .addText(text => text
                .setValue(this.tempCharacter.ancestryId)
                .onChange(value => this.tempCharacter.ancestryId = value));

        new Setting(parent)
            .setName('First Ancestry (Feature 1)')
            .setDesc('You will gain the first feature from this ancestry.')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.parentAncestry1)
                    .onChange(val => {
                        this.parentAncestry1 = val;
                        this.saveSectionStates();
                        this.onOpen();
                    });
            });

        new Setting(parent)
            .setName('Second Ancestry (Feature 2)')
            .setDesc('You will gain the second feature from this ancestry.')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.parentAncestry2)
                    .onChange(val => {
                        this.parentAncestry2 = val;
                        this.saveSectionStates();
                        this.onOpen();
                    });
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
                            this.saveSectionStates(); // Save state before redraw
                            this.onOpen(); // Redraw the modal
                        }));
                setting.nameEl.setText(`Experience ${index + 1}`);
            });

            new Setting(parent).addButton(btn => btn.setButtonText("Add Experience").onClick(() => {
                this.tempCharacter.experiences.push({ _type: 'experience', id: uuidv4(), name: '', value: 0 });
                this.saveSectionStates(); // Save state before redraw
                this.onOpen(); // Redraw the modal
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
                        // After CardSwapModal closes and updates tempChar, re-open this modal to refresh
                        this.onOpen();
                    }).open();
                }));

        const cardListsContainer = container.createDiv({ cls: 'dh-manager-card-lists' });

        if (!this.tempCharacter.loadout) this.tempCharacter.loadout = [];
        if (!this.tempCharacter.vault) this.tempCharacter.vault = [];

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
                this.saveSectionStates();
                this.onOpen();
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