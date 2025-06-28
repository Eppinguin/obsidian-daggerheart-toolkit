import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App, Setting, TextComponent, ExtraButtonComponent, Menu } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import {
    Character, CompendiumAncestry, CompendiumClass, CompendiumCommunity, Trait,
    InventoryItem, Experience, Feature, CompendiumFeature, ArmorItem, WeaponItem, GenericItem, CompendiumItem, CompendiumSubclass, DomainCard, Condition
} from '../../types';
import { DAGGERHEART_CONDITIONS } from '../constants';
import { renderMarkdown, renderRollableContent } from '../rendering/ui-helpers';

export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

type ManagerTab = 'abilities' | 'inventory' | 'details'; // Abilities is now the default
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
    private activeManagerTab: ManagerTab = 'abilities'; // Default tab is now 'abilities'

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
        this.drawTopBar(main); // Changed from drawHeader
        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            this.drawCharacterSheet(main, activeChar);
        } else {
            this.drawCharacterCreator(main);
        }
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
        selector.addEventListener('change', (ev: Event) => {
            const selectEl = ev.target as HTMLSelectElement;
            this.plugin.setActiveCharacterId(selectEl.value || null);
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
            deleteBtn.addEventListener('click', async () => {
                new Notice('To delete a character, please confirm in the upcoming dialog.');
                setTimeout(async () => {
                    if (confirm(`Are you sure you want to delete ${activeChar.name}? This cannot be undone.`)) {
                        await this.plugin.deleteCharacter(activeChar.id);
                    }
                }, 100);
            });
        }

        const newCharBtn = right.createEl('button', { cls: 'clickable-icon' });
        setIcon(newCharBtn, 'plus');
        newCharBtn.ariaLabel = "Create New Character";
        newCharBtn.addEventListener('click', () => {
            this.creatorState = { traits: {}, domainCardIds: [], backgroundAnswers: [], experiences: [{ name: '', description: '' }, { name: '', description: '' }], startingWeaponIds: [], potionChoice: 'health', connections: [] };
            this.creatorStep = 0;
            this.plugin.setActiveCharacterId(null);
        });
    }

    // --- CHARACTER CREATOR WIZARD (Omitted for brevity) ---
    private redrawCreatorStep() { if (!this.stepContainer) return; this.stepContainer.empty(); const steps = [this.drawCreatorStep1_Class.bind(this), this.drawCreatorStep2_Heritage.bind(this), this.drawCreatorStep3_Traits.bind(this), this.drawCreatorStep4_Equipment.bind(this), this.drawCreatorStep5_Background.bind(this), this.drawCreatorStep6_Experiences.bind(this), this.drawCreatorStep7_Domains.bind(this), this.drawCreatorStep8_Connections.bind(this), this.drawCreatorStep9_FinalDetails.bind(this),]; if (this.creatorStep < steps.length) { steps[this.creatorStep](this.stepContainer); } this.backBtn.style.visibility = this.creatorStep === 0 ? 'hidden' : 'visible'; this.nextBtn.textContent = this.creatorStep === steps.length - 1 ? 'Create Character' : 'Next'; }
    private drawCharacterCreator(parent: HTMLElement) { const creatorEl = parent.createDiv({ cls: 'dh-creator-wizard' }); creatorEl.createEl('h2', { text: 'Create New Character' }); this.stepContainer = creatorEl.createDiv(); const navContainer = creatorEl.createDiv({ cls: 'dh-creator-nav' }); this.backBtn = navContainer.createEl('button', { text: 'Back', cls: 'dh-creator-btn' }); this.nextBtn = navContainer.createEl('button', { text: 'Next', cls: 'dh-creator-btn mod-cta' }); this.backBtn.addEventListener('click', () => { if (this.creatorStep > 0) { this.creatorStep--; this.redrawCreatorStep(); } }); this.nextBtn.addEventListener('click', async () => { const steps = 9; if (this.creatorStep === steps - 1) { await this.finalizeCharacter(this.creatorState); } else if (this.creatorStep < steps - 1) { this.creatorStep++; this.redrawCreatorStep(); } }); this.redrawCreatorStep(); }
    private drawCreatorStep1_Class(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Step 1: Choose your Class & Subclass' }); const detailsContainer = parent.createDiv({ cls: 'dh-creator-details' }); const subclassSetting = new Setting(parent); const drawDetails = () => {
            detailsContainer.empty(); if (!this.creatorState.classId) return; const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId); if (charClass) {
                detailsContainer.createEl('h4', { text: charClass.name }); if (charClass._narrative?.description) {
                    renderMarkdown(this.plugin, charClass._narrative.description, detailsContainer.createDiv());
                }
                detailsContainer.createEl('p', { text: `Initial HP: ${charClass.initialHitPoints} | Initial Evasion: ${charClass.initialEvasion}` }); if (this.creatorState.subclassId) { const subclass = this.plugin.characterCompendium.getSubclass(this.creatorState.subclassId); if (subclass) { detailsContainer.createEl('h5', { text: `Subclass: ${subclass.name}` }); renderMarkdown(this.plugin, subclass.description, detailsContainer.createDiv()); } }
            }
        }; const drawSubclassDropdown = () => { subclassSetting.clear(); const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? ''); if (charClass) { subclassSetting.setName("Subclass").addDropdown(dd => { dd.addOption('', '--- Select ---'); charClass.subclasses.forEach(subRef => { const subclass = this.plugin.characterCompendium.getSubclass(subRef.value); if (subclass) dd.addOption(subclass.id, subclass.name); }); dd.setValue(this.creatorState.subclassId || '').onChange(value => { this.creatorState.subclassId = value; drawDetails(); }); }); } }; new Setting(parent).setName("Class").addDropdown(dd => { dd.addOption('', '--- Select ---'); this.plugin.characterCompendium.classes.forEach(cls => dd.addOption(cls.id, cls.name)); dd.setValue(this.creatorState.classId || '').onChange(value => { this.creatorState.classId = value; this.creatorState.subclassId = undefined; this.creatorState.backgroundAnswers = []; this.creatorState.connections = []; drawSubclassDropdown(); drawDetails(); }); }); drawSubclassDropdown(); drawDetails();
    }
    private drawCreatorStep2_Heritage(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 2: Choose Heritage' }); const ancestryDetails = parent.createDiv({ cls: 'dh-creator-details' }); new Setting(parent).setName("Ancestry").addDropdown(dd => { dd.addOption('', '--- Select ---'); this.plugin.characterCompendium.ancestries.forEach(anc => dd.addOption(anc.id, anc.name)); dd.setValue(this.creatorState.ancestryId || '').onChange(value => { this.creatorState.ancestryId = value; this.redrawCreatorStep(); }); }); if (this.creatorState.ancestryId) { const ancestry = this.plugin.characterCompendium.getAncestry(this.creatorState.ancestryId); if (ancestry) { ancestryDetails.createEl('h4', { text: ancestry.name }); renderMarkdown(this.plugin, ancestry.description, ancestryDetails.createDiv()); ancestryDetails.createEl('strong', { text: `${ancestry.primaryFeature.name}: ` }).appendText(ancestry.primaryFeature.description); ancestryDetails.createEl('br'); ancestryDetails.createEl('strong', { text: `${ancestry.secondaryFeature.name}: ` }).appendText(ancestry.secondaryFeature.description); } } const communityDetails = parent.createDiv({ cls: 'dh-creator-details' }); new Setting(parent).setName("Community").addDropdown(dd => { dd.addOption('', '--- Select ---'); this.plugin.characterCompendium.communities.forEach(com => dd.addOption(com.id, com.name)); dd.setValue(this.creatorState.communityId || '').onChange(value => { this.creatorState.communityId = value; this.redrawCreatorStep(); }); }); if (this.creatorState.communityId) { const community = this.plugin.characterCompendium.getCommunity(this.creatorState.communityId); if (community) { communityDetails.createEl('h4', { text: community.name }); renderMarkdown(this.plugin, community.description, communityDetails.createDiv()); communityDetails.createEl('strong', { text: `${community.feature.name}: ` }).appendText(community.feature.description); } } }
    private drawCreatorStep3_Traits(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 3: Assign Traits' }); parent.createEl('p', { text: 'Assign each value (+2, +1, +1, +0, +0, -1) to one of the six traits.' }); const assignedValues = Object.values(this.creatorState.traits || {}); const remainingValues = TRAIT_VALUES.filter(v => { const countInAssigned = assignedValues.filter(av => av === v).length; const countInMaster = TRAIT_VALUES.filter(tv => tv === v).length; return countInAssigned < countInMaster; }); TRAIT_NAMES.forEach(traitName => { new Setting(parent).setName(traitName).addDropdown(dd => { dd.addOption('none', '---'); const currentValue = this.creatorState.traits ? this.creatorState.traits[traitName] : undefined; const options = (currentValue !== undefined && currentValue !== null) ? [...new Set([currentValue, ...remainingValues])].sort((a, b) => b - a) : [...new Set(remainingValues)].sort((a, b) => b - a); options.forEach(val => dd.addOption(String(val), val >= 0 ? `+${val}` : String(val))); dd.setValue(String(currentValue ?? 'none')); dd.onChange(value => { const numValue = value === 'none' ? undefined : parseInt(value); if (this.creatorState.traits) { this.creatorState.traits[traitName] = numValue; } this.redrawCreatorStep(); }); }); }); }
    private drawCreatorStep4_Equipment(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 4: Starting Equipment' }); const weapons = this.plugin.characterCompendium.weapons; const armors = this.plugin.characterCompendium.armors; new Setting(parent).setName('Primary Weapon').addDropdown(dd => { dd.addOption('', '--- Select ---'); weapons.filter(w => w.burden === 'Two-Handed').forEach(w => dd.addOption(w.id, `${w.name} (2-Handed)`)); weapons.filter(w => w.burden === 'One-Handed').forEach(w => dd.addOption(w.id, `${w.name} (1-Handed)`)); dd.setValue(this.creatorState.startingWeaponIds?.[0] || '').onChange(value => { const weapon = weapons.find(w => w.id === value); this.creatorState.startingWeaponIds = weapon ? [value] : []; this.redrawCreatorStep(); }); }); const primaryWeapon = weapons.find(w => w.id === this.creatorState.startingWeaponIds?.[0]); if (primaryWeapon && primaryWeapon.burden === 'One-Handed') { const secondaryWeapons = this.plugin.characterCompendium.weapons.filter(w => w.burden === 'One-Handed'); new Setting(parent).setName('Secondary Weapon').addDropdown(dd => { dd.addOption('', '--- None ---'); secondaryWeapons.forEach(w => dd.addOption(w.id, w.name)); dd.setValue(this.creatorState.startingWeaponIds?.[1] || '').onChange(value => { this.creatorState.startingWeaponIds = value ? [primaryWeapon.id, value] : [primaryWeapon.id]; }); }); } new Setting(parent).setName('Armor').addDropdown(dd => { dd.addOption('', '--- Select ---'); armors.forEach(a => dd.addOption(a.id, a.name)); dd.setValue(this.creatorState.startingArmorId || '').onChange(value => { this.creatorState.startingArmorId = value; }); }); new Setting(parent).setName('Starting Potion').addDropdown(dd => { dd.addOption('health', 'Minor Health Potion').addOption('stamina', 'Minor Stamina Potion').setValue(this.creatorState.potionChoice || 'health').onChange(value => { this.creatorState.potionChoice = value as 'health' | 'stamina'; }); }); }
    private drawCreatorStep5_Background(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 5: Background Questions' }); const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? '') as CompendiumClassWithNarrative | undefined; if (charClass?._narrative?.backgrounds) { charClass._narrative.backgrounds.forEach((bg, index) => { new Setting(parent).setName(bg.question).addTextArea(text => { text.setValue(this.creatorState.backgroundAnswers?.[index] || '').onChange(value => { if (!this.creatorState.backgroundAnswers) this.creatorState.backgroundAnswers = []; this.creatorState.backgroundAnswers[index] = value; }); }); }); } else { parent.createEl('p', { text: 'Please select a class in Step 1 to see background questions.' }); } }
    private drawCreatorStep6_Experiences(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 6: Create Experiences' }); parent.createEl('p', { text: 'Create two experiences for your character. These represent skills or defining moments from their past. They both start with a +2 modifier.' }); if (!this.creatorState.experiences) this.creatorState.experiences = [{ name: '', description: '' }, { name: '', description: '' }]; this.creatorState.experiences.forEach((exp, index) => { parent.createEl('h5', { text: `Experience ${index + 1}` }); new Setting(parent).setName('Name').addText(text => text.setPlaceholder('e.g., Survivor, Master of Disguise').setValue(exp.name).onChange(value => exp.name = value)); }); }
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
            if (this.creatorState.domainCardIds?.includes(card.id)) {
                cardEl.addClass('is-selected');
            }

            cardEl.addEventListener('click', () => {
                if (!this.creatorState.domainCardIds) {
                    this.creatorState.domainCardIds = [];
                }

                const isSelected = this.creatorState.domainCardIds.includes(card.id);

                if (isSelected) {
                    this.creatorState.domainCardIds = this.creatorState.domainCardIds.filter(id => id !== card.id);
                    cardEl.removeClass('is-selected');
                } else {
                    if (this.creatorState.domainCardIds.length < 2) {
                        this.creatorState.domainCardIds.push(card.id);
                        cardEl.addClass('is-selected');
                    } else {
                        new Notice('You can only select two domain cards.');
                    }
                }
            });

            cardEl.createEl('strong', { text: card.name });
            renderMarkdown(this.plugin, card.description, cardEl.createDiv());

            const metadata = this.getFeatureMetadata(card as Feature);
            const footer = cardEl.createDiv({ cls: 'dh-creator-card-meta' });
            if (metadata.domain) {
                footer.createSpan({ text: `Domain: ${metadata.domain}` });
            }
            if (metadata.level) {
                footer.createSpan({ text: `Level: ${metadata.level}` });
            }
        });
    }
    private drawCreatorStep8_Connections(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 8: Create Connections' }); parent.createEl('p', { text: "Use these questions as inspiration to create connections with the other characters at your table. Discuss your answers together and jot down your notes here." }); const charClass = this.plugin.characterCompendium.getClass(this.creatorState.classId ?? '') as CompendiumClassWithNarrative | undefined; if (charClass?._narrative?.connections) { charClass._narrative.connections.forEach((conn, index) => { new Setting(parent).setName(conn.question).addTextArea(text => { text.setValue(this.creatorState.connections?.[index] || '').onChange(value => { if (!this.creatorState.connections) this.creatorState.connections = []; this.creatorState.connections[index] = value; }); }); }); } else { parent.createEl('p', { text: 'Please select a class in Step 1 to see connection questions.' }); } }
    private drawCreatorStep9_FinalDetails(parent: HTMLElement) { parent.createEl('h3', { text: 'Step 9: Final Details & Review' }); if (!this.creatorState.pronouns) this.creatorState.pronouns = { subject: 'they', object: 'them' }; new Setting(parent).setName("Character Name").addText(text => text.setPlaceholder("Elara Meadowlight").setValue(this.creatorState.name || '').onChange(value => this.creatorState.name = value)); new Setting(parent).setName("Subject Pronoun").addText(text => text.setPlaceholder("e.g., she").setValue(this.creatorState.pronouns?.subject || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.subject = value; })); new Setting(parent).setName("Object Pronoun").addText(text => text.setPlaceholder("e.g., her").setValue(this.creatorState.pronouns?.object || '').onChange(value => { if (this.creatorState.pronouns) this.creatorState.pronouns.object = value; })); parent.createEl('hr'); parent.createEl('h4', { text: 'Character Review' }); const reviewEl = parent.createDiv({ cls: 'dh-creator-review' }); const { ancestryId, communityId, classId, subclassId, traits, startingArmorId, startingWeaponIds, domainCardIds } = this.creatorState; const ancestry = this.plugin.characterCompendium.getAncestry(ancestryId ?? ''); const community = this.plugin.characterCompendium.getCommunity(communityId ?? ''); const charClass = this.plugin.characterCompendium.getClass(classId ?? ''); const subclass = this.plugin.characterCompendium.getSubclass(subclassId ?? ''); const armor = this.plugin.characterCompendium.armors.find(a => a.id === startingArmorId); const weapons = startingWeaponIds ? this.plugin.characterCompendium.weapons.filter(w => startingWeaponIds.includes(w.id)) : []; const domains = domainCardIds?.map(id => this.plugin.characterCompendium.getFeature(id)?.name).join(', '); reviewEl.createEl('p').innerHTML = `<strong>Class:</strong> ${charClass?.name || 'N/A'} (${subclass?.name || 'N/A'})`; reviewEl.createEl('p').innerHTML = `<strong>Ancestry:</strong> ${ancestry?.name || 'N/A'}`; reviewEl.createEl('p').innerHTML = `<strong>Community:</strong> ${community?.name || 'N/A'}`; reviewEl.createEl('h5', { text: 'Traits' }); if (traits) { Object.entries(traits).forEach(([key, value]) => { if (value !== undefined) reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>${key}:</strong> ${value >= 0 ? '+' : ''}${value}`; }); } reviewEl.createEl('h5', { text: 'Equipment' }); reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Armor:</strong> ${armor?.name || 'N/A'}`; reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = `<strong>Weapons:</strong> ${weapons?.map(w => w.name).join(', ') || 'N/A'}`; reviewEl.createEl('h5', { text: 'Domain Cards' }); reviewEl.createEl('p', { cls: 'dh-review-item' }).innerHTML = domains || 'N/A'; }
    private async finalizeCharacter(partialChar: Partial<CreatorState>) {
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

        const startingWeapons = partialChar.startingWeaponIds.map(id => ({
            ...this.plugin.characterCompendium.weapons.find(w => w.id === id) as WeaponItem,
            instanceId: uuidv4()
        }));
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
            hitPoints: { _type: 'dynamicResource', max: charClass.initialHitPoints, current: 0 },
            stress: { _type: 'dynamicResource', max: 6, current: 0 },
            hope: { _type: 'dynamicResource', max: 6, current: 2 },
            armorSlots: { _type: 'dynamicResource', max: startingArmor.baseScore, current: 0 },
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
            features: (partialChar.domainCardIds || [])
                .map(id => this.plugin.characterCompendium.getFeature(id))
                .filter(f => f) as Feature[],
            inventory: [
                ...standardInventory,
                ...charClass.initialInventory.map(i => ({ ...i, instanceId: uuidv4() })),
                ...startingWeapons,
                startingArmor,
            ],
            equippedArmorId: startingArmor.instanceId,
            equippedWeaponIds: startingWeapons.map(w => w.instanceId),
            background: charClass._narrative?.backgrounds.map((bg, i) => ({
                question: bg.question,
                answer: partialChar.backgroundAnswers?.[i] || ''
            })),
            connections: charClass._narrative?.connections.map((c, i) => ({
                question: c.question,
                answer: partialChar.connections?.[i] || ''
            })),
            conditions: [], // Initialize conditions array
        };

        await this.plugin.updateCharacter(fullChar);
        this.plugin.setActiveCharacterId(fullChar.id);
    }

    // --- CHARACTER SHEET RENDERER (REBUILT) ---
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
        const charClass = this.plugin.characterCompendium.getClass(data.classId);
        const subClass = this.plugin.characterCompendium.getSubclass(data.subclassId);
        const ancestry = this.plugin.characterCompendium.getAncestry(data.ancestryId);

        const header = parent.createDiv({ cls: 'dh-sheet-header' });

        const left = header.createDiv({ cls: 'dh-header-left' });
        const avatar = left.createDiv({ cls: 'dh-avatar' });
        setIcon(avatar, 'user-round');
        const nameplate = left.createDiv({ cls: 'dh-nameplate' });
        nameplate.createEl('h1', { text: data.name || "Unnamed Character" });
        nameplate.createEl('p', { text: `${ancestry?.name || 'N/A'} ${charClass?.name || 'N/A'} (${subClass?.name || 'N/A'})` });

        const right = header.createDiv({ cls: 'dh-header-right' });
        const classDomains = CLASS_DOMAINS[data.classId] || [];
        right.createDiv({ cls: 'dh-domain-placeholder', text: classDomains.join(' & ') });
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

        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId) as ArmorItem | undefined;
        let armorEvasionMod = 0;
        if (equippedArmor?.features?.some(f => f.toLowerCase().includes('heavy'))) {
            armorEvasionMod = equippedArmor.features.some(f => f.toLowerCase().includes('very heavy')) ? -2 : -1;
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
        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId) as ArmorItem | undefined;
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
                box.addEventListener('click', () => this.plugin.rollDice(`1d12+1d12`, `Trait: ${name}`));
            }
        });
    }

    private drawActiveWeapons(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-active-weapons' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Active Weapons' });

        const equippedWeapons = data.inventory.filter(i => data.equippedWeaponIds && data.equippedWeaponIds.includes(i.instanceId)) as WeaponItem[];

        if (equippedWeapons.length === 0) {
            const card = container.createDiv({ cls: 'dh-weapon-card' });
            card.createDiv({ text: 'No weapons equipped.', cls: 'dh-empty-text' });
        } else {
            equippedWeapons.forEach((weapon, index) => {
                this.createWeaponCard(container, weapon, index === 0 ? 'Primary' : 'Secondary', data);
            });
        }
    }

    private createWeaponCard(parent: HTMLElement, weapon: WeaponItem, type: 'Primary' | 'Secondary', character: Character) {
        const card = parent.createDiv({ cls: 'dh-weapon-card' });
        card.createEl('h4', { text: type });

        const body = card.createDiv({ cls: 'dh-weapon-card-body' });
        const left = body.createDiv();
        left.createDiv({ cls: 'dh-weapon-name', text: weapon.name });
        left.createDiv({ cls: 'dh-weapon-type', text: `${weapon.burden} - ${weapon.range}` });

        const feature = (weapon.features || [])[0];
        const featureEl = left.createDiv({ cls: 'dh-weapon-feature' });
        renderRollableContent(this.plugin, feature || 'No feature.', featureEl, `${weapon.name}: ${feature || 'Attack'}`);


        const right = body.createDiv({ cls: 'dh-weapon-card-right' });
        const traitName = weapon.trait as keyof Character['traits'];
        const trait = character.traits[traitName];
        if (trait) {
            const rollBox = right.createDiv({ cls: 'dh-weapon-roll-box' });
            rollBox.createDiv({ text: `${trait.value >= 0 ? '+' : ''}${trait.value}` });
            rollBox.createDiv({ text: traitName });
            rollBox.addEventListener('click', () => {
                this.plugin.rollDice(`1d12+1d12`, `${weapon.name} Attack with ${traitName}`);
            });
        }
        const damageBox = right.createDiv({ cls: 'dh-weapon-damage-box' });
        let proficiency = 1;
        if (character.level >= 8) {
            proficiency = 4;
        } else if (character.level >= 5) {
            proficiency = 3;
        } else if (character.level >= 2) {
            proficiency = 2;
        }

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
            card.addEventListener('click', () => new ExperienceModal(this.app, exp, (updatedExp) => {
                const index = data.experiences.findIndex(e => e.id === exp.id);
                if (index > -1) data.experiences[index] = updatedExp;
                this.plugin.updateCharacter(data);
            }, () => {
                data.experiences = data.experiences.filter(e => e.id !== exp.id);
                this.plugin.updateCharacter(data);
            }).open());
        });
    }

    // --- MANAGER UI (REWORKED) ---
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

    private drawInventoryManager(parent: HTMLElement, character: Character) {
        const topBar = parent.createDiv({ cls: 'dh-inventory-topbar' });
        this.drawGoldTracker(topBar, character);
        const manageBtn = topBar.createEl('button', { text: 'Manage Equipment' });
        manageBtn.addEventListener('click', () => {
            new AddItemModal(this.app, this.plugin, (item) => {
                character.inventory.push({ ...item, instanceId: uuidv4() });
                this.plugin.updateCharacter(character);
            }).open();
        });

        const list = parent.createDiv({ cls: 'dh-inventory-list' });
        const header = list.createDiv({ cls: 'dh-inventory-item is-header' });
        header.createDiv({ text: 'Name' });
        header.createDiv({ text: 'Description' });
        header.createDiv({ text: 'Active' });

        character.inventory.forEach(item => {
            const row = list.createDiv({ cls: 'dh-inventory-item' });
            const isEquipped = item.instanceId === character.equippedArmorId || (character.equippedWeaponIds && character.equippedWeaponIds.includes(item.instanceId));

            row.createDiv({ text: item.name, cls: 'dh-inventory-item-name' });

            let desc = '';
            if (item._type === 'weapon') desc = `${(item as WeaponItem).damageDice} ${(item as WeaponItem).damageType} - ${(item as WeaponItem).burden}`;
            else if (item._type === 'armor') desc = `${(item as ArmorItem).baseScore} Armor`;
            else if (item.description) desc = item.description;
            row.createDiv({ text: desc, cls: 'dh-inventory-item-desc' });

            const checkboxCell = row.createDiv({ cls: 'dh-inventory-item-active' });
            const checkbox = checkboxCell.createEl('input', { type: 'checkbox' });
            checkbox.checked = isEquipped;
            checkbox.addEventListener('click', () => new ItemActionModal(this.app, item, character, () => this.plugin.updateCharacter(character)).open());

        });
    }

    private drawGoldTracker(parent: HTMLElement, data: Character) {
        const box = parent.createDiv({ cls: 'dh-gold-tracker' });
        box.addEventListener('click', () => new GoldModal(this.app, data, () => this.plugin.updateCharacter(data)).open());
        box.createEl('span').setText(`Gold: ${data.gold.chests}C, ${data.gold.bags}B, ${data.gold.handfuls}H`);
    }

    private drawAbilitiesManager(parent: HTMLElement, data: Character) {
        this.drawFeatureSection(parent, 'Domain & Class Features', data.features, data);

        const charClass = this.plugin.characterCompendium.getClass(data.classId);
        const ancestry = this.plugin.characterCompendium.getAncestry(data.ancestryId);
        const community = this.plugin.characterCompendium.getCommunity(data.communityId);

        if (ancestry) this.drawFeatureSection(parent, 'Heritage Features', [ancestry.primaryFeature, ancestry.secondaryFeature], data);
        if (community) this.drawFeatureSection(parent, 'Community Features', [community.feature], data);
        if (charClass) this.drawFeatureSection(parent, 'Core Class Features', [...(charClass?.features || []), charClass?.hopeFeature], data);
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

    private drawFeatureSection(parent: HTMLElement, title: string, features: (Feature | CompendiumFeature | undefined)[], character: Character) {
        if (!features.some(f => f)) return;
        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: title });

        const grid = section.createDiv({ cls: 'dh-feature-grid' });

        features.forEach(feat => {
            if (feat) this.createFeatureCard(grid, feat, character);
        });
    }

    private createFeatureCard(parent: HTMLElement, feature: Feature | CompendiumFeature, character: Character) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });
        const metadata = this.getFeatureMetadata(feature as Feature);

        const header = card.createDiv({ cls: 'dh-feature-card-header' });
        header.createDiv({ cls: 'dh-feature-card-title', text: feature.name });
        const metaHeader = header.createDiv({ cls: 'dh-feature-card-meta-header' });
        if (metadata.domain) {
            metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.domain });
        }
        if (metadata.type) {
            metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.type });
        }

        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        renderRollableContent(this.plugin, feature.description, body, feature.name);

        const footer = card.createDiv({ cls: 'dh-feature-card-footer' });
        const createFooterBox = (label: string, value: string | number | undefined) => {
            if (value === undefined) return;
            const box = footer.createDiv({ cls: 'dh-feature-card-box' });
            box.createDiv({ cls: 'value', text: String(value) });
            box.createDiv({ cls: 'label', text: label });
        };

        if (metadata.level) {
            createFooterBox('Level', metadata.level);
        }
        if (metadata.recallCost !== undefined) {
            createFooterBox('Recall', metadata.recallCost);
        }
    }


    private getFeatureMetadata(feature: Feature | DomainCard): { level?: number; domain?: string; type?: string; recallCost?: number } { const metadata: { level?: number; domain?: string; type?: string; recallCost?: number } = {}; if ('notes' in feature && feature.notes && Array.isArray(feature.notes)) { feature.notes.forEach(note => { const lowerNote = note.toLowerCase(); if (lowerNote.startsWith('level:')) { const level = parseInt(note.split(':')[1]?.trim()); if (!isNaN(level)) metadata.level = level; } else if (lowerNote.startsWith('domain:')) { metadata.domain = note.split(':')[1]?.trim(); } else if (lowerNote.startsWith('type:')) { metadata.type = note.split(':')[1]?.trim(); } else if (lowerNote.startsWith('recall cost:')) { const cost = parseInt(note.split(':')[1]?.trim()); if (!isNaN(cost)) metadata.recallCost = cost; } }); } else if ('level' in feature) { const card = feature as DomainCard; metadata.level = card.level; metadata.domain = card.domain; metadata.type = card.type; metadata.recallCost = card.recallCost; } return metadata; }

}

