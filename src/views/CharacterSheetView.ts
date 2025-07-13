import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, MarkdownRenderer } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import {
    Character, Trait, InventoryItem, CompendiumFeature, CompendiumItem, DomainCard, ArmorItem, WeaponItem, AvatarTransform, InherentFeature
} from '../types';
import {
    AddItemModal,
    CardSwapModal,
    CharacterManagerModal,
    ConfirmationModal,
    ConditionModal,
    DowntimeModal,
    GoldModal,
    ImportExportModal,
    ItemEditModal,
    LevelUpModal
} from '../modals';
import { renderMarkdown, renderRollableContent } from '../rendering/ui-helpers';
import { handleAdvantageDisadvantage, formatTraitModifier } from '../services/dice-helpers';
import { ContentType } from '../services/export-import';
import { CharacterCreator } from './components/CharacterCreator';

export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

type ManagerTab = 'abilities' | 'inventory' | 'details';
const TRAIT_SKILLS: { [key in keyof Character['traits']]: string[] } = {
    Agility: ['Dodge', 'Sprint', 'Leap'],
    Strength: ['Lift', 'Smash', 'Grapple'],
    Finesse: ['Control', 'Hide', 'Tinker'],
    Instinct: ['Perceive', 'Sense', 'Navigate'],
    Presence: ['Charm', 'Perform', 'Deceive'],
    Knowledge: ['Recall', 'Analyze', 'Comprehend']
};

function resolveImageUrl(app: any, url: string | null | undefined): string | null {
    if (!url) {
        return null;
    }

    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return url;
    }

    let fileName = url;
    const match = url.match(/^!?\[\[(.*?)(?:\|.*)?\]\]/);
    if (match) {
        fileName = match[1];
    }

    const file = app.metadataCache.getFirstLinkpathDest(fileName, '');
    if (file instanceof TFile) {
        return app.vault.getResourcePath(file);
    }

    return null;
}


export class CharacterSheetView extends ItemView {
    plugin: DaggerheartStatblockPlugin;
    private activeManagerTab: ManagerTab = 'abilities';
    private isEditingDetails = false;

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
        if (this.isEditingDetails) {
            return;
        }

        const container = this.containerEl.children[1];
        const mainContent = container.querySelector('.dh-cs-main');
        const scrollPosition = mainContent ? mainContent.scrollTop : 0;

        const activeEl = document.activeElement as HTMLElement;
        let focusedInfo: { id: string; selectionStart: number; selectionEnd: number } | null = null;
        if (activeEl && activeEl.matches('.dh-details-section textarea') && activeEl.id) {
            const textarea = activeEl as HTMLTextAreaElement;
            focusedInfo = {
                id: textarea.id,
                selectionStart: textarea.selectionStart,
                selectionEnd: textarea.selectionEnd,
            };
        }

