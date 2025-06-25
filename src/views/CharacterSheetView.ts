import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App, Setting, TextComponent, ExtraButtonComponent } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import {
    Character, CompendiumAncestry, CompendiumClass, CompendiumCommunity, Trait,
    InventoryItem, Experience, Feature, CompendiumFeature, ArmorItem, WeaponItem, GenericItem, CompendiumItem, CompendiumSubclass, DomainCard
} from '../../types';
import { renderMarkdown } from '../rendering/ui-helpers';

export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

type ManagerTab = 'inventory' | 'abilities' | 'details';
const TRAIT_VALUES = [2, 1, 1, 0, 0, -1];
const TRAIT_NAMES: (keyof Character['traits'])[] = ['Strength', 'Agility', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];

// Extend CompendiumClass for this view's purposes to include narrative and inventory data from JSON
type CompendiumClassWithNarrative = CompendiumClass & {
    initialInventory: (WeaponItem | ArmorItem | GenericItem)[];
    _narrative?: {
        backgrounds: { question: string }[];
        connections: { question: string }[];
    };
};

// Type for the character creator state, expanded to include all creation steps
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
};

const CLASS_DOMAINS: { [key: string]: string[] } = {
    bard: ['Grace', 'Codex'],
    druid: ['Arcana', 'Sage'],
    guardian: ['Blade', 'Valor'],
    ranger: ['Bone', 'Sage'],
    rogue: ['Grace', 'Midnight'],
    seraph: ['Splendor', 'Valor'],
    sorcerer: ['Arcana', 'Midnight'],
    warrior: ['Blade', 'Bone'],
    wizard: ['Codex', 'Splendor'],
};