// --- MODALS ---
class ConditionModal extends Modal {
    character: Character;
    onSave: (character: Character) => void;

    constructor(app: App, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.character = character;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add Condition' });

        // Predefined conditions
        contentEl.createEl('h3', { text: 'Select Condition' });
        const predefinedContainer = contentEl.createDiv({ cls: 'dh-predefined-conditions-container' });
        DAGGERHEART_CONDITIONS.forEach(condition => {
            const isApplied = this.character.conditions?.some(c => c.name === condition.name);
            if (!isApplied) {
                const card = predefinedContainer.createDiv({ cls: 'dh-condition-card' });
                card.createEl('strong', { text: condition.name });
                card.createEl('p', { text: condition.description });
                card.addEventListener('click', () => {
                    if (!this.character.conditions) {
                        this.character.conditions = [];
                    }
                    this.character.conditions.push(condition);
                    this.onSave(this.character);
                    this.close();
                });
            }
        });

        // Custom condition
        contentEl.createEl('h3', { text: 'Add Custom Condition' });
        let customName = '';
        let customDesc = '';

        new Setting(contentEl)
            .setName('Name')
            .addText(text => text.onChange(value => customName = value.trim()));

        new Setting(contentEl)
            .setName('Description (Optional)')
            .addTextArea(text => text.onChange(value => customDesc = value.trim()));

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Add Custom')
                .setCta()
                .onClick(() => {
                    if (customName) {
                        if (!this.character.conditions) {
                            this.character.conditions = [];
                        }
                        if (this.character.conditions.some(c => c.name.toLowerCase() === customName.toLowerCase())) {
                            new Notice(`Condition "${customName}" already exists.`);
                            return;
                        }
                        this.character.conditions.push({ name: customName, description: customDesc });
                        this.onSave(this.character);
                        this.close();
                    } else {
                        new Notice('Please provide a name for the custom condition.');
                    }
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class GoldModal extends Modal { character: Character; onSave: () => void; constructor(app: App, character: Character, onSave: () => void) { super(app); this.character = character; this.onSave = onSave; } onOpen() { const { contentEl } = this; contentEl.createEl("h2", { text: "Update Wealth" }); let { handfuls, bags, chests } = this.character.gold; new Setting(contentEl).setName("Chests").addText(text => text.setValue(String(chests)).onChange(v => chests = parseInt(v) || 0)); new Setting(contentEl).setName("Bags").addText(text => text.setValue(String(bags)).onChange(v => bags = parseInt(v) || 0)); new Setting(contentEl).setName("Handfuls").addText(text => text.setValue(String(handfuls)).onChange(v => handfuls = parseInt(v) || 0)); new Setting(contentEl).addButton(btn => btn.setButtonText("Save").setCta().onClick(() => { bags += Math.floor(handfuls / 10); handfuls %= 10; chests += Math.floor(bags / 10); bags %= 10; this.character.gold = { _type: 'gold', handfuls, bags, chests }; this.onSave(); this.close(); })); } onClose() { this.contentEl.empty(); } }
class ExperienceModal extends Modal { experience: Experience | null; onSave: (result: Experience) => void; onDelete?: () => void; result: Experience; constructor(app: App, experience: Experience | null, onSave: (result: Experience) => void, onDelete?: () => void) { super(app); this.experience = experience; this.onSave = onSave; this.onDelete = onDelete; this.result = experience ? { ...experience } : { _type: 'experience', id: uuidv4(), name: '', value: 2, description: '' }; } onOpen() { const { contentEl } = this; contentEl.createEl("h2", { text: this.experience ? "Edit Experience" : "Add Experience" }); new Setting(contentEl).setName("Name").addText(text => text.setValue(this.result.name).onChange(v => this.result.name = v)); new Setting(contentEl).setName("Value").addText(text => text.setValue(String(this.result.value)).onChange(v => this.result.value = parseInt(v) || 0)); new Setting(contentEl).setName("Description").addTextArea(text => text.setValue(this.result.description || '').onChange(v => this.result.description = v)); const buttons = new Setting(contentEl); if (this.onDelete) { buttons.addButton(btn => btn.setButtonText("Delete").setWarning().onClick(() => { if (confirm("Are you sure?")) { if (this.onDelete) this.onDelete(); this.close(); } })); } buttons.addButton(btn => btn.setButtonText("Save").setCta().onClick(() => { if (!this.result.name) { new Notice("Name is required."); return; } this.onSave(this.result); this.close(); })); } onClose() { this.contentEl.empty(); } }
class AddItemModal extends Modal { plugin: DaggerheartStatblockPlugin; onSelect: (item: CompendiumItem) => void; private searchInput: TextComponent; constructor(app: App, plugin: DaggerheartStatblockPlugin, onSelect: (item: CompendiumItem) => void) { super(app); this.plugin = plugin; this.onSelect = onSelect; this.modalEl.addClass('dh-modal'); } onOpen() { const { contentEl } = this; contentEl.createEl("h2", { text: "Add Item from Compendium" }); const searchContainer = contentEl.createDiv({ cls: 'search-container' }); this.searchInput = new TextComponent(searchContainer).setPlaceholder("Search items..."); const listEl = contentEl.createDiv({ cls: 'dh-modal-list' }); this.renderList(listEl, ''); this.searchInput.onChange(value => this.renderList(listEl, value)); } renderList(container: HTMLElement, filter: string) { container.empty(); const allItems = this.plugin.characterCompendium.getAllItems(); const filtered = allItems.filter(item => item.name.toLowerCase().includes(filter.toLowerCase())); if (filtered.length === 0) { container.createEl('p', { text: 'No items match your search.' }); return; } filtered.forEach(item => { const itemEl = container.createDiv({ cls: 'dh-modal-list-item' }); itemEl.style.marginBottom = "10px"; itemEl.style.padding = "10px"; itemEl.style.border = "1px solid var(--background-modifier-border)"; itemEl.style.borderRadius = "5px"; itemEl.style.cursor = "pointer"; itemEl.addEventListener('mouseenter', () => { itemEl.style.backgroundColor = "var(--background-modifier-hover)"; }); itemEl.addEventListener('mouseleave', () => { itemEl.style.backgroundColor = ""; }); itemEl.createEl('h4', { text: item.name }); const typeText = item._type === 'weapon' ? 'Weapon' : item._type === 'armor' ? 'Armor' : 'Item'; const typeBadge = itemEl.createDiv({ cls: 'dh-item-badge', text: typeText }); typeBadge.style.display = "inline-block"; typeBadge.style.padding = "2px 8px"; typeBadge.style.margin = "5px 0"; typeBadge.style.borderRadius = "10px"; typeBadge.style.fontSize = "smaller"; typeBadge.style.backgroundColor = "var(--background-modifier-border)"; if (item.description) { itemEl.createEl('p', { text: item.description || '', attr: { style: "margin-top: 5px; font-size: 0.9em; color: var(--text-muted);" } }); } itemEl.addEventListener('click', () => { this.onSelect(item); this.close(); }); }); } onClose() { this.contentEl.empty(); } }

class CharacterManagerModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;

    private tempCharacter: Character;
    private selectedCurrentFeatureId: string | null = null;
    private selectedNewFeatureId: string | null = null;
    private replaceBtn: HTMLButtonElement;
    private featureListsContainer: HTMLElement;


    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.tempCharacter = JSON.parse(JSON.stringify(character));
        this.onSave = onSave;
        this.modalEl.addClass('dh-character-manager-modal');
    }

    onOpen() {
        this.contentEl.empty();
        const { contentEl } = this;
        contentEl.createEl("h1", { text: `Manage ${this.character.name}` });

        this.drawCoreDetails(contentEl.createDiv());
        this.drawHeritageAndClass(contentEl.createDiv());
        this.drawVitalsEditor(contentEl.createDiv());
        this.drawTraitsEditor(contentEl.createDiv());
        this.drawExperiencesEditor(contentEl.createDiv());
        this.drawFeatureReplacement(contentEl.createDiv());

        const footer = contentEl.createDiv({ cls: 'dh-modal-footer' });
        footer.createEl('button', { text: 'Save & Close', cls: 'mod-cta' }).addEventListener('click', () => {
            this.onSave(this.tempCharacter);
            this.close();
        });
    }

    private drawCoreDetails(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Core Details' });
        new Setting(container)
            .setName('Character Name')
            .addText(text => text
                .setValue(this.tempCharacter.name)
                .onChange(value => this.tempCharacter.name = value));

        new Setting(container)
            .setName('Level')
            .addText(text => text
                .setValue(String(this.tempCharacter.level))
                .onChange(value => {
                    const level = parseInt(value);
                    if (!isNaN(level)) {
                        this.tempCharacter.level = level;
                    }
                }));
    }

    private drawHeritageAndClass(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section is-grid' });

        new Setting(container)
            .setName('Ancestry')
            .addDropdown(dd => {
                this.plugin.characterCompendium.ancestries.forEach(a => dd.addOption(a.id, a.name));
                dd.setValue(this.tempCharacter.ancestryId)
                    .onChange(value => this.tempCharacter.ancestryId = value);
            });

        new Setting(container)
            .setName('Community')
            .addDropdown(dd => {
                this.plugin.characterCompendium.communities.forEach(c => dd.addOption(c.id, c.name));
                dd.setValue(this.tempCharacter.communityId)
                    .onChange(value => this.tempCharacter.communityId = value);
            });

        new Setting(container)
            .setName('Class')
            .addDropdown(dd => {
                this.plugin.characterCompendium.classes.forEach(c => dd.addOption(c.id, c.name));
                dd.setValue(this.tempCharacter.classId)
                    .onChange(value => this.tempCharacter.classId = value);
            });

        new Setting(container)
            .setName('Subclass')
            .addDropdown(dd => {
                const charClass = this.plugin.characterCompendium.getClass(this.tempCharacter.classId);
                if (charClass) {
                    charClass.subclasses.forEach(subRef => {
                        const subclass = this.plugin.characterCompendium.getSubclass(subRef.value);
                        if (subclass) dd.addOption(subclass.id, subclass.name);
                    });
                }
                dd.setValue(this.tempCharacter.subclassId)
                    .onChange(value => this.tempCharacter.subclassId = value);
            });
    }

    private drawVitalsEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section is-grid' });

        new Setting(container).setName("Max HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.max)).onChange(v => this.tempCharacter.hitPoints.max = parseInt(v) || 0));
        new Setting(container).setName("Current HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.current)).onChange(v => this.tempCharacter.hitPoints.current = parseInt(v) || 0));
        new Setting(container).setName("Max Stress").addText(text => text.setValue(String(this.tempCharacter.stress.max)).onChange(v => this.tempCharacter.stress.max = parseInt(v) || 0));
        new Setting(container).setName("Current Stress").addText(text => text.setValue(String(this.tempCharacter.stress.current)).onChange(v => this.tempCharacter.stress.current = parseInt(v) || 0));
        new Setting(container).setName("Max Hope").addText(text => text.setValue(String(this.tempCharacter.hope.max)).onChange(v => this.tempCharacter.hope.max = parseInt(v) || 0));
        new Setting(container).setName("Current Hope").addText(text => text.setValue(String(this.tempCharacter.hope.current)).onChange(v => this.tempCharacter.hope.current = parseInt(v) || 0));
        new Setting(container).setName("Evasion").addText(text => text.setValue(String(this.tempCharacter.evasion)).onChange(v => this.tempCharacter.evasion = parseInt(v) || 0));
    }

    private drawTraitsEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Traits' });
        const grid = container.createDiv({ cls: 'is-grid' });
        TRAIT_NAMES.forEach(traitName => {
            new Setting(grid)
                .setName(traitName)
                .addText(text => text
                    .setValue(String(this.tempCharacter.traits[traitName].value))
                    .onChange(value => this.tempCharacter.traits[traitName].value = parseInt(value) || 0)
                );
        });
    }

    private drawExperiencesEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Experiences' });
        const experiencesContainer = container.createDiv();

        const redrawExperiences = () => {
            experiencesContainer.empty();
            this.tempCharacter.experiences.forEach((exp, index) => {
                new Setting(experiencesContainer)
                    .setName(`Experience ${index + 1}`)
                    .addText(text => text
                        .setPlaceholder('Name')
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
                            redrawExperiences();
                        }));
            });
        };

