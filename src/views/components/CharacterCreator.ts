// src/views/components/CharacterCreator.ts
import { App, Notice, Setting, TFile } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import {
    Character, Trait, InventoryItem, CompendiumFeature, CompendiumItem, DomainCard, JsonAncestry, ArmorItem, WeaponItem, AvatarTransform
} from '../../../types';
import { AddItemModal, CompendiumCreatorModal, ItemEditModal } from '../../modals';
import { renderMarkdown, renderRollableContent } from '../../rendering/ui-helpers';
import { createAvatarEditor } from "./AvatarEditor";
import { CharacterSheetView } from '../CharacterSheetView';

const TRAIT_VALUES = [2, 1, 1, 0, 0, -1];
const TRAIT_NAMES: (keyof Character['traits'])[] = ['Strength', 'Agility', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];

type CreatorState = {
    name: string;
    description?: string;
    pronouns: { subject: string; object: string; };
    isMixedAncestry?: boolean;
    mixedAncestryName?: string;
    ancestryId: string;
    ancestryId2?: string;
    communityId: string;
    classId: string;
    subclassId: string;
    traits: { [key in keyof Character['traits']]?: number };
    startingWeaponIds: string[];
    startingArmorId: string;
    backgroundAnswers: string[];
    experiences: { name: string; }[];
    domainCardIds: string[];
    potionChoice: 'health' | 'stamina';
    connections: string[];
    additionalItems?: InventoryItem[];
    avatarUrl?: string;
    avatarTransform?: AvatarTransform;
    selectedClassItem: string | null;
    customClassItem?: string;
    accentColor?: string;
};

export class CharacterCreator {
    private plugin: DaggerheartStatblockPlugin;
    private view: CharacterSheetView;
    private parent: HTMLElement;
    private creatorState: Partial<CreatorState> = {};
    private creatorStep: number = 0;

    private stepContainer: HTMLElement;
    private backBtn: HTMLButtonElement;
    private nextBtn: HTMLButtonElement;

    constructor(plugin: DaggerheartStatblockPlugin, view: CharacterSheetView, parent: HTMLElement) {
        this.plugin = plugin;
        this.view = view;
        this.parent = parent;
        this.resetCreatorState();
        this.drawCharacterCreator(this.parent);
    }

    private get app(): App {
        return this.plugin.app;
    }

    private resetCreatorState() {
        this.creatorState = {
            traits: {},
            domainCardIds: [],
            backgroundAnswers: [],
            experiences: [{ name: '' }, { name: '' }],
            startingWeaponIds: [],
            potionChoice: 'health',
            connections: [],
            avatarUrl: '',
            avatarTransform: undefined,
            isMixedAncestry: false,
            additionalItems: [],
            selectedClassItem: null,
            customClassItem: '',
            accentColor: '#e5b32a',
        };
    }