export class CharacterSheetView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    private activeManagerTab: ManagerTab = 'inventory';

    // State for the character creator wizard
    private creatorState: Partial<CreatorState> = {
        traits: {},
        domainCardIds: [],
        backgroundAnswers: [],
        experiences: [{ name: '', description: '' }, { name: '', description: '' }],
        startingWeaponIds: [],
        potionChoice: 'health',
        connections: [],
    };
    private creatorStep: number = 0;

    // UI elements for the creator
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
        container.empty();
        const main = container.createDiv({ cls: 'dh-cs-main' });
        this.drawHeader(main);
        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            this.drawCharacterSheet(main, activeChar);
        } else {
            this.drawCharacterCreator(main);
        }
    }

    private drawHeader(parent: HTMLElement) {
        const header = parent.createDiv({ cls: 'dh-cs-header' });
        const characters = this.plugin.getCharacters();
        const activeCharId = this.plugin.getActiveCharacterId();
        const selector = header.createEl('select', { cls: 'dropdown' });
        selector.createEl('option', { value: '', text: 'Select a Character...' });
        characters.forEach((char: Character) => {
            const option = selector.createEl('option', { value: char.id, text: char.name });
            if (char.id === activeCharId) { option.selected = true; }
        });
        selector.addEventListener('change', (ev: Event) => {
            const selectEl = ev.target as HTMLSelectElement;
            this.plugin.setActiveCharacterId(selectEl.value || null);
        });
        const newCharBtn = header.createEl('button', { cls: 'clickable-icon' });
        setIcon(newCharBtn, 'plus');
        newCharBtn.addEventListener('click', () => {
            this.creatorState = { traits: {}, domainCardIds: [], backgroundAnswers: [], experiences: [{ name: '', description: '' }, { name: '', description: '' }], startingWeaponIds: [], potionChoice: 'health', connections: [] };
            this.creatorStep = 0;
            this.plugin.setActiveCharacterId(null);
        });
    }

    // --- CHARACTER CREATOR WIZARD ---

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

        if (this.creatorStep < steps.length) {
            steps[this.creatorStep](this.stepContainer);
        }

        this.backBtn.style.visibility = this.creatorStep === 0 ? 'hidden' : 'visible';
        this.nextBtn.textContent = this.creatorStep === steps.length - 1 ? 'Create Character' : 'Next';
    }

    private drawCharacterCreator(parent: HTMLElement) {
        const creatorEl = parent.createDiv({ cls: 'dh-creator-wizard' });
        creatorEl.createEl('h2', { text: 'Create New Character' });

        this.stepContainer = creatorEl.createDiv();
        const navContainer = creatorEl.createDiv({ cls: 'dh-creator-nav' });
        this.backBtn = navContainer.createEl('button', { text: 'Back', cls: 'dh-creator-btn' });
        this.nextBtn = navContainer.createEl('button', { text: 'Next', cls: 'dh-creator-btn' });

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


    // --- WIZARD STEPS ---

    private drawCreatorStep1_Class(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 1: Choose your Class & Subclass' });

        const detailsContainer = parent.createDiv({ cls: 'dh-creator-details' });
        const subclassSetting = new Setting(parent);

        const drawDetails = () => {
            detailsContainer.empty();
            if (!this.creatorState.classId) return;
            const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId);
            if (charClass) {
                detailsContainer.createEl('h4', { text: charClass.name });
                renderMarkdown(this.plugin, charClass._narrative.description, detailsContainer.createDiv());
                detailsContainer.createEl('p', { text: `Initial HP: ${charClass.initialHitPoints} | Initial Evasion: ${charClass.initialEvasion}` });

                if (this.creatorState.subclassId) {
                    const subclass = this.plugin.characterCompendium.getSubclass(this.creatorState.subclassId);
                    if (subclass) {
                        detailsContainer.createEl('h5', { text: `Subclass: ${subclass.name}` });
                        renderMarkdown(this.plugin, subclass.description, detailsContainer.createDiv());
                    }
                }
            }
        };

        const drawSubclassDropdown = () => {
            subclassSetting.clear();
            const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? '');
            if (charClass) {
                subclassSetting.setName("Subclass").addDropdown(dd => {
                    dd.addOption('', '--- Select ---');
                    charClass.subclasses.forEach(subRef => {
                        const subclass = this.plugin.characterCompendium.getSubclass(subRef.value);
                        if (subclass) dd.addOption(subclass.id, subclass.name);
                    });
                    dd.setValue(this.creatorState.subclassId || '').onChange(value => { this.creatorState.subclassId = value; drawDetails(); });
                });
            }
        };

        new Setting(parent).setName("Class").addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            this.plugin.characterCompendium.classes.forEach(cls => dd.addOption(cls.id, cls.name));
            dd.setValue(this.creatorState.classId || '').onChange(value => {
                this.creatorState.classId = value;
                this.creatorState.subclassId = undefined;
                this.creatorState.backgroundAnswers = [];
                this.creatorState.connections = [];
                drawSubclassDropdown();
                drawDetails();
            });
        });

        drawSubclassDropdown();
        drawDetails();
    }

    private drawCreatorStep2_Heritage(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 2: Choose Heritage' });
        const ancestryDetails = parent.createDiv({ cls: 'dh-creator-details' });
        new Setting(parent).setName("Ancestry").addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            this.plugin.characterCompendium.ancestries.forEach(anc => dd.addOption(anc.id, anc.name));
            dd.setValue(this.creatorState.ancestryId || '').onChange(value => {
                this.creatorState.ancestryId = value;
                this.redrawCreatorStep();
            });
        });
        if (this.creatorState.ancestryId) {
            const ancestry = this.plugin.characterCompendium.getAncestry(this.creatorState.ancestryId);
            if (ancestry) {
                ancestryDetails.createEl('h4', { text: ancestry.name });
                renderMarkdown(this.plugin, ancestry.description, ancestryDetails.createDiv());
                ancestryDetails.createEl('strong', { text: `${ancestry.primaryFeature.name}: ` }).appendText(ancestry.primaryFeature.description);
                ancestryDetails.createEl('br');
                ancestryDetails.createEl('strong', { text: `${ancestry.secondaryFeature.name}: ` }).appendText(ancestry.secondaryFeature.description);
            }
        }

        const communityDetails = parent.createDiv({ cls: 'dh-creator-details' });
        new Setting(parent).setName("Community").addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            this.plugin.characterCompendium.communities.forEach(com => dd.addOption(com.id, com.name));
            dd.setValue(this.creatorState.communityId || '').onChange(value => {
                this.creatorState.communityId = value;
                this.redrawCreatorStep();
            });
        });
        if (this.creatorState.communityId) {
            const community = this.plugin.characterCompendium.getCommunity(this.creatorState.communityId);
            if (community) {
                communityDetails.createEl('h4', { text: community.name });
                renderMarkdown(this.plugin, community.description, communityDetails.createDiv());
                communityDetails.createEl('strong', { text: `${community.feature.name}: ` }).appendText(community.feature.description);
            }
        }
    }

    private drawCreatorStep3_Traits(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 3: Assign Traits' });
        parent.createEl('p', { text: 'Assign each value (+2, +1, +1, +0, +0, -1) to one of the six traits.' });
        const assignedValues = Object.values(this.creatorState.traits || {});
        const remainingValues = TRAIT_VALUES.filter(v => {
            const countInAssigned = assignedValues.filter(av => av === v).length;
            const countInMaster = TRAIT_VALUES.filter(tv => tv === v).length;
            return countInAssigned < countInMaster;
        });

        TRAIT_NAMES.forEach(traitName => {
            new Setting(parent).setName(traitName).addDropdown(dd => {
                dd.addOption('none', '---');
                const currentValue = this.creatorState.traits ? this.creatorState.traits[traitName] : undefined;
                const options = (currentValue !== undefined && currentValue !== null)
                    ? [...new Set([currentValue, ...remainingValues])].sort((a, b) => b - a)
                    : [...new Set(remainingValues)].sort((a, b) => b - a);

                options.forEach(val => dd.addOption(String(val), val >= 0 ? `+${val}` : String(val)));
                dd.setValue(String(currentValue ?? 'none'));

                dd.onChange(value => {
                    const numValue = value === 'none' ? undefined : parseInt(value);
                    if (this.creatorState.traits) {
                        this.creatorState.traits[traitName] = numValue;
                    }
                    this.redrawCreatorStep();
                });
            });
        });
    }

    private drawCreatorStep4_Equipment(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 4: Starting Equipment' });
        const weapons = this.plugin.characterCompendium.weapons;
        const armors = this.plugin.characterCompendium.armors;

        new Setting(parent).setName('Primary Weapon').addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            weapons.filter(w => w.burden === 'Two-Handed').forEach(w => dd.addOption(w.id, `${w.name} (2-Handed)`));
            weapons.filter(w => w.burden === 'One-Handed').forEach(w => dd.addOption(w.id, `${w.name} (1-Handed)`));
            dd.setValue(this.creatorState.startingWeaponIds?.[0] || '').onChange(value => {
                const weapon = weapons.find(w => w.id === value);
                this.creatorState.startingWeaponIds = weapon ? [value] : [];
                this.redrawCreatorStep();
            });
        });

        const primaryWeapon = weapons.find(w => w.id === this.creatorState.startingWeaponIds?.[0]);
        if (primaryWeapon && primaryWeapon.burden === 'One-Handed') {
            const secondaryWeapons = this.plugin.characterCompendium.weapons.filter(w => w.burden === 'One-Handed');
            new Setting(parent).setName('Secondary Weapon').addDropdown(dd => {
                dd.addOption('', '--- None ---');
                secondaryWeapons.forEach(w => dd.addOption(w.id, w.name));
                dd.setValue(this.creatorState.startingWeaponIds?.[1] || '').onChange(value => {
                    this.creatorState.startingWeaponIds = value ? [primaryWeapon.id, value] : [primaryWeapon.id];
                });
            });
        }

        new Setting(parent).setName('Armor').addDropdown(dd => {
            dd.addOption('', '--- Select ---');
            armors.forEach(a => dd.addOption(a.id, a.name));
            dd.setValue(this.creatorState.startingArmorId || '').onChange(value => { this.creatorState.startingArmorId = value; });
        });

        new Setting(parent).setName('Starting Potion').addDropdown(dd => {
            dd.addOption('health', 'Minor Health Potion').addOption('stamina', 'Minor Stamina Potion').setValue(this.creatorState.potionChoice || 'health').onChange(value => { this.creatorState.potionChoice = value as 'health' | 'stamina'; });
        });
    }

    private drawCreatorStep5_Background(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 5: Background Questions' });
        const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? '') as CompendiumClassWithNarrative | undefined;
        if (charClass?._narrative?.backgrounds) {
            charClass._narrative.backgrounds.forEach((bg, index) => {
                new Setting(parent).setName(bg.question).addTextArea(text => {
                    text.setValue(this.creatorState.backgroundAnswers?.[index] || '').onChange(value => {
                        if (!this.creatorState.backgroundAnswers) this.creatorState.backgroundAnswers = [];
                        this.creatorState.backgroundAnswers[index] = value;
                    });
                });
            });
        } else {
            parent.createEl('p', { text: 'Please select a class in Step 1 to see background questions.' });
        }
    }

    private drawCreatorStep6_Experiences(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 6: Create Experiences' });
        parent.createEl('p', { text: 'Create two experiences for your character. These represent skills or defining moments from their past. They both start with a +2 modifier.' });
        if (!this.creatorState.experiences) this.creatorState.experiences = [{ name: '', description: '' }, { name: '', description: '' }];

        this.creatorState.experiences.forEach((exp, index) => {
            parent.createEl('h5', { text: `Experience ${index + 1}` });
            new Setting(parent).setName('Name').addText(text => text.setPlaceholder('e.g., Survivor, Master of Disguise').setValue(exp.name).onChange(value => exp.name = value));
            // new Setting(parent).setName('Description').addTextArea(text => text.setPlaceholder('A brief description of the experience.').setValue(exp.description).onChange(value => exp.description = value));
        });
    }

    private drawCreatorStep7_Domains(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 7: Choose Domain Cards' });
        const classId = this.creatorState.classId;
        if (!classId) {
            parent.createEl('p', { text: 'Please select a class in Step 1.' });
            return;
        }

        const domains = CLASS_DOMAINS[classId];
        if (!domains) {
            parent.createEl('p', { text: 'Class domains not found.' });
            return;
        }

        parent.createEl('p', { text: `Choose two cards from your class domains: ${domains.join(' & ')}.` });

        const domainCards = this.plugin.characterCompendium.features.filter(f => {
            const metadata = this.getFeatureMetadata(f);
            return metadata.level === 1 && domains.some(d => d.toLowerCase() === metadata.domain?.toLowerCase());
        });

        const cardContainer = parent.createDiv({ cls: 'dh-creator-card-grid' });
        domainCards.forEach(card => {
            const cardEl = cardContainer.createDiv({ cls: 'dh-creator-card' });
            const label = cardEl.createEl('label');
            const checkbox = label.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.creatorState.domainCardIds?.includes(card.id) ?? false;

            checkbox.onchange = () => {
                if (!this.creatorState.domainCardIds) this.creatorState.domainCardIds = [];
                if (checkbox.checked) {
                    if (this.creatorState.domainCardIds.length < 2) {
                        this.creatorState.domainCardIds.push(card.id);
                    } else {
                        checkbox.checked = false;
                        new Notice('You can only select two domain cards.');
                    }
                } else {
                    this.creatorState.domainCardIds = this.creatorState.domainCardIds.filter(id => id !== card.id);
                }
            };

            label.createEl('strong', { text: card.name });
            renderMarkdown(this.plugin, card.description, label.createDiv());
        });
    }

    private drawCreatorStep8_Connections(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 8: Create Connections' });
        parent.createEl('p', { text: "Use these questions as inspiration to create connections with the other characters at your table. Discuss your answers together and jot down your notes here." });
        const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? '') as CompendiumClassWithNarrative | undefined;
        if (charClass?._narrative?.connections) {
            charClass._narrative.connections.forEach((conn, index) => {
                new Setting(parent).setName(conn.question).addTextArea(text => {
                    text.setValue(this.creatorState.connections?.[index] || '').onChange(value => {
                        if (!this.creatorState.connections) this.creatorState.connections = [];
                        this.creatorState.connections[index] = value;
                    });
                });
            });
        } else {
            parent.createEl('p', { text: 'Please select a class in Step 1 to see connection questions.' });
        }
    }


    private drawCreatorStep9_FinalDetails(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 9: Final Details & Review' });

        if (!this.creatorState.pronouns) this.creatorState.pronouns = { subject: 'they', object: 'them' };
        new Setting(parent).setName("Character Name").addText(text => text.setPlaceholder("Elara Meadowlight").setValue(this.creatorState.name || '').onChange(value => this.creatorState.name = value));
        new Setting(parent).setName("Subject Pronoun").addText(text => text.setPlaceholder("e.g., she").setValue(this.creatorState.pronouns?.subject || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.subject = value; }));
        new Setting(parent).setName("Object Pronoun").addText(text => text.setPlaceholder("e.g., her").setValue(this.creatorState.pronouns?.object || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.object = value; }));

        parent.createEl('hr');
        parent.createEl('h4', { text: 'Character Review' });
        const reviewEl = parent.createDiv({ cls: 'dh-creator-review' });

        const { ancestryId, communityId, classId, subclassId, traits, startingArmorId, startingWeaponIds, domainCardIds } = this.creatorState;
        const ancestry = this.plugin.characterCompendium.getAncestry(ancestryId ?? '');
        const community = this.plugin.characterCompendium.getCommunity(communityId ?? '');
        const charClass = this.plugin.characterCompendium.getClass(classId ?? '');
        const subclass = this.plugin.characterCompendium.getSubclass(subclassId ?? '');
        const armor = this.plugin.characterCompendium.armors.find(a => a.id === startingArmorId);
        const weapons = startingWeaponIds ? this.plugin.characterCompendium.weapons.filter(w => startingWeaponIds.includes(w.id)) : [];
        const domains = domainCardIds?.map(id => this.plugin.characterCompendium.getFeature(id)?.name).join(', ');

        reviewEl.createEl('p').innerHTML = `<strong>Class:</strong> ${charClass?.name || 'N/A'} (${subclass?.name || 'N/A'})`;
        reviewEl.createEl('p').innerHTML = `<strong>Ancestry:</strong> ${ancestry?.name || 'N/A'}`;
        reviewEl.createEl('p').innerHTML = `<strong>Community:</strong> ${community?.name || 'N/A'}`;

        reviewEl.createEl('h5', { text: 'Traits' });
        if (traits) { Object.entries(traits).forEach(([key, value]) => { if (value !== undefined) reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>${key}:</strong> ${value >= 0 ? '+' : ''}${value}`; }); }

        reviewEl.createEl('h5', { text: 'Equipment' });
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Armor:</strong> ${armor?.name || 'N/A'}`;
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Weapons:</strong> ${weapons?.map(w => w.name).join(', ') || 'N/A'}`;

        reviewEl.createEl('h5', { text: 'Domain Cards' });
        reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = domains || 'N/A';
    }

    private async finalizeCharacter(partialChar: Partial<CreatorState>) {
        // Validation...
        if (!partialChar.name || !partialChar.classId || !partialChar.subclassId || !partialChar.ancestryId || !partialChar.communityId || !partialChar.startingArmorId || !partialChar.startingWeaponIds || partialChar.startingWeaponIds.length === 0 || !partialChar.traits || !partialChar.domainCardIds || partialChar.domainCardIds.length !== 2) {
            new Notice("Please complete all required fields on all steps.");
            return;
        }

        const charClass = this.plugin.characterCompendium.getClass(partialChar.classId) as CompendiumClassWithNarrative | undefined;
        const ancestry = this.plugin.characterCompendium.getAncestry(partialChar.ancestryId);
        const community = this.plugin.characterCompendium.getCommunity(partialChar.communityId);
        const armor = this.plugin.characterCompendium.armors.find(a => a.id === partialChar.startingArmorId);

        if (!charClass || !ancestry || !community || !armor) {
            new Notice("Compendium data missing. Cannot create character.");
            return;
        }

        const finalTraits: { [key in keyof Character['traits']]: Trait } = {} as any;
        for (const key of TRAIT_NAMES) {
            finalTraits[key] = { _type: 'trait', value: partialChar.traits[key] ?? 0, locked: false };
        }

        const standardInventory: InventoryItem[] = [
            { _type: 'item', id: 'torch', name: 'Torch', instanceId: uuidv4() },
            { _type: 'item', id: 'rope', name: '50ft of Rope', instanceId: uuidv4() },
        ];
        if (partialChar.potionChoice === 'health') {
            standardInventory.push({ _type: 'item', id: 'minor-health-potion', name: 'Minor Health Potion', instanceId: uuidv4() });
        } else {
            standardInventory.push({ _type: 'item', id: 'minor-stamina-potion', name: 'Minor Stamina Potion', instanceId: uuidv4() });
        }

        const startingWeapons = partialChar.startingWeaponIds.map(id => ({ ...this.plugin.characterCompendium.weapons.find(w => w.id === id) as WeaponItem, instanceId: uuidv4() }));
        const startingArmor = { ...armor, instanceId: uuidv4() };

        const fullChar: Character = {
            id: uuidv4(),
            'dg-character': true,
            _type: 'character',
            name: partialChar.name,
            level: 1,
            pronouns: { ...partialChar.pronouns, _type: 'pronouns' } as Character['pronouns'],
            ancestryId: ancestry.id,
            communityId: community.id,
            classId: charClass.id,
            subclassId: partialChar.subclassId,
            evasion: charClass.initialEvasion,
            traits: finalTraits,
            hitPoints: { _type: 'dynamicResource', max: charClass.initialHitPoints, current: charClass.initialHitPoints },
            stress: { _type: 'dynamicResource', max: 6, current: 6 },
            hope: { _type: 'dynamicResource', max: 6, current: 2 },
            armorSlots: { _type: 'dynamicResource', max: startingArmor.baseScore, current: startingArmor.baseScore },
            damageThresholds: { _type: 'damageThresholds', major: startingArmor.baseThresholds.major + 1, severe: startingArmor.baseThresholds.severe + 1 },
            gold: { _type: 'gold', handfuls: 1, bags: 0, chests: 0 },
            experiences: (partialChar.experiences || []).map(exp => ({ ...exp, id: uuidv4(), value: 2, _type: 'experience' })),
            features: (partialChar.domainCardIds || []).map(id => this.plugin.characterCompendium.getFeature(id)).filter(f => f) as Feature[],
            inventory: [
                ...standardInventory,
                ...charClass.initialInventory.map(i => ({ ...i, instanceId: uuidv4() })),
                ...startingWeapons,
                startingArmor,
            ],
            equippedArmorId: startingArmor.instanceId,
            equippedWeaponIds: startingWeapons.map(w => w.instanceId),
            background: charClass._narrative?.backgrounds.map((bg, i) => ({ question: bg.question, answer: partialChar.backgroundAnswers?.[i] || '' })),
            connections: charClass._narrative?.connections.map((c, i) => ({ question: c.question, answer: partialChar.connections?.[i] || '' })),
        };

        await this.plugin.updateCharacter(fullChar);
        this.plugin.setActiveCharacterId(fullChar.id);
    }


    // --- CHARACTER SHEET RENDERER ---
    private drawCharacterSheet(parent: HTMLElement, data: Character) {
        const sheet = parent.createDiv({ cls: 'dh-sheet' });
        this.drawSheetHeader(sheet, data);
        const mainGrid = sheet.createDiv({ cls: 'dh-sheet-grid-compact' });
        this.drawLeftColumn(mainGrid, data);
        this.drawRightColumn(mainGrid, data);
    }

    private drawSheetHeader(parent: HTMLElement, data: Character) {
        const charClass = this.plugin.characterCompendium.getClass(data.classId);
        const ancestry = this.plugin.characterCompendium.getAncestry(data.ancestryId);
        const header = parent.createDiv({ cls: 'dh-sheet-header' });
        const nameAndClass = header.createDiv();
        nameAndClass.createEl('h1', { text: data.name || "Unnamed Character" });
        nameAndClass.createEl('p', { text: `Level ${data.level || 1} ${charClass?.name || 'N/A'}` });
        const ancestryAndCommunity = header.createDiv({ cls: 'text-align-right' });
        ancestryAndCommunity.createEl('h2', { text: ancestry?.name || 'N/A' });
        const deleteBtn = header.createEl('button', { cls: 'clickable-icon' });
        setIcon(deleteBtn, 'trash');
        deleteBtn.addEventListener('click', async () => {
            new Notice('To delete a character, please confirm in the upcoming dialog.');
            setTimeout(async () => {
                if (confirm(`Are you sure you want to delete ${data.name}? This cannot be undone.`)) {
                    await this.plugin.deleteCharacter(data.id);
                }
            }, 100);
        });
    }

    private drawLeftColumn(parent: HTMLElement, data: Character) {
        const leftCol = parent.createDiv({ cls: 'dh-grid-column-left' });
        this.drawPrimaryStats(leftCol, data);
        this.drawResourceTracks(leftCol, data);
        this.drawTraits(leftCol, data);
    }

    private drawRightColumn(parent: HTMLElement, data: Character) {
        const rightCol = parent.createDiv({ cls: 'dh-grid-column-right' });
        this.drawManager(rightCol, data);
    }

    private drawPrimaryStats(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-primary-stats' });
        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId) as ArmorItem | undefined;
        let armorEvasionMod = 0;
        if (equippedArmor?.features?.some(f => f.toLowerCase().includes('heavy'))) {
            armorEvasionMod = equippedArmor.features.some(f => f.toLowerCase().includes('very heavy')) ? -2 : -1;
        }
        const finalEvasion = data.evasion + armorEvasionMod;

        let finalMajorThreshold = data.damageThresholds.major;
        let finalSevereThreshold = data.damageThresholds.severe;

        if (!equippedArmor) {
            finalMajorThreshold = data.level;
            finalSevereThreshold = data.level * 2;
        } else {
            finalMajorThreshold = equippedArmor.baseThresholds.major + data.level;
            finalSevereThreshold = equippedArmor.baseThresholds.severe + data.level;
        }

        const evasionBox = container.createDiv({ cls: 'dh-stat-box' });
        evasionBox.createEl('span', { text: String(finalEvasion), cls: 'dh-stat-value' });
        evasionBox.createEl('span', { text: 'Evasion', cls: 'dh-stat-label' });
        const armorBox = container.createDiv({ cls: 'dh-stat-box' });
        armorBox.createEl('span', { text: String(data.armorSlots?.current || 0), cls: 'dh-stat-value' });
        armorBox.createEl('span', { text: 'Armor Slots', cls: 'dh-stat-label' });
        const thresholdsBox = container.createDiv({ cls: 'dh-threshold-box' });
        thresholdsBox.innerHTML = `<span>Minor<br>< ${finalMajorThreshold}</span><span>Major<br>${finalMajorThreshold}</span><span>Severe<br>${finalSevereThreshold}</span>`;
    }

    private drawResourceTracks(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-resource-tracks' });
        if (data.hitPoints) this.plugin.createInteractiveTrack(container, 'HP', data.hitPoints.max, data.id + '-hp', data.hitPoints.current, (v) => { data.hitPoints.current = v; this.plugin.updateCharacter(data); });
        if (data.stress) this.plugin.createInteractiveTrack(container, 'Stress', data.stress.max, data.id + '-stress', data.stress.current, (v) => { data.stress.current = v; this.plugin.updateCharacter(data); });
        if (data.hope) this.plugin.createInteractiveTrack(container, 'Hope', data.hope.max, data.id + '-hope', data.hope.current, (v) => { data.hope.current = v; this.plugin.updateCharacter(data); });
    }

    private drawTraits(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-traits' });
        Object.entries(data.traits).forEach(([name, trait]) => {
            const box = container.createDiv({ cls: `dh-trait-box-small ${trait.locked ? 'locked' : ''}` });
            box.createDiv({ cls: 'dh-trait-name-small', text: name.substring(0, 3).toUpperCase() });
            box.createDiv({ cls: 'dh-trait-value-small', text: `${trait.value >= 0 ? '+' : ''}${trait.value}` });
            if (!trait.locked) {
                box.addEventListener('click', () => this.plugin.rollDice(`1d20${trait.value >= 0 ? '+' : ''}${trait.value}`));
            }
        });
    }

    // --- MANAGER UI ---

    private drawManager(parent: HTMLElement, data: Character) {
        const managerContainer = parent.createDiv({ cls: 'dh-manager-container' });
        const tabs = managerContainer.createDiv({ cls: 'dh-manager-tabs' });
        this.createManagerTab(tabs, 'inventory', 'Inventory');
        this.createManagerTab(tabs, 'abilities', 'Abilities');
        this.createManagerTab(tabs, 'details', 'Details');

        const content = managerContainer.createDiv({ cls: 'dh-manager-content' });
        switch (this.activeManagerTab) {
            case 'inventory': this.drawInventoryManager(content, data); break;
            case 'abilities': this.drawAbilitiesManager(content, data); break;
            case 'details': this.drawDetailsManager(content, data); break;
        }
    }

    private createManagerTab(parent: HTMLElement, id: ManagerTab, text: string) {
        const tab = parent.createEl('div', { text, cls: 'dh-manager-tab' });
        if (this.activeManagerTab === id) { tab.addClass('is-active'); }
        tab.addEventListener('click', () => { this.activeManagerTab = id; this.draw(); });
    }

    private drawInventoryManager(parent: HTMLElement, character: Character) {
        const equippedSection = parent.createDiv({ cls: 'dh-card-section' });
        equippedSection.createEl('h3', { text: 'Equipped' });
        const equippedItems = character.inventory.filter(i => i.instanceId === character.equippedArmorId || (character.equippedWeaponIds && character.equippedWeaponIds.includes(i.instanceId)));
        if (equippedItems.length === 0) { equippedSection.createDiv({ text: 'Nothing equipped.', cls: 'dh-empty-text' }); }
        else { equippedItems.forEach(item => this.createItemCard(equippedSection, item, character)); }

        const carriedSection = parent.createDiv({ cls: 'dh-card-section' });
        const carriedHeader = carriedSection.createDiv({ cls: 'dh-section-header' });
        carriedHeader.createEl('h3', { text: 'Carried' });
        const addBtn = carriedHeader.createEl('button', { cls: 'clickable-icon' });
        setIcon(addBtn, 'plus');
        addBtn.addEventListener('click', () => {
            new AddItemModal(this.app, this.plugin, (item) => {
                character.inventory.push({ ...item, instanceId: uuidv4() });
                this.plugin.updateCharacter(character);
            }).open();
        });

        const carriedItems = character.inventory.filter(i => !equippedItems.some(eq => eq.instanceId === i.instanceId));
        if (carriedItems.length === 0) { carriedSection.createDiv({ text: 'Carrying nothing.', cls: 'dh-empty-text' }); }
        else { carriedItems.forEach(item => this.createItemCard(carriedSection, item, character)); }
    }

    private drawAbilitiesManager(parent: HTMLElement, data: Character) {
        const charClass = this.plugin.characterCompendium.getClass(data.classId);
        const ancestry = this.plugin.characterCompendium.getAncestry(data.ancestryId);
        const community = this.plugin.characterCompendium.getCommunity(data.communityId);

        if (ancestry) this.drawFeatureSection(parent, 'Heritage Features', [ancestry.primaryFeature, ancestry.secondaryFeature]);
        if (community) this.drawFeatureSection(parent, 'Community Features', [community.feature]);
        if (charClass) this.drawFeatureSection(parent, 'Class Features', [...(charClass?.features || []), charClass?.hopeFeature]);

        const domainSection = parent.createDiv({ cls: 'dh-card-section' });
        const domainHeader = domainSection.createDiv({ cls: 'dh-section-header' });
        domainHeader.createEl('h3', { text: 'Acquired Features & Spells' });
        const addDomainBtn = domainHeader.createEl('button', { cls: 'clickable-icon' });
        setIcon(addDomainBtn, 'plus');
        addDomainBtn.addEventListener('click', () => {
            if (!data.features) { data.features = []; }
            new AddFeatureModal(this.app, this.plugin, data, (feature) => {
                data.features.push(feature);
                this.plugin.updateCharacter(data);
            }).open();
        });

        (data.features || []).forEach(feature => {
            const notesText = 'notes' in feature && feature.notes && Array.isArray(feature.notes) ? feature.notes.join(', ') : '';
            this.createFeatureCard(domainSection, feature.name, feature.description, notesText);
        });
    }

    private drawDetailsManager(parent: HTMLElement, data: Character) {
        const goldSection = parent.createDiv({ cls: 'dh-card-section' });
        goldSection.createEl('h3', { text: 'Wealth' });
        const goldGrid = goldSection.createDiv({ cls: 'dh-gold-grid' });
        this.createGoldBox(goldGrid, 'Handfuls', data.gold.handfuls, data);
        this.createGoldBox(goldGrid, 'Bags', data.gold.bags, data);
        this.createGoldBox(goldGrid, 'Chests', data.gold.chests, data);

        const expSection = parent.createDiv({ cls: 'dh-card-section' });
        const expHeader = expSection.createDiv({ cls: 'dh-section-header' });
        expHeader.createEl('h3', { text: 'Experiences' });
        const addExpBtn = expHeader.createEl('button', { cls: 'clickable-icon' });
        setIcon(addExpBtn, 'plus');
        addExpBtn.addEventListener('click', () => new ExperienceModal(this.app, null, (exp) => { data.experiences.push(exp); this.plugin.updateCharacter(data); }).open());

        (data.experiences || []).forEach(exp => {
            this.createFeatureCard(expSection, exp.name, exp.description || '', `+${exp.value}`, true)
                .addEventListener('click', () => new ExperienceModal(this.app, exp, (updatedExp) => {
                    const index = data.experiences.findIndex(e => e.id === exp.id);
                    if (index > -1) data.experiences[index] = updatedExp;
                    this.plugin.updateCharacter(data);
                }, () => {
                    data.experiences = data.experiences.filter(e => e.id !== exp.id);
                    this.plugin.updateCharacter(data);
                }).open());
        });

        if (data.background && data.background.length > 0) {
            const backgroundSection = parent.createDiv({ cls: 'dh-card-section' });
            backgroundSection.createEl('h3', { text: 'Background' });
            data.background.forEach(bg => {
                this.createFeatureCard(backgroundSection, bg.question, bg.answer, '');
            });
        }
    }

    private createGoldBox(parent: HTMLElement, label: 'Handfuls' | 'Bags' | 'Chests', value: number, data: Character) {
        const box = parent.createDiv({ cls: 'dh-gold-box' });
        box.createEl('span', { text: String(value), cls: 'dh-gold-value' });
        box.createEl('span', { text: label, cls: 'dh-gold-label' });
        box.addEventListener('click', () => new GoldModal(this.app, data, () => this.plugin.updateCharacter(data)).open());
    }

    private createFeatureCard(parent: HTMLElement, name: string, description: string, subtext: string, isInteractive: boolean = false) {
        const card = parent.createDiv({ cls: `dh-card ${isInteractive ? 'is-interactive' : ''}` });
        const titleRow = card.createDiv({ cls: 'dh-card-title-row' });
        titleRow.createDiv({ cls: 'dh-card-title', text: name });
        if (subtext) titleRow.createSpan({ cls: 'dh-card-subtext', text: subtext });
        const descEl = card.createDiv({ cls: 'dh-card-description' });
        renderMarkdown(this.plugin, description, descEl);
        return card;
    }

    private createItemCard(parent: HTMLElement, item: InventoryItem, character: Character) {
        const card = parent.createDiv({ cls: 'dh-card is-interactive' });
        const titleRow = card.createDiv({ cls: 'dh-card-title-row' });
        titleRow.createDiv({ cls: 'dh-card-title', text: item.name });
        const subtext = item._type === 'weapon' ? `${(item as WeaponItem).damageDice} ${(item as WeaponItem).damageType}` : (item._type === 'armor' ? `${(item as ArmorItem).baseScore} Armor` : 'Item');
        titleRow.createSpan({ cls: 'dh-card-subtext', text: subtext });
        card.addEventListener('click', () => new ItemActionModal(this.app, item, character, () => this.plugin.updateCharacter(character)).open());
    }

    private drawFeatureSection(parent: HTMLElement, title: string, features: (CompendiumFeature | undefined)[]) {
        if (!features.some(f => f)) return;
        const section = parent.createDiv({ cls: 'dh-card-section' });
        section.createEl('h3', { text: title });
        features.forEach(feat => {
            if (feat) this.createFeatureCard(section, feat.name, feat.description, '');
        });
    }

    private getFeatureMetadata(feature: Feature | DomainCard): { level?: number; domain?: string; type?: string; recallCost?: number } {
        const metadata: { level?: number; domain?: string; type?: string; recallCost?: number } = {};

        if ('notes' in feature && feature.notes && Array.isArray(feature.notes)) {
            feature.notes.forEach(note => {
                const lowerNote = note.toLowerCase();
                if (lowerNote.startsWith('level:')) {
                    const level = parseInt(note.split(':')[1]?.trim());
                    if (!isNaN(level)) metadata.level = level;
                } else if (lowerNote.startsWith('domain:')) {
                    metadata.domain = note.split(':')[1]?.trim();
                } else if (lowerNote.startsWith('type:')) {
                    metadata.type = note.split(':')[1]?.trim();
                } else if (lowerNote.startsWith('recall cost:')) {
                    const cost = parseInt(note.split(':')[1]?.trim());
                    if (!isNaN(cost)) metadata.recallCost = cost;
                }
            });
        } else if ('level' in feature) { // It's a DomainCard
            const card = feature as DomainCard;
            metadata.level = card.level;
            metadata.domain = card.domain;
            metadata.type = card.type;
            metadata.recallCost = card.recallCost;
        }
        return metadata;
    }
}

// --- MODALS ---

class GoldModal extends Modal {
    character: Character;
    onSave: () => void;
    constructor(app: App, character: Character, onSave: () => void) { super(app); this.character = character; this.onSave = onSave; }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Update Wealth" });
        let { handfuls, bags, chests } = this.character.gold;
        new Setting(contentEl).setName("Chests").addText(text => text.setValue(String(chests)).onChange(v => chests = parseInt(v) || 0));
        new Setting(contentEl).setName("Bags").addText(text => text.setValue(String(bags)).onChange(v => bags = parseInt(v) || 0));
        new Setting(contentEl).setName("Handfuls").addText(text => text.setValue(String(handfuls)).onChange(v => handfuls = parseInt(v) || 0));
        new Setting(contentEl).addButton(btn => btn.setButtonText("Save").setCta().onClick(() => {
            bags += Math.floor(handfuls / 10);
            handfuls %= 10;
            chests += Math.floor(bags / 10);
            bags %= 10;
            this.character.gold = { _type: 'gold', handfuls, bags, chests };
            this.onSave();
            this.close();
        }));
    }
    onClose() { this.contentEl.empty(); }
}

class ExperienceModal extends Modal {
    experience: Experience | null;
    onSave: (result: Experience) => void;
    onDelete?: () => void;
    result: Experience;
    constructor(app: App, experience: Experience | null, onSave: (result: Experience) => void, onDelete?: () => void) {
        super(app);
        this.experience = experience;
        this.onSave = onSave;
        this.onDelete = onDelete;
        this.result = experience ? { ...experience } : { _type: 'experience', id: uuidv4(), name: '', value: 2, description: '' };
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.experience ? "Edit Experience" : "Add Experience" });
        new Setting(contentEl).setName("Name").addText(text => text.setValue(this.result.name).onChange(v => this.result.name = v));
        new Setting(contentEl).setName("Value").addText(text => text.setValue(String(this.result.value)).onChange(v => this.result.value = parseInt(v) || 0));
        new Setting(contentEl).setName("Description").addTextArea(text => text.setValue(this.result.description || '').onChange(v => this.result.description = v));
        const buttons = new Setting(contentEl);
        if (this.onDelete) {
            buttons.addButton(btn => btn.setButtonText("Delete").setWarning().onClick(() => {
                if (confirm("Are you sure?")) {
                    if (this.onDelete) this.onDelete();
                    this.close();
                }
            }));
        }
        buttons.addButton(btn => btn.setButtonText("Save").setCta().onClick(() => {
            if (!this.result.name) { new Notice("Name is required."); return; }
            this.onSave(this.result);
            this.close();
        }));
    }
    onClose() { this.contentEl.empty(); }
}

class AddItemModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSelect: (item: CompendiumItem) => void;
    private searchInput: TextComponent;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onSelect: (item: CompendiumItem) => void) {
        super(app);
        this.plugin = plugin;
        this.onSelect = onSelect;
        this.modalEl.addClass('dh-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Add Item from Compendium" });

        const searchContainer = contentEl.createDiv({ cls: 'search-container' });
        this.searchInput = new TextComponent(searchContainer).setPlaceholder("Search items...");

        const listEl = contentEl.createDiv({ cls: 'dh-modal-list' });
        this.renderList(listEl, '');

        this.searchInput.onChange(value => this.renderList(listEl, value));
    }

    renderList(container: HTMLElement, filter: string) {
        container.empty();
        const allItems = this.plugin.characterCompendium.getAllItems();
        const filtered = allItems.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()));

        if (filtered.length === 0) {
            container.createEl('p', { text: 'No items match your search.' });
            return;
        }

        filtered.forEach(item => {
            const itemEl = container.createDiv({ cls: 'dh-modal-list-item' });
            itemEl.style.marginBottom = "10px";
            itemEl.style.padding = "10px";
            itemEl.style.border = "1px solid var(--background-modifier-border)";
            itemEl.style.borderRadius = "5px";
            itemEl.style.cursor = "pointer";

            itemEl.addEventListener('mouseenter', () => { itemEl.style.backgroundColor = "var(--background-modifier-hover)"; });
            itemEl.addEventListener('mouseleave', () => { itemEl.style.backgroundColor = ""; });

            itemEl.createEl('h4', { text: item.name });

            const typeText = item._type === 'weapon' ? 'Weapon' : item._type === 'armor' ? 'Armor' : 'Item';
            const typeBadge = itemEl.createDiv({ cls: 'dh-item-badge', text: typeText });
            typeBadge.style.display = "inline-block";
            typeBadge.style.padding = "2px 8px";
            typeBadge.style.margin = "5px 0";
            typeBadge.style.borderRadius = "10px";
            typeBadge.style.fontSize = "smaller";
            typeBadge.style.backgroundColor = "var(--background-modifier-border)";

            if (item.description) {
                itemEl.createEl('p', { text: item.description || '', attr: { style: "margin-top: 5px; font-size: 0.9em; color: var(--text-muted);" } });
            }

            itemEl.addEventListener('click', () => { this.onSelect(item); this.close(); });
        });
    }

    onClose() { this.contentEl.empty(); }
}

class AddFeatureModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSelect: (feature: Feature) => void;
    // ... filtering properties ...

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSelect: (feature: Feature) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.onSelect = onSelect;
        this.modalEl.addClass('dh-modal');
    }

    onOpen() {
        // ... modal implementation ...
    }

    // ... other methods ...
}

class ItemActionModal extends Modal {
    item: InventoryItem;
    character: Character;
    onUpdate: () => void;

    constructor(app: App, item: InventoryItem, character: Character, onUpdate: () => void) {
        super(app);
        this.item = item;
        this.character = character;
        this.onUpdate = onUpdate;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.item.name });

        if (this.item._type === 'armor' || this.item._type === 'weapon') {
            const isEquipped = this.character.equippedArmorId === this.item.instanceId || this.character.equippedWeaponIds.includes(this.item.instanceId);
            if (isEquipped) {
                new Setting(contentEl).addButton(btn => btn.setButtonText("Unequip").onClick(() => this.unequipItem()));
            } else {
                new Setting(contentEl).addButton(btn => btn.setButtonText("Equip").onClick(() => this.equipItem()));
            }
        }

        new Setting(contentEl).addButton(btn => btn.setButtonText("Drop").setWarning().onClick(() => {
            if (confirm("Are you sure you want to drop this item?")) {
                this.character.inventory = this.character.inventory.filter(i => i.instanceId !== this.item.instanceId);
                this.unequipItem();
                this.onUpdate();
                this.close();
            }
        }));
    }

    equipItem() {
        if (this.item._type === 'armor') {
            this.character.equippedArmorId = this.item.instanceId;
            const armor = this.item as ArmorItem;
            this.character.armorSlots = { _type: 'dynamicResource', max: armor.baseScore, current: armor.baseScore };
            this.character.damageThresholds = { _type: 'damageThresholds', major: armor.baseThresholds.major + this.character.level, severe: armor.baseThresholds.severe + this.character.level };
        } else if (this.item._type === 'weapon') {
            const weapon = this.item as WeaponItem;
            if (weapon.burden === 'Two-Handed') {
                this.character.equippedWeaponIds = [this.item.instanceId];
            } else {
                const equippedWeapons = this.character.inventory.filter(i => this.character.equippedWeaponIds.includes(i.instanceId) && i._type === 'weapon') as WeaponItem[];
                const twoHandedEquipped = equippedWeapons.find(w => w.burden === 'Two-Handed');
                if (twoHandedEquipped) {
                    this.character.equippedWeaponIds = [this.item.instanceId];
                } else if (equippedWeapons.length < 2) {
                    this.character.equippedWeaponIds.push(this.item.instanceId);
                } else {
                    new Notice("You already have two one-handed weapons equipped. Unequip one first.");
                    this.close();
                    return;
                }
            }
        }
        this.onUpdate();
        this.close();
    }

    unequipItem() {
        if (this.item._type === 'armor' && this.character.equippedArmorId === this.item.instanceId) {
            this.character.equippedArmorId = null;
            this.character.armorSlots = { _type: 'dynamicResource', max: 0, current: 0 };
            this.character.damageThresholds = { _type: 'damageThresholds', major: this.character.level, severe: this.character.level * 2 };
        } else if (this.item._type === 'weapon') {
            this.character.equippedWeaponIds = this.character.equippedWeaponIds.filter(id => id !== this.item.instanceId);
        }
        this.onUpdate();
        this.close();
    }

    onClose() { this.contentEl.empty(); }
}
