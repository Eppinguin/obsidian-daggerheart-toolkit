// src/modals/LevelUpModal.ts
import { App, Modal, Setting, Notice, TextComponent, ExtraButtonComponent } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, LevelUpSelection as BaseLevelUpSelection, DomainCard, JsonAbility, Trait, Experience, InventoryItem, JsonSubclass, JsonFeat } from '../types';
import { renderMarkdown } from '../rendering/ui-helpers';
import { TRAIT_NAMES } from '../constants';

// Add newExperienceId to the type definition for persistent tracking.
// In a real application, this would be in types.ts
interface LevelUpSelection extends BaseLevelUpSelection {
    newExperienceId?: string;
}

export class LevelUpModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;

    private tempCharacter: Character;
    private originalCharacterState: Character; // A snapshot of the character when the modal was opened.
    private levelUpContainer: HTMLElement;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        // Deep copy for isolated editing and for the "rewind" state.
        this.originalCharacterState = JSON.parse(JSON.stringify(character));
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
            this.executeSmartRebuild();
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
                    // When decreasing level, remove the history for the level being removed.
                    delete this.tempCharacter.levelUpHistory[this.tempCharacter.level];
                    this.tempCharacter.level--;
                    this.onOpen(); // Redraw everything
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
                    this.onOpen(); // Redraw everything
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

        // Initialize level up history for the current level if it doesn't exist.
        if (!this.tempCharacter.levelUpHistory[level]) {
            this.tempCharacter.levelUpHistory[level] = {
                advancements: [null, null],
                domainCardId: null,
            };
        }
        // Ensure newExperienceName and a persistent ID exist for relevant levels.
        if (level === 2 || level === 5 || level === 8) {
            const history = this.tempCharacter.levelUpHistory[level] as LevelUpSelection;
            if (history.newExperienceName === undefined) {
                history.newExperienceName = ``;
            }
            if (!history.newExperienceId) {
                history.newExperienceId = uuidv4();
            }
        }

        const selection = this.tempCharacter.levelUpHistory[level] as LevelUpSelection;

        // --- Automatic Advancements (Tier Achievements) ---
        if (level === 2 || level === 5 || level === 8) {
            const autoContainer = entryContainer.createDiv({ cls: 'dh-automatic-advancements' });
            autoContainer.createEl('h3', { text: 'Tier Achievement' });
            const list = autoContainer.createEl('ul');
            list.createEl('li', { text: 'Increase Proficiency by +1' });

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

                    // If the saved choice is no longer valid, still show it but disabled.
                    if (currentAdvancement?.id && !advancementOptions.some(opt => opt.id === currentAdvancement.id)) {
                        const optionName = this.getAdvancementNameById(currentAdvancement.id, level);
                        if (optionName) {
                            dd.addOption(currentAdvancement.id, optionName);
                        }
                    }

                    dd.setValue(currentAdvancement?.id || '');

                    dd.onChange(value => {
                        const previousValue = selection.advancements[i]?.id;
                        if (previousValue !== value) {
                            selection.advancements[i] = value ? { id: value, choices: [] } : null;
                            this.validateAndResetSubsequentLevels(level);
                        }

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

    private getMarkedTraits(upToLevel: number): Set<string> {
        const markedTraits = new Set<string>();
        const currentTier = this.getTier(upToLevel);

        // Determine the starting level of the current tier
        const tierStartLevel = {
            2: 2,
            3: 5,
            4: 8,
        }[currentTier] || 2;

        // Iterate from the start of the tier up to the level just before the current one
        for (let l = tierStartLevel; l < upToLevel; l++) {
            const history = this.tempCharacter.levelUpHistory[l];
            if (history) {
                history.advancements.forEach(adv => {
                    if (adv?.id === 'increase_traits') {
                        adv.choices.forEach(traitName => {
                            if (traitName) {
                                markedTraits.add(traitName);
                            }
                        });
                    }
                });
            }
        }
        return markedTraits;
    }

    private drawAdvancementDetails(parent: HTMLElement, advancement: LevelUpSelection['advancements'][0], level: number, choiceIndex: number) {
        parent.empty();
        if (!advancement) return;

        const selection = this.tempCharacter.levelUpHistory[level] as LevelUpSelection;

        switch (advancement.id) {
            case 'increase_traits': {
                parent.addClass('dh-advancement-details');
                const allSelectedTraitsInLevel = selection.advancements
                    .filter(a => a?.id === 'increase_traits' && a.choices)
                    .flatMap(a => a!.choices)
                    .filter(c => c);

                const markedTraitsFromPreviousLevels = this.getMarkedTraits(level);

                for (let i = 0; i < 2; i++) {
                    const currentChoice = advancement.choices[i];

                    const filteredAvailableTraits = TRAIT_NAMES.filter(t =>
                        (!allSelectedTraitsInLevel.includes(t) && !markedTraitsFromPreviousLevels.has(t)) || t === currentChoice
                    );

                    new Setting(parent).setName(`Trait ${i + 1}`).addDropdown(dd => {
                        dd.addOption('', '---');
                        filteredAvailableTraits.forEach(t => dd.addOption(t, t));

                        if (currentChoice && !filteredAvailableTraits.includes(currentChoice as any)) {
                            dd.addOption(currentChoice, `${currentChoice} (Marked)`);
                        }

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

                // Build a temporary list of experiences available for upgrade at this point in the modal
                const experiencesAtThisLevel = [...this.originalCharacterState.experiences];
                for (let l = 2; l <= level; l++) {
                    const history = this.tempCharacter.levelUpHistory[l] as LevelUpSelection;
                    if (history?.newExperienceId && history.newExperienceName) {
                        if (!experiencesAtThisLevel.some(e => e.id === history.newExperienceId)) {
                            experiencesAtThisLevel.push({ _type: 'experience', id: history.newExperienceId, name: history.newExperienceName, value: 2 });
                        }
                    }
                }

                for (let i = 0; i < 2; i++) {
                    const currentChoice = advancement.choices[i];
                    const availableExperiences = experiencesAtThisLevel.filter(e => !allSelectedExpsInLevel.includes(e.id) || e.id === currentChoice);

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
            case 'upgrade_subclass': {
                parent.addClass('dh-advancement-details');
                const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
                if (!subclass) break;

                const ownedFeatures = this.getOwnedSubclassFeatures(level);
                const ownedSpecializations = subclass.specializations.filter(s => ownedFeatures.has(s.name));
                const ownedMasteries = subclass.masteries.filter(m => ownedFeatures.has(m.name));

                let availableUpgrades: JsonFeat[] = [];
                let upgradeType = '';

                if (ownedSpecializations.length < subclass.specializations.length) {
                    upgradeType = 'Specialization';
                    availableUpgrades = subclass.specializations.filter(s => !ownedFeatures.has(s.name));
                } else if (ownedMasteries.length < subclass.masteries.length) {
                    upgradeType = 'Mastery';
                    availableUpgrades = subclass.masteries.filter(m => !ownedFeatures.has(m.name));
                }

                if (availableUpgrades.length > 0) {
                    const currentChoice = advancement.choices[0];
                    new Setting(parent).setName(`Choose ${upgradeType} Card`).addDropdown(dd => {
                        dd.addOption('', '---');
                        availableUpgrades.forEach(feat => dd.addOption(feat.name, feat.name));
                        dd.setValue(currentChoice ?? '');
                        dd.onChange(value => {
                            advancement.choices[0] = value || '';
                            this.validateAndResetSubsequentLevels(level);
                            this.drawLevelUpInterface();
                        });
                    });
                    this.redrawDomainCardPreview(parent, currentChoice);
                } else {
                    parent.createEl('p', { text: 'No further subclass upgrades available at this time.' });
                }
                break;
            }
            case 'multiclass': {
                parent.addClass('dh-advancement-details');
                if (!Array.isArray(advancement.choices) || advancement.choices.length < 3) {
                    advancement.choices = ['', '', ''];
                }
                const [selectedClassId, selectedSubclassId, selectedDomainId] = advancement.choices;

                new Setting(parent).setName('New Class').addDropdown(dd => {
                    dd.addOption('', '--- Select Class ---');
                    this.plugin.compendium.classes
                        .filter(c => c.name !== this.originalCharacterState.classId)
                        .forEach(c => dd.addOption(c.name, c.name));
                    dd.setValue(selectedClassId ?? '');
                    dd.onChange(value => {
                        advancement.choices = [value, '', ''];
                        this.validateAndResetSubsequentLevels(level);
                        this.drawLevelUpInterface();
                    });
                });

                const selectedClass = this.plugin.compendium.getClass(selectedClassId);

                if (selectedClass) {
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
                            this.validateAndResetSubsequentLevels(level);
                            this.drawLevelUpInterface();
                        });
                    });

                    const availableDomains = [selectedClass.domain_1, selectedClass.domain_2];
                    new Setting(parent).setName('New Domain').addDropdown(dd => {
                        dd.addOption('', '--- Select Domain ---');
                        availableDomains.forEach(domain => dd.addOption(domain, domain));
                        dd.setValue(selectedDomainId ?? '');
                        dd.onChange(value => {
                            advancement.choices[2] = value;
                            this.validateAndResetSubsequentLevels(level);
                            this.drawLevelUpInterface();
                        });
                    });
                }
                break;
            }
        }
    }

    private redrawDomainCardPreview(parent: HTMLElement, cardName: string | null) {
        let previewEl = parent.querySelector('.dh-domain-card-preview');
        if (previewEl) {
            previewEl.remove();
        }
        if (!cardName) return;

        const card = this.plugin.compendium.abilities.find(a => a.name === cardName)
            || this.plugin.compendium.subclasses
                .flatMap(s => [...s.specializations, ...s.masteries])
                .find(f => f.name === cardName);

        if (card) {
            previewEl = parent.createDiv({ cls: 'dh-domain-card-preview' });
            previewEl.createEl('h4', { text: card.name });
            renderMarkdown(this.plugin, (card as JsonAbility).text || (card as JsonFeat).text, previewEl.createDiv());
        }
    }

    private getAdvancementNameById(id: string, level: number): string | null {
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

                const ownedFeatures = this.getOwnedSubclassFeatures(level);
                const ownedSpecializations = subclass.specializations.filter(s => ownedFeatures.has(s.name));

                if (ownedSpecializations.length < subclass.specializations.length) {
                    return 'Take Specialization card';
                }
                return 'Take Mastery card';
            }
            default: return null;
        }
    }

    private getOwnedSubclassFeatures(currentLevel: number): Set<string> {
        const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
        if (!subclass) return new Set();

        const owned = new Set<string>();

        // Add foundation features
        subclass.foundations.forEach(f => owned.add(f.name));

        // Add features from level up history up to the level *before* the one we're checking
        for (let l = 2; l < currentLevel; l++) {
            const history = this.tempCharacter.levelUpHistory[l] as LevelUpSelection;
            history?.advancements.forEach(adv => {
                if (adv?.id === 'upgrade_subclass' && adv.choices[0]) {
                    owned.add(adv.choices[0]);
                }
            });
        }
        return owned;
    }

    private getTier(level: number): number {
        if (level >= 8) return 4;
        if (level >= 5) return 3;
        if (level >= 2) return 2;
        return 1;
    }

    private countAdvancementsInTier(advancementId: string, tier: number, history: { [level: number]: LevelUpSelection }): number {
        const [startLevel, endLevel] = {
            2: [2, 4],
            3: [5, 7],
            4: [8, 10],
        }[tier] || [0, 0];

        let count = 0;
        for (let l = startLevel; l <= endLevel; l++) {
            const levelHistory = history[l];
            if (levelHistory) {
                count += levelHistory.advancements.filter(a => a?.id === advancementId).length;
            }
        }
        return count;
    }

    private getAdvancementOptions(level: number): { id: string, name: string }[] {
        const tier = this.getTier(level);
        const subclass = this.plugin.compendium.getSubclass(this.tempCharacter.subclassId);
        if (!subclass) return [];

        const history = this.tempCharacter.levelUpHistory as { [level: number]: LevelUpSelection };

        // Define the limits for each advancement per tier.
        const tierLimits: { [key: string]: number } = {
            'increase_traits': 3,
            'add_hp': 2,
            'add_stress': 2,
            'increase_experience': 1,
            'take_domain_card': 1,
            'increase_evasion': 1,
            'upgrade_subclass': tier >= 3 ? 1 : 0, // Tier 2 has this handled separately
            'increase_proficiency': tier >= 3 ? 1 : 0,
            'multiclass': tier >= 3 ? 1 : 0,
        };

        const potentialOptions = [
            { id: 'increase_traits', name: 'Increase two character traits' },
            { id: 'add_hp', name: 'Add 1 Hit Point slot' },
            { id: 'add_stress', name: 'Add 1 Stress slot' },
            { id: 'increase_experience', name: 'Increase two Experiences' },
            { id: 'take_domain_card', name: 'Take an additional domain card' },
            { id: 'increase_evasion', name: 'Increase Evasion by +1' },
        ];

        // Tier 2 specific: Enhanced Subclass
        if (tier === 2) {
            tierLimits['upgrade_subclass'] = 1;
        }

        // Tier 3+ options
        if (tier >= 3) {
            potentialOptions.push(
                { id: 'upgrade_subclass', name: 'Enhanced Subclass' },
                { id: 'increase_proficiency', name: 'Increase Proficiency by +1 (Costs 2 choices)' },
                { id: 'multiclass', name: 'Multiclass (Costs 2 choices)' }
            );
        }

        // Filter options based on tier limits
        const options = potentialOptions.filter(opt => {
            const countInTier = this.countAdvancementsInTier(opt.id, tier, history);
            return countInTier < tierLimits[opt.id];
        });

        // Handle mutual exclusivity for Enhanced Subclass and Multiclass within the tier
        const hasTakenSubclassUpgradeInTier = this.countAdvancementsInTier('upgrade_subclass', tier, history) > 0;
        const hasTakenMulticlassInTier = this.countAdvancementsInTier('multiclass', tier, history) > 0;

        if (hasTakenSubclassUpgradeInTier) {
            return options.filter(opt => opt.id !== 'multiclass');
        }
        if (hasTakenMulticlassInTier) {
            return options.filter(opt => opt.id !== 'upgrade_subclass');
        }

        // Final check for subclass upgrade availability (specializations/masteries)
        const upgradeSubclassOption = options.find(opt => opt.id === 'upgrade_subclass');
        if (upgradeSubclassOption) {
            const allHistoryAdvancements = Object.values(history).flatMap(h => h.advancements.map(a => a?.id));
            const upgradeSubclassCount = allHistoryAdvancements.filter(id => id === 'upgrade_subclass').length;
            const totalPossibleUpgrades = subclass.specializations.length + subclass.masteries.length;
            if (upgradeSubclassCount >= totalPossibleUpgrades) {
                return options.filter(opt => opt.id !== 'upgrade_subclass');
            }
            upgradeSubclassOption.name = this.getAdvancementNameById('upgrade_subclass', level) || 'Upgrade Subclass';
        }

        return options;
    }


    private getDomainCardOptions(level: number, exclusions: string[] = []): JsonAbility[] {
        const primaryClass = this.plugin.compendium.getClass(this.character.classId);
        if (!primaryClass) return [];

        //const tier = this.getTier(level);

        const domainsToSearch: { domain: string, maxLevel: number }[] = [
            { domain: primaryClass.domain_1.toLowerCase(), maxLevel: level },
            { domain: primaryClass.domain_2.toLowerCase(), maxLevel: level }
        ];

        let multiclassDomain: string | null = null;
        for (let l = 2; l <= this.tempCharacter.level; l++) {
            const history = this.tempCharacter.levelUpHistory[l] as LevelUpSelection;
            const multiclassAdv = history?.advancements.find(a => a?.id === 'multiclass');
            if (multiclassAdv && multiclassAdv.choices[2]) {
                multiclassDomain = multiclassAdv.choices[2];
                break;
            }
        }

        if (multiclassDomain) {
            domainsToSearch.push({
                domain: multiclassDomain.toLowerCase(),
                maxLevel: Math.ceil(level / 2) // This rule seems separate from the tier rule, keeping as is.
            });
        }

        const chosenCardNames = new Set<string>(exclusions.filter(e => e));
        for (let l = 2; l <= this.tempCharacter.level; l++) {
            const history = this.tempCharacter.levelUpHistory[l] as LevelUpSelection;
            if (history?.domainCardId) {
                chosenCardNames.add(history.domainCardId);
            }
            history?.advancements.forEach(adv => {
                if (adv?.id === 'take_domain_card' && adv.choices[0]) {
                    chosenCardNames.add(adv.choices[0]);
                }
            });
        }
        const initialCards = new Set(this.originalCharacterState.features.map(f => f.name));

        return this.plugin.compendium.abilities.filter(ability => {
            const abilityDomain = ability.domain?.toLowerCase() || '';
            const domainInfo = domainsToSearch.find(d => d.domain === abilityDomain);
            if (!domainInfo) return false;

            const abilityLevel = parseInt(ability.level);
            return (
                !isNaN(abilityLevel) &&
                abilityLevel > 0 &&
                abilityLevel <= domainInfo.maxLevel && // Check against tier-limited maxLevel
                !initialCards.has(ability.name) &&
                !chosenCardNames.has(ability.name)
            );
        }).sort((a, b) => parseInt(a.level) - parseInt(b.level) || a.name.localeCompare(b.name));
    }

    private validateAndResetSubsequentLevels(changedLevel: number) {
        let wasReset = false;
        for (let level = changedLevel + 1; level <= this.tempCharacter.level; level++) {
            const selection = this.tempCharacter.levelUpHistory[level] as LevelUpSelection;
            if (!selection) continue;

            const availableAdvancements = this.getAdvancementOptions(level).map(opt => opt.id);
            const availableCards = this.getDomainCardOptions(level).map(card => card.name);

            let resetReason = '';

            // Validate Advancements
            for (let i = 0; i < selection.advancements.length; i++) {
                const adv = selection.advancements[i];
                if (adv && !availableAdvancements.includes(adv.id)) {
                    resetReason += `Advancement choice "${this.getAdvancementNameById(adv.id, level)}" is no longer valid. `;
                    selection.advancements[i] = null;
                    wasReset = true;
                }
            }

            // Validate Domain Card
            if (selection.domainCardId && !availableCards.includes(selection.domainCardId)) {
                resetReason += `Domain card "${selection.domainCardId}" is no longer valid. `;
                selection.domainCardId = null;
                wasReset = true;
            }
        }

        if (wasReset) {
            new Notice("A change at an earlier level invalidated some of your later choices, which have been reset.", 5000);
            this.drawLevelUpInterface();
        }
    }

    private executeSmartRebuild() {
        // 1. Start with the current character state to preserve manual changes (e.g., inventory, card loadout)
        const finalChar: Character = JSON.parse(JSON.stringify(this.originalCharacterState));
        finalChar.levelUpHistory = this.tempCharacter.levelUpHistory;
        finalChar.level = this.tempCharacter.level;

        // 2. Rewind: Revert the character to a clean level 1 state, preserving only foundational attributes.
        this.rewindCharacter(finalChar);

        // 3. Fast-Forward: Apply all mechanical benefits from the new level up history.
        this.fastForwardCharacter(finalChar, finalChar.levelUpHistory as { [level: number]: LevelUpSelection });

        // 4. Finalize and Save
        new Notice("Character stats recalculated and applied!");
        this.onSave(finalChar);
    }

    private rewindCharacter(char: Character) {
        const charClass = this.plugin.compendium.getClass(char.classId);
        const subclass = this.plugin.compendium.getSubclass(char.subclassId);
        if (!charClass || !subclass) return;

        // --- Experience Rewind ---
        // Start with a copy of the experiences from the pre-modal state
        char.experiences = JSON.parse(JSON.stringify(this.originalCharacterState.experiences));
        const originalHistory = this.originalCharacterState.levelUpHistory;
        const newExpIds = new Set<string>();
        for (const level in originalHistory) {
            const history = originalHistory[level] as LevelUpSelection;
            if (history.newExperienceId) {
                newExpIds.add(history.newExperienceId);
            }
        }
        // Remove experiences created during level-ups
        char.experiences = char.experiences.filter(exp => !newExpIds.has(exp.id));
        // Revert the +1 bonuses from "increase_experience" advancements
        for (const level in originalHistory) {
            const history = originalHistory[level] as LevelUpSelection;
            history.advancements.forEach(adv => {
                if (adv?.id === 'increase_experience') {
                    adv.choices.forEach(expId => {
                        const experience = char.experiences.find(e => e.id === expId);
                        if (experience) {
                            experience.value--;
                        }
                    });
                }
            });
        }

        // --- Card Rewind ---
        const cardsToRemove = new Set<string>();
        for (const level in originalHistory) {
            const history = originalHistory[level] as LevelUpSelection;
            if (history.domainCardId) {
                cardsToRemove.add(history.domainCardId);
            }
            history.advancements.forEach(adv => {
                if (adv?.id === 'take_domain_card' && adv.choices[0]) {
                    cardsToRemove.add(adv.choices[0]);
                }
                if (adv?.id === 'upgrade_subclass' && adv.choices[0]) {
                    cardsToRemove.add(adv.choices[0]);
                }
                if (adv?.id === 'multiclass' && adv.choices[0]) {
                    const newClass = this.plugin.compendium.getClass(adv.choices[0]);
                    const newSubclass = this.plugin.compendium.getSubclass(adv.choices[1]);
                    if (newClass) {
                        cardsToRemove.add(newClass.hope_feat_name);
                        newClass.class_feats.forEach(f => cardsToRemove.add(f.name));
                    }
                    if (newSubclass) {
                        newSubclass.foundations.forEach(f => cardsToRemove.add(f.name));
                    }
                }
            });
        }
        char.features = char.features.filter(card => !cardsToRemove.has(card.name));
        char.vault = char.vault.filter(card => !cardsToRemove.has(card.name));

        // Reset stats to level 1 values
        char.proficiency = 1;
        char.hitPoints.max = parseInt(charClass.hp);
        char.stress.max = 6;
        char.evasion = parseInt(charClass.evasion);

        // Reset traits to their original values, before any level ups
        char.traits = JSON.parse(JSON.stringify(this.originalCharacterState.traits));
        for (const levelHistory of Object.values(this.originalCharacterState.levelUpHistory)) {
            levelHistory?.advancements.forEach(adv => {
                if (adv?.id === 'increase_traits') {
                    adv.choices.forEach(traitName => {
                        const traitKey = traitName as keyof typeof char.traits;
                        if (char.traits[traitKey]) {
                            char.traits[traitKey].value--;
                            char.traits[traitKey].locked = false;
                        }
                    });
                }
            });
        }

        // Reset multiclass info
        char.multiclassClassId = null;
        char.multiclassSubclassId = null;
        char.multiclassDomainId = null;
    }

    private fastForwardCharacter(char: Character, history: { [level: number]: LevelUpSelection }) {
        const charClass = this.plugin.compendium.getClass(char.classId);
        const subclass = this.plugin.compendium.getSubclass(char.subclassId);
        if (!charClass || !subclass) return;

        // Re-apply level-ups from 2 to the new target level
        for (let level = 2; level <= char.level; level++) {
            // Recalculate damage thresholds for each level
            const equippedArmor = char.inventory.find(i => i.instanceId === char.equippedArmorId && i._type === 'armor') as InventoryItem & { _type: 'armor' } | undefined;
            if (equippedArmor) {
                char.damageThresholds.major = equippedArmor.baseThresholds.major + level;
                char.damageThresholds.severe = equippedArmor.baseThresholds.severe + level;
            } else {
                char.damageThresholds.major = level;
                char.damageThresholds.severe = level * 2;
            }

            // Apply Tier Achievements
            if (level === 2 || level === 5 || level === 8) {
                char.proficiency++;
                const selectionForExp = history[level];
                if (selectionForExp?.newExperienceName && selectionForExp.newExperienceId) {
                    // Update existing experience or add new one
                    const existingExp = char.experiences.find(e => e.id === selectionForExp.newExperienceId);
                    if (existingExp) {
                        existingExp.name = selectionForExp.newExperienceName;
                    } else {
                        char.experiences.push({ _type: 'experience', id: selectionForExp.newExperienceId, name: selectionForExp.newExperienceName, value: 2 });
                    }
                }
                if (level === 5 || level === 8) {
                    Object.values(char.traits).forEach(t => t.locked = false);
                }
            }

            const selection = history[level];
            if (!selection) continue;

            const addCardToLoadoutOrVault = (card: DomainCard) => {
                if (!card) return;
                const alreadyHasCard = char.features.some(f => f.name === card.name) || char.vault.some(f => f.name === card.name);
                if (alreadyHasCard) return;

                if (char.features.length < 5) {
                    char.features.push(card);
                } else {
                    char.vault.push(card);
                }
            };

            // Apply Advancements
            selection.advancements.forEach(adv => {
                if (!adv) return;
                switch (adv.id) {
                    case 'add_hp': char.hitPoints.max++; break;
                    case 'add_stress': char.stress.max++; break;
                    case 'increase_evasion': char.evasion++; break;
                    case 'increase_proficiency': char.proficiency++; break;
                    case 'increase_traits':
                        adv.choices.forEach(traitName => {
                            const traitKey = traitName as keyof typeof char.traits;
                            if (traitName && char.traits[traitKey] && !char.traits[traitKey].locked) {
                                char.traits[traitKey].value++;
                                char.traits[traitKey].locked = true;
                            }
                        });
                        break;
                    case 'increase_experience':
                        adv.choices.forEach(expId => {
                            const experience = char.experiences.find(e => e.id === expId);
                            if (experience) {
                                experience.value++;
                            }
                        });
                        break;
                    case 'upgrade_subclass': {
                        if (adv.choices[0]) {
                            const featureName = adv.choices[0];
                            const feature = [...subclass.specializations, ...subclass.masteries].find(f => f.name === featureName);
                            if (feature) {
                                const newCard: DomainCard = { _type: 'domainCard', id: feature.name, name: feature.name, description: feature.text, level: 0, domain: 'Subclass', type: 'Ability', recall: 0, isCustom: subclass.isCustom };
                                addCardToLoadoutOrVault(newCard);
                            }
                        }
                        break;
                    }
                    case 'take_domain_card': {
                        if (adv.choices[0]) {
                            const card = this.plugin.compendium.getAbility(adv.choices[0]);
                            if (card) addCardToLoadoutOrVault(card);
                        }
                        break;
                    }
                    case 'multiclass':
                        const [classId, subclassId, domainId] = adv.choices;
                        if (classId && subclassId && domainId) {
                            char.multiclassClassId = classId;
                            char.multiclassSubclassId = subclassId;
                            char.multiclassDomainId = domainId;

                            const newClass = this.plugin.compendium.getClass(classId);
                            const newSubclass = this.plugin.compendium.getSubclass(subclassId);

                            if (newClass) {
                                const classFeature: DomainCard = { _type: 'domainCard', id: newClass.hope_feat_name, name: newClass.hope_feat_name, description: newClass.hope_feat_text, level: 0, domain: 'Multiclass', type: 'Ability', recall: 0, isCustom: newClass.isCustom };
                                addCardToLoadoutOrVault(classFeature);
                                newClass.class_feats.forEach(feat => {
                                    const cfCard: DomainCard = { _type: 'domainCard', id: feat.name, name: feat.name, description: feat.text, level: 0, domain: 'Multiclass', type: 'Ability', recall: 0, isCustom: newClass.isCustom };
                                    addCardToLoadoutOrVault(cfCard);
                                });
                            }
                            if (newSubclass) {
                                newSubclass.foundations.forEach(foundation => {
                                    const foundationCard: DomainCard = { _type: 'domainCard', id: foundation.name, name: foundation.name, description: foundation.text, level: 0, domain: 'Multiclass', type: 'Ability', recall: 0, isCustom: newSubclass.isCustom };
                                    addCardToLoadoutOrVault(foundationCard);
                                });
                            }
                        }
                        break;
                }
            });

            // Apply Domain Card
            if (selection.domainCardId) {
                const card = this.plugin.compendium.getAbility(selection.domainCardId);
                if (card) addCardToLoadoutOrVault(card);
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
