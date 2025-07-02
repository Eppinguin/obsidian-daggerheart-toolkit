// src/modals/LevelUpModal.ts
import { App, Modal, Setting, Notice, TextComponent, ExtraButtonComponent } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import { Character, LevelUpSelection, DomainCard, JsonAbility, Trait, Experience, InventoryItem, JsonSubclass } from '../../types';
import { renderMarkdown } from '../rendering/ui-helpers';
import { TRAIT_NAMES } from '../constants';

export class LevelUpModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;

    private tempCharacter: Character;
    private originalCharacter: Character;
    private levelUpContainer: HTMLElement;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.originalCharacter = character;
        this.tempCharacter = JSON.parse(JSON.stringify(character));
        this.onSave = onSave;
        this.modalEl.addClass('dh-level-up-modal');

        if (!this.tempCharacter.levelUpHistory) {
            this.tempCharacter.levelUpHistory = {};
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h1", { text: `Level Up Manager for ${this.character.name}` });

        this.drawLevelController(contentEl);

        contentEl.createEl("p", { text: "Manage the choices for each level. All stats will be recalculated and applied when you save." });

        this.levelUpContainer = contentEl.createDiv('dh-level-up-container');
        this.drawLevelUpInterface();

        const footer = contentEl.createDiv({ cls: 'dh-modal-footer' });
        footer.createEl('button', { text: 'Save & Apply Changes', cls: 'mod-cta' }).addEventListener('click', () => {
            this.recalculateAndApplyChanges();
            this.onSave(this.tempCharacter);
            this.close();
        });
    }

    private drawLevelController(parent: HTMLElement) {
        const setting = new Setting(parent)
            .setName('Character Level')
            .setDesc("Set your character's new level.");

        setting.controlEl.addClass('dh-level-controller-controls');

        new ExtraButtonComponent(setting.controlEl)
            .setIcon('minus')
            .setTooltip('Decrease Level')
            .onClick(() => {
                if (this.tempCharacter.level > 1) {
                    this.tempCharacter.level--;
                    this.onOpen();
                }
            });

        setting.controlEl.createDiv({
            text: String(this.tempCharacter.level),
            cls: 'dh-level-display-text'
        });

        new ExtraButtonComponent(setting.controlEl)
            .setIcon('plus')
            .setTooltip('Increase Level')
            .onClick(() => {
                if (this.tempCharacter.level < 10) {
                    this.tempCharacter.level++;
                    this.onOpen();
                }
            });
    }

    private drawLevelUpInterface() {
        this.levelUpContainer.empty();
        for (let level = 2; level <= this.tempCharacter.level; level++) {
            this.drawLevelEntry(this.levelUpContainer, level);
        }
    }

    private drawLevelEntry(parent: HTMLElement, level: number) {
        const entryContainer = parent.createDiv({ cls: 'dh-level-entry' });
        entryContainer.createEl('h2', { text: `Level ${level}` });

        if (!this.tempCharacter.levelUpHistory[level]) {
            this.tempCharacter.levelUpHistory[level] = {
                advancements: [null, null],
                domainCardId: null,
                newExperienceName: (level === 2 || level === 5 || level === 8) ? `Level ${level} Experience` : undefined
            };
        }
        // Ensure newExperienceName exists for relevant levels if history is old
        if ((level === 2 || level === 5 || level === 8) && !this.tempCharacter.levelUpHistory[level].newExperienceName) {
            this.tempCharacter.levelUpHistory[level].newExperienceName = `Level ${level} Experience`;
        }

        const selection = this.tempCharacter.levelUpHistory[level];

        // --- Automatic Advancements (Tier Achievements) ---
        if (level === 2 || level === 5 || level === 8) {
            const autoContainer = entryContainer.createDiv({ cls: 'dh-automatic-advancements' });
            autoContainer.createEl('h3', { text: 'Tier Achievement' });
            const list = autoContainer.createEl('ul');
            list.createEl('li', { text: 'Increase Proficiency by +1' });

            // New Experience Input
            const expLi = list.createEl('li');
            new Setting(expLi)
                .setName('Gain a new Experience at +2')
                .addText(text => {
                    text.setPlaceholder('Name your new experience')
                        .setValue(selection.newExperienceName || '')
                        .onChange(value => {
                            selection.newExperienceName = value;
                        });
                });

            if (level === 5 || level === 8) {
                list.createEl('li', { text: 'Clear all marked traits' });
            }
        }

        const advancementOptions = this.getAdvancementOptions(level);

        // Advancements
        entryContainer.createEl('h3', { text: 'Your Advancements' });
        const advancementContainer = entryContainer.createDiv({ cls: 'dh-advancement-container' });

        const isCostly = (id: string | undefined | null) => id === 'increase_proficiency' || id === 'multiclass';

        for (let i = 0; i < 2; i++) {
            const choiceContainer = advancementContainer.createDiv({ cls: 'dh-advancement-choice' });
            const otherChoiceIndex = 1 - i;
            const isOtherChoiceCostly = isCostly(selection.advancements[otherChoiceIndex]?.id);

            new Setting(choiceContainer)
                .setName(`Choice ${i + 1}`)
                .addDropdown(dd => {
                    const currentAdvancement = selection.advancements[i];

                    if (isOtherChoiceCostly) {
                        dd.addOption('', '--- (Used by other choice) ---');
                        dd.setValue('');
                        dd.setDisabled(true);
                        return;
                    }

                    dd.addOption('', '--- Select Advancement ---');
                    advancementOptions.forEach(opt => {
                        dd.addOption(opt.id, opt.name);
                    });

                    // Defensive patch: if the current value isn't in the options list, add it.
                    // This ensures the dropdown always displays the saved value correctly.
                    if (currentAdvancement?.id && !advancementOptions.some(opt => opt.id === currentAdvancement.id)) {
                        const optionName = this.getAdvancementNameById(currentAdvancement.id);
                        if (optionName) {
                            dd.addOption(currentAdvancement.id, optionName);
                        }
                    }

                    dd.setValue(currentAdvancement?.id || '');

                    dd.onChange(value => {
                        // Only reset choices if the advancement type actually changes.
                        if (currentAdvancement?.id !== value) {
                            selection.advancements[i] = value ? { id: value, choices: [] } : null;
                        } else if (!value) {
                            selection.advancements[i] = null;
                        }


                        // If the new choice is costly, nullify the other choice.
                        if (isCostly(value)) {
                            selection.advancements[otherChoiceIndex] = null;
                        }

                        this.drawLevelUpInterface();
                    });
                });

            if (!isOtherChoiceCostly && selection.advancements[i]) {
                this.drawAdvancementDetails(choiceContainer.createDiv(), selection.advancements[i], level, i);
            }
        }

        // Domain Card
        entryContainer.createEl('h3', { text: 'Domain Card' });
        const domainContainer = entryContainer.createDiv();
        const extraCardChoice = selection.advancements.find(a => a?.id === 'take_domain_card')?.choices[0];
        let domainCardOptions = this.getDomainCardOptions(level, extraCardChoice ? [extraCardChoice] : []);
        const mainCardChoice = selection.domainCardId;

        const mainCardChoiceAbility = mainCardChoice ? this.plugin.compendium.abilities.find(a => a.name === mainCardChoice) : undefined;
        if (mainCardChoiceAbility && !domainCardOptions.some(opt => opt.name === mainCardChoiceAbility.name)) {
            domainCardOptions.push(mainCardChoiceAbility);
            domainCardOptions.sort((a, b) => parseInt(a.level) - parseInt(b.level) || a.name.localeCompare(b.name));
        }

        new Setting(domainContainer)
            .setName('New Domain Card')
            .addDropdown(dd => {
                dd.addOption('', '--- Select Domain Card ---');
                domainCardOptions.forEach(card => dd.addOption(card.name, `${card.name} (Lvl ${card.level} ${card.domain})`));
                dd.setValue(selection.domainCardId || '');
                dd.onChange(value => {
                    selection.domainCardId = value || null;
                    this.drawLevelUpInterface();
                });
            });

        this.redrawDomainCardPreview(domainContainer, selection.domainCardId);
    }

    private drawAdvancementDetails(parent: HTMLElement, advancement: LevelUpSelection['advancements'][0], level: number, choiceIndex: number) {
        parent.empty();
        if (!advancement) return;

        const selection = this.tempCharacter.levelUpHistory[level];

        switch (advancement.id) {
            case 'increase_traits': {
                parent.addClass('dh-advancement-details');
                const availableTraits = TRAIT_NAMES;
                const allSelectedTraitsInLevel = selection.advancements
                    .filter(a => a?.id === 'increase_traits' && a.choices)
                    .flatMap(a => a!.choices)
                    .filter(c => c);

                for (let i = 0; i < 2; i++) {
                    const currentChoice = advancement.choices[i];
                    const filteredAvailableTraits = availableTraits.filter(t => !allSelectedTraitsInLevel.includes(t) || t === currentChoice);

                    new Setting(parent).setName(`Trait ${i + 1}`).addDropdown(dd => {
                        dd.addOption('', '---');
                        filteredAvailableTraits.forEach(t => dd.addOption(t, t));
                        dd.setValue(currentChoice ?? '');
                        dd.onChange(value => {
                            advancement.choices[i] = value || '';
                            this.drawLevelUpInterface();
                        });
                    });
                }
                break;
            }
            case 'increase_experience': {
                parent.addClass('dh-advancement-details');
                const allSelectedExpsInLevel = selection.advancements
                    .filter(a => a?.id === 'increase_experience' && a.choices)
                    .flatMap(a => a!.choices)
                    .filter(c => c);

                for (let i = 0; i < 2; i++) {
                    const currentChoice = advancement.choices[i];
                    const availableExperiences = this.tempCharacter.experiences.filter(e => !allSelectedExpsInLevel.includes(e.id) || e.id === currentChoice);

                    new Setting(parent).setName(`Experience ${i + 1}`).addDropdown(dd => {
                        dd.addOption('', '---');
                        availableExperiences.forEach(e => dd.addOption(e.id, e.name));
                        dd.setValue(currentChoice ?? '');
                        dd.onChange(value => {
                            advancement.choices[i] = value || '';
                            this.drawLevelUpInterface();
                        });
                    });
                }
                break;
            }
            case 'take_domain_card': {
                parent.addClass('dh-advancement-details');
                const mainCardChoice = selection.domainCardId;
                let domainCardOptions = this.getDomainCardOptions(level, mainCardChoice ? [mainCardChoice] : []);
                const currentChoice = advancement.choices[0];

                const currentChoiceAbility = currentChoice ? this.plugin.compendium.abilities.find(a => a.name === currentChoice) : undefined;
                if (currentChoiceAbility && !domainCardOptions.some(opt => opt.name === currentChoiceAbility.name)) {
                    domainCardOptions.push(currentChoiceAbility);
                    domainCardOptions.sort((a, b) => parseInt(a.level) - parseInt(b.level) || a.name.localeCompare(b.name));
                }

                new Setting(parent).setName('Extra Domain Card').addDropdown(dd => {
                    dd.addOption('', '---');
                    domainCardOptions.forEach(c => dd.addOption(c.name, `${c.name} (Lvl ${c.level} ${c.domain})`));
                    dd.setValue(currentChoice ?? '');
                    dd.onChange(value => {
                        advancement.choices[0] = value || '';
                        this.drawLevelUpInterface();
                    });
                });
                this.redrawDomainCardPreview(parent, currentChoice);
                break;
            }
            case 'multiclass': {
                parent.addClass('dh-advancement-details');
                // Ensure choices is an array of at least 3 elements to avoid errors
                if (!Array.isArray(advancement.choices) || advancement.choices.length < 3) {
                    advancement.choices = ['', '', ''];
                }
                const [selectedClassId, selectedSubclassId, selectedDomainId] = advancement.choices;

                // Class Dropdown
                new Setting(parent).setName('New Class').addDropdown(dd => {
                    dd.addOption('', '--- Select Class ---');
                    this.plugin.compendium.classes
                        .filter(c => c.name !== this.originalCharacter.classId) // Exclude primary class
                        .forEach(c => dd.addOption(c.name, c.name));
                    dd.setValue(selectedClassId ?? '');
                    dd.onChange(value => {
                        advancement.choices = [value, '', '']; // Reset subclass and domain on class change
                        this.drawLevelUpInterface();
                    });
                });

                const selectedClass = this.plugin.compendium.getClass(selectedClassId);

                if (selectedClass) {
                    // Subclass Dropdown
                    const availableSubclasses = [
                        this.plugin.compendium.getSubclass(selectedClass.subclass_1),
                        this.plugin.compendium.getSubclass(selectedClass.subclass_2)
                    ].filter((s): s is JsonSubclass => !!s);

                    new Setting(parent).setName('New Subclass').addDropdown(dd => {
                        dd.addOption('', '--- Select Subclass ---');
                        availableSubclasses.forEach(sub => dd.addOption(sub.name, sub.name));
                        dd.setValue(selectedSubclassId ?? '');
                        dd.onChange(value => {
                            advancement.choices[1] = value;
                            this.drawLevelUpInterface();
                        });
                    });

                    // Domain Dropdown
                    const availableDomains = [selectedClass.domain_1, selectedClass.domain_2];
                    new Setting(parent).setName('New Domain').addDropdown(dd => {
                        dd.addOption('', '--- Select Domain ---');
                        availableDomains.forEach(domain => dd.addOption(domain, domain));
                        dd.setValue(selectedDomainId ?? '');
                        dd.onChange(value => {
                            advancement.choices[2] = value;
                            this.drawLevelUpInterface();
                        });
                    });
                }
                break;
            }
        }
    }


    private redrawDomainCardPreview(parent: HTMLElement, cardId: string | null) {
        let previewEl = parent.querySelector('.dh-domain-card-preview');
        if (previewEl) {
            previewEl.remove();
        }
        if (!cardId) return;

        const card = this.plugin.compendium.abilities.find(a => a.name === cardId);
        if (card) {
            previewEl = parent.createDiv({ cls: 'dh-domain-card-preview' });
            previewEl.createEl('h4', { text: card.name });
            renderMarkdown(this.plugin, card.text, previewEl.createDiv());
        }
    }

    private getAdvancementNameById(id: string): string | null {
        switch (id) {
            case 'increase_traits': return 'Increase two character traits';
            case 'add_hp': return 'Add 1 Hit Point slot';
            case 'add_stress': return 'Add 1 Stress slot';
            case 'increase_experience': return 'Increase two Experiences';
            case 'take_domain_card': return 'Take an additional domain card';
            case 'increase_evasion': return 'Increase Evasion by +1';
            case 'increase_proficiency': return 'Increase Proficiency by +1 (Costs 2 choices)';
            case 'multiclass': return 'Multiclass (Costs 2 choices)';
            case 'upgrade_subclass': {
                const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
                if (!subclass) return 'Upgrade Subclass';
                const hasSpecialization = this.tempCharacter.features.some(f => subclass.specializations.some(s => s.name === f.name))
                    || Object.values(this.tempCharacter.levelUpHistory).some(h => h.advancements.some(a => a?.id === 'upgrade_subclass'));
                return `Take ${hasSpecialization ? 'Mastery' : 'Specialization'} card`;
            }
            default: return null;
        }
    }

    private getAdvancementOptions(level: number): { id: string, name: string }[] {
        const tier = level >= 8 ? 4 : level >= 5 ? 3 : level >= 2 ? 2 : 1;
        const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
        if (!subclass) return [];

        const options = [
            { id: 'increase_traits', name: 'Increase two character traits' },
            { id: 'add_hp', name: 'Add 1 Hit Point slot' },
            { id: 'add_stress', name: 'Add 1 Stress slot' },
            { id: 'increase_experience', name: 'Increase two Experiences' },
            { id: 'take_domain_card', name: 'Take an additional domain card' },
            { id: 'increase_evasion', name: 'Increase Evasion by +1' },
        ];

        // --- Check history for unique, one-time choices ---
        const upgradeSubclassSelection = Object.entries(this.tempCharacter.levelUpHistory).find(([, h]) => h && h.advancements.some(a => a?.id === 'upgrade_subclass'));
        const multiclassSelection = Object.entries(this.tempCharacter.levelUpHistory).find(([, h]) => h && h.advancements.some(a => a?.id === 'multiclass'));

        // --- SUBCLASS UPGRADE ---
        // Determine state by combining base character features with choices made in the modal
        const hasSpecialization = this.tempCharacter.features.some(f => subclass.specializations.some(s => s.name === f.name)) || !!upgradeSubclassSelection;
        const hasMastery = this.tempCharacter.features.some(f => subclass.masteries.some(m => m.name === f.name));

        if (tier >= 2 && !hasMastery) {
            const upgradeLevel = upgradeSubclassSelection ? parseInt(upgradeSubclassSelection[0]) : null;
            // Show the option if it hasn't been taken yet, OR if it has been taken at the current level
            if (upgradeLevel === null || upgradeLevel === level) {
                options.push({ id: 'upgrade_subclass', name: `Take ${hasSpecialization ? 'Mastery' : 'Specialization'} card` });
            }
        }

        if (tier >= 3) {
            options.push({ id: 'increase_proficiency', name: 'Increase Proficiency by +1 (Costs 2 choices)' });
        }

        // --- MULTICLASS ---
        if (level >= 5) {
            const multiclassLevel = multiclassSelection ? parseInt(multiclassSelection[0]) : null;
            // Show the option if it hasn't been taken yet, OR if it has been taken at the current level
            if (multiclassLevel === null || multiclassLevel === level) {
                options.push({ id: 'multiclass', name: 'Multiclass (Costs 2 choices)' });
            }
        }

        return options;
    }

    private getDomainCardOptions(level: number, exclusions: string[] = []): JsonAbility[] {
        const primaryClass = this.plugin.compendium.getClass(this.character.classId);
        if (!primaryClass) return [];

        const domainsToSearch: { domain: string, maxLevel: number }[] = [
            { domain: primaryClass.domain_1.toLowerCase(), maxLevel: level },
            { domain: primaryClass.domain_2.toLowerCase(), maxLevel: level }
        ];

        // FIX: Handle potential undefined value from character type
        let multiclassDomain: string | null = this.tempCharacter.multiclassDomainId || null;
        if (!multiclassDomain) {
            for (let l = 2; l <= level; l++) {
                const history = this.tempCharacter.levelUpHistory[l];
                const multiclassAdv = history?.advancements.find(a => a?.id === 'multiclass');
                if (multiclassAdv && multiclassAdv.choices[2]) {
                    multiclassDomain = multiclassAdv.choices[2];
                    break;
                }
            }
        }

        if (multiclassDomain) {
            domainsToSearch.push({
                domain: multiclassDomain.toLowerCase(),
                maxLevel: Math.ceil(level / 2)
            });
        }

        const chosenCardIds = new Set<string>(exclusions.filter(e => e));
        for (let l = 2; l <= this.tempCharacter.level; l++) {
            const history = this.tempCharacter.levelUpHistory[l];
            if (history?.domainCardId) {
                chosenCardIds.add(history.domainCardId);
            }
            history?.advancements.forEach(adv => {
                if (adv?.id === 'take_domain_card' && adv.choices[0]) {
                    chosenCardIds.add(adv.choices[0]);
                }
            });
        }
        const initialCards = new Set(this.originalCharacter.features.map(f => f.id));

        return this.plugin.compendium.abilities.filter(ability => {
            const abilityDomain = ability.domain?.toLowerCase() || '';
            const domainInfo = domainsToSearch.find(d => d.domain === abilityDomain);

            if (!domainInfo) return false; // Not one of the character's domains

            const abilityLevel = parseInt(ability.level);
            return (
                !isNaN(abilityLevel) &&
                abilityLevel > 0 && // Exclude level 0 cards
                abilityLevel <= domainInfo.maxLevel && // Check against the correct max level
                !initialCards.has(ability.name) &&
                !chosenCardIds.has(ability.name)
            );
        }).sort((a, b) => parseInt(a.level) - parseInt(b.level) || a.name.localeCompare(b.name));
    }

    private recalculateAndApplyChanges() {
        const charClass = this.plugin.compendium.getClass(this.tempCharacter.classId);
        const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);

        if (!charClass || !subclass) {
            new Notice("Critical character data missing. Cannot apply changes.");
            return;
        }

        // --- Step 1: Create a pristine Level 1 character state ---
        // Start with a fresh copy of the original L1 character data, which we assume is stored correctly.
        // We will rebuild all stats and lists from this baseline.
        const rebuiltChar: Character = {
            ...JSON.parse(JSON.stringify(this.originalCharacter)), // Copy IDs, name, etc.
            level: 1,
            proficiency: 1,
            hitPoints: { ...this.originalCharacter.hitPoints, max: parseInt(charClass.hp) },
            stress: { ...this.originalCharacter.stress, max: 6 },
            evasion: parseInt(charClass.evasion),
            damageThresholds: { ...this.originalCharacter.damageThresholds }, // Will be recalculated in the loop
            multiclassClassId: null,
            multiclassSubclassId: null,
            multiclassDomainId: null,
            // Deep copy the original traits to avoid modifying them, we'll recalculate the values
            traits: JSON.parse(JSON.stringify(this.originalCharacter.traits)),
            // Filter features to only include true Level 1 cards (foundations, starting domains)
            features: this.originalCharacter.features.filter(f => {
                const isFoundation = subclass.foundations.some(found => found.name === f.name);
                return f.level === 1 || isFoundation;
            }),
            // Filter experiences to only include the starting ones (heuristic: they don't have a tier-based name)
            experiences: this.originalCharacter.experiences.filter(exp => {
                return ![`Level 2 Experience`, `Level 5 Experience`, `Level 8 Experience`].includes(exp.name) &&
                    !Object.values(this.originalCharacter.levelUpHistory).some(h => h?.newExperienceName === exp.name);
            }),
        };

        // Recalculate L1 Damage Thresholds based on equipped armor
        const equippedArmor = rebuiltChar.inventory.find(i => i.instanceId === rebuiltChar.equippedArmorId && i._type === 'armor') as InventoryItem & { _type: 'armor' } | undefined;
        if (equippedArmor) {
            rebuiltChar.damageThresholds.major = equippedArmor.baseThresholds.major + 1;
            rebuiltChar.damageThresholds.severe = equippedArmor.baseThresholds.severe + 1;
        } else {
            rebuiltChar.damageThresholds.major = 1;
            rebuiltChar.damageThresholds.severe = 2;
        }

        // --- Step 2: Apply the NEW level-up history to the pristine L1 character ---
        for (let level = 2; level <= this.tempCharacter.level; level++) {
            rebuiltChar.level = level;
            rebuiltChar.damageThresholds.major++;
            rebuiltChar.damageThresholds.severe++;

            if (level === 2 || level === 5 || level === 8) {
                rebuiltChar.proficiency++;
                const newExpName = this.tempCharacter.levelUpHistory[level]?.newExperienceName || `Level ${level} Experience`;
                rebuiltChar.experiences.push({ _type: 'experience', id: uuidv4(), name: newExpName, value: 2 });
                Object.values(rebuiltChar.traits).forEach(t => t.locked = false);
            }

            const selection = this.tempCharacter.levelUpHistory[level];
            if (!selection) continue;

            selection.advancements.forEach(adv => {
                if (!adv) return;
                switch (adv.id) {
                    case 'add_hp': rebuiltChar.hitPoints.max++; break;
                    case 'add_stress': rebuiltChar.stress.max++; break;
                    case 'increase_evasion': rebuiltChar.evasion++; break;
                    case 'increase_proficiency': rebuiltChar.proficiency++; break;
                    case 'increase_traits':
                        adv.choices.forEach(traitName => {
                            const traitKey = traitName as keyof typeof rebuiltChar.traits;
                            if (traitName && rebuiltChar.traits[traitKey] && !rebuiltChar.traits[traitKey].locked) {
                                rebuiltChar.traits[traitKey].value++;
                                rebuiltChar.traits[traitKey].locked = true;
                            }
                        });
                        break;
                    case 'increase_experience':
                        adv.choices.forEach(expId => {
                            const experience = rebuiltChar.experiences.find(e => e.id === expId);
                            if (experience) experience.value++;
                        });
                        break;
                    case 'upgrade_subclass':
                        const hasSpecialization = rebuiltChar.features.some(f => subclass.specializations.some(s => s.name === f.name));
                        const cardToAdd = !hasSpecialization ? subclass.specializations[0] : subclass.masteries[0];
                        if (cardToAdd && !rebuiltChar.features.some(f => f.name === cardToAdd.name)) {
                            rebuiltChar.features.push({ _type: 'domainCard', id: cardToAdd.name, name: cardToAdd.name, description: cardToAdd.text, level: 0, domain: 'Subclass', type: 'Ability', recall: 0 });
                        }
                        break;
                    case 'take_domain_card':
                        if (adv.choices[0]) {
                            const card = this.plugin.compendium.getAbility(adv.choices[0]);
                            if (card) rebuiltChar.features.push(card);
                        }
                        break;
                    case 'multiclass':
                        const [classId, subclassId, domainId] = adv.choices;
                        if (classId && subclassId && domainId) {
                            rebuiltChar.multiclassClassId = classId;
                            rebuiltChar.multiclassSubclassId = subclassId;
                            rebuiltChar.multiclassDomainId = domainId;

                            const newClass = this.plugin.compendium.getClass(classId);
                            const newSubclass = this.plugin.compendium.getSubclass(subclassId);

                            if (newClass) {
                                const classFeature: DomainCard = { _type: 'domainCard', id: newClass.hope_feat_name, name: newClass.hope_feat_name, description: newClass.hope_feat_text, level: 0, domain: 'Multiclass', type: 'Ability', recall: 0 };
                                rebuiltChar.features.push(classFeature);
                            }
                            if (newSubclass) {
                                const foundation = newSubclass.foundations[0];
                                if (foundation) {
                                    const foundationCard: DomainCard = { _type: 'domainCard', id: foundation.name, name: foundation.name, description: foundation.text, level: 0, domain: 'Multiclass', type: 'Ability', recall: 0 };
                                    rebuiltChar.features.push(foundationCard);
                                }
                            }
                        }
                        break;
                }
            });

            if (selection.domainCardId) {
                const card = this.plugin.compendium.getAbility(selection.domainCardId);
                if (card) rebuiltChar.features.push(card);
            }
        }

        // --- Step 3: Finalize and save the newly calculated character ---
        rebuiltChar.hitPoints.current = Math.min(rebuiltChar.hitPoints.current, rebuiltChar.hitPoints.max);
        rebuiltChar.stress.current = Math.min(rebuiltChar.stress.current, rebuiltChar.stress.max);

        rebuiltChar.levelUpHistory = this.tempCharacter.levelUpHistory;
        rebuiltChar.level = this.tempCharacter.level;

        this.tempCharacter = rebuiltChar;

        new Notice("Character stats recalculated and applied!");
    }


    onClose() {
        this.contentEl.empty();
    }
}