        new Setting(container).addButton(btn => btn.setButtonText("Add Experience").onClick(() => {
            this.tempCharacter.experiences.push({ _type: 'experience', id: uuidv4(), name: '', description: '', value: 0 });
            redrawExperiences();
        }));

        redrawExperiences();
    }


    private drawFeatureReplacement(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Replace Domain Feature' });
        container.createEl("p", { text: "Select one of your current domain features to replace, and then select an available feature from your class domains to learn." });

        this.featureListsContainer = container.createDiv({ cls: 'dh-replace-feature-container' });
        this.redrawFeatureLists();

        const buttonContainer = container.createDiv({ cls: 'dh-modal-footer-bar' });
        this.replaceBtn = buttonContainer.createEl('button', { text: 'Replace Selected Feature' });
        this.replaceBtn.disabled = true;
        this.replaceBtn.addEventListener('click', () => this.handleReplace());
    }

    private redrawFeatureLists() {
        this.featureListsContainer.empty();
        this.drawCurrentFeatures(this.featureListsContainer.createDiv());
        this.drawAvailableFeatures(this.featureListsContainer.createDiv());
    }

    private drawCurrentFeatures(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Your Current Features' });
        const listEl = parent.createDiv({ cls: 'dh-feature-list' });
        const currentDomainFeatures = this.tempCharacter.features;

        currentDomainFeatures.forEach(feature => {
            const itemEl = listEl.createDiv({ cls: 'dh-feature-list-item' });
            itemEl.createDiv({ cls: 'dh-feature-list-item-name', text: feature.name });
            const metadata = this.getFeatureMetadata(feature);
            if (metadata.domain) {
                itemEl.createDiv({ cls: 'dh-feature-list-item-sub', text: `Domain: ${metadata.domain}` });
            }
            itemEl.dataset.featureId = feature.id;

            if (this.selectedCurrentFeatureId === feature.id) {
                itemEl.addClass('is-selected');
            }

            itemEl.addEventListener('click', () => {
                this.selectedCurrentFeatureId = feature.id;
                listEl.querySelectorAll('.dh-feature-list-item').forEach(el => el.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.updateButtonState();
            });
        });
    }

    private drawAvailableFeatures(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Available Replacements' });
        const listEl = parent.createDiv({ cls: 'dh-feature-list' });

        const classId = this.tempCharacter.classId;
        const classDomains = CLASS_DOMAINS[classId] || [];
        const currentFeatureIds = this.tempCharacter.features.map(f => f.id);

        const availableFeatures = this.plugin.characterCompendium.features.filter(f => {
            const metadata = this.getFeatureMetadata(f);
            const isDomainCard = classDomains.some(d => d.toLowerCase() === metadata.domain?.toLowerCase());
            const isNotOwned = !currentFeatureIds.includes(f.id);
            return isDomainCard && isNotOwned && (metadata.level ?? 1) <= this.tempCharacter.level;
        });

        if (availableFeatures.length === 0) {
            listEl.createDiv({ cls: 'dh-empty-text', text: 'No available features to learn at this time.' });
        }

        availableFeatures.forEach(feature => {
            const itemEl = listEl.createDiv({ cls: 'dh-feature-list-item' });
            itemEl.createDiv({ cls: 'dh-feature-list-item-name', text: feature.name });
            const metadata = this.getFeatureMetadata(feature);
            if (metadata.domain) {
                itemEl.createDiv({ cls: 'dh-feature-list-item-sub', text: `Domain: ${metadata.domain}` });
            }
            itemEl.dataset.featureId = feature.id;

            if (this.selectedNewFeatureId === feature.id) {
                itemEl.addClass('is-selected');
            }

            itemEl.addEventListener('click', () => {
                this.selectedNewFeatureId = feature.id;
                listEl.querySelectorAll('.dh-feature-list-item').forEach(el => el.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.updateButtonState();
            });
        });
    }

    private updateButtonState() {
        if (this.selectedCurrentFeatureId && this.selectedNewFeatureId) {
            this.replaceBtn.disabled = false;
        } else {
            this.replaceBtn.disabled = true;
        }
    }

    private handleReplace() {
        if (!this.selectedCurrentFeatureId || !this.selectedNewFeatureId) return;

        const newFeature = this.plugin.characterCompendium.getFeature(this.selectedNewFeatureId);
        if (!newFeature) {
            new Notice("Error: Could not find the selected feature to learn.");
            return;
        }

        const featureIndex = this.tempCharacter.features.findIndex(f => f.id === this.selectedCurrentFeatureId);
        if (featureIndex === -1) {
            new Notice("Error: Could not find the feature to replace.");
            return;
        }

        this.tempCharacter.features[featureIndex] = newFeature;

        new Notice(`Replaced feature with ${newFeature.name}. Save to apply changes.`);

        this.selectedCurrentFeatureId = null;
        this.selectedNewFeatureId = null;
        this.redrawFeatureLists();
        this.updateButtonState();
    }

    private getFeatureMetadata(feature: Feature | DomainCard): { level?: number; domain?: string; type?: string; recallCost?: number } { const metadata: { level?: number; domain?: string; type?: string; recallCost?: number } = {}; if ('notes' in feature && feature.notes && Array.isArray(feature.notes)) { feature.notes.forEach(note => { const lowerNote = note.toLowerCase(); if (lowerNote.startsWith('level:')) { const level = parseInt(note.split(':')[1]?.trim()); if (!isNaN(level)) metadata.level = level; } else if (lowerNote.startsWith('domain:')) { metadata.domain = note.split(':')[1]?.trim(); } else if (lowerNote.startsWith('type:')) { metadata.type = note.split(':')[1]?.trim(); } else if (lowerNote.startsWith('recall cost:')) { const cost = parseInt(note.split(':')[1]?.trim()); if (!isNaN(cost)) metadata.recallCost = cost; } }); } else if ('level' in feature) { const card = feature as DomainCard; metadata.level = card.level; metadata.domain = card.domain; metadata.type = card.type; metadata.recallCost = card.recallCost; } return metadata; }

    onClose() { this.contentEl.empty(); }
}

class ItemActionModal extends Modal { item: InventoryItem; character: Character; onUpdate: () => void; constructor(app: App, item: InventoryItem, character: Character, onUpdate: () => void) { super(app); this.item = item; this.character = character; this.onUpdate = onUpdate; } onOpen() { const { contentEl } = this; contentEl.createEl("h2", { text: this.item.name }); if (this.item._type === 'armor' || this.item._type === 'weapon') { const isEquipped = this.character.equippedArmorId === this.item.instanceId || this.character.equippedWeaponIds.includes(this.item.instanceId); if (isEquipped) { new Setting(contentEl).addButton(btn => btn.setButtonText("Unequip").onClick(() => this.unequipItem())); } else { new Setting(contentEl).addButton(btn => btn.setButtonText("Equip").onClick(() => this.equipItem())); } } new Setting(contentEl).addButton(btn => btn.setButtonText("Drop").setWarning().onClick(() => { if (confirm("Are you sure you want to drop this item?")) { this.character.inventory = this.character.inventory.filter(i => i.instanceId !== this.item.instanceId); this.unequipItem(); this.onUpdate(); this.close(); } })); } equipItem() { if (this.item._type === 'armor') { this.character.equippedArmorId = this.item.instanceId; const armor = this.item as ArmorItem; this.character.armorSlots = { _type: 'dynamicResource', max: armor.baseScore, current: armor.baseScore }; this.character.damageThresholds = { _type: 'damageThresholds', major: armor.baseThresholds.major + this.character.level, severe: armor.baseThresholds.severe + this.character.level }; } else if (this.item._type === 'weapon') { const weapon = this.item as WeaponItem; if (weapon.burden === 'Two-Handed') { this.character.equippedWeaponIds = [this.item.instanceId]; } else { const equippedWeapons = this.character.inventory.filter(i => this.character.equippedWeaponIds.includes(i.instanceId) && i._type === 'weapon') as WeaponItem[]; const twoHandedEquipped = equippedWeapons.find(w => w.burden === 'Two-Handed'); if (twoHandedEquipped) { this.character.equippedWeaponIds = [this.item.instanceId]; } else if (equippedWeapons.length < 2) { this.character.equippedWeaponIds.push(this.item.instanceId); } else { new Notice("You already have two one-handed weapons equipped. Unequip one first."); this.close(); return; } } } this.onUpdate(); this.close(); } unequipItem() { if (this.item._type === 'armor' && this.character.equippedArmorId === this.item.instanceId) { this.character.equippedArmorId = null; this.character.armorSlots = { _type: 'dynamicResource', max: 0, current: 0 }; this.character.damageThresholds = { _type: 'damageThresholds', major: this.character.level, severe: this.character.level * 2 }; } else if (this.item._type === 'weapon') { this.character.equippedWeaponIds = this.character.equippedWeaponIds.filter(id => id !== this.item.instanceId); } this.onUpdate(); this.close(); } onClose() { this.contentEl.empty(); } }