        container.empty();
        const main = container.createDiv({ cls: 'dh-cs-main' });
        this.drawTopBar(main);
        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            this.drawCharacterSheet(main, activeChar);
        } else {
            new CharacterCreator(this.plugin, this, main);
        }
        main.scrollTop = scrollPosition;

        if (focusedInfo) {
            const newEl = container.querySelector(`#${focusedInfo.id}`) as HTMLTextAreaElement;
            if (newEl) {
                newEl.focus();
                try {
                    newEl.setSelectionRange(focusedInfo.selectionStart, focusedInfo.selectionEnd);
                } catch (e) {
                    console.error("Could not restore selection range.", e);
                }
            }
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
        selector.addEventListener('change', async (ev: Event) => {
            const selectEl = ev.target as HTMLSelectElement;
            await this.plugin.setActiveCharacterId(selectEl.value || null);
        });

        const importBtn = left.createEl('button', { cls: 'dh-import-btn clickable-icon' });
        setIcon(importBtn, 'download');
        importBtn.setAttribute('aria-label', 'Import Character');
        importBtn.title = 'Import Character';
        importBtn.addEventListener('click', () => {
            new ImportExportModal(this.app, this.plugin, 'import', ContentType.CHARACTER).open();
        });

        const right = header.createDiv({ cls: 'dh-topbar-right' });

        const activeChar = this.plugin.getActiveCharacter();
        if (activeChar) {
            const exportBtn = right.createEl('button', { cls: 'dh-export-btn clickable-icon' });
            setIcon(exportBtn, 'upload');
            exportBtn.setAttribute('aria-label', 'Export Character');
            exportBtn.title = 'Export Character';
            exportBtn.addEventListener('click', () => {
                new ImportExportModal(this.app, this.plugin, 'export', ContentType.CHARACTER, activeChar.id).open();
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
            this.plugin.setActiveCharacterId(null);
        });
    }

    private drawCharacterSheet(parent: HTMLElement, data: Character) {
        const sheet = parent.createDiv({ cls: 'dh-sheet' });

        sheet.style.setProperty('--dh-sheet-accent', data.accentColor || '#e5b32a');
        const accentColor = data.accentColor || '#e5b32a';
        const accentGlow = this.hexToRgba(accentColor, 0.4);
        sheet.style.setProperty('--dh-sheet-accent-glow', accentGlow);


        this.drawSheetHeader(sheet, data);
        const mainGrid = sheet.createDiv({ cls: 'dh-sheet-grid' });
        this.drawLeftColumn(mainGrid, data);
        this.drawCenterColumn(mainGrid, data);
        this.drawRightColumn(mainGrid, data);
        this.drawManager(sheet, data);
    }

    private hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    private drawSheetHeader(parent: HTMLElement, data: Character) {
        const charClass = this.plugin.compendium.getClass(data.classId);
        const subClass = this.plugin.compendium.getSubclass(data.subclassId);
        const ancestry = this.plugin.compendium.getAncestry(data.ancestryId);

        const header = parent.createDiv({ cls: 'dh-sheet-header' });
        const left = header.createDiv({ cls: 'dh-header-left' });

        const avatar = left.createDiv({ cls: 'dh-avatar' });
        const resolvedUrl = resolveImageUrl(this.app, data.avatarUrl);

        if (resolvedUrl) {
            if (data.avatarTransform) {
                const img = new Image();
                img.src = resolvedUrl;
                img.onload = () => {
                    if (!data.avatarTransform) return;

                    const EDITOR_SIZE = 150;
                    const HEADER_SIZE = 70;
                    const sizeRatio = HEADER_SIZE / EDITOR_SIZE;

                    const scale = data.avatarTransform.scale;
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

                    avatar.style.backgroundImage = `url("${resolvedUrl}")`;
                    avatar.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
                    avatar.style.backgroundPosition = `${bgPosX} ${bgPosY}`;
                    avatar.style.backgroundRepeat = 'no-repeat';
                }
            } else {
                avatar.style.backgroundImage = `url("${resolvedUrl}")`;
            }
        } else {
            setIcon(avatar, 'user-round');
        }

        const nameplate = left.createDiv({ cls: 'dh-nameplate' });

        const nameWrapper = nameplate.createDiv({ cls: 'dh-name-wrapper' });
        nameWrapper.createEl('h1', { text: data.name || "Unnamed Character" });

        const editBtn = nameWrapper.createEl('button', { cls: 'dh-edit-character-btn clickable-icon' });
        setIcon(editBtn, 'settings-2');
        editBtn.ariaLabel = "Edit Character";
        editBtn.addEventListener('click', () => {
            new CharacterManagerModal(this.app, this.plugin, data, (updatedChar) => {
                this.plugin.updateCharacter(updatedChar);
            }).open();
        });

        let classDisplay = `${charClass?.name || 'N/A'} (${subClass?.name || 'N/A'})`;
        if (data.multiclassClassId) {
            const mcClass = this.plugin.compendium.getClass(data.multiclassClassId);
            const mcSubclass = data.multiclassSubclassId ? this.plugin.compendium.getSubclass(data.multiclassSubclassId) : null;
            classDisplay += ` / ${mcClass?.name || 'N/A'} (${mcSubclass?.name || 'N/A'})`;
        }
        nameplate.createEl('p', { text: `${ancestry?.name || data.ancestryId} ${classDisplay}` });

        const right = header.createDiv({ cls: 'dh-header-right' });

        const downtimeBtn = right.createEl('button', { cls: 'dh-downtime-btn' });
        setIcon(downtimeBtn, 'bed-double');
        downtimeBtn.createSpan({ text: 'Downtime' });
        downtimeBtn.ariaLabel = "Take a Rest";
        downtimeBtn.addEventListener('click', () => {
            new DowntimeModal(this.app, this.plugin, data, (updatedChar) => {
                this.plugin.updateCharacter(updatedChar);
            }).open();
        });

        if (charClass) {
            const classDomains = [charClass.domain_1, charClass.domain_2];
            if (data.multiclassDomainId) {
                classDomains.push(data.multiclassDomainId);
            }
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
        const equippedWeapons = data.inventory.filter((i2) => data.equippedWeaponIds && data.equippedWeaponIds.includes(i2.instanceId) && i2._type === "weapon") as (InventoryItem & { _type: 'weapon' })[];
        const domainCards = data.loadout.filter((f2) => f2.domain !== "Multiclass" || f2.domain === "Multiclass");
        let armorEvasionMod = 0;
        let weaponEvasionMod = 0;
        let armorMod = 0;
        if (!equippedArmor) {
            data.armorSlots.max = 0;
            if (domainCards.length === 0) {      
            } else {
                domainCards.forEach((feature) => {
                    if (feature.name.toLowerCase().includes("bare bones")) {
                    data.armorSlots.max = 3 + data.traits['Strength'].value;
                    }
                });
            }     
        }
        else {
            if (domainCards.length === 0) {      
            } else {
                domainCards.forEach((feature) => {
                    if (feature.name.toLowerCase().includes("armorer")) {
                        armorMod = armorMod + 1;
                    }
                    else if (feature.name.toLowerCase().includes("valor-touched")) {
                        let valorCounter = 0;
                        domainCards.forEach((feature) => {
                            if (feature.domain.toLowerCase().includes("valor")) {
                                valorCounter = valorCounter + 1;
                            }
                        });
                        if (valorCounter>3) {
                            armorMod = armorMod + 1;
                        }
                    }
                });
            }
        }
        if (equippedArmor?.features?.some((f2) => f2.name.toLowerCase().includes("heavy"))) {
            armorEvasionMod = equippedArmor.features.some((f2) => f2.name.toLowerCase().includes("very heavy")) ? -2 : -1;
        } else if (equippedArmor?.features?.some((f2) => f2.name.toLowerCase().includes("flexible"))) {
            armorEvasionMod = 1;
        }
        if (equippedWeapons.length === 0) {
        } else {
            equippedWeapons.forEach((weapon) => {
                if (weapon?.features?.some((f2: CompendiumFeature) => f2.name.toLowerCase().includes("heavy")) || weapon?.features?.some((f2: CompendiumFeature) => f2.name.toLowerCase().includes("massive"))) {
                    weaponEvasionMod = -1;
                }
                else if (weapon?.features?.some((f2: CompendiumFeature) => f2.name.toLowerCase().includes("barrier"))) {
                    weaponEvasionMod = weaponEvasionMod - 1;
                    switch(weapon?.tier) {
                        case 2:
                            armorMod = armorMod + 3;
                            break;
                        case 3:
                            armorMod = armorMod + 4;
                            break;
                        case 4:
                            armorMod = armorMod + 5;
                            break;
                        default:
                            armorMod = armorMod + 2;
                    }
                }
                else if (weapon?.features?.some((f2) => f2.name.toLowerCase().includes("protective")) || weapon?.features?.some((f2) => f2.name.toLowerCase().includes("double duty"))) {
                    if(weapon?.name.toLowerCase().includes("round")){
                        switch(weapon?.tier) {
                            case 2:
                                armorMod = armorMod + 2;
                                break;
                            case 3:
                                armorMod = armorMod + 3;
                                break;
                            case 4:
                                armorMod = armorMod + 4;
                                break;
                            default:
                                armorMod = armorMod + 1;
                        }
                    }
                    else armorMod = armorMod + 1;
                }
            });
        }
        const finalEvasion = data.evasion + armorEvasionMod + weaponEvasionMod + (data.customModifiers?.evasion || 0);
        const evasionBox = container.createDiv({ cls: 'dh-stat-hex' });
        evasionBox.createEl('span', { text: String(finalEvasion), cls: 'dh-stat-value' });
        evasionBox.createEl('span', { text: 'Evasion', cls: 'dh-stat-label' });
        const armorBox = container.createDiv({ cls: 'dh-stat-hex' });
        armorBox.createEl('span', { text: String(data.armorSlots.max + armorMod), cls: 'dh-stat-value' });
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

        const domainCards = data.loadout.filter((f2) => f2.domain !== "Multiclass" || f2.domain === "Multiclass");
        if (!equippedArmor) {
            if (domainCards.length === 0) {
            } else {
                finalMajorThreshold = data.level;
                finalSevereThreshold = data.level * 2;
                domainCards.forEach((feature) => {
                    if (feature.name.toLowerCase().includes("bare bones")) {
                        if (data.level < 2) {
                            finalMajorThreshold = 9 + data.level;
                            finalSevereThreshold = 19 + data.level;
                        }
                        else if (data.level < 5) {
                            finalMajorThreshold = 11 + data.level;
                            finalSevereThreshold = 24 + data.level;
                        }
                        else if (data.level < 8) {
                            finalMajorThreshold = 13 + data.level;
                            finalSevereThreshold = 31 + data.level;
                        }
                        else {
                            finalMajorThreshold = 15 + data.level;
                            finalSevereThreshold = 38 + data.level;
                        }
                    }
                });
            }
        } else {
            finalMajorThreshold = equippedArmor.baseThresholds.major + data.level;
            finalSevereThreshold = equippedArmor.baseThresholds.severe + data.level;
            if (domainCards.length === 0) {
            } else {
                domainCards.forEach((feature) => {
                    if (feature.name.toLowerCase().includes("fortified armor")) {
                        finalMajorThreshold = finalMajorThreshold + 2;
                        finalSevereThreshold = finalSevereThreshold + 2;
                    }
                });
            }
        }
        const ancestry = this.plugin.compendium.getAncestry(data.ancestryId);
        const ancestryFeats = ancestry ? ancestry.feats.map((f2) => ({ name: f2.name, description: f2.text })) : [];
        if (ancestryFeats.length === 0) {      
        } else {
            ancestryFeats.forEach((feature) => {
                if (feature.name.toLowerCase().includes("shell")) {
                    finalMajorThreshold = finalMajorThreshold + data.proficiency;
                    finalSevereThreshold = finalSevereThreshold + data.proficiency;
                }
            });
        }
        //get SubClassFeatures
        /*const ownedFeatures = data.features;
        if(ownedFeatures.has("Unwavering")){
            finalMajorThreshold = finalMajorThreshold + 1;
            finalSevereThreshold = finalSevereThreshold + 1;
        }
        if(ownedFeatures.has("Unrelenting")){
            finalMajorThreshold = finalMajorThreshold + 2;
            finalSevereThreshold = finalSevereThreshold + 2;
        }
        if(ownedFeatures.has("Undaunted")){
            finalMajorThreshold = finalMajorThreshold + 3;
            finalSevereThreshold = finalSevereThreshold + 3;
        }*/
        //add modifiers for Thresholds here
        finalMajorThreshold += (data.customModifiers?.majorThreshold || 0);
        finalSevereThreshold += (data.customModifiers?.severeThreshold || 0);
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
                    let baseDiceString = `1d12+1d12`;
                    const modifierString = formatTraitModifier(trait.value);
                    let rollTitle = `${name} Roll`;
                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        rollTitle
                    );
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
                let baseDiceString = `1d12+1d12`;
                const modifierString = formatTraitModifier(traitValue);
                const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                    event,
                    baseDiceString,
                    rollTitle
                );
                this.plugin.rollDice(
                    `${diceString}${modifierString}`,
                    newRollTitle,
                    traitName
                );
            });
        }
        const damageBox = right.createDiv({ cls: 'dh-weapon-damage-box' });

        const proficiency = character.proficiency;
        const damageString = weapon.damageDice;
        const match = damageString.match(/(d\d+)([+-]\d+)?/);
        let damageFormula = '';

        if (match) {
            const diePart = match[1];
            const modifierPart = match[2] || '';
            damageFormula = `${proficiency}${diePart}${modifierPart}`;
        } else {
            damageFormula = `${proficiency}${damageString}`;
        }

        damageBox.createDiv({ text: damageFormula });
        damageBox.createDiv({ text: weapon.damageType });
        damageBox.title = `Click to roll ${damageFormula}`;
        damageBox.addEventListener('click', () => {
            this.plugin.rollDice(damageFormula, `${weapon.name} Damage`);
        });
    }
    private drawVitals(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-vitals' });
        this.drawConditions(container, data);
        const levelBox = container.createDiv({ cls: 'dh-level-box', text: '' });
        levelBox.createEl('h4', { text: 'Level' });
        levelBox.createDiv({ cls: 'dh-level-value', text: String(data.level) });

        levelBox.addClass('is-clickable');
        levelBox.ariaLabel = "Manage Levels";
        levelBox.addEventListener('click', () => {
            new LevelUpModal(this.app, this.plugin, data, (updatedCharacter) => {
                this.plugin.updateCharacter(updatedCharacter);
            }).open();
        });
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
            const card = this.createExperienceCard(container, exp.name, `+${exp.value}`, false);
        });
    }

    private drawManager(parent: HTMLElement, data: Character) {
        const managerContainer = parent.createDiv({ cls: 'dh-manager-container' });
        const tabs = managerContainer.createDiv({ cls: 'dh-manager-tabs' });
        this.createManagerTab(tabs, 'abilities', 'Abilities');
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
                    this.unequipItem(character, item, false);
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
        // Draw the swappable Domain Cards section
        this.drawDomainCardSection(parent, 'Domain Cards', data.loadout, data);

        // Draw the read-only Inherent Features section
        this.drawInherentFeaturesSection(parent, data);
    }

    private drawDomainCardSection(parent: HTMLElement, title: string, cards: DomainCard[], character: Character) {
        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: title });

        const controls = header.createDiv({ cls: 'dh-section-header-controls' });
        const manageBtn = controls.createEl('button', { text: 'Manage Cards' });
        setIcon(manageBtn, 'book-copy');
        manageBtn.addEventListener('click', () => {
            new CardSwapModal(this.app, this.plugin, character, (updatedChar) => {
                this.plugin.updateCharacter(updatedChar);
            }).open();
        });

        const grid = section.createDiv({ cls: 'dh-feature-grid' });
        if (cards.length > 0) {
            cards.forEach(card => {
                if (card) this.createFeatureCard(grid, card, character);
            });
        } else {
            grid.createDiv({ text: 'No cards in loadout.', cls: 'dh-empty-text' })
        }
    }

    private drawInherentFeaturesSection(parent: HTMLElement, character: Character) {
        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: 'Features' });

        const groupedFeatures = character.features.reduce((acc, feature) => {
            const source = feature.source;
            if (!acc[source]) {
                acc[source] = [];
            }
            acc[source].push(feature);
            return acc;
        }, {} as Record<InherentFeature['source'], InherentFeature[]>);

        const sourceOrder: InherentFeature['source'][] = ['Class', 'Subclass', 'Ancestry', 'Community'];

        for (const source of sourceOrder) {
            const features = groupedFeatures[source];
            if (features && features.length > 0) {
                const groupContainer = section.createDiv({ cls: 'dh-feature-group' });
                groupContainer.createEl('h4', { text: source, cls: 'dh-feature-group-title' });
                const grid = groupContainer.createDiv({ cls: 'dh-feature-grid' });
                features.forEach(feat => {
                    this.createFeatureCard(grid, feat, character);
                });
            }
        }
    }

    private drawDetailsManager(parent: HTMLElement, data: Character) {
        const createEditableMarkdownField = (
            container: HTMLElement,
            initialValue: string,
            updateLogic: (value: string) => void,
            isSingleLine: boolean = false
        ) => {
            const contentDiv = container.createDiv({ cls: 'dh-markdown-content' });
            if (isSingleLine) {
                contentDiv.addClass('is-single-line');
            }

            const renderView = () => {
                contentDiv.empty();
                const valueToRender = initialValue || (isSingleLine ? "" : "_Click to edit..._");
                MarkdownRenderer.render(this.app, valueToRender, contentDiv, '', this);
            };

            const switchToEditMode = () => {
                this.isEditingDetails = true;
                contentDiv.empty();
                const editorContainer = contentDiv.createDiv({ cls: 'dh-markdown-editor-container' });
                const editorEl = editorContainer.createEl('textarea', { text: initialValue });
                editorEl.focus();

                const saveAndExit = () => {
                    document.removeEventListener('click', handleOutsideClick, true);
                    const newValue = editorEl.value;
                    updateLogic(newValue);
                    this.isEditingDetails = false;
                    this.plugin.updateCharacter(data);
                };

                const handleOutsideClick = (e: MouseEvent) => {
                    if (!editorContainer.contains(e.target as Node)) {
                        saveAndExit();
                    }
                };

                setTimeout(() => document.addEventListener('click', handleOutsideClick, true), 0);

                editorEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        saveAndExit();
                    }
                });
            };

            contentDiv.addEventListener('click', (event: MouseEvent) => {
                const target = event.target as HTMLElement;
                const link = target.closest('a.internal-link');

                if (link) {
                    event.preventDefault();
                    const linkText = link.getAttribute('data-href');
                    if (linkText) {
                        this.app.workspace.openLinkText(linkText, '', event.ctrlKey || event.metaKey);
                    }
                    return;
                }

                if (!contentDiv.querySelector('textarea')) {
                    switchToEditMode();
                }
            });

            renderView();
        };

        // Description Section
        const descriptionSection = parent.createDiv({ cls: 'dh-details-section' });
        descriptionSection.createEl('h3', { text: 'Character Description' });
        const descriptionCard = descriptionSection.createDiv({ cls: 'dh-detail-card' });
        createEditableMarkdownField(descriptionCard, data.notes || '', (value) => { data.notes = value; });

        // Background Section
        if (data.background && data.background.length > 0) {
            const backgroundSection = parent.createDiv({ cls: 'dh-details-section dh-background-section' });
            backgroundSection.createEl('h3', { text: 'Background' });
            data.background.forEach((bg) => {
                const card = backgroundSection.createDiv({ cls: 'dh-detail-card' });
                card.createEl('h4', { text: bg.question });
                createEditableMarkdownField(card, bg.answer || '', (value) => { bg.answer = value; }, true);
            });
        }

        // Connections Section
        if (data.connections && data.connections.length > 0) {
            const connectionSection = parent.createDiv({ cls: 'dh-details-section dh-connections-section' });
            connectionSection.createEl('h3', { text: 'Connections' });
            data.connections.forEach((conn) => {
                const card = connectionSection.createDiv({ cls: 'dh-detail-card' });
                card.createEl('h4', { text: conn.question });
                createEditableMarkdownField(card, conn.answer || '', (value) => { conn.answer = value; }, true);
            });
        }
    }

    private createExperienceCard(parent: HTMLElement, title: string, subtext: string, isInteractive: boolean = false) { const card = parent.createDiv({ cls: `dh-experience-card ${isInteractive ? 'is-interactive' : ''}` }); card.createDiv({ cls: 'dh-card-title', text: title }); if (subtext) card.createSpan({ cls: 'dh-experience-value', text: subtext }); return card; }

    private createFeatureCard(parent: HTMLElement, feature: InherentFeature | DomainCard, character: Character) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });
        const metadata = this.getFeatureMetadata(feature);

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

        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        renderRollableContent(this.plugin, feature.description, body, feature.name, true);

        if (feature.description.toLowerCase().includes('make a spellcast roll')) {
            const footer = card.createDiv({ cls: 'dh-feature-card-footer dh-feature-card-footer-left' });
            const subclass = this.plugin.compendium.getSubclass(character.subclassId);
            const spellcastingTraitName = subclass?.spellcast_trait as keyof Character['traits'] | undefined;

            if (spellcastingTraitName) {
                const traitValue = character.traits[spellcastingTraitName]?.value ?? 0;
                const rollBox = footer.createDiv({ cls: 'dh-spellcast-box dh-spellcast-box-inline' });
                const modSpan = rollBox.createSpan({ cls: 'dh-spellcast-modifier' });
                modSpan.setText(`${traitValue >= 0 ? '+' : ''}${traitValue}`);
                rollBox.createSpan({ text: ` ${spellcastingTraitName}` });
                rollBox.title = `Click to make a Spellcast roll with ${spellcastingTraitName}`;

                rollBox.addEventListener('click', (event) => {
                    let baseDiceString = `1d12+1d12`;
                    const modifierString = formatTraitModifier(traitValue);
                    let rollTitle = `${feature.name} Spellcast`;
                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        rollTitle
                    );
                    this.plugin.rollDice(
                        `${diceString}${modifierString}`,
                        newRollTitle,
                        spellcastingTraitName
                    );
                });
            }
        }
    }

    private getFeatureMetadata(feature: InherentFeature | DomainCard): { level?: number; domain?: string; type?: string; } {
        const metadata: { level?: number; domain?: string; type?: string; } = {};
        if (feature && 'domain' in feature) { // This is a simple check for DomainCard
            const card = feature as DomainCard;
            metadata.level = card.level;
            metadata.domain = card.domain;
            metadata.type = card.type;
        }
        return metadata;
    }
}
