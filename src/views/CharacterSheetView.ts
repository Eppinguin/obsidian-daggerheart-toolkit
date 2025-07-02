import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App, Setting, TextComponent, ExtraButtonComponent, Menu, MenuItem } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import {
    Character, Trait, InventoryItem, Experience, CompendiumFeature, CompendiumItem, DomainCard, Condition, JsonClass, JsonSubclass, JsonAncestry, JsonCommunity, ArmorItem, WeaponItem, AvatarTransform
} from '../../types';
import {
    AddItemModal,
    CardSwapModal,
    CharacterManagerModal,
    ConfirmationModal,
    ConditionModal,
    GoldModal,
    ExperienceModal,
    ItemEditModal,
    CompendiumCreatorModal
} from '../modals';
import { DAGGERHEART_CONDITIONS } from '../constants';
import { renderMarkdown, renderRollableContent } from '../rendering/ui-helpers';
import { handleAdvantageDisadvantage, formatTraitModifier } from '../services/dice-helpers';
import { createAvatarEditor } from "./components/AvatarEditor";

export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

type ManagerTab = 'abilities' | 'inventory' | 'details';
const TRAIT_VALUES = [2, 1, 1, 0, 0, -1];
const TRAIT_NAMES: (keyof Character['traits'])[] = ['Strength', 'Agility', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];
const TRAIT_SKILLS: { [key in keyof Character['traits']]: string[] } = {
    Agility: ['Dodge', 'Sprint', 'Leap'],
    Strength: ['Lift', 'Smash', 'Grapple'],
    Finesse: ['Control', 'Hide', 'Tinker'],
    Instinct: ['Perceive', 'Sense', 'Navigate'],
    Presence: ['Charm', 'Perform', 'Deceive'],
    Knowledge: ['Recall', 'Analyze', 'Comprehend']
};

type CreatorState = {
    name: string;
    pronouns: { subject: string; object: string; };
    classId: string;
    subclassId: string;
    ancestryId: string;
    communityId: string;
    traits: { [key in keyof Character['traits']]?: number };
    startingWeaponIds: string[];
    startingArmorId: string;
    backgroundAnswers: string[];
    experiences: { name: string; description: string; }[];
    domainCardIds: string[];
    potionChoice: 'health' | 'stamina';
    connections: string[];
    avatarUrl?: string;
    avatarTransform?: AvatarTransform;
};


