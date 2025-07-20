import { ItemView, WorkspaceLeaf, Notice, Setting, setIcon, TFile, MarkdownRenderer, Menu, App, Modal, MenuItem } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import {
    Character, Trait, InventoryItem, CompendiumFeature, CompendiumItem, DomainCard, ArmorItem, WeaponItem, AvatarTransform, InherentFeature,
    TokenTrackerState,
    Beastform,
    Stances
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
    LevelUpModal,
    ManageTrackersModal,
    TemporaryResourceModal
} from '../modals';
import { getTokenType, createTokenTracker } from '../services/token-helpers';
import { renderMarkdown, renderRollableContent } from '../rendering/ui-helpers';
import { handleAdvantageDisadvantage, formatTraitModifier } from '../services/dice-helpers';
import { getEvasionModifier, getArmorModifier, getFinalDamageThresholds, getUnarmedAttack } from '../services/feature-automations';
import { ContentType } from '../services/export-import';
import { CharacterCreator } from './components/CharacterCreator';
import { DiceTray } from 'src/DiceTray';
import { getTier } from 'src/constants';

export const CHARACTER_SHEET_VIEW_TYPE = "dh-character-sheet-view";

type ManagerTab = 'abilities' | 'inventory' | 'details' | "beastforms" | "stances";
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
    private diceTray: DiceTray;

    constructor(leaf: WorkspaceLeaf, plugin: DaggerheartStatblockPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.containerEl.addClass('dh-character-sheet-view');
        this.diceTray = new DiceTray(this.plugin);
    }

    getViewType(): string { return CHARACTER_SHEET_VIEW_TYPE; }
    getDisplayText(): string { return "Characters"; }
    getIcon(): string { return "user-round-plus"; }

    async onOpen() {
        this.draw();
        this.registerEvent(this.app.workspace.on('daggerheart-character-update', () => this.draw()));
    }

    async onClose() {
        this.diceTray?.unload();
        super.onClose();
    }

    draw() {
        if (this.isEditingDetails) {
            return;
        }

        const container = this.containerEl.children[1] as HTMLElement;
        const mainContent = container.querySelector('.dh-cs-main') as HTMLElement;
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
        const activeChar = this.plugin.getActiveCharacter();

        if (activeChar) {
            const accentColor = activeChar.accentColor || '#e5b32a';
            const accentGlow = this.hexToRgba(accentColor, 0.4);
            this.containerEl.style.setProperty('--dh-sheet-accent', accentColor);
            this.containerEl.style.setProperty('--dh-sheet-accent-glow', accentGlow);

            this.drawCharacterSheet(container, activeChar);
        } else {
            this.drawNoCharacterState(container);
            this.containerEl.style.removeProperty('--dh-sheet-accent');
            this.containerEl.style.removeProperty('--dh-sheet-accent-glow');
        }

        const newMainContent = container.querySelector('.dh-cs-main') as HTMLElement;
        if (newMainContent) {
            newMainContent.scrollTop = scrollPosition;
        }

        this.diceTray.render(this.containerEl);

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

    public setTrayFormula(formula: string, context: string, modifier?: number) {
        this.diceTray.setFormula(formula, context, modifier);
    }

    private drawNoCharacterState(parent: HTMLElement) {
        const header = parent.createDiv({ cls: 'dh-character-selection-header' });

        const selectBtn = header.createEl('button', { text: 'Select a Character' });
        setIcon(selectBtn, 'users');
        selectBtn.addEventListener('click', (e) => {
            const menu = new Menu();
            const characters = this.plugin.getCharacters();
            if (characters.length > 0) {
                characters.forEach(char => {
                    menu.addItem(item => item
                        .setTitle(char.name)
                        .onClick(() => this.plugin.setActiveCharacterId(char.id))
                    );
                });
            } else {
                menu.addItem(item => item.setTitle("No characters found").setDisabled(true));
            }
            menu.showAtMouseEvent(e);
        });

        const importBtn = header.createEl('button', { text: 'Import Character' });
        setIcon(importBtn, 'download');
        importBtn.addEventListener('click', () => {
            new ImportExportModal(this.app, this.plugin, 'import', ContentType.CHARACTER).open();
        });

        new CharacterCreator(this.plugin, this, parent);
    }

    private drawCharacterSheet(parent: HTMLElement, data: Character) {
        const sheet = parent.createDiv({ cls: 'dh-sheet' });
        const main = sheet.createDiv({ cls: 'dh-cs-main' });

        this.drawSheetHeader(main, data);
        const mainGrid = main.createDiv({ cls: 'dh-sheet-grid' });
        this.drawLeftColumn(mainGrid, data);
        this.drawCenterColumn(mainGrid, data);
        this.drawRightColumn(mainGrid, data);
        this.drawManager(main, data);
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

        const actionsBtn = nameWrapper.createEl('button', { cls: 'dh-character-actions-btn clickable-icon' });
        setIcon(actionsBtn, 'settings-2');
        actionsBtn.ariaLabel = "Manage Characters & Actions";
        actionsBtn.addEventListener('click', (event: MouseEvent) => {
            this.showMasterActionsMenu(event, data);
        });

        if (data.activeBeastformName) {
            const activeBeast = this.plugin.compendium.beastforms.find(b => b.name === data.activeBeastformName);
            if (activeBeast) {
                const banner = nameplate.createDiv({ cls: 'dh-active-beastform-banner' });
                banner.createSpan({ text: `Transformed: ${activeBeast.name}` });
                const revertBtn = banner.createEl('button');
                setIcon(revertBtn, 'x-circle');
                revertBtn.ariaLabel = "Revert to normal form";
                revertBtn.addEventListener('click', () => {
                    data.activeBeastformName = null;
                    this.plugin.updateCharacter(data);
                });
            }
        }

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

    private showMasterActionsMenu(event: MouseEvent, character: Character) {
        const menu = new Menu();

        // Section 1: Current Character Management
        menu.addItem((item) =>
            item
                .setTitle("Manage Character")
                .setIcon("pencil")
                .onClick(() => {
                    new CharacterManagerModal(this.app, this.plugin, character, (updatedChar) => {
                        this.plugin.updateCharacter(updatedChar);
                    }).open();
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Export Character")
                .setIcon("upload")
                .onClick(() => {
                    new ImportExportModal(this.app, this.plugin, 'export', ContentType.CHARACTER, character.id).open();
                })
        );

        menu.addSeparator();

        // Section 2: Switch Character
        const characters = this.plugin.getCharacters().filter(c => c.id !== character.id);
        if (characters.length > 0) {
            menu.addItem((item: MenuItem) => {
                item.setTitle("Switch To").setIcon("users");
                // This uses a type assertion '(item as any)' to access setSubmenu.
                // This is a workaround for potentially outdated or incorrect Obsidian type definitions.
                // It allows the code to compile while relying on the runtime availability of the method.
                const subMenu = (item as any).setSubmenu();
                characters.forEach(char => {
                    subMenu.addItem((subItem: MenuItem) => {
                        subItem
                            .setTitle(char.name)
                            .setIcon("user-round")
                            .onClick(() => this.plugin.setActiveCharacterId(char.id));
                    });
                });
            });
            menu.addSeparator();
        }

        // Section 3: Global Actions
        menu.addItem((item) =>
            item
                .setTitle("Create New Character")
                .setIcon("plus")
                .onClick(() => this.plugin.setActiveCharacterId(null))
        );

        menu.addItem((item) =>
            item
                .setTitle("Import Character")
                .setIcon("download")
                .onClick(() => {
                    new ImportExportModal(this.app, this.plugin, 'import', ContentType.CHARACTER).open();
                })
        );

        menu.addSeparator();

        // Section 4: Danger Zone
        menu.addItem((item) =>
            item
                .setTitle("Delete Current Character")
                .setIcon("trash")
                .onClick(() => {
                    new ConfirmationModal(
                        this.app,
                        `Are you sure you want to delete ${character.name}?`,
                        async () => { await this.plugin.deleteCharacter(character.id); }
                    ).open();
                })
        );

        menu.showAtMouseEvent(event);
    }

    private drawLeftColumn(parent: HTMLElement, data: Character) {
        const leftCol = parent.createDiv({ cls: 'dh-grid-column-left' });
        this.drawPrimaryDefenses(leftCol, data);
        this.drawDamageAndResources(leftCol, data);
    }

    private drawCenterColumn(parent: HTMLElement, data: Character) {
        const centerCol = parent.createDiv({ cls: 'dh-grid-column-center' });
        this.drawTraits(centerCol, data);
        const subClass = this.plugin.compendium.getSubclass(data.subclassId);
        if (subClass?.name.toLowerCase().includes('martial artist')) {
            this.drawActiveStance(centerCol, data);
        }
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
        const equippedWeapons = data.inventory.filter(i => data.equippedWeaponIds?.includes(i.instanceId) && i._type === "weapon") as (InventoryItem & { _type: 'weapon' })[];

        // --- Evasion Calculation ---
        let beastformEvasionBonus = 0;
        if (data.activeBeastformName) {
            const activeBeast = this.plugin.compendium.beastforms.find(b => b.name === data.activeBeastformName);
            if (activeBeast?.attributes.some(a => a.trait === 'Evasion')) {
                beastformEvasionBonus = activeBeast.attributes.find(a => a.trait === 'Evasion')?.bonus || 0;
            }
        }
        const evasionModifier = getEvasionModifier(data, equippedArmor, equippedWeapons, this.plugin);
        const finalEvasion = data.evasion + evasionModifier + beastformEvasionBonus + (data.customModifiers?.evasion || 0);

        // --- Armor Calculation ---
        const armorModifier = getArmorModifier(data, equippedWeapons, this.plugin);
        const finalArmor = (equippedArmor ? equippedArmor.baseScore : 0) + armorModifier;
        if (!equippedArmor && data.loadout.some(f => f.name.toLowerCase().includes("bare bones"))) {
            data.armorSlots.max = 3 + data.traits['Strength'].value;
        } else if (equippedArmor) {
            data.armorSlots.max = finalArmor;
        } else {
            data.armorSlots.max = 0;
        }

        // --- Rendering ---
        const evasionBox = container.createDiv({ cls: 'dh-stat-hex' });
        evasionBox.createEl('span', { text: String(finalEvasion), cls: 'dh-stat-value' });
        evasionBox.createEl('span', { text: 'Evasion', cls: 'dh-stat-label' });

        const armorBox = container.createDiv({ cls: 'dh-stat-hex' });
        armorBox.createEl('span', { text: String(data.armorSlots.max), cls: 'dh-stat-value' });
        armorBox.createEl('span', { text: 'Armor', cls: 'dh-stat-label' });

        const armorSlotsContainer = parent.createDiv({ cls: 'dh-armor-slots' });

        const armorLabelContainer = armorSlotsContainer.createDiv({ cls: 'dh-armor-label-container' });
        armorLabelContainer.createEl('span', { text: 'Armor Slots' });
        const addTempArmorBtn = armorLabelContainer.createEl('button', { cls: 'dh-add-temp-btn clickable-icon' });
        setIcon(addTempArmorBtn, 'plus-circle');
        addTempArmorBtn.ariaLabel = "Add/Edit Temporary Armor Slots";
        addTempArmorBtn.addEventListener('click', () => {
            const currentVal = data.temporaryArmorSlots ? String(data.temporaryArmorSlots.max) : '0';
            new TemporaryResourceModal(this.app, "Edit Temporary Armor", "Enter amount", currentVal, (value) => {
                const amount = parseInt(value);
                if (!isNaN(amount)) {
                    if (!data.temporaryArmorSlots) {
                        data.temporaryArmorSlots = { _type: 'dynamicResource', current: 0, max: 0 };
                    }
                    const currentMarked = data.temporaryArmorSlots.current;
                    data.temporaryArmorSlots.max = amount;
                    data.temporaryArmorSlots.current = Math.min(currentMarked, amount);
                    if (amount === 0) {
                        data.temporaryArmorSlots.current = 0;
                    }
                    this.plugin.updateCharacter(data);
                }
            }).open();
        });

        this.plugin.createInteractiveTrack(armorSlotsContainer, '', data.armorSlots.max, data.id + '-armor', data.armorSlots.current, (v) => {
            data.armorSlots.current = v;
            this.plugin.updateCharacter(data);
        });

        if (data.temporaryArmorSlots && data.temporaryArmorSlots.max > 0) {
            const tempArmorContainer = armorSlotsContainer.createDiv({ cls: 'dh-temporary-track-container' });
            this.plugin.createInteractiveTrack(tempArmorContainer, 'Temp', data.temporaryArmorSlots.max, data.id + '-temp-armor', data.temporaryArmorSlots.current, (v) => {
                if (!data.temporaryArmorSlots) return;
                data.temporaryArmorSlots.current = v;
                if (data.temporaryArmorSlots.current >= data.temporaryArmorSlots.max) {
                    data.temporaryArmorSlots.max = 0;
                    data.temporaryArmorSlots.current = 0;
                }
                this.plugin.updateCharacter(data);
            });
        }
    }

    private drawDamageAndResources(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-damage-and-resources' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Hit Points & Stress' });

        const thresholdsDisplay = container.createDiv({ cls: 'dh-thresholds-display' });
        const equippedArmor = data.inventory.find(i => i.instanceId === data.equippedArmorId && i._type === 'armor') as InventoryItem & { _type: 'armor' } | undefined;

        // --- Threshold Calculation ---
        const { major: finalMajorThreshold, severe: finalSevereThreshold } = getFinalDamageThresholds(data, equippedArmor, this.plugin);

        // --- Rendering ---
        const mainRow = thresholdsDisplay.createDiv({ cls: 'dh-threshold-main-row' });
        const minorBox = mainRow.createDiv({ cls: 'dh-threshold-box' });
        minorBox.createSpan({ cls: 'dh-threshold-label', text: 'Minor' });

        mainRow.createSpan({ cls: 'dh-threshold-value', text: String(finalMajorThreshold) });

        const majorGroup = mainRow.createDiv({ cls: 'dh-threshold-group' });
        majorGroup.createDiv({ cls: 'dh-threshold-arrow' });
        const majorBox = majorGroup.createDiv({ cls: 'dh-threshold-box' });
        majorBox.createSpan({ cls: 'dh-threshold-label', text: 'Major' });

        mainRow.createSpan({ cls: 'dh-threshold-value', text: String(finalSevereThreshold) });
        const severeGroup = mainRow.createDiv({ cls: 'dh-threshold-group' });
        severeGroup.createDiv({ cls: 'dh-threshold-arrow' });
        const severeBox = severeGroup.createDiv({ cls: 'dh-threshold-box' });
        severeBox.createSpan({ cls: 'dh-threshold-label', text: 'Severe' });

        const descRow = thresholdsDisplay.createDiv({ cls: 'dh-threshold-desc-row' });
        descRow.createDiv({ cls: 'dh-threshold-desc-item', text: 'Mark 1 HP' });
        descRow.createDiv({ cls: 'dh-threshold-separator is-empty' });
        descRow.createDiv({ cls: 'dh-threshold-desc-item', text: 'Mark 2 HP' });
        descRow.createDiv({ cls: 'dh-threshold-separator is-empty' });
        descRow.createDiv({ cls: 'dh-threshold-desc-item', text: 'Mark 3 HP' });


        if (data.hitPoints) {
            const hpTrackContainer = container.createDiv();
            this.plugin.createInteractiveTrack(hpTrackContainer, 'HP', data.hitPoints.max, data.id + '-hp', data.hitPoints.current, (v) => {
                data.hitPoints.current = v;

                if (data.activeBeastformName && data.hitPoints.current >= data.hitPoints.max) {
                    data.activeBeastformName = null;
                    new Notice("You marked your last Hit Point and reverted to your normal form.");
                }

                this.plugin.updateCharacter(data);
            });
            const hpLabel = hpTrackContainer.querySelector('.dh-track-label') as HTMLElement;
            if (hpLabel) {
                hpLabel.addClass('is-clickable');
                hpLabel.ariaLabel = "Add/Edit Temporary HP";
                hpLabel.addEventListener('click', () => {
                    const currentVal = data.temporaryHitPoints ? String(data.temporaryHitPoints.max) : '0';
                    new TemporaryResourceModal(this.app, "Edit Temporary HP", "Enter amount", currentVal, (value) => {
                        const amount = parseInt(value);
                        if (!isNaN(amount)) {
                            if (!data.temporaryHitPoints) {
                                data.temporaryHitPoints = { _type: 'dynamicResource', current: 0, max: 0 };
                            }
                            data.temporaryHitPoints.max = amount;
                            data.temporaryHitPoints.current = 0;
                            this.plugin.updateCharacter(data);
                        }
                    }).open();
                });
            }
        }

        if (data.temporaryHitPoints && data.temporaryHitPoints.max > 0) {
            const tempHpContainer = container.createDiv({ cls: 'dh-temporary-track-container' });
            this.plugin.createInteractiveTrack(tempHpContainer, 'Temp HP', data.temporaryHitPoints.max, data.id + '-temp-hp', data.temporaryHitPoints.current, (v) => {
                if (!data.temporaryHitPoints) return;
                data.temporaryHitPoints.current = v;
                if (data.temporaryHitPoints.current >= data.temporaryHitPoints.max) {
                    data.temporaryHitPoints.max = 0;
                    data.temporaryHitPoints.current = 0;
                }
                this.plugin.updateCharacter(data);
            });
        }

        if (data.stress) {
            const stressTrackContainer = container.createDiv();
            this.plugin.createInteractiveTrack(stressTrackContainer, 'Stress', data.stress.max, data.id + '-stress', data.stress.current, (v) => { data.stress.current = v; this.plugin.updateCharacter(data); });
            const stressLabel = stressTrackContainer.querySelector('.dh-track-label') as HTMLElement;
            if (stressLabel) {
                stressLabel.addClass('is-clickable');
                stressLabel.ariaLabel = "Add/Edit Temporary Stress";
                stressLabel.addEventListener('click', () => {
                    const currentVal = data.temporaryStress ? String(data.temporaryStress.max) : '0';
                    new TemporaryResourceModal(this.app, "Edit Temporary Stress", "Enter amount", currentVal, (value) => {
                        const amount = parseInt(value);
                        if (!isNaN(amount)) {
                            if (!data.temporaryStress) {
                                data.temporaryStress = { _type: 'dynamicResource', current: 0, max: 0 };
                            }
                            const currentMarked = data.temporaryStress.current;
                            data.temporaryStress.max = amount;
                            data.temporaryStress.current = Math.min(currentMarked, amount);
                            if (amount === 0) {
                                data.temporaryStress.current = 0;
                            }
                            this.plugin.updateCharacter(data);
                        }
                    }).open();
                });
            }
        }

        if (data.temporaryStress && data.temporaryStress.max > 0) {
            const tempStressContainer = container.createDiv({ cls: 'dh-temporary-track-container' });
            this.plugin.createInteractiveTrack(tempStressContainer, 'Temp Stress', data.temporaryStress.max, data.id + '-temp-stress', data.temporaryStress.current, (v) => {
                if (!data.temporaryStress) return;
                data.temporaryStress.current = v;
                if (data.temporaryStress.current >= data.temporaryStress.max) {
                    data.temporaryStress.max = 0;
                    data.temporaryStress.current = 0;
                }
                this.plugin.updateCharacter(data);
            });
        }
    }

    private drawTraits(parent: HTMLElement, data: Character) {
        const container = parent.createDiv({ cls: 'dh-traits-grid' });

        let beastBonuses: { [key: string]: number } = {};
        if (data.activeBeastformName) {
            const activeBeast = this.plugin.compendium.beastforms.find(b => b.name === data.activeBeastformName);
            if (activeBeast) {
                activeBeast.attributes.forEach(attr => {
                    if (attr.trait !== 'Evasion') {
                        beastBonuses[attr.trait] = attr.bonus;
                    }
                });
            }
        }

        Object.entries(data.traits).forEach(([name, trait]) => {
            const key = name as keyof Character['traits'];
            const bonus = beastBonuses[name] || 0;
            const finalValue = trait.value + bonus;
            const box = container.createDiv({ cls: `dh-trait-box-large ${trait.locked ? 'locked' : ''}` });

            if (bonus > 0) {
                box.addClass('is-modified');
                box.title = `Base: ${trait.value >= 0 ? '+' : ''}${trait.value}, Bonus: +${bonus}`;
            }

            box.createDiv({ cls: 'dh-trait-value-large', text: `${finalValue >= 0 ? '+' : ''}${finalValue}` });
            box.createDiv({ cls: 'dh-trait-name-large', text: name });
            const skillsList = box.createDiv({ cls: 'dh-trait-skills' });
            (TRAIT_SKILLS[key] || []).forEach(skill => {
                skillsList.createDiv({ text: skill });
            });
            if (!trait.locked) {
                box.title = `Click to roll ${name}. Hold Shift for Advantage or Alt for Disadvantage. Hold Cmd/Ctrl to add to Dice Tray.`;
                box.addEventListener('click', (event) => {
                    const baseDiceString = `dr`;
                    const modifier = finalValue;
                    const context = `${name} Roll`;

                    if (event.metaKey || event.ctrlKey) {
                        this.setTrayFormula(baseDiceString, context, modifier);
                        return;
                    }

                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        context
                    );
                    this.plugin.rollDice(
                        `${diceString}${formatTraitModifier(modifier)}`,
                        newRollTitle,
                        name
                    );
                });
            }
        });
    }

    private drawActiveWeapons(parent: HTMLElement, data: Character) {
        // Create the main container for this section
        const container = parent.createDiv({ cls: 'dh-active-weapons' });

        // Determine the title based on character state
        let titleText = 'Active Weapons';
        if (data.activeBeastformName) {
            const activeBeast = this.plugin.compendium.beastforms.find(b => b.name === data.activeBeastformName);
            if (activeBeast) {
                titleText = 'Active Attack';
            }
        }

        // Create the original, centered header
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: titleText });

        // Draw the specific content (beast, weapon, or unarmed) first
        if (data.activeBeastformName) {
            const activeBeast = this.plugin.compendium.beastforms.find(b => b.name === data.activeBeastformName);
            if (activeBeast) {
                this.createBeastformAttackCard(container, activeBeast, data);
            }
        } else {
            const equippedWeapons = data.inventory.filter(i => data.equippedWeaponIds && data.equippedWeaponIds.includes(i.instanceId) && i._type === 'weapon') as (InventoryItem & { _type: 'weapon' })[];
            if (equippedWeapons.length === 0) {
                this.createUnarmedAttackCard(container, 'Unarmed', data);
            } else {
                equippedWeapons.forEach((weapon, index) => {
                    this.createWeaponCard(container, weapon, index === 0 ? 'Primary' : 'Secondary', data);
                });
            }
        }

        // Create the proficiency pip display at the bottom of the section
        const proficiencyContainer = container.createDiv({ cls: 'dh-proficiency-container' });
        proficiencyContainer.createSpan({ cls: 'dh-proficiency-label', text: 'Proficiency' });
        const pipsContainer = proficiencyContainer.createDiv({ cls: 'dh-proficiency-pips' });
        const MAX_PROFICIENCY = 6;
        for (let i = 0; i < MAX_PROFICIENCY; i++) {
            const pip = pipsContainer.createDiv({ cls: 'dh-proficiency-pip' });
            if (i < data.proficiency) {
                pip.addClass('is-filled');
            }
        }
    }

    private createUnarmedAttackCard(parent: HTMLElement, type: string, character: Character) {
        const card = parent.createDiv({ cls: 'dh-weapon-card' });
        card.createEl('h4', { text: type });
        const body = card.createDiv({ cls: 'dh-weapon-card-body' });

        const left = body.createDiv();
        left.createDiv({ cls: 'dh-weapon-name', text: 'Unarmed Attack' });
        left.createDiv({ cls: 'dh-weapon-type', text: `Melee` });

        const right = body.createDiv({ cls: 'dh-weapon-card-right' });

        const createRollBox = (traitName: 'Strength' | 'Finesse') => {
            const trait = character.traits[traitName];
            if (trait) {
                const rollBox = right.createDiv({ cls: 'dh-weapon-roll-box' });
                const traitValue = trait.value;
                const traitDisplay = `${traitValue >= 0 ? '+' : ''}${traitValue}`;
                rollBox.createDiv({ text: traitDisplay });
                rollBox.createDiv({ text: traitName });
                const rollTitle = `Unarmed Attack (${traitName})`;
                rollBox.title = `Click to roll ${traitName}. Hold Shift for Advantage or Alt for Disadvantage. Hold Cmd/Ctrl to add to Dice Tray.`;
                rollBox.addEventListener('click', (event) => {
                    const formula = 'dr';
                    const modifier = traitValue;

                    if (event.metaKey || event.ctrlKey) {
                        this.setTrayFormula(formula, rollTitle, modifier);
                        return;
                    }

                    let baseDiceString = `dr`;
                    const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                        event,
                        baseDiceString,
                        rollTitle
                    );
                    this.plugin.rollDice(
                        `${diceString}${formatTraitModifier(modifier)}`,
                        newRollTitle,
                        traitName
                    );
                });
            }
        };

        createRollBox('Strength');
        createRollBox('Finesse');

        const damageBox = right.createDiv({ cls: 'dh-weapon-damage-box' });
        const { formula: damageFormula, type: damageTypeLabel, context: damageRollContext } = getUnarmedAttack(character, this.plugin);

        damageBox.createDiv({ text: damageFormula });
        damageBox.createDiv({ text: damageTypeLabel });
        damageBox.title = `Click to roll ${damageFormula}. Hold Cmd/Ctrl to add to Dice Tray.`;
        damageBox.addEventListener('click', (event) => {
            if (event.metaKey || event.ctrlKey) {
                this.setTrayFormula(damageFormula, damageRollContext);
                return;
            }
            this.plugin.rollDice(damageFormula, damageRollContext);
        });
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
            rollBox.title = `Click to roll. Hold Shift for Advantage or Alt for Disadvantage. Hold Cmd/Ctrl to add to Dice Tray.`;
            rollBox.addEventListener('click', (event) => {
                const formula = 'dr';
                const modifier = traitValue;

                if (event.metaKey || event.ctrlKey) {
                    this.setTrayFormula(formula, rollTitle, modifier);
                    return;
                }

                let baseDiceString = `dr`;
                const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(
                    event,
                    baseDiceString,
                    rollTitle
                );
                this.plugin.rollDice(
                    `${diceString}${formatTraitModifier(modifier)}`,
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
        damageBox.title = `Click to roll ${damageFormula}. Hold Cmd/Ctrl to add to Dice Tray.`;
        damageBox.addEventListener('click', (event) => {
            if (event.metaKey || event.ctrlKey) {
                this.setTrayFormula(damageFormula, `${weapon.name} Damage`);
                return;
            }
            this.plugin.rollDice(damageFormula, `${weapon.name} Damage`);
        });
    }

    private createBeastformAttackCard(parent: HTMLElement, beast: Beastform, character: Character) {
        const card = parent.createDiv({ cls: 'dh-weapon-card' });
        card.createEl('h4', { text: beast.name });
        const body = card.createDiv({ cls: 'dh-weapon-card-body' });

        const left = body.createDiv();
        left.createDiv({ cls: 'dh-weapon-name', text: 'Beast Attack' });
        left.createDiv({ cls: 'dh-weapon-type', text: `${beast.attack.range}` });

        (beast.features || []).forEach(feature => {
            const featureEl = left.createDiv({ cls: 'dh-weapon-feature' });
            renderRollableContent(this.plugin, `**${feature.name}:** ${feature.description}`, featureEl, `${beast.name}: ${feature.name}`, true);
        });

        const right = body.createDiv({ cls: 'dh-weapon-card-right' });
        const traitName = beast.attack.trait as keyof Character['traits'];
        const trait = character.traits[traitName];
        if (trait) {
            const beastAttributeBonus = beast.attributes.find(a => a.trait === traitName)?.bonus || 0;
            const totalTraitValue = trait.value + beastAttributeBonus;

            const rollBox = right.createDiv({ cls: 'dh-weapon-roll-box' });
            const traitDisplay = `${totalTraitValue >= 0 ? '+' : ''}${totalTraitValue}`;
            rollBox.createDiv({ text: traitDisplay });
            rollBox.createDiv({ text: traitName });
            const rollTitle = `${beast.name} Attack`;
            rollBox.title = `Click to roll. Hold Shift for Advantage or Alt for Disadvantage. Hold Cmd/Ctrl to add to Dice Tray.`;
            rollBox.addEventListener('click', (event) => {
                const formula = 'dr';
                const modifier = totalTraitValue;
                if (event.metaKey || event.ctrlKey) {
                    this.setTrayFormula(formula, rollTitle, modifier);
                    return;
                }
                const { diceString, rollTitle: newRollTitle } = handleAdvantageDisadvantage(event, 'dr', rollTitle);
                this.plugin.rollDice(`${diceString}${formatTraitModifier(modifier)}`, newRollTitle, traitName);
            });
        }

        const damageBox = right.createDiv({ cls: 'dh-weapon-damage-box' });
        const proficiency = character.proficiency;
        let damageFormula = `${proficiency}${beast.attack.dice}`;

        if (beast.attack.dice.includes('+') || beast.attack.dice.includes('-')) {
            damageFormula = `${proficiency}(${beast.attack.dice})`;
        }

        damageBox.createDiv({ text: damageFormula });
        damageBox.createDiv({ text: beast.attack.type });
        damageBox.title = `Click to roll ${damageFormula}. Hold Cmd/Ctrl to add to Dice Tray.`;
        damageBox.addEventListener('click', (event) => {
            if (event.metaKey || event.ctrlKey) {
                this.setTrayFormula(damageFormula, `${beast.name} Damage`);
                return;
            }
            this.plugin.rollDice(damageFormula, `${beast.name} Damage`);
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
            const card = this.createExperienceCard(container, exp.name, `+${exp.value}`, true);
            card.addEventListener('click', () => {
                this.diceTray.addModifier(exp.value);
            });
        });
    }

    private drawManager(parent: HTMLElement, data: Character) {
        const managerContainer = parent.createDiv({ cls: 'dh-manager-container' });
        const tabs = managerContainer.createDiv({ cls: 'dh-manager-tabs' });
        this.createManagerTab(tabs, 'abilities', 'Abilities');
        this.createManagerTab(tabs, 'inventory', 'Equipment');
        this.createManagerTab(tabs, 'details', 'Details');
        if (data.classId.match("Druid")) {
            this.createManagerTab(tabs, 'beastforms', 'Beastforms');
        }
        const content = managerContainer.createDiv({ cls: 'dh-manager-content' });
        switch (this.activeManagerTab) {
            case 'abilities': this.drawAbilitiesManager(content, data); break;
            case 'inventory': this.drawInventoryManager(content, data); break;
            case 'details': this.drawDetailsManager(content, data); break;
            case 'beastforms': this.drawBeasformsSection(content, data); break;
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
        this.drawDomainCardSection(parent, 'Domain Cards', data.loadout, data);
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

    private drawBeasformsSection(parent: HTMLElement, character: Character) {
        const section = parent.createDiv({ cls: 'dh-card-section' });
        const header = section.createDiv({ cls: 'dh-section-header-bar' });
        header.createEl('h3', { text: 'Beastforms' });

        const beastforms = this.plugin.compendium.beastforms.reduce((acc, beast) => {
            const tier = beast.tier;
            if (!acc[tier]) {
                acc[tier] = [];
            }
            acc[tier].push(beast);
            return acc;
        }, {} as Record<Beastform['tier'], Beastform[]>);

        const tierOrder: Beastform['tier'][] = [1, 2, 3, 4];

        for (const tier of tierOrder) {
            const beasts = beastforms[tier];
            if (beasts && beasts.length > 0) {
                const groupContainer = section.createDiv({ cls: 'dh-feature-group' });
                groupContainer.createEl('h4', { text: `Tier ${tier}`, cls: 'dh-feature-group-title' });
                const grid = groupContainer.createDiv({ cls: 'dh-feature-grid' });
                beasts.forEach(beast => {
                    this.createBeastCard(grid, beast, character);
                });
            }
        }
    }

    private drawActiveStance(parent: HTMLElement, character: Character) {
        const container = parent.createDiv({ cls: 'dh-active-stance' });
        const header = container.createDiv({ cls: 'dh-section-header-box' });
        header.createEl('h3', { text: 'Active Stance' });

        const content = container.createDiv({ cls: 'dh-active-stance-content' });
        const learnedStances = character.equippedStances || [];

        new Setting(content)
            .setName('Switch Stance')
            .setDesc('Select which of your learned stances is currently active.')
            .addDropdown(dd => {
                dd.addOption('', 'None');
                learnedStances.forEach(stanceName => {
                    dd.addOption(stanceName, stanceName);
                });
                dd.setValue(character.activeStance || '').onChange(async (value) => {
                    character.activeStance = value;
                    await this.plugin.updateCharacter(character);
                });
            });

        const activeStanceName = character.activeStance;
        if (activeStanceName) {
            const activeStanceData = this.plugin.compendium.stances.find(s => s.name === activeStanceName);
            if (activeStanceData) {
                const card = content.createDiv({ cls: 'dh-active-stance-card' });
                card.createEl('h4', { text: activeStanceData.name });
                const descEl = card.createDiv({ cls: 'dh-active-stance-description' });
                renderRollableContent(this.plugin, activeStanceData.description, descEl, activeStanceData.name, true);
            }
        } else {
            content.createDiv({ text: 'No stance is currently active.', cls: 'dh-empty-text' });
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
                const valueToRender = initialValue || "_Click to edit..._";
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

        const descriptionSection = parent.createDiv({ cls: 'dh-details-section' });
        descriptionSection.createEl('h3', { text: 'Character Description' });
        const descriptionCard = descriptionSection.createDiv({ cls: 'dh-detail-card' });
        createEditableMarkdownField(descriptionCard, data.notes || '', (value) => { data.notes = value; });

        if (data.background && data.background.length > 0) {
            const backgroundSection = parent.createDiv({ cls: 'dh-details-section dh-background-section' });
            backgroundSection.createEl('h3', { text: 'Background' });
            data.background.forEach((bg) => {
                const card = backgroundSection.createDiv({ cls: 'dh-detail-card' });
                card.createEl('h4', { text: bg.question });
                createEditableMarkdownField(card, bg.answer || '', (value) => { bg.answer = value; }, true);
            });
        }

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

    private createExperienceCard(parent: HTMLElement, title: string, subtext: string, isInteractive: boolean = false) {
        const card = parent.createDiv({ cls: `dh-experience-card ${isInteractive ? 'is-interactive' : ''}` });
        card.createDiv({ cls: 'dh-card-title', text: title });
        if (subtext) card.createSpan({ cls: 'dh-experience-value', text: subtext });
        return card;
    }

    private createFeatureCard(parent: HTMLElement, feature: InherentFeature | DomainCard, character: Character) {
        const card = parent.createDiv({ cls: 'dh-feature-card' });

        card.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            const menu = new Menu();

            menu.addItem((item) =>
                item
                    .setTitle("Manage Trackers...")
                    .setIcon("list-plus")
                    .onClick(() => {
                        new ManageTrackersModal(this.app, this.plugin, character, feature).open();
                    })
            );

            menu.showAtMouseEvent(event);
        });

        const metadata = this.getFeatureMetadata(feature);

        const header = card.createDiv({ cls: 'dh-feature-card-header' });
        header.createDiv({ cls: 'dh-feature-card-title', text: feature.name });

        const metaHeader = header.createDiv({ cls: 'dh-feature-card-meta-header' });
        if (metadata.domain) metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.domain });
        if (metadata.type) metaHeader.createSpan({ cls: 'dh-feature-card-type', text: metadata.type });
        if (metadata.level) metaHeader.createSpan({ cls: 'dh-feature-card-type', text: `Level ${metadata.level}` });

        const body = card.createDiv({ cls: 'dh-feature-card-body' });
        renderRollableContent(this.plugin, feature.description, body, feature.name, true);

        const hasSpellcast = feature.description.toLowerCase().includes('make a spellcast roll');
        const tokenInfo = getTokenType(feature.description);
        const nativeHasTokens = tokenInfo.type !== 'none' || feature.description.toLowerCase().includes('mark a stress to replenish this card with tokens');

        if (nativeHasTokens) {
            if (!character.trackers) character.trackers = {};
            if (!character.trackers[feature.id]) character.trackers[feature.id] = [];

            const existingNative = character.trackers[feature.id].find(t => t.id === 'native');
            if (!existingNative) {
                let baseMaxTokens = 0;
                const traitSource = tokenInfo.source as keyof Character['traits'] | undefined;

                if (tokenInfo.type === 'trait' && traitSource && character.traits[traitSource]) {
                    const traitValue = character.traits[traitSource].value;
                    baseMaxTokens = tokenInfo.hasMinimumOne ? Math.max(1, traitValue) : traitValue;
                }
                else if (tokenInfo.type === 'spellcast' || tokenInfo.type === 'replenish_spellcast') {
                    if (character.spellCastTrait) {
                        const traitValue = character.traits[character.spellCastTrait as keyof Character['traits']].value;
                        baseMaxTokens = tokenInfo.hasMinimumOne ? Math.max(1, traitValue) : traitValue;
                    }
                } else if (tokenInfo.type === 'complex' && tokenInfo.source === 'sage_cards') {
                    baseMaxTokens = [...character.loadout, ...character.vault].filter(c => c.domain === 'Sage').length;
                }

                const nativeTracker: TokenTrackerState = { id: 'native', tokens: 0, max: baseMaxTokens };
                character.trackers[feature.id].unshift(nativeTracker);
            }
        }

        const allTrackers = character.trackers?.[feature.id] || [];

        if (hasSpellcast || allTrackers.length > 0) {
            const footer = card.createDiv({ cls: 'dh-feature-card-footer dh-feature-card-footer-left' });

            if (hasSpellcast) {
                let spellcastingTraitName: keyof Character['traits'] | undefined = character.spellCastTrait as keyof Character['traits'] ||
                    this.plugin.compendium.getSubclass(character.subclassId)?.spellcast_trait as keyof Character['traits'];

                if (spellcastingTraitName) {
                    const traitValue = character.traits[spellcastingTraitName]?.value ?? 0;
                    const rollBox = footer.createEl('div', { cls: 'dh-spellcast-box dh-spellcast-box-inline' });
                    rollBox.createSpan({ cls: 'dh-spellcast-modifier', text: `${traitValue >= 0 ? '+' : ''}${traitValue}` });
                    rollBox.createSpan({ text: ` ${spellcastingTraitName}` });
                    rollBox.title = `Click to roll. Hold Shift for Advantage or Alt for Disadvantage. Hold Cmd/Ctrl to add to Dice Tray.`;
                    rollBox.addEventListener('click', (event) => {
                        const formula = 'dr';
                        const modifier = traitValue;
                        const context = `${feature.name} Spellcast`;

                        if (event.metaKey || event.ctrlKey) {
                            this.setTrayFormula(formula, context, modifier);
                            return;
                        }

                        const { diceString } = handleAdvantageDisadvantage(event, `dr`, context);
                        this.plugin.rollDice(`${diceString}${formatTraitModifier(modifier)}`, context, spellcastingTraitName);
                    });
                }
            }

            allTrackers.forEach((trackerState) => {
                createTokenTracker(
                    footer,
                    trackerState,
                    (newState: TokenTrackerState) => {
                        const allTrackersForCard = character.trackers?.[feature.id];
                        if (allTrackersForCard) {
                            const index = allTrackersForCard.findIndex(t => t.id === newState.id);
                            if (index > -1) {
                                allTrackersForCard[index] = newState;
                                this.plugin.updateCharacter(character);
                            }
                        }
                    }
                );
            });
        }
    }

    private getFeatureMetadata(feature: InherentFeature | DomainCard): { level?: number; domain?: string; type?: string; } {
        const metadata: { level?: number; domain?: string; type?: string; } = {};
        if (feature && 'domain' in feature) {
            const card = feature as DomainCard;
            metadata.level = card.level;
            metadata.domain = card.domain;
            metadata.type = card.type;
        }
        return metadata;
    }

    private createBeastCard(parent: HTMLElement, beast: Beastform, character: Character) {
        const card = parent.createDiv({ cls: 'dh-beastform-card' });

        const header = card.createDiv({ cls: 'dh-beastform-card-header' });
        header.createEl('h4', { text: beast.name, cls: 'dh-beastform-card-title' });
        if (beast.examples) {
            header.createSpan({ text: beast.examples, cls: 'dh-beastform-card-examples' });
        }

        const body = card.createDiv({ cls: 'dh-beastform-card-body' });

        const statsGrid = body.createDiv({ cls: 'dh-beastform-stats-grid' });
        const attributesCell = statsGrid.createDiv();
        attributesCell.createEl('h5', { text: 'Attributes' });
        const attrList = attributesCell.createEl('ul');
        beast.attributes.forEach(attr => {
            attrList.createEl('li', { text: `+${attr.bonus} ${attr.trait}` });
        });

        const attackCell = statsGrid.createDiv();
        attackCell.createEl('h5', { text: 'Attack' });
        const attackList = attackCell.createEl('ul');
        const proficiency = character.proficiency;
        attackList.createEl('li', { text: `Range: ${beast.attack.range}` });
        attackList.createEl('li', { text: `Trait: ${beast.attack.trait}` });
        attackList.createEl('li', { text: `Damage: ${proficiency}${beast.attack.dice} ${beast.attack.type}` });

        if (beast.advantages) {
            const advantagesSection = body.createDiv({ cls: 'dh-beastform-advantages' });
            advantagesSection.createEl('h5', { text: 'Advantages' });
            advantagesSection.createEl('p', { text: `Gain advantage on: ${beast.advantages}` });
        }

        const featuresSection = body.createDiv({ cls: 'dh-beastform-features' });
        featuresSection.createEl('h5', { text: 'Features' });
        beast.features.forEach(feature => {
            const featureEl = featuresSection.createDiv({ cls: 'dh-beastform-feature-item' });
            featureEl.createEl('strong', { text: `${feature.name}: ` });
            featureEl.createSpan({ text: feature.description });
        });

        const footer = card.createDiv({ cls: 'dh-beastform-card-footer' });
        const transformBtn = footer.createEl('button', { text: 'Transform' });

        const characterTier = getTier(character.level);
        const isDisabledByTier = beast.tier > characterTier;
        const isDisabledByState = !!character.activeBeastformName;

        if (isDisabledByTier || isDisabledByState) {
            transformBtn.disabled = true;
            if (isDisabledByTier) {
                transformBtn.title = `Requires Tier ${beast.tier} (You are Tier ${characterTier})`;
            } else if (isDisabledByState) {
                transformBtn.title = 'You are already transformed.';
            }
        }

        transformBtn.addEventListener('click', () => {
            if (character.stress.current >= character.stress.max) {
                new Notice("You have no Stress slots available to spend.");
                return;
            }

            new ConfirmationModal(
                this.app,
                `Transforming into ${beast.name} costs 1 Stress. Are you sure?`,
                async () => {
                    character.stress.current++;
                    character.activeBeastformName = beast.name;
                    await this.plugin.updateCharacter(character);
                }
            ).open();
        });
    }
}