    private redrawCreatorStep() {
        if (!this.stepContainer) return;
        this.stepContainer.empty();

        const steps = [
            this.drawCreatorStep1_Class.bind(this),
            this.drawCreatorStep2_Heritage.bind(this),
            this.drawCreatorStep3_Traits.bind(this),
            this.drawCreatorStep4_Equipment.bind(this),
            this.drawCreatorStep5_Background.bind(this),
            this.drawCreatorStep6_Experiences.bind(this),
            this.drawCreatorStep7_Domains.bind(this),
            this.drawCreatorStep8_Connections.bind(this),
            this.drawCreatorStep9_FinalDetails.bind(this),
        ];

        // Update step indicators in the sidebar
        const stepsNav = this.parent.querySelector('.dh-creator-steps-list');
        if (stepsNav) {
            const stepItems = stepsNav.querySelectorAll('.dh-creator-step-item');
            stepItems.forEach((item, idx) => {
                item.classList.remove('is-active', 'is-completed');
                // FIX: Cast the result to HTMLElement to satisfy setIcon's type requirement.
                const indicator = item.querySelector('.dh-creator-step-indicator') as HTMLElement;

                // This is the new logic to check for actual completion
                const isCompleted = this.isStepCompleted(idx);

                if (indicator) {
                    if (idx === this.creatorStep) {
                        item.classList.add('is-active');
                        this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'circle-dot' } }, el => {
                            indicator.empty();
                            indicator.appendChild(el);
                        });
                    } else if (isCompleted) {
                        item.classList.add('is-completed');
                        this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'check-circle' } }, el => {
                            indicator.empty();
                            indicator.appendChild(el);
                        });
                    } else {
                        this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'circle' } }, el => {
                            indicator.empty();
                            indicator.appendChild(el);
                        });
                    }
                }
            });
        }

        if (this.creatorStep < steps.length) {
            steps[this.creatorStep](this.stepContainer);
        }
        this.backBtn.style.visibility = this.creatorStep === 0 ? 'hidden' : 'visible';
        this.nextBtn.textContent = this.creatorStep === steps.length - 1 ? 'Create Character' : 'Next';
    }

    private isStepCompleted(stepIndex: number): boolean {
        const state = this.creatorState;
        switch (stepIndex) {
            case 0: // Class & Subclass
                return !!(state.classId && state.subclassId);
            case 1: // Heritage
                if (!state.communityId) return false;
                if (state.isMixedAncestry) {
                    return !!(state.mixedAncestryName && state.ancestryId && state.ancestryId2);
                } else {
                    return !!state.ancestryId;
                }
            case 2: // Traits
                const assignedTraits = Object.values(state.traits || {}).filter(v => v !== undefined);
                return assignedTraits.length === 6;
            case 3: // Equipment
                return !!(state.startingArmorId && state.startingWeaponIds && state.startingWeaponIds.length > 0);
            case 4: // Background
                // Step is not complete if no class is selected yet.
                if (!state.classId) return false;
                const charClassBg = this.plugin.compendium.getClass(state.classId);
                // If the class has no background questions, the step is considered complete.
                if (!charClassBg?.backgrounds || charClassBg.backgrounds.length === 0) return true;
                // Otherwise, check if all questions have been answered.
                return state.backgroundAnswers?.length === charClassBg.backgrounds.length && state.backgroundAnswers.every(a => a && a.trim() !== '');
            case 5: // Experiences
                return !!(state.experiences && state.experiences.length === 2 && state.experiences.every(e => e.name && e.name.trim() !== ''));
            case 6: // Domains
                return !!(state.domainCardIds && state.domainCardIds.length === 2);
            case 7: // Connections
                // Considered complete if at least one connection has been filled out.
                return !!state.connections?.some(c => c && c.trim() !== '');
            case 8: // Final Details
                return !!(state.name && state.name.trim() !== '');
            default:
                return false;
        }
    }

    private drawCharacterCreator(parent: HTMLElement) {
        const wizardWrapper = parent.createDiv({ cls: 'dh-creator-wizard' });

        // Header with title and navigation buttons
        const header = wizardWrapper.createDiv({ cls: 'dh-creator-header' });
        header.createEl('h2', { text: 'Create New Character' });
        const navButtons = header.createDiv({ cls: 'dh-creator-nav-buttons' });
        this.backBtn = navButtons.createEl('button', { text: 'Back', cls: 'dh-creator-btn' });
        this.nextBtn = navButtons.createEl('button', { text: 'Next', cls: 'dh-creator-btn mod-cta' });

        const creatorLayout = wizardWrapper.createDiv({ cls: 'dh-creator-layout' });

        // Left sidebar for steps
        const stepsNav = creatorLayout.createDiv({ cls: 'dh-creator-steps-nav' });
        const stepsList = stepsNav.createDiv({ cls: 'dh-creator-steps-list' });

        const stepLabels = [
            'Class', 'Heritage', 'Traits', 'Equipment', 'Background',
            'Experiences', 'Domains', 'Connections', 'Details'
        ];

        stepLabels.forEach((label, idx) => {
            const stepItem = stepsList.createDiv({ cls: 'dh-creator-step-item' });
            const indicator = stepItem.createDiv({ cls: 'dh-creator-step-indicator' });
            this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'circle' } }, el => indicator.appendChild(el));
            const stepLabel = stepItem.createDiv({ cls: 'dh-creator-step-label' });
            stepLabel.textContent = label;

            stepItem.addEventListener('click', () => {
                this.creatorStep = idx;
                this.redrawCreatorStep();
            });
        });

        // Main content area
        const contentWrapper = creatorLayout.createDiv({ cls: 'dh-creator-content-wrapper' });
        this.stepContainer = contentWrapper.createDiv({ cls: 'dh-creator-step-content' });

        // Event listeners for the buttons
        this.backBtn.addEventListener('click', () => {
            if (this.creatorStep > 0) {
                this.creatorStep--;
                this.redrawCreatorStep();
            }
        });

        this.nextBtn.addEventListener('click', async () => {
            const steps = 9;
            if (this.creatorStep === steps - 1) {
                await this.finalizeCharacter(this.creatorState);
            } else if (this.creatorStep < steps - 1) {
                this.creatorStep++;
                this.redrawCreatorStep();
            }
        });

        this.redrawCreatorStep();
    }

    private drawCreatorStep1_Class(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 1: Choose your Class & Subclass' });

        const classSetting = new Setting(parent)
            .setName("Class")
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.classes.forEach(cls => dd.addOption(cls.name, cls.name));
                dd.setValue(this.creatorState.classId || '').onChange(value => {
                    this.creatorState.classId = value;
                    this.creatorState.subclassId = undefined;
                    this.redrawCreatorStep();
                });
            });

        const selectedClass = this.plugin.compendium.getClass(this.creatorState.classId || '');

        if (selectedClass) {
            classSetting.addButton(btn => {
                btn.setIcon('pencil').setTooltip('Edit class').onClick(() => {
                    new CompendiumCreatorModal(this.app, this.plugin, 'Class', selectedClass).open();
                });
            });
        }

        if (selectedClass) {
            const subclassSetting = new Setting(parent).setName("Subclass");
            const availableSubclasses = [
                this.plugin.compendium.getSubclass(selectedClass.subclass_1),
                this.plugin.compendium.getSubclass(selectedClass.subclass_2)
            ].filter((s): s is any => !!s);

            subclassSetting.addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                availableSubclasses.forEach(sub => dd.addOption(sub.name, sub.name));
                dd.setValue(this.creatorState.subclassId || '').onChange(value => {
                    this.creatorState.subclassId = value;
                    this.redrawCreatorStep();
                });
            });

            const selectedSubclass = this.plugin.compendium.getSubclass(this.creatorState.subclassId || '');
            if (selectedSubclass) {
                subclassSetting.addButton(btn => {
                    btn.setIcon('pencil').setTooltip('Edit subclass').onClick(() => {
                        new CompendiumCreatorModal(this.app, this.plugin, 'Subclass', selectedSubclass).open();
                    });
                });
            }
        }

        const detailsContainer = parent.createDiv({ cls: 'dh-creator-details' });
        if (selectedClass) {
            detailsContainer.createEl('h4', { text: selectedClass.name });
            if (selectedClass.description) {
                renderMarkdown(this.plugin, selectedClass.description, detailsContainer.createDiv());
            }
            detailsContainer.createEl('p', { text: `Initial HP: ${selectedClass.hp} | Initial Evasion: ${selectedClass.evasion}` });

            if (this.creatorState.subclassId) {
                const subclass = this.plugin.compendium.getSubclass(this.creatorState.subclassId);
                if (subclass) {
                    detailsContainer.createEl('h5', { text: `Subclass: ${subclass.name}` });
                    renderMarkdown(this.plugin, subclass.description, detailsContainer.createDiv());
                }
            }

            const previewContainer = parent.createDiv();
            const classFeatures: CompendiumFeature[] = selectedClass.class_feats.map(f => ({ name: f.name, description: f.text }));
            if (selectedClass.hope_feat_name) {
                classFeatures.push({ name: selectedClass.hope_feat_name, description: selectedClass.hope_feat_text });
            }
            this.drawCreatorFeaturePreview(previewContainer, 'Class Features', classFeatures);

            if (this.creatorState.subclassId) {
                const subclass = this.plugin.compendium.getSubclass(this.creatorState.subclassId);
                if (subclass) {
                    const subclassFeatures: CompendiumFeature[] = subclass.foundations.map(f => ({ name: f.name, description: f.text }));
                    this.drawCreatorFeaturePreview(previewContainer, `${subclass.name} Foundations`, subclassFeatures);
                }
            }
        }
    }

    private drawCreatorStep2_Heritage(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 2: Choose Your Heritage' });

        new Setting(parent)
            .setName('Create a Mixed Ancestry')
            .setDesc('Combine features from two different ancestries.')
            .addToggle(toggle => toggle
                .setValue(this.creatorState.isMixedAncestry || false)
                .onChange(value => {
                    this.creatorState.isMixedAncestry = value;
                    this.creatorState.ancestryId = undefined;
                    this.creatorState.ancestryId2 = undefined;
                    this.creatorState.mixedAncestryName = undefined;
                    this.redrawCreatorStep();
                }));

        if (this.creatorState.isMixedAncestry) {
            this.drawMixedAncestryCreator(parent);
        } else {
            this.drawSingleAncestryCreator(parent);
        }

        const communityContainer = parent.createDiv();
        new Setting(communityContainer).setName("Community").addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            this.plugin.compendium.communities.forEach(com => dd.addOption(com.name, com.name));
            dd.setValue(this.creatorState.communityId || '').onChange(value => {
                this.creatorState.communityId = value;
                this.redrawCreatorStep();
            });
        });

        if (this.creatorState.communityId) {
            const community = this.plugin.compendium.getCommunity(this.creatorState.communityId);
            if (community) {
                const details = communityContainer.createDiv({ cls: 'dh-creator-details' });
                details.createEl('h4', { text: community.name });
                renderMarkdown(this.plugin, community.description, details.createDiv());
                const communityFeatures: CompendiumFeature[] = community.feats.map(f => ({ name: f.name, description: f.text }));
                this.drawCreatorFeaturePreview(details, 'Community Features', communityFeatures);
            }
        }
    }

    private drawSingleAncestryCreator(parent: HTMLElement) {
        const ancestrySetting = new Setting(parent)
            .setName("Ancestry")
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(anc => dd.addOption(anc.name, anc.name));
                dd.setValue(this.creatorState.ancestryId || '').onChange(value => {
                    this.creatorState.ancestryId = value;
                    this.redrawCreatorStep();
                });
            });

        const selectedAncestry = this.plugin.compendium.getAncestry(this.creatorState.ancestryId || '');
        if (selectedAncestry) {
            ancestrySetting.addButton(btn => {
                btn.setIcon('pencil').setTooltip('Edit ancestry').onClick(() => {
                    new CompendiumCreatorModal(this.app, this.plugin, 'Ancestry', selectedAncestry).open();
                });
            });
            const details = parent.createDiv({ cls: 'dh-creator-details' });
            details.createEl('h4', { text: selectedAncestry.name });
            renderMarkdown(this.plugin, selectedAncestry.description, details.createDiv());
            const ancestryFeatures: CompendiumFeature[] = selectedAncestry.feats.map(f => ({ name: f.name, description: f.text }));
            this.drawCreatorFeaturePreview(details, 'Ancestry Features', ancestryFeatures);
        }
    }

    private drawMixedAncestryCreator(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Mixed Ancestry Details' });

        new Setting(parent)
            .setName('Mixed Ancestry Name')
            .setDesc('e.g., Goblin-Orc, Half-Elf')
            .addText(text => text
                .setPlaceholder('Enter a name for your heritage')
                .setValue(this.creatorState.mixedAncestryName || '')
                .onChange(value => this.creatorState.mixedAncestryName = value));

        new Setting(parent)
            .setName('First Ancestry')
            .setDesc('You will gain the first feature from this ancestry.')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(anc => dd.addOption(anc.name, anc.name));
                dd.setValue(this.creatorState.ancestryId || '').onChange(value => {
                    this.creatorState.ancestryId = value;
                    this.redrawCreatorStep();
                });
            });

        new Setting(parent)
            .setName('Second Ancestry')
            .setDesc('You will gain the second feature from this ancestry.')
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(anc => dd.addOption(anc.name, anc.name));
                dd.setValue(this.creatorState.ancestryId2 || '').onChange(value => {
                    this.creatorState.ancestryId2 = value;
                    this.redrawCreatorStep();
                });
            });

        const detailsContainer = parent.createDiv({ cls: 'dh-creator-details' });
        const selectedAncestry1 = this.plugin.compendium.getAncestry(this.creatorState.ancestryId || '');
        const selectedAncestry2 = this.plugin.compendium.getAncestry(this.creatorState.ancestryId2 || '');

        if (selectedAncestry1 && selectedAncestry2) {
            detailsContainer.createEl('h5', { text: 'Your Mixed Ancestry Features' });
            const features: CompendiumFeature[] = [];
            if (selectedAncestry1.feats?.[0]) {
                features.push({ name: `${selectedAncestry1.feats[0].name} (${selectedAncestry1.name})`, description: selectedAncestry1.feats[0].text });
            }
            if (selectedAncestry2.feats?.[1]) {
                features.push({ name: `${selectedAncestry2.feats[1].name} (${selectedAncestry2.name})`, description: selectedAncestry2.feats[1].text });
            }
            this.drawCreatorFeaturePreview(detailsContainer, '', features);
        }
    }

    private drawSuggestionBox(parent: HTMLElement, title: string, suggestions: { [key: string]: string; }, onApply: () => void) {
        const suggestionContainer = parent.createDiv({ cls: 'dh-suggestion-box' });

        const header = suggestionContainer.createDiv({ cls: 'dh-suggestion-header' });
        const iconEl = header.createSpan({ cls: 'dh-suggestion-icon' });
        this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'star' } }, el => iconEl.appendChild(el));
        header.createEl('h5', { text: title });

        const list = suggestionContainer.createDiv({ cls: 'dh-suggestion-list' });
        for (const [key, value] of Object.entries(suggestions)) {
            if (value) {
                const item = list.createDiv({ cls: 'dh-suggestion-item' });
                item.createSpan({ cls: 'dh-suggestion-key', text: `${key}:` });
                item.createSpan({ cls: 'dh-suggestion-value', text: value });
            }
        }

        const footer = suggestionContainer.createDiv({ cls: 'dh-suggestion-footer' });
        const applyBtn = footer.createEl('button', { text: 'Apply Suggestions', cls: 'mod-cta' });
        applyBtn.addEventListener('click', () => {
            onApply();
            this.redrawCreatorStep();
        });
    }

    private drawCreatorStep3_Traits(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 3: Assign Traits' });
        parent.createEl('p', { text: 'Assign each value (+2, +1, +1, +0, +0, -1) to one of the six traits.' });

        const selectedClass = this.plugin.compendium.getClass(this.creatorState.classId || '');

        if (this.creatorState.subclassId) {
            const subclass = this.plugin.compendium.getSubclass(this.creatorState.subclassId);
            if (subclass?.spellcast_trait) {
                const spellcastingEl = parent.createDiv({ cls: 'dh-spellcasting-trait' });
                spellcastingEl.createEl('p', {
                    text: `${subclass.name} Spellcasting Trait: ${subclass.spellcast_trait}`,
                    cls: 'mod-spellcasting'
                });
            }
        }

        if (selectedClass?.suggested_traits) {
            const traitSuggestions: { [key: string]: string } = {};
            const suggested = selectedClass.suggested_traits.split(',').map(s => s.trim());
            TRAIT_NAMES.forEach((name, i) => {
                traitSuggestions[name] = suggested[i] || 'N/A';
            });

            this.drawSuggestionBox(parent, 'Suggested Traits', traitSuggestions, () => {
                const traitValues = selectedClass.suggested_traits?.split(',').map(s => parseInt(s.trim()));
                if (traitValues && traitValues.length === TRAIT_NAMES.length) {
                    this.creatorState.traits = {};
                    TRAIT_NAMES.forEach((name, i) => {
                        if (this.creatorState.traits) {
                            this.creatorState.traits[name] = traitValues[i];
                        }
                    });
                    new Notice(`${selectedClass.name} suggested traits applied.`);
                } else {
                    new Notice('Could not apply suggested traits. Data might be malformed.');
                }
            });
        }

        const assignedValues = Object.values(this.creatorState.traits || {});
        const remainingValues = TRAIT_VALUES.filter(v => {
            const countInAssigned = assignedValues.filter(av => av === v).length;
            const countInMaster = TRAIT_VALUES.filter(tv => tv === v).length;
            return countInAssigned < countInMaster;
        });

        TRAIT_NAMES.forEach(traitName => { new Setting(parent).setName(traitName).addDropdown(dd => { dd.addOption('none', '---'); const currentValue = this.creatorState.traits ? this.creatorState.traits[traitName] : undefined; const options = (currentValue !== undefined && currentValue !== null) ? [...new Set([currentValue, ...remainingValues])].sort((a, b) => b - a) : [...new Set(remainingValues)].sort((a, b) => b - a); options.forEach(val => dd.addOption(String(val), val >= 0 ? `+${val}` : String(val))); dd.setValue(String(currentValue ?? 'none')); dd.onChange(value => { const numValue = value === 'none' ? undefined : parseInt(value); if (this.creatorState.traits) { this.creatorState.traits[traitName] = numValue; } this.redrawCreatorStep(); }); }); });
    }

    private drawCreatorStep4_Equipment(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 4: Starting Equipment' });
        const weapons = this.plugin.compendium.weapons.filter(w => (w as WeaponItem).tier === '1') as WeaponItem[];
        const armors = this.plugin.compendium.armors.filter(a => (a as ArmorItem).tier === '1') as ArmorItem[];
        const selectedClass = this.plugin.compendium.getClass(this.creatorState.classId || '');

        if (selectedClass && (selectedClass.suggested_primary || selectedClass.suggested_secondary || selectedClass.suggested_armor)) {
            const suggestions: { [key: string]: string } = {};
            if (selectedClass.suggested_primary) suggestions['Primary Weapon'] = selectedClass.suggested_primary;
            if (selectedClass.suggested_secondary) suggestions['Secondary Weapon'] = selectedClass.suggested_secondary;
            if (selectedClass.suggested_armor) suggestions['Armor'] = selectedClass.suggested_armor;

            this.drawSuggestionBox(parent, 'Suggested Equipment', suggestions, () => {
                const primary = weapons.find(w => w.name === selectedClass.suggested_primary);
                const secondary = weapons.find(w => w.name === selectedClass.suggested_secondary);
                const armor = armors.find(a => a.name === selectedClass.suggested_armor);

                if (armor) {
                    this.creatorState.startingArmorId = armor.name;
                }

                const weaponIds = [];
                if (primary) weaponIds.push(primary.name);
                if (secondary) weaponIds.push(secondary.name);
                this.creatorState.startingWeaponIds = weaponIds;

                new Notice(`${selectedClass.name} suggested equipment applied.`);
            });
        }

        new Setting(parent).setName('Primary Weapon').addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            weapons.filter(w => w.burden === 'Two-Handed').forEach(w => dd.addOption(w.name, `${w.name} (2-Handed)`));
            weapons.filter(w => w.burden === 'One-Handed').forEach(w => dd.addOption(w.name, `${w.name} (1-Handed)`));
            dd.setValue(this.creatorState.startingWeaponIds?.[0] || '').onChange(value => {
                const weapon = weapons.find(w => w.name === value);
                this.creatorState.startingWeaponIds = weapon ? [value] : [];
                this.redrawCreatorStep();
            });
        });

        const primaryWeapon = weapons.find(w => w.name === this.creatorState.startingWeaponIds?.[0]);
        if (primaryWeapon && primaryWeapon.burden === 'One-Handed') {
            const secondaryWeapons = this.plugin.compendium.weapons.filter(w => (w as WeaponItem).burden === 'One-Handed' && (w as WeaponItem).tier === '1') as WeaponItem[];
            new Setting(parent).setName('Secondary Weapon').addDropdown(dd => {
                dd.addOption('', '--- None ---');
                secondaryWeapons.forEach(w => dd.addOption(w.name, w.name));
                dd.setValue(this.creatorState.startingWeaponIds?.[1] || '').onChange(value => {
                    this.creatorState.startingWeaponIds = value ? [primaryWeapon.name, value] : [primaryWeapon.name];
                    this.redrawCreatorStep();
                });
            });
        }

        new Setting(parent).setName('Armor').addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            armors.forEach(a => dd.addOption(a.name, a.name));
            dd.setValue(this.creatorState.startingArmorId || '').onChange(value => {
                this.creatorState.startingArmorId = value;
                this.redrawCreatorStep();
            });
        });

        if (selectedClass && selectedClass.items) {
            parent.createEl('h4', { text: 'Class Item', cls: 'setting-item-heading' });

            const classItems = selectedClass.items.split(/\sor\s/).map(item => {
                const trimmedItem = item.trim();
                return trimmedItem.charAt(0).toUpperCase() + trimmedItem.slice(1);
            });

            const classItemContainer = parent.createDiv({ cls: 'dh-creator-card-grid' });

            classItems.forEach(itemName => {
                const itemCard = classItemContainer.createDiv({ cls: 'dh-creator-card' + (this.creatorState.selectedClassItem === itemName ? ' is-selected' : '') });
                itemCard.createEl('strong', { text: itemName });

                itemCard.addEventListener('click', () => {
                    this.creatorState.selectedClassItem = itemName;
                    this.creatorState.customClassItem = '';
                    this.redrawCreatorStep();
                });
            });

            const customCard = classItemContainer.createDiv({ cls: 'dh-creator-card' + (this.creatorState.customClassItem ? ' is-selected' : '') });
            customCard.createEl('strong', { text: 'Custom Item' });

            const customInput = customCard.createEl('input', {
                type: 'text',
                placeholder: 'Enter your own item',
                value: this.creatorState.customClassItem || ''
            });

            customInput.addEventListener('click', (e) => {
                // Prevent the card click handler from firing
                e.stopPropagation();
            });

            customInput.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                this.creatorState.customClassItem = target.value;
                this.creatorState.selectedClassItem = null;
                if (target.value) {
                    customCard.classList.add('is-selected');
                } else {
                    customCard.classList.remove('is-selected');
                }
            });

            customCard.addEventListener('click', () => {
                customInput.focus();
                this.creatorState.selectedClassItem = null;
                if (this.creatorState.customClassItem) {
                    customCard.classList.add('is-selected');
                }
                this.redrawCreatorStep();
            });
        }

        new Setting(parent).setName('Starting Potion').addDropdown(dd => {
            dd.addOption('health', 'Minor Health Potion').addOption('stamina', 'Minor Stamina Potion').setValue(this.creatorState.potionChoice || 'health').onChange(value => {
                this.creatorState.potionChoice = value as 'health' | 'stamina';
            });
        });

        const addItemContainer = parent.createDiv({ cls: 'dh-add-item-container' });
        const addItemButton = addItemContainer.createEl('button', { cls: 'mod-cta', text: 'Add Additional Item' });
        addItemButton.addEventListener('click', () => {
            const tempChar: Character = {
                id: 'temp-character',
                'dg-character': true,
                _type: 'character',
                name: this.creatorState.name || 'New Character',
                level: 1,
                proficiency: 1,
                pronouns: { _type: 'pronouns', subject: 'they', object: 'them' },
                ancestryId: this.creatorState.ancestryId || '',
                communityId: this.creatorState.communityId || '',
                classId: this.creatorState.classId || '',
                subclassId: this.creatorState.subclassId || '',
                evasion: 0,
                traits: {} as any,
                hitPoints: { _type: 'dynamicResource', max: 0, current: 0 },
                stress: { _type: 'dynamicResource', max: 0, current: 0 },
                hope: { _type: 'dynamicResource', max: 0, current: 0 },
                armorSlots: { _type: 'dynamicResource', max: 0, current: 0 },
                damageThresholds: { _type: 'damageThresholds', major: 0, severe: 0 },
                gold: { _type: 'gold', handfuls: 0, bags: 0, chests: 0 },
                experiences: [],
                features: [],
                vault: [],
                inventory: this.creatorState.additionalItems || [],
                equippedArmorId: null,
                equippedWeaponIds: [],
                levelUpHistory: {},
                conditions: [],
            };

            new AddItemModal(
                this.app,
                this.plugin,
                tempChar,
                (item: CompendiumItem) => {
                    let inventoryItem: InventoryItem;

                    if (item._type === 'weapon') {
                        const [damageDice, damageType] = (item.damage || 'd6').split(' ');
                        inventoryItem = {
                            _type: 'weapon',
                            instanceId: uuidv4(),
                            quantity: 1,
                            name: item.name,
                            tier: parseInt(item.tier || '1'),
                            trait: item.trait || 'Strength',
                            range: item.range || 'Melee',
                            damage: item.damage || 'd6',
                            burden: (item.burden || 'One-Handed') as 'One-Handed' | 'Two-Handed',
                            primaryOrSecondary: (item.primary_or_secondary || 'Primary') as 'Primary' | 'Secondary',
                            damageDice,
                            damageType: damageType || 'phy',
                            features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                            description: item.feat_text,
                            isCustom: item.isCustom
                        };
                    } else if (item._type === 'armor') {
                        const [major, severe] = (item.base_thresholds || '1 / 2').split('/').map(s => parseInt(s.trim()));
                        inventoryItem = {
                            _type: 'armor',
                            instanceId: uuidv4(),
                            quantity: 1,
                            name: item.name,
                            tier: parseInt(item.tier || '1'),
                            baseScore: parseInt(item.base_score || '1'),
                            baseThresholds: { major, severe },
                            features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                            description: item.feat_text,
                            isCustom: item.isCustom
                        };
                    } else if (item._type === 'consumable') {
                        inventoryItem = {
                            _type: 'consumable',
                            instanceId: uuidv4(),
                            quantity: 1,
                            name: item.name,
                            roll: item.roll || '',
                            description: item.description,
                            isCustom: item.isCustom
                        };
                    } else {
                        inventoryItem = {
                            _type: 'item',
                            instanceId: uuidv4(),
                            quantity: 1,
                            name: item.name,
                            description: item.description,
                            isCustom: item.isCustom
                        };
                    }

                    if (!this.creatorState.additionalItems) {
                        this.creatorState.additionalItems = [];
                    }
                    this.creatorState.additionalItems.push(inventoryItem);

                    this.redrawCreatorStep();
                },
                () => {
                    new ItemEditModal(
                        this.app,
                        this.plugin,
                        tempChar,
                        null,
                        (item: InventoryItem) => {
                            if (!this.creatorState.additionalItems) {
                                this.creatorState.additionalItems = [];
                            }
                            this.creatorState.additionalItems.push(item);
                            this.redrawCreatorStep();
                        }
                    ).open();
                }
            ).open();
        });

        if (this.creatorState.additionalItems && this.creatorState.additionalItems.length > 0) {
            const additionalItemsSection = parent.createDiv({ cls: 'dh-additional-items-section' });
            additionalItemsSection.createEl('h4', { text: 'Additional Items' });

            const itemsList = additionalItemsSection.createEl('ul', { cls: 'dh-additional-items-list' });

            this.creatorState.additionalItems.forEach((item, index) => {
                const itemEl = itemsList.createEl('li', { cls: 'dh-additional-item' });

                const itemHeader = itemEl.createDiv({ cls: 'dh-item-header' });

                const nameContainer = itemHeader.createDiv({ cls: 'dh-item-name-container' });
                nameContainer.createEl('span', { text: item.name, cls: 'dh-item-name' });
                nameContainer.createEl('span', {
                    text: item._type.charAt(0).toUpperCase() + item._type.slice(1),
                    cls: 'dh-item-type-badge'
                });

                // Additional info based on type
                if (item._type === 'weapon') {
                    nameContainer.createEl('span', {
                        text: `T${item.tier} ${item.trait} ${item.range}`,
                        cls: 'dh-item-details'
                    });
                } else if (item._type === 'armor') {
                    nameContainer.createEl('span', {
                        text: `T${item.tier} AS: ${item.baseScore}`,
                        cls: 'dh-item-details'
                    });
                }

                // Remove button
                const removeBtn = itemHeader.createEl('button', { cls: 'dh-remove-item-btn' });
                this.app.workspace.containerEl.createEl('span', { attr: { 'data-icon': 'trash' } }, el => removeBtn.appendChild(el));
                removeBtn.addEventListener('click', () => {
                    this.creatorState.additionalItems?.splice(index, 1);
                    this.redrawCreatorStep();
                });

                // Add description if present
                if (item.description) {
                    itemEl.createEl('div', {
                        text: item.description,
                        cls: 'dh-item-description'
                    });
                }

                // Add features if present
                if ('features' in item && item.features && item.features.length > 0) {
                    const featureContainer = itemEl.createDiv({
                        cls: 'dh-item-feature',
                        attr: {
                            style: 'cursor: default;'
                        }
                    });

                    item.features.forEach((feature: CompendiumFeature) => {
                        const nameEl = featureContainer.createEl('span', {
                            text: feature.name,
                            cls: 'dh-item-feature-name'
                        });
                        // Ensure no title attribute that would cause a question mark cursor
                        nameEl.removeAttribute('title');
                        nameEl.removeAttribute('aria-label');

                        const descEl = featureContainer.createEl('div', {
                            text: feature.description,
                            cls: 'dh-item-feature-description'
                        });
                        // Ensure no title attribute that would cause a question mark cursor
                        descEl.removeAttribute('title');
                        descEl.removeAttribute('aria-label');
                    });
                }
            });
        }

        const equipmentFeatures: CompendiumFeature[] = [];
        if (this.creatorState.startingArmorId) {
            const armor = armors.find(a => a.name === this.creatorState.startingArmorId);
            if (armor && armor.feat_name) {
                equipmentFeatures.push({ name: armor.feat_name, description: armor.feat_text || '' });
            }
        }
        if (this.creatorState.startingWeaponIds) {
            this.creatorState.startingWeaponIds.forEach(weaponId => {
                const weapon = weapons.find(w => w.name === weaponId);
                if (weapon && weapon.feat_name) {
                    equipmentFeatures.push({ name: weapon.feat_name, description: weapon.feat_text || '' });
                }
            });
        }
        if (equipmentFeatures.length > 0) {
            this.drawCreatorFeaturePreview(parent, 'You will gain these Equipment Features', equipmentFeatures);
        }
    }

    private drawCreatorStep5_Background(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 5: Background Questions' }); const charClass = this.plugin.compendium.getClass(this.creatorState.classId ?? ''); if (charClass?.backgrounds) { charClass.backgrounds.forEach((bg, index) => { new Setting(parent).setName(bg.question).addTextArea(text => { text.setValue(this.creatorState.backgroundAnswers?.[index] || '').onChange(value => { if (!this.creatorState.backgroundAnswers) this.creatorState.backgroundAnswers = []; this.creatorState.backgroundAnswers[index] = value; }); }); }); } else { parent.createEl('p', { text: 'Please select a class in Step 1 to see background questions.' }); } }
    private drawCreatorStep6_Experiences(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 6: Create Experiences' }); parent.createEl('p', { text: 'Create two experiences for your character. These represent skills or defining moments from their past. They both start with a +2 modifier.' }); if (!this.creatorState.experiences) this.creatorState.experiences = [{ name: '' }, { name: '' }]; this.creatorState.experiences.forEach((exp, index) => { parent.createEl('h5', { text: `Experience ${index + 1}` }); new Setting(parent).setName('Name').addText(text => text.setPlaceholder('e.g., Survivor, Master of Disguise').setValue(exp.name).onChange(value => exp.name = value)); }); }
    private drawCreatorStep7_Domains(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 7: Choose Domain Cards' });
        const classId = this.creatorState.classId;
        if (!classId) {
            parent.createEl('p', { text: 'Please select a class in Step 1.' });
            return;
        }
        const charClass = this.plugin.compendium.getClass(classId);
        if (!charClass) return;
        const domains = [charClass.domain_1, charClass.domain_2];
        parent.createEl('p', { text: `Choose two cards from your class domains: ${domains.join(' & ')}.` });

        const domainCards = this.plugin.compendium.abilities.filter(f => f.level === '1' && domains.some(d => d.toLowerCase() === f.domain?.toLowerCase()));

        const cardContainer = parent.createDiv({ cls: 'dh-creator-card-grid' });
        domainCards.forEach(card => {
            const cardEl = cardContainer.createDiv({ cls: 'dh-creator-card' });
            if (this.creatorState.domainCardIds?.includes(card.name)) {
                cardEl.addClass('is-selected');
            }

            cardEl.addEventListener('click', () => {
                if (!this.creatorState.domainCardIds) {
                    this.creatorState.domainCardIds = [];
                }

                const isSelected = this.creatorState.domainCardIds.includes(card.name);

                if (isSelected) {
                    this.creatorState.domainCardIds = this.creatorState.domainCardIds.filter(id => id !== card.name);
                    cardEl.removeClass('is-selected');
                } else {
                    if (this.creatorState.domainCardIds.length < 2) {
                        this.creatorState.domainCardIds.push(card.name);
                        cardEl.addClass('is-selected');
                    } else {
                        new Notice('You can only select two domain cards.');
                    }
                }
            });

            cardEl.createEl('strong', { text: card.name });
            renderMarkdown(this.plugin, card.text, cardEl.createDiv());

            const footer = cardEl.createDiv({ cls: 'dh-creator-card-meta' });
            if (card.domain) {
                footer.createSpan({ text: `Domain: ${card.domain}` });
            }
            if (card.level) {
                footer.createSpan({ text: `Level: ${card.level}` });
            }
        });
    }
    private drawCreatorStep8_Connections(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 8: Create Connections' }); parent.createEl('p', { text: "Use these questions as inspiration to create connections with the other characters at your table. Discuss your answers together and jot down your notes here." }); const charClass = this.plugin.compendium.getClass(this.creatorState.classId ?? ''); if (charClass?.connections) { charClass.connections.forEach((conn, index) => { new Setting(parent).setName(conn.question).addTextArea(text => { text.setValue(this.creatorState.connections?.[index] || '').onChange(value => { if (!this.creatorState.connections) this.creatorState.connections = []; this.creatorState.connections[index] = value; }); }); }); } else { parent.createEl('p', { text: 'Please select a class in Step 1 to see connection questions.' }); } }
    private drawCreatorStep9_FinalDetails(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 9: Final Details & Review' });

        const layout = parent.createDiv({ cls: 'dh-step9-layout' });
        const leftCol = layout.createDiv({ cls: 'dh-step9-col-left' });
        const rightCol = layout.createDiv({ cls: 'dh-step9-col-right' });

        // --- Left Column: Inputs ---
        const detailsGroup = leftCol.createDiv({ cls: 'dh-creator-input-group' });
        detailsGroup.createEl('h4', { text: 'Character Details' });
        if (!this.creatorState.pronouns) this.creatorState.pronouns = { subject: 'they', object: 'them' };
        new Setting(detailsGroup).setName("Character Name").addText(text => text.setPlaceholder("Elara Meadowlight").setValue(this.creatorState.name || '').onChange(value => this.creatorState.name = value));
        new Setting(detailsGroup).setName("Subject Pronoun").addText(text => text.setPlaceholder("e.g., she").setValue(this.creatorState.pronouns?.subject || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.subject = value; }));
        new Setting(detailsGroup).setName("Object Pronoun").addText(text => text.setPlaceholder("e.g., her").setValue(this.creatorState.pronouns?.object || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.object = value; }));
        new Setting(detailsGroup)
            .setName("Character Description")
            .setDesc("A brief description of your character's appearance and personality.")
            .addTextArea(text => {
                text.setValue(this.creatorState.description || '')
                    .onChange(value => this.creatorState.description = value);
                text.inputEl.rows = 4;
            });

        const visualGroup = leftCol.createDiv({ cls: 'dh-creator-input-group' });
        visualGroup.createEl('h4', { text: 'Character Visuals' });

        new Setting(visualGroup)
            .setName('Accent Color')
            .setDesc('Choose a personal color for your character sheet.')
            .addColorPicker(picker => picker
                .setValue(this.creatorState.accentColor || '#e5b32a')
                .onChange(value => {
                    this.creatorState.accentColor = value;
                }));

        createAvatarEditor(
            this.app,
            visualGroup,
            this.creatorState.avatarUrl || '',
            this.creatorState.avatarTransform,
            (newUrl) => {
                this.creatorState.avatarUrl = newUrl;
                this.creatorState.avatarTransform = undefined;
            },
            (newTransform) => {
                this.creatorState.avatarTransform = newTransform;
            }
        );

        // --- Right Column: Review ---
        const reviewCard = rightCol.createDiv({ cls: 'dh-creator-review-card' });
        reviewCard.createEl('h4', { text: 'Character Summary' });

        const { ancestryId, communityId, classId, subclassId, traits, startingArmorId, startingWeaponIds, domainCardIds } = this.creatorState;
        const ancestry = this.plugin.compendium.getAncestry(ancestryId ?? '');
        const community = this.plugin.compendium.getCommunity(communityId ?? '');
        const charClass = this.plugin.compendium.getClass(classId ?? '');
        const subclass = this.plugin.compendium.getSubclass(subclassId ?? '');
        const armor = this.plugin.compendium.armors.find(a => a.name === startingArmorId) as ArmorItem | undefined;
        const weapons = startingWeaponIds ? (this.plugin.compendium.weapons.filter(w => startingWeaponIds.includes(w.name)) as WeaponItem[]) : [];
        const domains = domainCardIds?.map(id => this.plugin.compendium.getAbility(id)?.name).filter(n => n).join(', ');

        // Core Info Section
        const coreInfoSection = reviewCard.createDiv({ cls: 'dh-review-section' });
        coreInfoSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Class:</strong> ${charClass?.name || 'N/A'} (${subclass?.name || 'N/A'})`;
        coreInfoSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Heritage:</strong> ${this.creatorState.isMixedAncestry ? (this.creatorState.mixedAncestryName || 'Mixed') : (ancestry?.name || 'N/A')}`;
        coreInfoSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Community:</strong> ${community?.name || 'N/A'}`;

        // Traits Section
        const traitsSection = reviewCard.createDiv({ cls: 'dh-review-section' });
        traitsSection.createEl('h5', { text: 'Traits' });
        const traitsGrid = traitsSection.createDiv({ cls: 'dh-review-grid' });
        if (traits) {
            Object.entries(traits).forEach(([key, value]) => {
                if (value !== undefined) traitsGrid.createEl('div', { cls: 'dh-review-item' }).innerHTML = `<strong>${key}:</strong> ${value >= 0 ? '+' : ''}${value}`;
            });
        }

        // Equipment Section
        const equipmentSection = reviewCard.createDiv({ cls: 'dh-review-section' });
        equipmentSection.createEl('h5', { text: 'Equipment' });
        equipmentSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Armor:</strong> ${armor?.name || 'N/A'}`;
        equipmentSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Weapons:</strong> ${weapons?.map(w => w.name).join(', ') || 'N/A'}`;

        // Domains Section
        const domainsSection = reviewCard.createDiv({ cls: 'dh-review-section' });
        domainsSection.createEl('h5', { text: 'Domain Cards' });
        domainsSection.createEl('p', { cls: 'dh-review-item' }).innerHTML = domains || 'N/A';
    }

    private async finalizeCharacter(partialChar: Partial<CreatorState>) {
        if (!partialChar.name || !partialChar.classId || !partialChar.subclassId || !partialChar.communityId || !partialChar.startingArmorId || !partialChar.startingWeaponIds || partialChar.startingWeaponIds.length === 0 || !partialChar.traits || !partialChar.domainCardIds || partialChar.domainCardIds.length !== 2) {
            new Notice("Please complete all required fields on all steps.");
            return;
        }

        let finalAncestryId = partialChar.ancestryId;

        if (partialChar.isMixedAncestry) {
            if (!partialChar.mixedAncestryName || !partialChar.ancestryId || !partialChar.ancestryId2) {
                new Notice("For a mixed ancestry, please select two parent ancestries and provide a custom name.");
                return;
            }
            const ancestry1 = this.plugin.compendium.getAncestry(partialChar.ancestryId);
            const ancestry2 = this.plugin.compendium.getAncestry(partialChar.ancestryId2);

            if (!ancestry1 || !ancestry2 || !ancestry1.feats?.[0] || !ancestry2.feats?.[1]) {
                new Notice("Could not create mixed ancestry. Please ensure both selected ancestries are valid and have features.");
                return;
            }

            const newMixedAncestry: JsonAncestry = {
                name: partialChar.mixedAncestryName,
                description: `A unique heritage combining the traits of ${ancestry1.name} and ${ancestry2.name}.`,
                feats: [ancestry1.feats[0], ancestry2.feats[1]],
                isCustom: true,
            };

            await this.plugin.saveCustomCompendiumData('user-ancestries.json', newMixedAncestry);
            finalAncestryId = newMixedAncestry.name;
        }

        if (!finalAncestryId) {
            new Notice("Please select an ancestry.");
            return;
        }

        const charClass = this.plugin.compendium.getClass(partialChar.classId);
        const ancestry = this.plugin.compendium.getAncestry(finalAncestryId);
        const community = this.plugin.compendium.getCommunity(partialChar.communityId);
        const subclass = this.plugin.compendium.getSubclass(partialChar.subclassId);
        const rawArmor = this.plugin.compendium.armors.find(a => a.name === partialChar.startingArmorId) as ArmorItem | undefined;
        const rawWeapons = partialChar.startingWeaponIds.map(name => this.plugin.compendium.weapons.find(w => w.name === name)).filter(w => w) as WeaponItem[];

        if (!charClass || !ancestry || !community || !rawArmor || !subclass || rawWeapons.length === 0) {
            new Notice("Compendium data missing. Cannot create character.");
            return;
        }

        const finalTraits: { [key in keyof Character['traits']]: Trait } = {} as any;
        for (const key of TRAIT_NAMES) {
            finalTraits[key] = { _type: 'trait', value: partialChar.traits[key] ?? 0, locked: false };
        }

        const [majorStr, severeStr] = rawArmor.base_thresholds.split(' / ');
        const startingArmor: InventoryItem = {
            _type: 'armor', instanceId: uuidv4(), quantity: 1, name: rawArmor.name, tier: parseInt(rawArmor.tier),
            baseScore: parseInt(rawArmor.base_score), baseThresholds: { major: parseInt(majorStr), severe: parseInt(severeStr) },
            features: rawArmor.feat_name ? [{ name: rawArmor.feat_name, description: rawArmor.feat_text || '' }] : [],
            description: rawArmor.feat_text || '', isCustom: rawArmor.isCustom,
        };

        const standardInventory: InventoryItem[] = [
            { _type: 'item', name: 'Torch', instanceId: uuidv4(), quantity: 1, isCustom: this.plugin.compendium.items.find(i => i.name === 'Torch')?.isCustom },
            { _type: 'item', name: '50ft of Rope', instanceId: uuidv4(), quantity: 1, isCustom: this.plugin.compendium.items.find(i => i.name === '50ft of Rope')?.isCustom },
        ];
        if (partialChar.potionChoice === 'health') {
            const potion = this.plugin.compendium.items.find(i => i.name === 'Minor Health Potion');
            standardInventory.push({ _type: 'item', name: 'Minor Health Potion', instanceId: uuidv4(), quantity: 1, isCustom: potion?.isCustom });
        } else {
            const potion = this.plugin.compendium.items.find(i => i.name === 'Minor Stamina Potion');
            standardInventory.push({ _type: 'item', name: 'Minor Stamina Potion', instanceId: uuidv4(), quantity: 1, isCustom: potion?.isCustom });
        }

        const startingWeapons: InventoryItem[] = rawWeapons.map(w => {
            const [damageDice, damageType] = w.damage.split(' ');
            return ({
                _type: 'weapon', instanceId: uuidv4(), quantity: 1, name: w.name, tier: parseInt(w.tier),
                primaryOrSecondary: w.primary_or_secondary as 'Primary' | 'Secondary', trait: w.trait, range: w.range,
                damage: w.damage, damageDice: damageDice, damageType: damageType, burden: w.burden as 'One-Handed' | 'Two-Handed',
                features: w.feat_name ? [{ name: w.feat_name, description: w.feat_text || '' }] : [],
                description: w.feat_text || '', isCustom: w.isCustom,
            });
        });

        const initialInventory: InventoryItem[] = [];

        // Add class item if one was selected
        if (partialChar.selectedClassItem) {
            const itemName = partialChar.selectedClassItem;
            const item = this.plugin.compendium.items.find(i => i.name.toLowerCase() === itemName.trim().toLowerCase());
            initialInventory.push({
                _type: 'item' as 'item',
                name: itemName.trim(),
                instanceId: uuidv4(),
                quantity: 1,
                isCustom: item?.isCustom
            });
        } else if (partialChar.customClassItem && partialChar.customClassItem.trim()) {
            const customItemName = partialChar.customClassItem.trim();
            const capitalizedCustomItemName = customItemName.charAt(0).toUpperCase() + customItemName.slice(1);
            initialInventory.push({
                _type: 'item' as 'item',
                name: capitalizedCustomItemName,
                instanceId: uuidv4(),
                quantity: 1,
                isCustom: true
            });
        }

        const finalFeatures: (DomainCard)[] = (partialChar.domainCardIds || []).map(id => this.plugin.compendium.getAbility(id)).filter(f => f) as DomainCard[];
        const finalEvasion = parseInt(charClass.evasion);
        const finalHp = parseInt(charClass.hp);

        const fullChar: Character = {
            id: uuidv4(), 'dg-character': true, _type: 'character', name: partialChar.name, level: 1, proficiency: 1,
            pronouns: { ...partialChar.pronouns, _type: 'pronouns' } as Character['pronouns'],
            ancestryId: finalAncestryId, communityId: community.name, classId: charClass.name, subclassId: subclass.name,
            evasion: finalEvasion, traits: finalTraits,
            hitPoints: { _type: 'dynamicResource', max: finalHp, current: 0 },
            stress: { _type: 'dynamicResource', max: 6, current: 0 },
            hope: { _type: 'dynamicResource', max: 6, current: 2 },
            armorSlots: { _type: 'dynamicResource', max: startingArmor.baseScore, current: 0 },
            avatarUrl: partialChar.avatarUrl || null, avatarTransform: partialChar.avatarTransform,
            damageThresholds: { _type: 'damageThresholds', major: startingArmor.baseThresholds.major + 1, severe: startingArmor.baseThresholds.severe + 1 },
            gold: { _type: 'gold', handfuls: 1, bags: 0, chests: 0 },
            experiences: (partialChar.experiences || []).map(exp => ({ _type: 'experience', id: uuidv4(), name: exp.name, value: 2, })),
            features: finalFeatures, vault: [],
            inventory: [...standardInventory, ...initialInventory, ...startingWeapons, startingArmor, ...(partialChar.additionalItems || [])],
            equippedArmorId: startingArmor.instanceId, equippedWeaponIds: startingWeapons.map(w => w.instanceId),
            background: charClass.backgrounds.map((bg, i) => ({ question: bg.question, answer: partialChar.backgroundAnswers?.[i] || '' })),
            connections: charClass.connections.map((c, i) => ({ question: c.question, answer: partialChar.connections?.[i] || '' })),
            levelUpHistory: {}, conditions: [], notes: partialChar.description || '',
            accentColor: partialChar.accentColor || '#e5b32a',
        };

        await this.plugin.updateCharacter(fullChar);
        this.plugin.setActiveCharacterId(fullChar.id);
    }

    private drawCreatorFeaturePreview(parent: HTMLElement, title: string, features: CompendiumFeature[]) {
        if (!features || features.length === 0) return;

        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: title });

        const grid = section.createDiv({ cls: 'dh-feature-grid' });
        features.forEach(feat => {
            if (feat && feat.name) {
                this.createCreatorPreviewCard(grid, feat);
            }
        });
    }

    private createCreatorPreviewCard(parent: HTMLElement, feature: CompendiumFeature) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });

        const header = card.createDiv({ cls: 'dh-feature-card-header' });
        header.createDiv({ cls: 'dh-feature-card-title', text: feature.name });

        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        renderRollableContent(this.plugin, feature.description, body, feature.name, true);
    }
}