export class CharacterSheetView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    private activeManagerTab: ManagerTab = 'abilities';

    private creatorState: Partial<CreatorState> = {
        traits: {},
        domainCardIds: [],
        backgroundAnswers: [],
        experiences: [{ name: '', description: '' }, { name: '', description: '' }],
        startingWeaponIds: [],
        potionChoice: 'health',
        connections: [],
        avatarUrl: '',
        avatarTransform: undefined,
    };
    private creatorStep: number = 0;

    private stepContainer: HTMLElement;
    private backBtn: HTMLButtonElement;
    private nextBtn: HTMLButtonElement;

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.containerEl.addClass('dh-character-sheet-view');
    }

    getViewType(): string { return CHARACTER_SHEET_VIEW_TYPE; }
    getDisplayText(): string { return "Characters"; }
    getIcon(): string { return "user-round-plus"; }

    async onOpen() {
        this.draw();
        this.registerEvent(this.app.workspace.on('daggerheart-character-update', () => this.draw()));
    }

    draw() {
        const container = this.containerEl.children[1];
        const mainContent = container.querySelector('.dh-cs-main');
        const scrollPosition = mainContent ? mainContent.scrollTop : 0;
        container.empty();
        const main = container.createDiv({ cls: 'dh-cs-main' });
        this.drawTopBar(main);
        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            this.drawCharacterSheet(main, activeChar);
        } else {
            this.drawCharacterCreator(main);
        }
        main.scrollTop = scrollPosition;
    }

    private drawTopBar(parent: HTMLElement) {
        const header = parent.createDiv({ cls: 'dh-cs-topbar' });
        const left = header.createDiv({ cls: 'dh-topbar-left' });
        const characters = this.plugin.getCharacters();
        const activeCharId = this.plugin.getActiveCharacterId();

        const selector = left.createEl('select', { cls: 'dropdown' });
        selector.createEl('option', { value: '', text: 'Select a Character...' });
        characters.forEach((char: Character) => {
            const option = selector.createEl('option', { value: char.id, text: char.name });
            if (char.id === activeCharId) { option.selected = true; }
        });
        selector.addEventListener('change', async (ev: Event) => {
            const selectEl = ev.target as HTMLSelectElement;
            await this.plugin.setActiveCharacterId(selectEl.value || null);
        });

        const right = header.createDiv({ cls: 'dh-topbar-right' });

        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            const editBtn = right.createEl('button', { cls: 'clickable-icon' });
            setIcon(editBtn, 'settings-2');
            editBtn.ariaLabel = "Edit Character";
            editBtn.addEventListener('click', () => {
                new CharacterManagerModal(this.app, this.plugin, activeChar, (updatedChar) => {
                    this.plugin.updateCharacter(updatedChar);
                }).open();
            });

            const deleteBtn = right.createEl('button', { cls: 'clickable-icon' });
            setIcon(deleteBtn, 'trash');
            deleteBtn.ariaLabel = "Delete Character";
            deleteBtn.addEventListener('click', () => {
                new ConfirmationModal(
                    this.app,
                    `Are you sure you want to delete ${activeChar.name}? This cannot be undone.`,
                    async () => {
                        await this.plugin.deleteCharacter(activeChar.id);
                    }
                ).open();
            });
        }

        const newCharBtn = right.createEl('button', { cls: 'clickable-icon' });
        setIcon(newCharBtn, 'plus');
        newCharBtn.ariaLabel = "Create New Character";
        newCharBtn.addEventListener('click', () => {
            this.creatorState = { traits: {}, domainCardIds: [], backgroundAnswers: [], experiences: [{ name: '', description: '' }, { name: '', description: '' }], startingWeaponIds: [], potionChoice: 'health', connections: [], avatarUrl: '', avatarTransform: undefined };
            this.creatorStep = 0;
            this.plugin.setActiveCharacterId(null);
        });
    }

    // --- CHARACTER CREATOR WIZARD (Omitted for brevity) ---
    private redrawCreatorStep() { if (!this.stepContainer) return; this.stepContainer.empty(); const steps = [this.drawCreatorStep1_Class.bind(this), this.drawCreatorStep2_Heritage.bind(this), this.drawCreatorStep3_Traits.bind(this), this.drawCreatorStep4_Equipment.bind(this), this.drawCreatorStep5_Background.bind(this), this.drawCreatorStep6_Experiences.bind(this), this.drawCreatorStep7_Domains.bind(this), this.drawCreatorStep8_Connections.bind(this), this.drawCreatorStep9_FinalDetails.bind(this),]; if (this.creatorStep < steps.length) { steps[this.creatorStep](this.stepContainer); } this.backBtn.style.visibility = this.creatorStep === 0 ? 'hidden' : 'visible'; this.nextBtn.textContent = this.creatorStep === steps.length - 1 ? 'Create Character' : 'Next'; }
    private drawCharacterCreator(parent: HTMLElement) { const creatorEl = parent.createDiv({ cls: 'dh-creator-wizard' }); creatorEl.createEl('h2', { text: 'Create New Character' }); this.stepContainer = creatorEl.createDiv(); const navContainer = creatorEl.createDiv({ cls: 'dh-creator-nav' }); this.backBtn = navContainer.createEl('button', { text: 'Back', cls: 'dh-creator-btn' }); this.nextBtn = navContainer.createEl('button', { text: 'Next', cls: 'dh-creator-btn mod-cta' }); this.backBtn.addEventListener('click', () => { if (this.creatorStep > 0) { this.creatorStep--; this.redrawCreatorStep(); } }); this.nextBtn.addEventListener('click', async () => { const steps = 9; if (this.creatorStep === steps - 1) { await this.finalizeCharacter(this.creatorState); } else if (this.creatorStep < steps - 1) { this.creatorStep++; this.redrawCreatorStep(); } }); this.redrawCreatorStep(); }

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
            ].filter((s): s is JsonSubclass => !!s);

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

        // --- Descriptions and Previews (this logic is unchanged) ---
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

    // Replace your drawCreatorStep2_Heritage method with this corrected version
    private drawCreatorStep2_Heritage(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 2: Choose Heritage' });

        // --- Ancestry Section ---
        const ancestrySetting = new Setting(parent)
            .setName("Ancestry")
            .addDropdown(dd => {
                dd.addOption('', '--- Select ---');
                this.plugin.compendium.ancestries.forEach(anc => {
                    dd.addOption(anc.name, anc.name);
                });
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
        }

        if (selectedAncestry) {
            const details = parent.createDiv({ cls: 'dh-creator-details' });
            details.createEl('h4', { text: selectedAncestry.name });
            renderMarkdown(this.plugin, selectedAncestry.description, details.createDiv());

            const ancestryFeatures: CompendiumFeature[] = selectedAncestry.feats.map(f => ({ name: f.name, description: f.text }));
            this.drawCreatorFeaturePreview(details, 'Ancestry Features', ancestryFeatures);
        }

        // --- Community Section (remains the same) ---
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

    private drawCreatorStep3_Traits(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 3: Assign Traits' });
        parent.createEl('p', { text: 'Assign each value (+2, +1, +1, +0, +0, -1) to one of the six traits.' });

        // Display spellcasting trait if the subclass has one
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

        // --- Weapon Selection ---
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
                    this.redrawCreatorStep(); // Redraw to update previews
                });
            });
        }

        // --- Armor & Potion Selection ---
        new Setting(parent).setName('Armor').addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            armors.forEach(a => dd.addOption(a.name, a.name));
            dd.setValue(this.creatorState.startingArmorId || '').onChange(value => {
                this.creatorState.startingArmorId = value;
                this.redrawCreatorStep(); // Redraw to update previews
            });
        });

        new Setting(parent).setName('Starting Potion').addDropdown(dd => {
            dd.addOption('health', 'Minor Health Potion').addOption('stamina', 'Minor Stamina Potion').setValue(this.creatorState.potionChoice || 'health').onChange(value => {
                this.creatorState.potionChoice = value as 'health' | 'stamina';
            });
        });

        // --- PREVIEW: Equipment Features ---
        const equipmentFeatures: CompendiumFeature[] = [];

        // Get armor feature
        if (this.creatorState.startingArmorId) {
            const armor = armors.find(a => a.name === this.creatorState.startingArmorId);
            if (armor && armor.feat_name) {
                equipmentFeatures.push({ name: armor.feat_name, description: armor.feat_text || '' });
            }
        }

        // Get weapon features
        if (this.creatorState.startingWeaponIds) {
            this.creatorState.startingWeaponIds.forEach(weaponId => {
                const weapon = weapons.find(w => w.name === weaponId);
                if (weapon && weapon.feat_name) {
                    equipmentFeatures.push({ name: weapon.feat_name, description: weapon.feat_text || '' });
                }
            });
        }

        // Draw the preview section if any features were found
        if (equipmentFeatures.length > 0) {
            this.drawCreatorFeaturePreview(parent, 'You will gain these Equipment Features', equipmentFeatures);
        }
    }

    private drawCreatorStep5_Background(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 5: Background Questions' }); const charClass = this.plugin.compendium.getClass(this.creatorState.classId ?? ''); if (charClass?.backgrounds) { charClass.backgrounds.forEach((bg, index) => { new Setting(parent).setName(bg.question).addTextArea(text => { text.setValue(this.creatorState.backgroundAnswers?.[index] || '').onChange(value => { if (!this.creatorState.backgroundAnswers) this.creatorState.backgroundAnswers = []; this.creatorState.backgroundAnswers[index] = value; }); }); }); } else { parent.createEl('p', { text: 'Please select a class in Step 1 to see background questions.' }); } }
    private drawCreatorStep6_Experiences(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 6: Create Experiences' }); parent.createEl('p', { text: 'Create two experiences for your character. These represent skills or defining moments from their past. They both start with a +2 modifier.' }); if (!this.creatorState.experiences) this.creatorState.experiences = [{ name: '', description: '' }, { name: '', description: '' }]; this.creatorState.experiences.forEach((exp, index) => { parent.createEl('h5', { text: `Experience ${index + 1}` }); new Setting(parent).setName('Name').addText(text => text.setPlaceholder('e.g., Survivor, Master of Disguise').setValue(exp.name).onChange(value => exp.name = value)); }); }
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

        // Character Name & Pronouns
        if (!this.creatorState.pronouns) this.creatorState.pronouns = { subject: 'they', object: 'them' };
        new Setting(parent).setName("Character Name").addText(text => text.setPlaceholder("Elara Meadowlight").setValue(this.creatorState.name || '').onChange(value => this.creatorState.name = value));
        new Setting(parent).setName("Subject Pronoun").addText(text => text.setPlaceholder("e.g., she").setValue(this.creatorState.pronouns?.subject || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.subject = value; }));
        new Setting(parent).setName("Object Pronoun").addText(text => text.setPlaceholder("e.g., her").setValue(this.creatorState.pronouns?.object || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.object = value; }));

        // Avatar Section
        parent.createEl('h4', { text: 'Character Avatar' });
        parent.createEl('p', { text: 'Add an avatar image for your character. This is optional.' });

        createAvatarEditor(
            parent,
            this.creatorState.avatarUrl || '',
            this.creatorState.avatarTransform,
            (newUrl) => {
                this.creatorState.avatarUrl = newUrl;
                this.creatorState.avatarTransform = undefined; // Reset transform on new URL
            },
            (newTransform) => {
                this.creatorState.avatarTransform = newTransform;
            }
        );

        // Review Section
        parent.createEl('hr');
        parent.createEl('h4', { text: 'Character Review' });
        const reviewEl = parent.createDiv({ cls: 'dh-creator-review' });
        const { ancestryId, communityId, classId, subclassId, traits, startingArmorId, startingWeaponIds, domainCardIds } = this.creatorState;
        const ancestry = this.plugin.compendium.getAncestry(ancestryId ?? '');
        const community = this.plugin.compendium.getCommunity(communityId ?? '');
        const charClass = this.plugin.compendium.getClass(classId ?? '');
        const subclass = this.plugin.compendium.getSubclass(subclassId ?? '');
        const armor = this.plugin.compendium.armors.find(a => a.name === startingArmorId) as ArmorItem | undefined;
        const weapons = startingWeaponIds ? (this.plugin.compendium.weapons.filter(w => startingWeaponIds.includes(w.name)) as WeaponItem[]) : [];
        const domains = domainCardIds?.join(', ');

        reviewEl.createEl('p').innerHTML = `<strong>Class:</strong> ${charClass?.name || 'N/A'} (${subclass?.name || 'N/A'})`;
        reviewEl.createEl('p').innerHTML = `<strong>Ancestry:</strong> ${ancestry?.name || 'N/A'}`;
        reviewEl.createEl('p').innerHTML = `<strong>Community:</strong> ${community?.name || 'N/A'}`;

        reviewEl.createEl('h5', { text: 'Traits' });
        if (traits) {
            Object.entries(traits).forEach(([key, value]) => {
                if (value !== undefined) reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>${key}:</strong> ${value >= 0 ? '+' : ''}${value}`;
            });
        }

        reviewEl.createEl('h5', { text: 'Equipment' });
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Armor:</strong> ${armor?.name || 'N/A'}`;
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Weapons:</strong> ${weapons?.map(w => w.name).join(', ') || 'N/A'}`;
        reviewEl.createEl('h5', { text: 'Domain Cards' });
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = domains || 'N/A';
    }
    private async finalizeCharacter(partialChar: Partial<CreatorState>) {
        if (!partialChar.name || !partialChar.classId || !partialChar.subclassId || !partialChar.ancestryId || !partialChar.communityId || !partialChar.startingArmorId || !partialChar.startingWeaponIds || partialChar.startingWeaponIds.length === 0 || !partialChar.traits || !partialChar.domainCardIds || partialChar.domainCardIds.length !== 2) {
            new Notice("Please complete all required fields on all steps.");
            return;
        }

        const charClass = this.plugin.compendium.getClass(partialChar.classId);
        const ancestry = this.plugin.compendium.getAncestry(partialChar.ancestryId);
        const community = this.plugin.compendium.getCommunity(partialChar.communityId);
        const subclass = this.plugin.compendium.getSubclass(partialChar.subclassId);
        const rawArmor = this.plugin.compendium.armors.find(a => a.name === partialChar.startingArmorId) as ArmorItem | undefined;
        const rawWeapons = partialChar.startingWeaponIds
            .map(name => this.plugin.compendium.weapons.find(w => w.name === name))
            .filter(w => w) as WeaponItem[];

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
            _type: 'armor',
            instanceId: uuidv4(),
            quantity: 1,
            name: rawArmor.name,
            tier: parseInt(rawArmor.tier),
            baseScore: parseInt(rawArmor.base_score),
            baseThresholds: { major: parseInt(majorStr), severe: parseInt(severeStr) },
            features: rawArmor.feat_name ? [{ name: rawArmor.feat_name, description: rawArmor.feat_text || '' }] : [],
            description: rawArmor.feat_text || '',
            isCustom: rawArmor.isCustom,
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

        const startingWeapons: InventoryItem[] = rawWeapons
            .map(w => {
                const [damageDice, damageType] = w.damage.split(' ');
                return ({
                    _type: 'weapon',
                    instanceId: uuidv4(),
                    quantity: 1,
                    name: w.name,
                    tier: parseInt(w.tier),
                    primaryOrSecondary: w.primary_or_secondary as 'Primary' | 'Secondary',
                    trait: w.trait,
                    range: w.range,
                    damage: w.damage,
                    damageDice: damageDice,
                    damageType: damageType,
                    burden: w.burden as 'One-Handed' | 'Two-Handed',
                    features: w.feat_name ? [{ name: w.feat_name, description: w.feat_text || '' }] : [],
                    description: w.feat_text || '',
                    isCustom: w.isCustom,
                });
            });

        const initialInventory: InventoryItem[] = (charClass.items || "").split(', ').map(itemName => {
            const item = this.plugin.compendium.items.find(i => i.name.toLowerCase() === itemName.trim().toLowerCase());
            return {
                _type: 'item' as 'item',
                name: itemName.trim(),
                instanceId: uuidv4(),
                quantity: 1,
                isCustom: item?.isCustom,
            }
        });

        const finalFeatures: (DomainCard)[] = (partialChar.domainCardIds || [])
            .map(id => this.plugin.compendium.getAbility(id))
            .filter(f => f) as DomainCard[];

        const finalEvasion = parseInt(charClass.evasion);
        const finalHp = parseInt(charClass.hp);

        const fullChar: Character = {
            id: uuidv4(),
            'dg-character': true,
            _type: 'character',
            name: partialChar.name,
            level: 1,
            pronouns: { ...partialChar.pronouns, _type: 'pronouns' } as Character['pronouns'],
            ancestryId: ancestry.name,
            communityId: community.name,
            classId: charClass.name,
            subclassId: subclass.name,
            evasion: finalEvasion,
            traits: finalTraits,
            hitPoints: { _type: 'dynamicResource', max: finalHp, current: finalHp },
            stress: { _type: 'dynamicResource', max: 6, current: 0 },
            hope: { _type: 'dynamicResource', max: 6, current: 2 },
            armorSlots: { _type: 'dynamicResource', max: startingArmor.baseScore, current: startingArmor.baseScore },
            avatarUrl: partialChar.avatarUrl || null,
            avatarTransform: partialChar.avatarTransform,
            damageThresholds: {
                _type: 'damageThresholds',
                major: startingArmor.baseThresholds.major + 1,
                severe: startingArmor.baseThresholds.severe + 1
            },
            gold: { _type: 'gold', handfuls: 1, bags: 0, chests: 0 },
            experiences: (partialChar.experiences || []).map(exp => ({
                ...exp,
                id: uuidv4(),
                value: 2,
                _type: 'experience'
            })),
            features: finalFeatures,
            vault: [],
            inventory: [
                ...standardInventory,
                ...initialInventory,
                ...startingWeapons,
                startingArmor,
            ],
            equippedArmorId: startingArmor.instanceId,
            equippedWeaponIds: startingWeapons.map(w => w.instanceId),
            background: charClass.backgrounds.map((bg, i) => ({
                question: bg.question,
                answer: partialChar.backgroundAnswers?.[i] || ''
            })),
            connections: charClass.connections.map((c, i) => ({
                question: c.question,
                answer: partialChar.connections?.[i] || ''
            })),
            conditions: [],
        };

        await this.plugin.updateCharacter(fullChar);
        this.plugin.setActiveCharacterId(fullChar.id);
    }

    private drawCharacterSheet(parent: HTMLElement, data: Character) {
        const sheet = parent.createDiv({ cls: 'dh-sheet' });
        this.drawSheetHeader(sheet, data);
        const mainGrid = sheet.createDiv({ cls: 'dh-sheet-grid' });
        this.drawLeftColumn(mainGrid, data);
        this.drawCenterColumn(mainGrid, data);
        this.drawRightColumn(mainGrid, data);
        this.drawManager(sheet, data);
    }

    private drawSheetHeader(parent: HTMLElement, data: Character) {
        const charClass = this.plugin.compendium.getClass(data.classId);
        const subClass = this.plugin.compendium.getSubclass(data.subclassId);
        const ancestry = this.plugin.compendium.getAncestry(data.ancestryId);

        const header = parent.createDiv({ cls: 'dh-sheet-header' });
        const left = header.createDiv({ cls: 'dh-header-left' });

        const avatar = left.createDiv({ cls: 'dh-avatar' });
        if (data.avatarUrl) {
            // This logic mirrors the editor, but adapts for the smaller 70px header size
            if (data.avatarTransform) {
                const img = new Image();
                img.src = data.avatarUrl;
                img.onload = () => {
                    // FIX: Re-check for avatarTransform inside the async callback.
                    if (!data.avatarTransform) return;

                    const EDITOR_SIZE = 150;
                    const HEADER_SIZE = 70;
                    const sizeRatio = HEADER_SIZE / EDITOR_SIZE;

                    const scale = data.avatarTransform.scale;
                    // Scale the offsets by the size ratio
                    const offsetX = data.avatarTransform.x * sizeRatio;
                    const offsetY = data.avatarTransform.y * sizeRatio;

                    const imgRatio = img.naturalWidth / img.naturalHeight;
                    let baseWidth, baseHeight;
                    if (imgRatio > 1) {
                        baseHeight = HEADER_SIZE;
                        baseWidth = HEADER_SIZE * imgRatio;
                    } else {
                        baseWidth = HEADER_SIZE;
                        baseHeight = HEADER_SIZE / imgRatio;
                    }

                    const bgWidth = baseWidth * scale;
                    const bgHeight = baseHeight * scale;
                    const bgPosX = `calc(50% + ${offsetX}px)`;
                    const bgPosY = `calc(50% + ${offsetY}px)`;

                    avatar.style.backgroundImage = `url("${data.avatarUrl}")`;
                    avatar.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
                    avatar.style.backgroundPosition = `${bgPosX} ${bgPosY}`;
                    avatar.style.backgroundRepeat = 'no-repeat';
                }
            }
        } else {
            setIcon(avatar, 'user-round');
        }


        const nameplate = left.createDiv({ cls: 'dh-nameplate' });
        nameplate.createEl('h1', { text: data.name || "Unnamed Character" });
        nameplate.createEl('p', { text: `${ancestry?.name || 'N/A'} ${charClass?.name || 'N/A'} (${subClass?.name || 'N/A'})` });
        const right = header.createDiv({ cls: 'dh-header-right' });
        if (charClass) {
            const classDomains = [charClass.domain_1, charClass.domain_2];
            right.createDiv({ cls: 'dh-domain-placeholder', text: classDomains.join(' & ') });
        }
    }

    private drawLeftColumn(parent: HTMLElement, data: Character) {
        const leftCol = parent.createDiv({ cls: 'dh-grid-column-left' });
        this.drawPrimaryDefenses(leftCol, data);
        this.drawDamageAndResources(leftCol, data);
    }

    private drawCenterColumn(parent: HTMLElement, data: Character) {
        const centerCol = parent.createDiv({ cls: 'dh-grid-column-center' });
        this.drawTraits(centerCol, data);
        this.drawActiveWeapons(centerCol, data);
    }

    private drawRightColumn(parent: HTMLElement, data: Character) {
        const rightCol = parent.createDiv({ cls: 'dh-grid-column-right' });
        this.drawVitals(rightCol, data);
        this.plugin.createInteractiveTrack(rightCol, 'Hope', data.hope.max, data.id + '-hope', data.hope.current, (v) => { data.hope.current = v; this.plugin.updateCharacter(data); });
        this.drawExperiences(rightCol, data);
    }

    private drawPrimaryDefenses(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-primary-defenses' });
        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId && i._type === 'armor') as InventoryItem & { _type: 'armor' } | undefined;
        let armorEvasionMod = 0;
        if (equippedArmor?.features?.some(f => f.name.toLowerCase().includes('heavy'))) {
            armorEvasionMod = equippedArmor.features.some(f => f.name.toLowerCase().includes('very heavy')) ? -2 : -1;
        }
        const finalEvasion = data.evasion + armorEvasionMod;
        const evasionBox = container.createDiv({ cls: 'dh-stat-hex' });
        evasionBox.createEl('span', { text: String(finalEvasion), cls: 'dh-stat-value' });
        evasionBox.createEl('span', { text: 'Evasion', cls: 'dh-stat-label' });
        const armorBox = container.createDiv({ cls: 'dh-stat-hex' });
        armorBox.createEl('span', { text: String(data.armorSlots.max), cls: 'dh-stat-value' });
        armorBox.createEl('span', { text: 'Armor', cls: 'dh-stat-label' });
        const armorSlotsContainer = parent.createDiv({ cls: 'dh-armor-slots' });
        armorSlotsContainer.createEl('span', { text: 'Armor Slots' });
        this.plugin.createInteractiveTrack(armorSlotsContainer, '', data.armorSlots.max, data.id + '-armor', data.armorSlots.current, (v) => {
            data.armorSlots.current = v;
            this.plugin.updateCharacter(data);
        });
    }

    private drawDamageAndResources(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-damage-and-resources' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Hit Points & Stress' });
        const thresholdsBox = container.createDiv({ cls: 'dh-thresholds-box' });
        let finalMajorThreshold = data.damageThresholds.major;
        let finalSevereThreshold = data.damageThresholds.severe;

        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId && i._type === 'armor') as InventoryItem & { _type: 'armor' } | undefined;

        if (!equippedArmor) {
            finalMajorThreshold = data.level;
            finalSevereThreshold = data.level * 2;
        } else {
            finalMajorThreshold = equippedArmor.baseThresholds.major + data.level;
            finalSevereThreshold = equippedArmor.baseThresholds.severe + data.level;
        }
        const minor = thresholdsBox.createDiv();
        minor.createEl('span', { cls: 'dh-threshold-label', text: 'Minor Damage' });
        minor.createEl('span', { cls: 'dh-threshold-desc', text: `Mark 1 HP` });
        const major = thresholdsBox.createDiv();
        major.createEl('span', { cls: 'dh-threshold-label', text: 'Major Damage' });
        major.createEl('span', { cls: 'dh-threshold-value', text: String(finalMajorThreshold) });
        major.createEl('span', { cls: 'dh-threshold-desc', text: `Mark 2 HP` });
        const severe = thresholdsBox.createDiv();
        severe.createEl('span', { cls: 'dh-threshold-label', text: 'Severe Damage' });
        severe.createEl('span', { cls: 'dh-threshold-value', text: String(finalSevereThreshold) });
        severe.createEl('span', { cls: 'dh-threshold-desc', text: `Mark 3 HP` });
        if (data.hitPoints) this.plugin.createInteractiveTrack(container, 'HP', data.hitPoints.max, data.id + '-hp', data.hitPoints.current, (v) => { data.hitPoints.current = v; this.plugin.updateCharacter(data); });
        if (data.stress) this.plugin.createInteractiveTrack(container, 'Stress', data.stress.max, data.id + '-stress', data.stress.current, (v) => { data.stress.current = v; this.plugin.updateCharacter(data); });
    }

    private drawTraits(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-traits-grid' });
        Object.entries(data.traits).forEach(([name, trait]) => {
            const key = name as keyof Character['traits'];
            const box = container.createDiv({ cls: `dh-trait-box-large ${trait.locked ? 'locked' : ''}` });
            box.createDiv({ cls: 'dh-trait-value-large', text: `${trait.value >= 0 ? '+' : ''}${trait.value}` });
            box.createDiv({ cls: 'dh-trait-name-large', text: name });
            const skillsList = box.createDiv({ cls: 'dh-trait-skills' });
            (TRAIT_SKILLS[key] || []).forEach(skill => {
                skillsList.createDiv({ text: skill });
            });
            if (!trait.locked) {
                box.title = `Click to roll ${name}. Hold Shift for Advantage or Alt for Disadvantage.`;
                box.addEventListener('click', (event) => {
                    // Base dice formula
                    let baseDiceString = `1d12+1d12`;  // Keep the base duality dice separate

                    // Format trait modifier properly using our helper function
                    const modifierString = formatTraitModifier(trait.value);

                    // Handle advantage/disadvantage using our helper function
                    let rollTitle = `${name} Roll`;
                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        rollTitle
                    );

                    // Place dice components in this order: base dice, advantage/disadvantage, modifier
                    console.log(`Rolling trait: ${name}, Base: ${baseDiceString}, Final: ${diceString}${modifierString}`);
                    this.plugin.rollDice(
                        `${diceString}${modifierString}`,
                        newRollTitle,
                        name
                    );
                });
            }
        });
    }

    private drawActiveWeapons(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-active-weapons' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Active Weapons' });
        const equippedWeapons = data.inventory.filter(i => data.equippedWeaponIds && data.equippedWeaponIds.includes(i.instanceId) && i._type === 'weapon') as (InventoryItem & { _type: 'weapon' })[];
        if (equippedWeapons.length === 0) {
            container.createDiv({ cls: 'dh-weapon-card' }).createDiv({ text: 'No weapons equipped.', cls: 'dh-empty-text' });
        } else {
            equippedWeapons.forEach((weapon, index) => {
                this.createWeaponCard(container, weapon, index === 0 ? 'Primary' : 'Secondary', data);
            });
        }
    }

    private createWeaponCard(parent: HTMLElement, weapon: InventoryItem & { _type: 'weapon' }, type: 'Primary' | 'Secondary', character: Character) {
        const card = parent.createDiv({ cls: 'dh-weapon-card' });
        card.createEl('h4', { text: type });
        const body = card.createDiv({ cls: 'dh-weapon-card-body' });
        const left = body.createDiv();
        left.createDiv({ cls: 'dh-weapon-name', text: weapon.name });
        left.createDiv({ cls: 'dh-weapon-type', text: `${weapon.burden} - ${weapon.range}` });
        const feature = (weapon.features || [])[0];
        const featureEl = left.createDiv({ cls: 'dh-weapon-feature' });
        renderRollableContent(this.plugin, feature?.description || 'No feature.', featureEl, `${weapon.name}: ${feature?.name || 'Attack'}`, true);
        const right = body.createDiv({ cls: 'dh-weapon-card-right' });
        const traitName = weapon.trait as keyof Character['traits'];
        const trait = character.traits[traitName];
        if (trait) {
            const rollBox = right.createDiv({ cls: 'dh-weapon-roll-box' });
            const traitValue = trait.value;
            const traitDisplay = `${traitValue >= 0 ? '+' : ''}${traitValue}`;
            rollBox.createDiv({ text: traitDisplay });
            rollBox.createDiv({ text: traitName });
            let rollTitle = `${weapon.name} Attack`;
            rollBox.addEventListener('click', (event) => {
                // Base dice formula
                let baseDiceString = `1d12+1d12`;  // Keep the base duality dice separate

                // Format trait modifier properly using our helper function
                const modifierString = formatTraitModifier(traitValue);

                // Handle advantage/disadvantage using our helper function
                const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                    event,
                    baseDiceString,
                    rollTitle
                );

                // Place dice components in this order: base dice, advantage/disadvantage, modifier
                console.log(`Rolling weapon: ${weapon.name}, Base: ${baseDiceString}, Final: ${diceString}${modifierString}`);
                this.plugin.rollDice(
                    `${diceString}${modifierString}`,
                    newRollTitle,
                    traitName
                );
            });
        }
        const damageBox = right.createDiv({ cls: 'dh-weapon-damage-box' });
        let proficiency = 1;
        if (character.level >= 8) { proficiency = 4; } else if (character.level >= 5) { proficiency = 3; } else if (character.level >= 2) { proficiency = 2; }
        const damageFormula = `${proficiency}${weapon.damageDice}`;
        damageBox.createDiv({ text: weapon.damageDice });
        damageBox.createDiv({ text: weapon.damageType });
        damageBox.title = `Click to roll ${damageFormula}`;
        damageBox.addEventListener('click', () => {
            this.plugin.rollDice(damageFormula, `${weapon.name} Damage`);
        });
    }

    private drawVitals(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-vitals' });
        this.drawConditions(container, data);
        const level = container.createDiv({ cls: 'dh-level-box' });
        level.createEl('h4', { text: 'Level' });
        level.createDiv({ cls: 'dh-level-value', text: String(data.level) });
    }

    private drawConditions(parent: HTMLElement, data: Character) {
        const conditionsBox = parent.createDiv({ cls: 'dh-conditions-box is-clickable' });
        conditionsBox.createEl('h4', { text: 'Conditions' });

        const tagsContainer = conditionsBox.createDiv({ cls: 'dh-condition-tags-list' });

        if (data.conditions && data.conditions.length > 0) {
            data.conditions.forEach(condition => {
                const tag = tagsContainer.createDiv({ cls: 'dh-condition-tag' });
                tag.createSpan({ text: condition.name });
                tag.ariaLabel = condition.description || condition.name;
                const removeBtn = tag.createEl('button', { cls: 'dh-remove-condition-btn' });
                setIcon(removeBtn, 'x');
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    data.conditions = data.conditions.filter(c => c.name !== condition.name);
                    this.plugin.updateCharacter(data);
                });
            });
        } else {
            tagsContainer.createDiv({ text: 'Add a condition...', cls: 'dh-empty-text' });
        }

        conditionsBox.addEventListener('click', () => {
            new ConditionModal(this.app, data, (updatedCharacter) => {
                this.plugin.updateCharacter(updatedCharacter);
            }).open();
        });
    }

    private drawExperiences(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-experiences' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Experience' });
        (data.experiences || []).forEach(exp => {
            const card = this.createExperienceCard(container, exp.name, `+${exp.value}`, true);
            card.addEventListener('click', () => {
                new ExperienceModal(this.app, data, (updatedCharacter) => {
                    this.plugin.updateCharacter(updatedCharacter);
                }).open();
            });
        });
    }

    private drawManager(parent: HTMLElement, data: Character) {
        const managerContainer = parent.createDiv({ cls: 'dh-manager-container' });
        const tabs = managerContainer.createDiv({ cls: 'dh-manager-tabs' });
        this.createManagerTab(tabs, 'abilities', 'Effects & Features');
        this.createManagerTab(tabs, 'inventory', 'Equipment');
        this.createManagerTab(tabs, 'details', 'Details');
        const content = managerContainer.createDiv({ cls: 'dh-manager-content' });
        switch (this.activeManagerTab) {
            case 'abilities': this.drawAbilitiesManager(content, data); break;
            case 'inventory': this.drawInventoryManager(content, data); break;
            case 'details': this.drawDetailsManager(content, data); break;
        }
    }

    private createManagerTab(parent: HTMLElement, id: ManagerTab, text: string) {
        const tab = parent.createEl('div', { text, cls: 'dh-manager-tab' });
        if (this.activeManagerTab === id) { tab.addClass('is-active'); }
        tab.addEventListener('click', () => { this.activeManagerTab = id; this.draw(); });
    }

    private equipItem(character: Character, item: InventoryItem, redraw: boolean = true) {
        if (item._type === 'armor') {
            character.equippedArmorId = item.instanceId;
            character.armorSlots.max = item.baseScore;
            character.damageThresholds = { _type: 'damageThresholds', major: item.baseThresholds.major + character.level, severe: item.baseThresholds.severe + character.level };
        } else if (item._type === 'weapon') {
            const weapon = item as InventoryItem & { _type: 'weapon' };
            if (weapon.burden === 'Two-Handed') {
                character.equippedWeaponIds = [item.instanceId];
            } else {
                const equippedWeapons = character.inventory.filter(i => character.equippedWeaponIds.includes(i.instanceId) && i._type === 'weapon') as (InventoryItem & { _type: 'weapon' })[];
                const twoHandedEquipped = equippedWeapons.find(w => w.burden === 'Two-Handed');
                if (twoHandedEquipped) {
                    character.equippedWeaponIds = [item.instanceId];
                } else if (equippedWeapons.length < 2) {
                    character.equippedWeaponIds.push(item.instanceId);
                } else {
                    new Notice("You already have two one-handed weapons equipped. Unequip one first.");
                    return;
                }
            }
        }
        if (redraw) {
            this.plugin.updateCharacter(character);
        }
    }

    private unequipItem(character: Character, item: InventoryItem, redraw: boolean = true) {
        if (item._type === 'armor' && character.equippedArmorId === item.instanceId) {
            character.equippedArmorId = null;
            character.armorSlots.max = 0;
            character.damageThresholds = { _type: 'damageThresholds', major: character.level, severe: character.level * 2 };
        } else if (item._type === 'weapon') {
            character.equippedWeaponIds = character.equippedWeaponIds.filter(id => id !== item.instanceId);
        }
        if (redraw) {
            this.plugin.updateCharacter(character);
        }
    }

    private drawInventoryManager(parent: HTMLElement, character: Character) {
        const topBar = parent.createDiv({ cls: 'dh-inventory-topbar' });
        this.drawGoldTracker(topBar, character);
        const buttonGroup = topBar.createDiv({ cls: 'dh-inventory-buttons' });

        buttonGroup.createEl('button', { text: 'Add Item' })
            .addEventListener('click', () => {
                new AddItemModal(this.app, this.plugin, character, (item) => {
                    if (!character.inventory) character.inventory = [];
                    // Process the raw compendium item into a character inventory item
                    let newItem: InventoryItem;
                    if (item._type === 'armor') {
                        const [major, severe] = item.base_thresholds.split(' / ').map(s => parseInt(s.trim()));
                        newItem = {
                            _type: 'armor', instanceId: uuidv4(), quantity: 1, name: item.name, description: item.feat_text,
                            tier: parseInt(item.tier), baseScore: parseInt(item.base_score), baseThresholds: { major, severe },
                            features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                            isCustom: item.isCustom,
                        };
                    } else if (item._type === 'weapon') {
                        const [damageDice, damageType] = item.damage.split(' ');
                        newItem = {
                            _type: 'weapon', instanceId: uuidv4(), quantity: 1, name: item.name, description: item.feat_text,
                            tier: parseInt(item.tier), burden: item.burden as 'One-Handed' | 'Two-Handed', range: item.range,
                            trait: item.trait, primaryOrSecondary: item.primary_or_secondary as 'Primary' | 'Secondary',
                            damage: item.damage, damageDice, damageType,
                            features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                            isCustom: item.isCustom,
                        };
                    } else {
                        newItem = { ...item, instanceId: uuidv4(), quantity: 1, isCustom: item.isCustom };
                    }
                    character.inventory.push(newItem);
                    this.plugin.updateCharacter(character);
                }, () => {
                    new ItemEditModal(this.app, this.plugin, character, null, (newItem) => {
                        if (!character.inventory) character.inventory = [];
                        character.inventory.push(newItem);
                        this.plugin.updateCharacter(character);
                    }).open();
                }).open();
            });

        const list = parent.createDiv({ cls: 'dh-inventory-list' });

        const header = list.createDiv({ cls: 'dh-inventory-item is-header' });
        header.createDiv({ text: 'Item' });
        header.createDiv({ text: 'Qty' });
        header.createDiv({ text: 'Details' });
        header.createDiv({ text: 'Actions', cls: 'dh-actions-header' });

        if (!character.inventory) character.inventory = [];
        character.inventory.forEach(item => {
            const row = list.createDiv({ cls: 'dh-inventory-item' });

            const nameCell = row.createDiv({ cls: 'dh-inventory-item-name' });
            const isEquipped = (item._type === 'armor' && item.instanceId === character.equippedArmorId) ||
                (item._type === 'weapon' && character.equippedWeaponIds.includes(item.instanceId));

            if (isEquipped) {
                setIcon(nameCell, item._type === 'armor' ? 'shield-check' : 'swords');
                nameCell.addClass('is-equipped');
            }
            nameCell.createSpan({ text: item.name });
            if (item.description) {
                nameCell.ariaLabel = item.description;
            }

            const qtyCell = row.createDiv({ cls: 'dh-inventory-item-qty' });
            if (item._type === 'item') {
                const downBtn = qtyCell.createEl('button', { text: '-' });
                downBtn.addEventListener('click', () => {
                    item.quantity = Math.max(1, (item.quantity || 1) - 1);
                    this.plugin.updateCharacter(character);
                });
                qtyCell.createSpan({ text: String(item.quantity || 1) });
                const upBtn = qtyCell.createEl('button', { text: '+' });
                upBtn.addEventListener('click', () => {
                    item.quantity = (item.quantity || 1) + 1;
                    this.plugin.updateCharacter(character);
                });
            } else {
                qtyCell.setText('1');
            }

            let details = '';
            if (item._type === 'weapon') {
                details = `${item.damage || ''}, ${item.range || ''}, ${item.burden || ''}`;
            } else if (item._type === 'armor') {
                details = `${item.baseScore || 0} Armor, Thresh: ${item.baseThresholds?.major || 0}/${item.baseThresholds?.severe || 0}`;
            } else if (item.description) {
                details = item.description.substring(0, 30) + (item.description.length > 30 ? '...' : '');
            }
            row.createDiv({ text: details, cls: 'dh-inventory-item-details' });

            const actionsCell = row.createDiv({ cls: 'dh-inventory-item-actions' });
            if (item._type === 'armor' || item._type === 'weapon') {
                const equipBtn = actionsCell.createEl('button');
                setIcon(equipBtn, isEquipped ? 'check-square' : 'square');
                equipBtn.ariaLabel = isEquipped ? 'Unequip' : 'Equip';
                equipBtn.addEventListener('click', () => {
                    if (isEquipped) {
                        this.unequipItem(character, item);
                    } else {
                        this.equipItem(character, item);
                    }
                });
            }

            const editBtn = actionsCell.createEl('button');
            setIcon(editBtn, 'pencil');
            editBtn.ariaLabel = "Edit Item";
            editBtn.addEventListener('click', () => {
                new ItemEditModal(this.app, this.plugin, character, item, (updatedItem) => {
                    const index = character.inventory.findIndex(i => i.instanceId === updatedItem.instanceId);
                    if (index > -1) {
                        character.inventory[index] = updatedItem;
                        this.plugin.updateCharacter(character);
                    }
                }, () => {
                    character.inventory = character.inventory.filter(i => i.instanceId !== item.instanceId);
                    this.unequipItem(character, item, false); // Unequip without redrawing
                    this.plugin.updateCharacter(character);
                }).open();
            });
        });
    }


    private drawGoldTracker(parent: HTMLElement, data: Character) {
        const box = parent.createDiv({ cls: 'dh-gold-tracker' });
        box.addEventListener('click', () => new GoldModal(this.app, data, () => this.plugin.updateCharacter(data)).open());
        box.createEl('span').setText(`Gold: ${data.gold.chests}C, ${data.gold.bags}B, ${data.gold.handfuls}H`);
    }

    private drawAbilitiesManager(parent: HTMLElement, data: Character) {
        const charClass = this.plugin.compendium.getClass(data.classId);
        const ancestry = this.plugin.compendium.getAncestry(data.ancestryId);
        const community = this.plugin.compendium.getCommunity(data.communityId);

        const hopeFeat: CompendiumFeature = charClass ? { name: charClass.hope_feat_name, description: charClass.hope_feat_text } : { name: '', description: '' };
        const classFeats: CompendiumFeature[] = charClass ? charClass.class_feats.map(f => ({ name: f.name, description: f.text })) : [];
        const ancestryFeats: CompendiumFeature[] = ancestry ? ancestry.feats.map(f => ({ name: f.name, description: f.text })) : [];
        const communityFeats: CompendiumFeature[] = community ? community.feats.map(f => ({ name: f.name, description: f.text })) : [];

        this.drawFeatureSection(parent, 'Domain & Class Features', data.features, data);
        if (ancestry) this.drawFeatureSection(parent, 'Heritage Features', ancestryFeats, data, false);
        if (community) this.drawFeatureSection(parent, 'Community Features', communityFeats, data, false);
        if (charClass) this.drawFeatureSection(parent, 'Core Class Features', [...classFeats, hopeFeat], data, false);
    }

    private drawDetailsManager(parent: HTMLElement, data: Character) {
        if (data.background && data.background.length > 0) {
            const backgroundSection = parent.createDiv({ cls: 'dh-details-section' });
            backgroundSection.createEl('h3', { text: 'Background' });
            data.background.forEach(bg => {
                const card = backgroundSection.createDiv({ cls: 'dh-detail-card' });
                card.createEl('h4', { text: bg.question });
                renderMarkdown(this.plugin, bg.answer || '_No answer provided._', card.createDiv());
            });
        }
        if (data.connections && data.connections.length > 0) {
            const connectionSection = parent.createDiv({ cls: 'dh-details-section' });
            connectionSection.createEl('h3', { text: 'Connections' });
            data.connections.forEach(conn => {
                const card = connectionSection.createDiv({ cls: 'dh-detail-card' });
                card.createEl('h4', { text: conn.question });
                renderMarkdown(this.plugin, conn.answer || '_No answer provided._', card.createDiv());
            });
        }
    }

    private createExperienceCard(parent: HTMLElement, title: string, subtext: string, isInteractive: boolean = false) { const card = parent.createDiv({ cls: `dh-experience-card ${isInteractive ? 'is-interactive' : ''}` }); card.createDiv({ cls: 'dh-card-title', text: title }); if (subtext) card.createSpan({ cls: 'dh-experience-value', text: subtext }); return card; }

    private drawFeatureSection(parent: HTMLElement, title: string, features: (CompendiumFeature | DomainCard | undefined)[], character: Character, addManageButton: boolean = true) {
        if (!features.some(f => f) && !addManageButton) return;
        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: title });

        // ADD THIS BLOCK to include the manage cards button
        if (addManageButton) {
            const controls = header.createDiv({ cls: 'dh-section-header-controls' });
            const manageBtn = controls.createEl('button', { text: 'Manage Cards' });
            setIcon(manageBtn, 'book-copy');
            manageBtn.addEventListener('click', () => {
                new CardSwapModal(this.app, this.plugin, character, (updatedChar) => {
                    this.plugin.updateCharacter(updatedChar);
                }).open();
            });
        }

        const grid = section.createDiv({ cls: 'dh-feature-grid' });
        if (features.length > 0) {
            features.forEach(feat => {
                if (feat) this.createFeatureCard(grid, feat, character);
            });
        } else {
            grid.createDiv({ text: 'No cards in loadout.', cls: 'dh-empty-text' })
        }
    }

    private createFeatureCard(parent: HTMLElement, feature: CompendiumFeature | DomainCard, character: Character) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });
        const metadata = this.getFeatureMetadata(feature as DomainCard);

        // --- Header ---
        const header = card.createDiv({ cls: 'dh-feature-card-header' });
        header.createDiv({ cls: 'dh-feature-card-title', text: feature.name });

        const metaHeader = header.createDiv({ cls: 'dh-feature-card-meta-header' });
        if (metadata.domain) {
            metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.domain });
        }
        if (metadata.type) {
            metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.type });
        }
        if (metadata.level) {
            metaHeader.createSpan({ cls: 'dh-feature-card-type', text: `Level ${metadata.level}` });
        }

        // --- Body ---
        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        renderRollableContent(this.plugin, feature.description, body, feature.name, true);

        // --- Footer & Spellcasting Button ---
        // Check for spellcasting roll
        if (feature.description.toLowerCase().includes('make a spellcast roll')) {
            const footer = card.createDiv({ cls: 'dh-feature-card-footer dh-feature-card-footer-left' });
            const subclass = this.plugin.compendium.getSubclass(character.subclassId);
            const spellcastingTraitName = subclass?.spellcast_trait as keyof Character['traits'] | undefined;

            if (spellcastingTraitName) {
                const traitValue = character.traits[spellcastingTraitName]?.value ?? 0;
                // Create a styled box instead of a plain button
                const rollBox = footer.createDiv({ cls: 'dh-spellcast-box dh-spellcast-box-inline' });
                const modSpan = rollBox.createSpan({ cls: 'dh-spellcast-modifier' });
                modSpan.setText(`${traitValue >= 0 ? '+' : ''}${traitValue}`);
                rollBox.createSpan({ text: ` ${spellcastingTraitName}` });
                rollBox.title = `Click to make a Spellcast roll with ${spellcastingTraitName}`;

                rollBox.addEventListener('click', (event) => {
                    // Base dice formula
                    let baseDiceString = `1d12+1d12`;  // Keep the base duality dice separate

                    // Format trait modifier properly using our helper function
                    const modifierString = formatTraitModifier(traitValue);

                    // Handle advantage/disadvantage using our helper function
                    let rollTitle = `${feature.name} Spellcast`;
                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        rollTitle
                    );

                    console.log(`Rolling spellcast: ${feature.name}, Base: ${baseDiceString}, Final: ${diceString}${modifierString}`);
                    this.plugin.rollDice(
                        `${diceString}${modifierString}`,
                        newRollTitle,
                        spellcastingTraitName
                    );
                });
            }
        }
    }

    private getFeatureMetadata(feature: DomainCard): { level?: number; domain?: string; type?: string; } {
        const metadata: { level?: number; domain?: string; type?: string; } = {};
        if (feature && feature._type === 'domainCard') {
            metadata.level = feature.level;
            metadata.domain = feature.domain;
            metadata.type = feature.type;
        }
        return metadata;
    }

    /**
     * Renders a full section for previewing features, complete with a title bar and a grid of cards.
     * @param parent - The parent HTMLElement to append the section to.
     * @param title - The title to display in the section header.
     * @param features - An array of features to display as cards.
     */
    private drawCreatorFeaturePreview(parent: HTMLElement, title: string, features: CompendiumFeature[]) {
        // Don't render anything if there are no features to show.
        if (!features || features.length === 0) return;

        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: title });

        const grid = section.createDiv({ cls: 'dh-feature-grid' });
        features.forEach(feat => {
            // Ensure the feature object is valid and has a name before creating a card.
            if (feat && feat.name) {
                this.createCreatorPreviewCard(grid, feat);
            }
        });
    }

    /**
     * Creates a single feature card, styled like the cards in the main character sheet manager.
     * @param parent - The parent grid HTMLElement to append the card to.
     * @param feature - The feature to display.
     */
    private createCreatorPreviewCard(parent: HTMLElement, feature: CompendiumFeature) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });

        // --- Card Header ---
        const header = card.createDiv({ cls: 'dh-feature-card-header' });
        header.createDiv({ cls: 'dh-feature-card-title', text: feature.name });

        // --- Card Body ---
        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        // Use renderRollableContent for consistency. It safely handles markdown and dice roll syntax.
        renderRollableContent(this.plugin, feature.description, body, feature.name, true);
    }
}
