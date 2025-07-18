import { App, Plugin, PluginSettingTab, Setting, TextComponent, WorkspaceLeaf, Notice, Editor, TFile, EventRef, Modal, Menu, DropdownComponent } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, DaggerheartPluginSettings, DEFAULT_SETTINGS, Character, JsonAbility, JsonClass, JsonSubclass, JsonAncestry, SavedEncounter, AllCompendiumData } from './types';
import { EncounterBuilderView, ENCOUNTER_BUILDER_VIEW_TYPE } from './views/EncounterBuilderView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './views/CharacterSheetView';
import { DaggerheartCompendium } from './services/compendium';
import { renderStatblockCard } from './rendering/statblock';
import { createInteractiveTrack } from './rendering/ui-helpers';
import { ContentType } from './services/export-import';
import {
    AdversaryReferenceModal,
    EncounterLinkModal,
    CompendiumEntryTypeSuggester,
    ImportExportModal
} from './modals/index';
import * as dddice from './services/dddice-service';
import type { ITheme } from './services/dddice-service';
import { DddiceActivationModal } from './services/dddice-activation';
import { RollCompletedPayload, RollComponent } from './DiceTray';

declare module "obsidian" {
    interface Workspace {
        on(name: 'daggerheart-character-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-character-update'): void;
        on(name: 'daggerheart-compendium-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-compendium-update'): void;
        on(name: 'daggerheart-encounter-update', callback: () => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-encounter-update'): void;
        on(name: 'daggerheart-roll-completed', callback: (payload: RollCompletedPayload) => void, ctx?: any): EventRef;
        trigger(name: 'daggerheart-roll-completed', payload: RollCompletedPayload): void;
    }
}

const USER_COMPENDIUM_FOLDER = 'user_data';

/**
 * Expands a dice string like "2d12+3" into "1d12+1d12+3".
 * This ensures the dice roller returns a flat list of results.
 * @param notation The dice string to expand.
 * @returns The expanded dice string.
 */
function expandDiceString(notation: string): string {
    const diceGroupRegex = /(\d+)d(\d+)/g;
    return notation.replace(diceGroupRegex, (match, countStr, size) => {
        const count = parseInt(countStr, 10);
        if (count <= 1) {
            return match; // No need to expand 1d12 or 0d12
        }
        const expanded = Array(count).fill(`1d${size}`);
        return expanded.join('+');
    });
}

function getThemePreviewUrl(theme: ITheme): string | undefined {
    const preview = theme?.preview;
    if (typeof preview !== 'object' || preview === null) return undefined;
    if (typeof preview.preview === 'string' && preview.preview) return preview.preview;
    if (typeof preview['preview.png'] === 'string' && preview['preview.png']) return preview['preview.png'];
    for (const key in preview) {
        if (Object.prototype.hasOwnProperty.call(preview, key)) {
            const value = preview[key];
            if (typeof value === 'string' && value.startsWith('http')) return value;
        }
    }
    return undefined;
}

export default class DaggerheartStatblockPlugin extends Plugin {
    settings: DaggerheartPluginSettings;
    compendium: DaggerheartCompendium;
    isDiceRollerEnabled: boolean = false;
    private characters: Character[] = [];
    private encounters: SavedEncounter[] = [];
    private activeCharacterId: string | null = null;
    public settingsTab: DaggerheartSettingTab | null = null;

    async onload() {
        await this.loadSettings();
        this.activeCharacterId = this.settings.activeCharacterId;

        this.initializeDddiceIfNeeded();

        this.compendium = new DaggerheartCompendium(this);
        await this.compendium.load();
        await this.loadCharacters();
        await this.loadEncounters();

        this.isDiceRollerEnabled = this.settings.enableDiceRoller && !!(this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api;

        if (this.settings.enableEncounterView) {
            this.registerView(ENCOUNTER_BUILDER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new EncounterBuilderView(leaf, this));
            this.addRibbonIcon('swords', 'Open Daggerheart Encounter Builder', () => this.activateEncounterBuilderView());
            this.addCommand({ id: 'open-daggerheart-encounter-builder', name: 'Open Encounter Builder', callback: () => this.activateEncounterBuilderView() });
        }

        if (this.settings.enableCharacterSheet) {
            this.registerView(CHARACTER_SHEET_VIEW_TYPE, (leaf: WorkspaceLeaf) => new CharacterSheetView(leaf, this));
            this.addRibbonIcon('user-round', 'Open Daggerheart Characters', () => this.activateCharacterSheetView());
            this.addCommand({ id: 'open-daggerheart-character-sheet', name: 'Open Characters', callback: () => this.activateCharacterSheetView() });

            this.addCommand({
                id: 'export-daggerheart-content',
                name: 'Export Daggerheart Content',
                callback: () => {
                    new ImportExportModal(this.app, this, 'export').open();
                }
            });

            this.addCommand({
                id: 'import-daggerheart-content',
                name: 'Import Daggerheart Content',
                callback: () => {
                    new ImportExportModal(this.app, this, 'import').open();
                }
            });
        }

        this.registerMarkdownCodeBlockProcessor('daggerheart-statblock', (source, el) => { this.processStatblock(source, el); });
        this.registerMarkdownCodeBlockProcessor('daggerheart-embed', (source, el) => { this.processEmbed(source, el); });
        this.addCommand({ id: 'insert-adversary-statblock', name: 'Insert Adversary Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (adversary) => editor.replaceSelection(`\`\`\`daggerheart-embed\nadversary: ${adversary.name}\n\`\`\``), 'adversary').open(); } });
        this.addCommand({ id: 'insert-environment-statblock', name: 'Insert Environment Statblock', editorCallback: (editor: Editor) => { new AdversaryReferenceModal(this.app, this, (environment) => editor.replaceSelection(`\`\`\`daggerheart-embed\nenvironment: ${environment.name}\n\`\`\``), 'environment').open(); } });
        this.addCommand({ id: 'insert-encounter-link', name: 'Insert Encounter Link', editorCallback: (editor: Editor) => { new EncounterLinkModal(this.app, this, (encounter) => editor.replaceSelection(`[${encounter.name}](obsidian://dh-encounter?id=${encounter.id})`)).open(); } });

        this.addCommand({
            id: 'add-custom-compendium-entry',
            name: 'Create or Edit Compendium Entry',
            callback: () => {
                new CompendiumEntryTypeSuggester(this.app, this).open();
            },
        });

        this.settingsTab = new DaggerheartSettingTab(this.app, this);
        this.addSettingTab(this.settingsTab);
    }

    async processStatblock(source: string, el: HTMLElement) {
        try {
            const cleanedSource = source.replace(/\u00A0/g, ' ');
            const data = YAML.load(cleanedSource) as StatblockData;
            if (!data || typeof data !== 'object') throw new Error("Parsed data is not a valid object.");
            renderStatblockCard(this, data, el, false, data.name);
        } catch (e: any) {
            console.error('Daggerheart Statblock: Error processing code block.', e);
            const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
            errorEl.setText(`Error rendering Daggerheart Statblock:\n${e.message}\n\nSource:\n${source}`);
        }
    }

    async processEmbed(source: string, el: HTMLElement) {
        try {
            const params = source.split('\n').reduce((acc, line) => {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length > 0) {
                    acc[key.trim()] = valueParts.join(':').trim();
                }
                return acc;
            }, {} as Record<string, string>);

            const items = this.compendium.getStatblocks();
            let itemToRender: StatblockData | undefined;
            let itemName: string | undefined;
            let itemType: 'adversary' | 'environment' = 'adversary';

            if (params.adversary) {
                itemName = params.adversary;
                itemType = 'adversary';
                itemToRender = items.find(i => i.name.toLowerCase() === itemName?.toLowerCase() && i.category === 'adversary');
            } else if (params.environment) {
                itemName = params.environment;
                itemType = 'environment';
                itemToRender = items.find(i => i.name.toLowerCase() === itemName?.toLowerCase() && i.category === 'environment');
            }

            if (itemToRender) {
                renderStatblockCard(this, itemToRender, el, false);
            } else if (itemName) {
                el.createEl('div', { text: `Could not find ${itemType} "${itemName}" in compendium.` });
            } else {
                el.createEl('div', { text: 'Invalid embed. Use "adversary: [Name]" or "environment: [Name]".' });
            }
        } catch (e: any) {
            console.error('Daggerheart Embed: Error processing embed block.', e);
            const errorEl = el.createEl('pre', { cls: 'dh-statblock-error' });
            errorEl.setText(`Error rendering Daggerheart embed:\n${e.message}`);
        }
    }

    private async loadCharacters() {
        const path = `${this.manifest.dir}/user_data/characters.json`;
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const data = await this.app.vault.adapter.read(path);
                this.characters = JSON.parse(data);
                if (this.characters.length > 0 && !this.activeCharacterId) {
                    this.activeCharacterId = this.characters[0].id;
                }
            } catch (e) {
                console.error("Daggerheart: Error loading characters.json. It might be corrupted.", e);
                this.characters = [];
            }
        } else {
            this.characters = [];
        }
    }

    private async saveCharacters() {
        const path = `${this.manifest.dir}/user_data/characters.json`;
        await this.app.vault.adapter.write(path, JSON.stringify(this.characters, null, 2));
    }

    private async loadEncounters() {
        const path = `${this.manifest.dir}/user_data/encounters.json`;
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const data = await this.app.vault.adapter.read(path);
                this.encounters = JSON.parse(data);
            } catch (e) {
                console.error("Daggerheart: Error loading encounters.json. It might be corrupted.", e);
                this.encounters = [];
            }
        } else {
            this.encounters = [];
        }
    }

    private async saveEncounters() {
        const path = `${this.manifest.dir}/user_data/encounters.json`;
        await this.app.vault.adapter.write(path, JSON.stringify(this.encounters, null, 2));
    }

    public getCharacters(): Character[] { return this.characters; }
    public getCharacter(id: string): Character | undefined { return this.characters.find(c => c.id === id); }
    public getActiveCharacter(): Character | undefined {
        if (!this.activeCharacterId) return undefined;
        return this.characters.find(c => c.id === this.activeCharacterId);
    }
    public getActiveCharacterId(): string | null { return this.activeCharacterId; }

    public async updateDddiceParticipantName() {
        if (this.settings.diceProvider !== 'dddice' || !this.settings.dddice.apiKey || !this.settings.dddice.room) {
            return;
        }

        const activeCharacter = this.getActiveCharacter();
        const characterName = activeCharacter ? activeCharacter.name : 'Observer';

        await dddice.updateParticipantName(this.settings.dddice, characterName);
    }

    public async setActiveCharacterId(id: string | null) {
        this.activeCharacterId = id;
        this.settings.activeCharacterId = id;
        await this.saveSettings();
        this.app.workspace.trigger('daggerheart-character-update');
        await this.updateDddiceParticipantName();
    }

    public async updateCharacter(character: Character) {
        const index = this.characters.findIndex(c => c.id === character.id);
        if (index > -1) {
            this.characters[index] = character;
        } else {
            this.characters.push(character);
        }
        await this.saveCharacters();
        this.app.workspace.trigger('daggerheart-character-update');
        if (character.id === this.activeCharacterId) {
            await this.updateDddiceParticipantName();
        }
    }

    public async deleteCharacter(id: string) {
        this.characters = this.characters.filter(c => c.id !== id);
        if (this.activeCharacterId === id) {
            this.activeCharacterId = this.characters.length > 0 ? this.characters[0].id : null;
        }
        await this.saveCharacters();
        this.app.workspace.trigger('daggerheart-character-update');
    }

    getSavedEncounters(): SavedEncounter[] {
        return this.encounters;
    }

    getSavedEncounter(id: string): SavedEncounter | undefined {
        return this.encounters.find(e => e.id === id);
    }

    async updateSavedEncounter(encounter: SavedEncounter): Promise<void> {
        const index = this.encounters.findIndex(e => e.id === encounter.id);
        if (index >= 0) {
            this.encounters[index] = encounter;
        } else {
            this.encounters.push(encounter);
        }
        await this.saveEncounters();
        this.app.workspace.trigger('daggerheart-encounter-update');
    }

    async removeSavedEncounter(id: string): Promise<void> {
        this.encounters = this.encounters.filter(e => e.id !== id);
        await this.saveEncounters();
        this.app.workspace.trigger('daggerheart-encounter-update');
    }

    async activateEncounterBuilderView(encounterId?: string) {
        this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        await this.app.workspace.getRightLeaf(false)?.setViewState({
            type: ENCOUNTER_BUILDER_VIEW_TYPE,
            active: true,
            state: { currentEncounterId: encounterId }
        });
        const leaves = this.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    async activateCharacterSheetView() {
        this.app.workspace.detachLeavesOfType(CHARACTER_SHEET_VIEW_TYPE);
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: CHARACTER_SHEET_VIEW_TYPE,
                active: true,
            });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    private async ensureUserCompendiumFolderExists() {
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}`;
        if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.adapter.mkdir(path);
        }
    }

    public async triggerCompendiumUpdate() {
        await this.compendium.load();
        this.app.workspace.trigger('daggerheart-character-update');
        this.app.workspace.trigger('daggerheart-compendium-update');
    }

    public async saveCustomCompendiumData(fileName: string, dataToSave: any) {
        await this.ensureUserCompendiumFolderExists();
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}/${fileName}`;
        let compendium: any[] = [];
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const rawData = await this.app.vault.adapter.read(path);
                if (rawData.trim() !== '') {
                    compendium = JSON.parse(rawData);
                }
            } catch (e) {
                new Notice(`Error reading ${fileName}. Check console. Overwriting.`);
                compendium = [];
            }
        }

        dataToSave.isCustom = true;

        const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === dataToSave.name.toLowerCase());
        if (existingIndex > -1) {
            compendium[existingIndex] = dataToSave;
            new Notice(`Updated custom entry: ${dataToSave.name}`);
        } else {
            compendium.push(dataToSave);
            new Notice(`Saved new custom entry: ${dataToSave.name}`);
        }

        await this.app.vault.adapter.write(path, JSON.stringify(compendium, null, 2));
        await this.triggerCompendiumUpdate();
    }

    public async addCustomCompendiumItem(contentType: ContentType, data: AllCompendiumData) {
        let fileName: string | null = null;

        switch (contentType) {
            case ContentType.ADVERSARY:
            case ContentType.ENVIRONMENT:
                fileName = this.settings.userCompendiumFile;
                break;
            case ContentType.ABILITY:
                fileName = this.settings.userAbilitiesFile;
                break;
            case ContentType.CLASS:
                fileName = this.settings.userClassesFile;
                break;
            case ContentType.SUBCLASS:
                fileName = this.settings.userSubclassesFile;
                break;
            case ContentType.ANCESTRY:
                fileName = this.settings.userAncestriesFile;
                break;
            case ContentType.COMMUNITY:
                fileName = this.settings.userCommunitiesFile;
                break;
            case ContentType.ARMOR:
                fileName = this.settings.userArmorFile;
                break;
            case ContentType.WEAPON:
                fileName = this.settings.userWeaponsFile;
                break;
            case ContentType.ITEM:
                fileName = this.settings.userItemsFile;
                break;
            case ContentType.CONSUMABLE:
                fileName = this.settings.userConsumablesFile;
                break;
            default:
                new Notice(`Cannot import type "${contentType}" as it has no configured save location.`);
                console.error(`Unhandled content type in addCustomCompendiumItem: ${contentType}`);
                return;
        }

        if (fileName) {
            await this.saveCustomCompendiumData(fileName, data);
        }
    }

    public async renameCustomCompendiumEntry(fileName: string, oldName: string, newData: any) {
        await this.ensureUserCompendiumFolderExists();
        const path = `${this.manifest.dir}/${USER_COMPENDIUM_FOLDER}/${fileName}`;
        let compendium: any[] = [];
        if (await this.app.vault.adapter.exists(path)) {
            try {
                const rawData = await this.app.vault.adapter.read(path);
                if (rawData.trim() !== '') {
                    compendium = JSON.parse(rawData);
                }
            } catch (e) {
                new Notice(`Error reading ${fileName}. Cannot rename.`);
                return;
            }
        }

        newData.isCustom = true;

        const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === oldName.toLowerCase());

        if (existingIndex !== -1) {
            compendium[existingIndex] = newData;
            await this.app.vault.adapter.write(path, JSON.stringify(compendium, null, 2));
            new Notice(`Renamed "${oldName}" to "${newData.name}".`);
        } else {
            await this.saveCustomCompendiumData(fileName, newData);
        }

        await this.triggerCompendiumUpdate();
    }

    public createInteractiveTrack(parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string, currentValue: number, updateCallback: (newValue: number) => void) {
        createInteractiveTrack(parentEl, label, maxValue, trackIdPrefix, currentValue, updateCallback);
    }

    public async rollDice(diceString: string, context: string, traitName?: string): Promise<number | null> {
        const trimmedDiceString = diceString.trim().toLowerCase();
        const dualityKeywords = ['dr', 'duality'];

        const containsKeyword = dualityKeywords.some(kw => trimmedDiceString.includes(kw));
        const startsWithKeyword = dualityKeywords.some(kw => trimmedDiceString.startsWith(kw));

        if (containsKeyword && !startsWithKeyword) {
            new Notice("Duality rolls ('dr' or 'duality') must be at the start of the formula.", 5000);
            return null;
        }

        let resultPayload: RollCompletedPayload | null = null;
        let total: number | null = null;

        if (this.settings.diceProvider === 'dddice') {
            const dddiceResult = await dddice.rollWithDddice(this.settings.dddice, diceString, context, traitName);

            if (dddiceResult) {
                resultPayload = {
                    context: context,
                    result: dddiceResult.display,
                    total: dddiceResult.totalStr,
                    outcome: dddiceResult.outcome,
                    structuredResult: dddiceResult.structuredResult,
                };
                total = dddiceResult.total;
            }
        } else {
            if (!this.settings.enableDiceRoller || !this.isDiceRollerEnabled) {
                new Notice("Dice Roller integration is not enabled in plugin settings.");
                return null;
            }
            const diceRollerPlugin = (this.app as any).plugins.getPlugin("obsidian-dice-roller");
            if (!diceRollerPlugin || typeof diceRollerPlugin.api?.getRoller !== 'function') {
                new Notice("Dice Roller plugin API not available or plugin is disabled.", 4000);
                return null;
            }
            try {
                let isDaggerheartActionRoll = false;
                let rollerDiceString = diceString;

                for (const keyword of dualityKeywords) {
                    if (diceString.toLowerCase().startsWith(keyword)) {
                        isDaggerheartActionRoll = true;
                        const modifiers = diceString.substring(keyword.length);
                        rollerDiceString = `1d12+1d12${modifiers}`;
                        break;
                    }
                }

                if (!isDaggerheartActionRoll) {
                    // This is for generic rolls, expand dice pools.
                    rollerDiceString = expandDiceString(rollerDiceString);
                }

                const roller = await diceRollerPlugin.api.getRoller(rollerDiceString);
                await roller.roll({ showDice: this.settings.useGraphicalDice, throw: this.settings.useGraphicalDice });

                total = roller.result;

                const resultDisplay = roller.prettified ?? diceString;
                const totalStr = String(total);
                let outcome: string | undefined = undefined;
                const structuredResult: RollComponent[] = [];
                const rollerResults = (roller.results && Array.isArray(roller.results)) ? [...roller.results] : [];

                if (isDaggerheartActionRoll && rollerResults.length > 0) {
                    const d12s = rollerResults.filter((r: any) => r.type === 'die' && r.dice?.faces === 12);

                    if (d12s.length >= 2) {
                        const hopeDie = d12s[0];
                        const fearDie = d12s[1];
                        const hopeValue = hopeDie.result;
                        const fearValue = fearDie.result;

                        structuredResult.push({ value: hopeValue, label: 'Hope', type: 'hope' });
                        structuredResult.push({ value: fearValue, label: 'Fear', type: 'fear' });

                        outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Critical!");

                        // Remove processed d12s to avoid double counting
                        const hopeIndex = rollerResults.indexOf(hopeDie);
                        if (hopeIndex > -1) rollerResults.splice(hopeIndex, 1);

                        const fearIndex = rollerResults.indexOf(fearDie);
                        if (fearIndex > -1) rollerResults.splice(fearIndex, 1);
                    }

                    rollerResults.forEach((res: any) => {
                        if (res.type === 'die' && res.dice?.faces === 6) {
                            if (res.dice?.negative) {
                                structuredResult.push({ value: -res.result, label: 'Disadvantage', type: 'disadvantage' });
                            } else {
                                structuredResult.push({ value: res.result, label: 'Advantage', type: 'advantage' });
                            }
                        } else if (res.type === 'modifier') {
                            structuredResult.push({ value: res.modifier, label: traitName || 'Mod', type: 'modifier' });
                        } else if (res.type === 'die') {
                            const value = res.dice?.negative ? -res.result : res.result;
                            structuredResult.push({ value, label: `d${res.dice?.faces}`, type: 'die' });
                        }
                    });

                } else if (rollerResults.length > 0) {
                    rollerResults.forEach((res: any) => {
                        if (res.type === 'die') {
                            const value = res.dice?.negative ? -res.result : res.result;
                            structuredResult.push({ value, label: `d${res.dice?.faces}`, type: 'die' });
                        } else if (res.type === 'modifier') {
                            structuredResult.push({ value: res.modifier, label: 'Modifier', type: 'modifier' });
                        }
                    });
                }

                resultPayload = { context, result: resultDisplay, total: totalStr, outcome, structuredResult };

            } catch (e) {
                console.error("Daggerheart: Error rolling dice with Dice Roller:", e);
                new Notice(`Error rolling dice for "${diceString}".`);
                return null;
            }
        }

        if (resultPayload) {
            this.app.workspace.trigger('daggerheart-roll-completed', resultPayload);
        } else if (total === null) {
            new Notice(`Failed to roll: ${diceString}`);
        }

        return total;
    }


    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        const settingsToSave = Object.assign({}, this.settings);

        if (settingsToSave.dddice) {
            const { rooms, themes, ...dddiceToSave } = settingsToSave.dddice;
            settingsToSave.dddice = dddiceToSave;
        }

        await this.saveData(settingsToSave);

        if (this.settingsTab) {
            this.settingsTab.display();
        }
    }

    onunload() {
        dddice.destroyDddiceRenderer();
        if (this.settings.enableEncounterView) {
            this.app.workspace.detachLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE);
        }
        if (this.settings.enableCharacterSheet) {
            this.app.workspace.detachLeavesOfType(CHARACTER_SHEET_VIEW_TYPE);
        }
    }

    public initializeDddiceIfNeeded() {
        const { diceProvider, dddice: dddiceSettings } = this.settings;
        if (diceProvider === 'dddice' && dddiceSettings.apiKey && dddiceSettings.renderInObsidian && dddiceSettings.room) {
            dddice.initializeDddiceRenderer(dddiceSettings);
            this.updateDddiceParticipantName();
        }
    }
}

class DaggerheartSettingTab extends PluginSettingTab {
    plugin: DaggerheartStatblockPlugin;
    private isDddiceConnecting: boolean = false;
    private _isPreloading: boolean = false;

    public dddiceRoomsCacheTimestamp: number = 0;
    public dddiceThemesCacheTimestamp: number = 0;
    public readonly CACHE_TTL = 60 * 1000;

    private _dddiceDropdownsToRefresh: DropdownComponent[] = [];
    private _themeSelectorsToRefresh: string[] = [];
    private _dddiceObserverInterval: number | null = null;

    constructor(app: App, plugin: DaggerheartStatblockPlugin) {
        super(app, plugin);
        this.plugin = plugin;

        // Initialize UI refresh trackers
        this._dddiceDropdownsToRefresh = [];
        this._themeSelectorsToRefresh = [];
        this._dddiceObserverInterval = null;

        // Start the UI refresh observer
        this.startDddiceDataObserver();
    } public async preloadDddiceData(loadAllThemes: boolean = false): Promise<void> {
        if (!this.plugin.settings.dddice.apiKey) return;

        const now = Date.now();
        this._isPreloading = true;

        try {
            const dddiceApi = dddice.initializeDddiceApi(this.plugin.settings.dddice.apiKey);
            let dataUpdated = false;

            const selectedRoomSlug = this.plugin.settings.dddice.room;
            const roomCacheExpired = now - this.dddiceRoomsCacheTimestamp > this.CACHE_TTL;

            if (selectedRoomSlug) {
                if (!this.plugin.settings.dddice.rooms) {
                    this.plugin.settings.dddice.rooms = [];
                }

                // Fetch the selected room for immediate display
                const room = await dddice.fetchDddiceRoom(dddiceApi, selectedRoomSlug);

                if (room) {
                    // Update the room in the array if it exists, otherwise add it
                    const existingRoomIndex = this.plugin.settings.dddice.rooms.findIndex(r => r.slug === room.slug);

                    if (existingRoomIndex >= 0) {
                        this.plugin.settings.dddice.rooms[existingRoomIndex] = {
                            slug: room.slug,
                            name: room.name
                        };
                    } else {
                        this.plugin.settings.dddice.rooms.push({
                            slug: room.slug,
                            name: room.name
                        });
                    }

                    dataUpdated = true;
                }
            }

            if (!this.plugin.settings.dddice.rooms || this.plugin.settings.dddice.rooms.length <= 1 || roomCacheExpired) {
                const allRooms = await dddice.fetchDddiceRooms(dddiceApi);

                if (allRooms && allRooms.length > 0) {
                    // Create a map of existing rooms by slug for quick lookup
                    const existingRoomsMap = new Map(
                        this.plugin.settings.dddice.rooms?.map(r => [r.slug, r]) || []
                    );

                    // Create a new array with all unique rooms
                    const updatedRooms = allRooms.map(room => ({
                        slug: room.slug,
                        name: room.name
                    }));

                    // Remove any duplicates by using a Map
                    const uniqueRooms = Array.from(
                        new Map(updatedRooms.map(r => [r.slug, r])).values()
                    );

                    this.plugin.settings.dddice.rooms = uniqueRooms;
                    this.dddiceRoomsCacheTimestamp = now;
                    dataUpdated = true;
                }
            }

            // For themes, we'll only check if we need to reload selected themes
            // unless loadAllThemes is true
            const selectedThemeIds = [
                this.plugin.settings.dddice.theme,
                this.plugin.settings.dddice.hopeTheme,
                this.plugin.settings.dddice.fearTheme
            ].filter(id => id);

            // Initialize themes array if it doesn't exist
            if (!this.plugin.settings.dddice.themes) {
                this.plugin.settings.dddice.themes = [];
            }

            const existingThemes = this.plugin.settings.dddice.themes || [];
            const missingThemeIds = selectedThemeIds.filter(id =>
                !existingThemes.some(theme => theme?.id === id)
            );

            const needsSelectedThemesReload = missingThemeIds.length > 0;
            const needsAllThemesReload = loadAllThemes &&
                (existingThemes.length === 0 || (now - this.dddiceThemesCacheTimestamp > this.CACHE_TTL));

            const needsThemesReload = needsSelectedThemesReload || needsAllThemesReload;

            if (needsThemesReload) {
                if (needsAllThemesReload) {
                    const themes = await dddice.fetchDddiceThemes(dddiceApi);
                    this.plugin.settings.dddice.themes = themes;
                    this.dddiceThemesCacheTimestamp = now;
                    dataUpdated = true;
                } else if (needsSelectedThemesReload) {
                    const fetchedThemes = await Promise.all(
                        missingThemeIds.map(async (themeId) => {
                            if (themeId) {
                                return await dddice.fetchDddiceTheme(dddiceApi, themeId);
                            }
                            return null;
                        })
                    );

                    const validThemes = fetchedThemes.filter((theme: ITheme | null): theme is ITheme => theme !== null);

                    if (validThemes.length > 0) {
                        const themesMap = new Map(
                            existingThemes.map((theme: ITheme) => [theme.id, theme])
                        );

                        validThemes.forEach((theme: ITheme) => {
                            themesMap.set(theme.id, theme);
                        });

                        this.plugin.settings.dddice.themes = Array.from(themesMap.values());
                        dataUpdated = true;
                    }
                }
            }

            if (dataUpdated) {
                this.display();
            }
        } catch (e) {
            console.error("Error preloading dddice data:", e);
        } finally {
            this._isPreloading = false;
        }
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        let startingPreload = false;

        if (this.plugin.settings.diceProvider === 'dddice' && !this._isPreloading) {
            this._isPreloading = true;
            startingPreload = true;
        }

        containerEl.createEl('h2', { text: 'Daggerheart Settings' });

        // Feature Toggle Settings
        containerEl.createEl('h3', { text: 'Feature Settings' });

        new Setting(containerEl)
            .setName('Enable Encounter View')
            .setDesc('Enable or disable the Encounter Builder view. Changes will take effect after restarting Obsidian.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableEncounterView)
                .onChange(async (value) => {
                    this.plugin.settings.enableEncounterView = value;
                    await this.plugin.saveSettings();
                    new Notice('Encounter View setting changed. Please reload Obsidian for the change to take effect.');
                    await promptReload();
                }));

        const promptReload = async () => {
            const shouldReload = await new Promise(resolve => {
                const notice = new Notice('Would you like to reload Obsidian now?', 0);
                notice.noticeEl.createEl('button', {
                    text: 'Yes',
                    cls: 'mod-cta'
                }).onclick = () => {
                    notice.hide();
                    resolve(true);
                };
                notice.noticeEl.createEl('button', {
                    text: 'No'
                }).onclick = () => {
                    notice.hide();
                    resolve(false);
                };
            });
            if (shouldReload) {
                window.location.reload();
            }
        };

        new Setting(containerEl)
            .setName('Enable Character Sheet')
            .setDesc('Enable or disable the Character Sheet view. Changes will take effect after restarting Obsidian.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCharacterSheet)
                .onChange(async (value) => {
                    this.plugin.settings.enableCharacterSheet = value;
                    await this.plugin.saveSettings();
                    new Notice('Character Sheet setting changed. Please reload Obsidian for the change to take effect.');
                    await promptReload();
                }));

        this.renderCompendiumSettings(containerEl);
        this.renderEncounterViewSettings(containerEl);
        this.renderIntegrationSettings(containerEl);

        // Start preload after the UI is built if needed
        if (startingPreload) {
            setTimeout(() => {
                this.preloadDddiceData(false).catch(error => {
                    console.error("Error during dddice data preload:", error);
                }).finally(() => {
                    this._isPreloading = false;
                });
            }, 0);
        }
    }

    renderCompendiumSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Compendium Settings' });
        new Setting(containerEl)
            .setName('Compendium Folder')
            .setDesc('Path to the folder containing your Daggerheart statblock Markdown files (e.g., "System/Daggerheart/Adversaries"). Leave empty to disable user compendium from markdown.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Example: Path/To/Adversaries')
                    .setValue(this.plugin.settings.compendiumFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.compendiumFolder = value.trim();
                        await this.plugin.saveSettings();
                        this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                    });
            });

        new Setting(containerEl)
            .setName('Use SRD Adversaries')
            .setDesc(`Include the Daggerheart SRD adversaries from the plugin's "adversaries.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdAdversaries)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdAdversaries = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));

        new Setting(containerEl)
            .setName('Use SRD Environments')
            .setDesc(`Include the Daggerheart SRD environments from the plugin's "environments.json" file.`)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSrdEnvironments)
                .onChange(async (value) => {
                    this.plugin.settings.useSrdEnvironments = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));
    }

    renderEncounterViewSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Encounter View Settings' });
        new Setting(containerEl)
            .setName('Show Description on Instance Cards')
            .setDesc('If enabled, the full description will be shown on adversary cards in the encounter builder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDescriptionOnCards)
                .onChange(async (value) => {
                    this.plugin.settings.showDescriptionOnCards = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.trigger('daggerheart-compendium-update');
                }));
    }

    renderIntegrationSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Integrations' });

        new Setting(containerEl)
            .setName('Dice Provider')
            .setDesc('Choose which service to use for rolling dice.')
            .addDropdown(dropdown => dropdown
                .addOption('dice-roller', 'Obsidian Dice Roller')
                .addOption('dddice', 'dddice.com')
                .setValue(this.plugin.settings.diceProvider)
                .onChange(async (value: 'dice-roller' | 'dddice') => {
                    this.plugin.settings.diceProvider = value;
                    await this.plugin.saveSettings();
                    this.display(); // Re-render settings
                }));

        if (this.plugin.settings.diceProvider === 'dddice') {
            this.renderDddiceSettings(containerEl);
        } else {
            this.renderDiceRollerSettings(containerEl);
        }
    }

    renderDiceRollerSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Enable Dice Roller Integration')
            .setDesc('Enable integration with the Dice Roller plugin for rolling dice in statblocks.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDiceRoller)
                .onChange(async (value) => {
                    this.plugin.settings.enableDiceRoller = value;
                    await this.plugin.saveSettings();
                    this.plugin.isDiceRollerEnabled = value && (this.app as any).plugins.getPlugin("obsidian-dice-roller")?.api != null;
                    if (value && !this.plugin.isDiceRollerEnabled) {
                        new Notice('Dice Roller plugin not found or is disabled. Please install and enable it.');
                    }
                    this.display();
                }));

        if (this.plugin.settings.enableDiceRoller) {
            const isPluginAvailable = this.plugin.isDiceRollerEnabled;
            new Setting(containerEl)
                .setName('Use Graphical Dice')
                .setDesc('If enabled, dice rolls will use graphical 3D dice (requires Dice Roller plugin).')
                .addToggle(toggle => {
                    toggle
                        .setValue(isPluginAvailable && this.plugin.settings.useGraphicalDice)
                        .setDisabled(!isPluginAvailable)
                        .onChange(async (value) => {
                            this.plugin.settings.useGraphicalDice = value;
                            await this.plugin.saveSettings();
                        });
                })
                .then(setting => {
                    if (setting.controlEl.parentElement && !isPluginAvailable) {
                        setting.controlEl.parentElement.addClass('setting-disabled');
                    }
                });
        }
    }

    renderDddiceSettings(containerEl: HTMLElement) {
        const apiKeyDesc = createFragment((frag) => {
            frag.createEl('p', { text: 'Connect to dddice to roll 3D dice and share with friends.' });
        });

        const connectSection = containerEl.createEl('div', { cls: 'dddice-connect-section' });

        new Setting(connectSection)
            .setName('Connect to dddice')
            .setDesc(apiKeyDesc)
            .addButton(button => button
                .setButtonText('Activate with dddice.com')
                .setCta()
                .onClick(() => {
                    new DddiceActivationModal(this.plugin).open();
                }));

        const isConnected = this.plugin.settings.dddice.apiKey;
        if (isConnected) {
            new Setting(containerEl)
                .setName('Render dice in Obsidian')
                .setDesc('If enabled, 3D dice will be rendered over the Obsidian window.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.dddice.renderInObsidian)
                    .onChange(async (value) => {
                        this.plugin.settings.dddice.renderInObsidian = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('dddice Room')
                .setDesc('Select the room to send dice rolls to.')
                .addDropdown(dropdown => {
                    const hasRooms = this.plugin.settings.dddice.rooms && this.plugin.settings.dddice.rooms.length > 0;
                    const isLoading = !hasRooms;

                    dropdown.addOption('', isLoading ? 'Loading rooms...' : 'Select a room...');

                    if (hasRooms) {
                        dropdown.selectEl.options.length = 1;

                        const availableRooms = this.plugin.settings.dddice.rooms || [];
                        availableRooms.forEach(room =>
                            dropdown.addOption(room.slug, room.name));

                        dropdown.setValue(this.plugin.settings.dddice.room || '');
                    }

                    // Add this dropdown to the refresh list
                    if (!hasRooms || (this.plugin.settings.dddice.room &&
                        !this.plugin.settings.dddice.rooms?.some(r => r.slug === this.plugin.settings.dddice.room))) {
                        this._dddiceDropdownsToRefresh.push(dropdown);
                    }

                    // Load rooms when the dropdown is clicked if not already loaded or if cache is expired
                    let isLoadingRooms = false;

                    dropdown.selectEl.addEventListener('mousedown', async (e) => {
                        // Check if we need to load or reload the rooms
                        const now = Date.now();
                        const needsReload =
                            !this.plugin.settings.dddice.rooms ||
                            this.plugin.settings.dddice.rooms.length === 0 ||
                            (now - this.dddiceRoomsCacheTimestamp > this.CACHE_TTL);

                        if (needsReload) {
                            if (isLoadingRooms) return;

                            e.preventDefault();
                            e.stopPropagation();
                            isLoadingRooms = true;

                            // Show loading option
                            dropdown.selectEl.options.length = 0;
                            dropdown.addOption('', 'Loading rooms...');

                            try {
                                const dddiceApi = dddice.initializeDddiceApi(this.plugin.settings.dddice.apiKey);

                                if (this.plugin.settings.dddice.room) {
                                    const room = await dddice.fetchDddiceRoom(dddiceApi, this.plugin.settings.dddice.room);

                                    if (room) {
                                        if (!this.plugin.settings.dddice.rooms) {
                                            this.plugin.settings.dddice.rooms = [];
                                        }

                                        this.plugin.settings.dddice.rooms = this.plugin.settings.dddice.rooms
                                            .filter(r => r.slug !== room.slug);

                                        this.plugin.settings.dddice.rooms.push({
                                            slug: room.slug,
                                            name: room.name
                                        });
                                    }
                                }

                                // Then fetch all rooms to populate the dropdown
                                const rooms = await dddice.fetchDddiceRooms(dddiceApi);

                                // Cache the rooms temporarily and update the timestamp
                                this.plugin.settings.dddice.rooms = rooms.map(r => ({ slug: r.slug, name: r.name }));
                                this.dddiceRoomsCacheTimestamp = now;

                                // Rebuild dropdown options
                                dropdown.selectEl.options.length = 0;
                                dropdown.addOption('', 'Select a room...');
                                this.plugin.settings.dddice.rooms.forEach(room =>
                                    dropdown.addOption(room.slug, room.name));

                                // Set the current value
                                dropdown.setValue(this.plugin.settings.dddice.room || '');

                                // Simulate a click to open the dropdown now that it's loaded
                                dropdown.selectEl.click();
                            } catch (e) {
                                console.error("Failed to load dddice rooms:", e);
                                dropdown.selectEl.options.length = 0;
                                dropdown.addOption('', 'Failed to load rooms');
                                new Notice("Failed to load dddice rooms.");
                            } finally {
                                isLoadingRooms = false;
                            }
                        }
                    });

                    dropdown.setValue(this.plugin.settings.dddice.room || '')
                        .onChange(async (value) => {
                            this.plugin.settings.dddice.room = value;
                            await this.plugin.saveSettings();
                        });
                });

            this.renderThemeSelector(containerEl, 'Default Theme', 'theme');
            this.renderThemeSelector(containerEl, 'Hope Die Theme', 'hopeTheme');
            this.renderThemeSelector(containerEl, 'Fear Die Theme', 'fearTheme');
        }
    }

    renderThemeSelector(containerEl: HTMLElement, title: string, settingKey: 'theme' | 'hopeTheme' | 'fearTheme') {
        const setting = new Setting(containerEl).setName(title);

        const themeContainer = setting.controlEl.createDiv({ cls: 'dh-theme-selector-container' });

        // Get the currently selected theme ID
        const selectedThemeId = this.plugin.settings.dddice[settingKey];

        // Create a card that will show the selected theme or a placeholder
        const card = themeContainer.createDiv({ cls: 'dh-theme-card is-selected-card' });

        // Make the card clickable to open the theme selection modal
        card.addClass('clickable');
        card.addEventListener('click', () => {
            // Open the modal immediately - it will handle lazy loading
            new ThemeSelectionModal(this.app, this.plugin, settingKey, (themeId) => {
                this.plugin.settings.dddice[settingKey] = themeId;
                this.plugin.saveSettings();
                this.display();
            }).open();
        });

        // If we have themes loaded and a theme is selected, show it
        const themes = this.plugin.settings.dddice.themes || [];
        let selectedTheme = themes.find(t => t?.id === selectedThemeId);

        if (selectedTheme) {
            const previewUrl = getThemePreviewUrl(selectedTheme);
            if (previewUrl) {
                // Create a loading placeholder first
                const loadingPlaceholder = card.createDiv({ cls: 'dh-theme-loading-placeholder' });
                loadingPlaceholder.setText('Loading...');

                // Then create the image
                const img = card.createEl('img', {
                    attr: { src: previewUrl, alt: selectedTheme.name || 'Theme preview' },
                    cls: 'dh-theme-preview'
                });

                // Remove placeholder when image loads
                img.onload = () => {
                    loadingPlaceholder.remove();
                };

                // Show "No image" if there's an error
                img.onerror = () => {
                    loadingPlaceholder.setText('No image');
                };
            } else {
                card.createDiv({ text: 'No Preview', cls: 'dh-theme-loading-placeholder' });
            }
            card.createDiv({ text: selectedTheme.name, cls: 'dh-theme-name' });
        } else if (selectedThemeId) {
            // If we have a theme ID but no theme loaded yet, show a loading state
            card.createDiv({ text: 'Loading theme...', cls: 'dh-theme-loading-placeholder' });
            card.createDiv({ text: 'Loading...', cls: 'dh-theme-name' });

            // Add this theme to the refresh list
            if (!this._themeSelectorsToRefresh.includes(settingKey)) {
                this._themeSelectorsToRefresh.push(settingKey);
            }

            // Try to load just the selected themes if needed
            if (this.plugin.settingsTab) {
                // Trigger theme loading in the background - only for selected themes
                this.plugin.settingsTab.preloadDddiceData(false);
            }
        } else {
            card.createDiv({ text: 'Select a theme', cls: 'dh-theme-loading-placeholder' });
            card.createDiv({ text: 'No theme selected', cls: 'dh-theme-name' });
        }        // Refresh after a short delay if the theme is loading
        if (selectedThemeId && !selectedTheme) {
            // The theme is already being tracked for refresh via the _themeSelectorsToRefresh array
            // We'll rely on the observer to update the UI when data is available

            // Also check if themes have been loaded since we started rendering
            const newThemes = this.plugin.settings.dddice.themes || [];
            const refreshedTheme = newThemes.find(t => t?.id === selectedThemeId);

            if (refreshedTheme) {
                // Clear the card and update it with the loaded theme
                card.empty();
                const previewUrl = getThemePreviewUrl(refreshedTheme);
                if (previewUrl) {
                    // Create a loading placeholder first
                    const loadingPlaceholder = card.createDiv({ cls: 'dh-theme-loading-placeholder' });
                    loadingPlaceholder.setText('Loading...');

                    // Then create the image
                    const img = card.createEl('img', {
                        attr: { src: previewUrl, alt: refreshedTheme.name || 'Theme preview' },
                        cls: 'dh-theme-preview'
                    });

                    // Remove placeholder when image loads
                    img.onload = () => {
                        loadingPlaceholder.remove();
                    };

                    // Show "No image" if there's an error
                    img.onerror = () => {
                        loadingPlaceholder.setText('No image');
                    };
                } else {
                    card.createDiv({ text: 'No Preview', cls: 'dh-theme-loading-placeholder' });
                }
                card.createDiv({ text: refreshedTheme.name, cls: 'dh-theme-name' });
            }
        }
    }

    private refreshDddiceRoomDropdown(dropdown: DropdownComponent) {
        if (!this.plugin.settings.dddice.rooms || this.plugin.settings.dddice.rooms.length === 0) {
            // If no rooms are available, show loading state
            dropdown.selectEl.options.length = 0;
            dropdown.addOption('', 'Loading rooms...');
            return;
        }

        // Clear existing options
        dropdown.selectEl.options.length = 0;
        dropdown.addOption('', 'Select a room...');

        // Add available rooms
        this.plugin.settings.dddice.rooms.forEach(room =>
            dropdown.addOption(room.slug, room.name));

        // Set current value
        dropdown.setValue(this.plugin.settings.dddice.room || '');
    }

    private startDddiceDataObserver() {
        if (this._dddiceObserverInterval) {
            clearInterval(this._dddiceObserverInterval);
        }

        this._dddiceObserverInterval = window.setInterval(() => {
            if (this._dddiceDropdownsToRefresh.length > 0) {
                const dropdowns = [...this._dddiceDropdownsToRefresh];
                this._dddiceDropdownsToRefresh = [];

                dropdowns.forEach(dropdown => {
                    this.refreshDddiceRoomDropdown(dropdown);
                });
            }

            if (this._themeSelectorsToRefresh.length > 0) {
                this._themeSelectorsToRefresh = [];
                if (!this._isPreloading) {
                    this.display();
                }
            }
        }, 200);
    }

    hide(): void {
        if (this._dddiceObserverInterval) {
            clearInterval(this._dddiceObserverInterval);
            this._dddiceObserverInterval = null;
        }

        // Clear any pending refreshes
        this._dddiceDropdownsToRefresh = [];
        this._themeSelectorsToRefresh = [];

        super.hide();
    }
}

class ThemeSelectionModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    settingKey: 'theme' | 'hopeTheme' | 'fearTheme';
    onSelect: (themeId: string) => void;
    private themeGrid: HTMLElement;
    private loadMoreButton: HTMLElement | null = null;
    private isLoadingMore: boolean = false;
    private dddiceApi: any;
    private currentPage: number = 1;
    private hasMorePages: boolean = true;
    private loadingEl: HTMLElement | null = null;
    private bottomLoadingEl: HTMLElement | null = null;
    private autoLoadTimeout: number | null = null;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, settingKey: 'theme' | 'hopeTheme' | 'fearTheme', onSelect: (themeId: string) => void) {
        super(app);
        this.plugin = plugin;
        this.settingKey = settingKey;
        this.onSelect = onSelect;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-theme-modal');
        contentEl.createEl('h2', { text: `Select ${this.settingKey.replace('Theme', '')} Theme` });

        this.themeGrid = contentEl.createDiv({ cls: 'dh-theme-grid' });

        // Add the bottom loading indicator right away
        this.addBottomLoadingIndicator();

        try {
            // Initialize the dddice API - do this immediately
            this.dddiceApi = dddice.initializeDddiceApi(this.plugin.settings.dddice.apiKey);

            // Check if we already have the currently selected theme loaded
            const selectedThemeId = this.plugin.settings.dddice[this.settingKey];
            let existingThemes = this.plugin.settings.dddice.themes || [];

            // Display any existing themes immediately while we load more
            if (existingThemes.length > 0) {
                this.displayThemes(existingThemes);
            }

            const selectedTheme = selectedThemeId ? existingThemes.find(t => t?.id === selectedThemeId) : undefined;

            // If the selected theme isn't loaded yet, fetch it first
            if (selectedThemeId && !selectedTheme) {
                const theme = await dddice.fetchDddiceTheme(this.dddiceApi, selectedThemeId);
                if (theme) {
                    // Make sure we don't have duplicates
                    existingThemes = existingThemes.filter(t => t?.id !== theme.id);
                    existingThemes.push(theme);
                    this.plugin.settings.dddice.themes = existingThemes;

                    // Display the selected theme
                    this.displayThemes([theme]);
                }
            }

            // Load the first page of themes
            const { themes, hasMore } = await dddice.fetchDddiceThemesPage(this.dddiceApi, true);
            this.hasMorePages = hasMore;

            // Merge new themes with existing themes, avoiding duplicates
            const mergedThemes = [...existingThemes];
            const newThemes = [];
            for (const theme of themes) {
                if (!mergedThemes.some(t => t?.id === theme.id)) {
                    mergedThemes.push(theme);
                    newThemes.push(theme);
                }
            }

            this.plugin.settings.dddice.themes = mergedThemes;

            // Display only the newly loaded themes (existing ones were already displayed)
            if (newThemes.length > 0) {
                this.displayThemes(newThemes);
            }

            // If no themes were found, show a message
            if (mergedThemes.length === 0) {
                this.themeGrid.createEl('p', { text: 'No themes found. Please connect to dddice first.' });
                this.removeBottomLoadingIndicator();
            } else if (this.hasMorePages) {
                // Schedule the next automatic load if we have more pages
                this.scheduleNextLoad();
            } else {
                // Remove the loading indicator if there are no more pages
                this.removeBottomLoadingIndicator();
            }
        } catch (e) {
            console.error("Failed to load themes in modal:", e);
            if (this.bottomLoadingEl) {
                this.bottomLoadingEl.setText('Failed to load themes. Please try again.');
            } else {
                this.themeGrid.createEl('p', { text: 'Failed to load themes. Please try again.', cls: 'theme-loading-indicator' });
            }
        }
    }

    displayThemes(themes: any[]) {
        if (!themes || themes.length === 0) {
            return;
        }

        themes.forEach(theme => {
            // Skip if this theme is already displayed
            if (this.themeGrid.querySelector(`[data-theme-id="${theme.id}"]`)) {
                return;
            }

            const card = this.themeGrid.createDiv({
                cls: 'dh-theme-card',
                attr: { 'data-theme-id': theme.id }
            });

            if (this.plugin.settings.dddice[this.settingKey] === theme.id) {
                card.addClass('is-selected');
            }

            const previewUrl = getThemePreviewUrl(theme);
            if (previewUrl) {
                const img = card.createEl('img', {
                    attr: { alt: theme.name || 'Theme preview' },
                    cls: 'dh-theme-preview'
                });

                // Add loading state and handle loading
                const loadingPlaceholder = card.createDiv({ cls: 'dh-theme-loading-placeholder' });
                loadingPlaceholder.setText('Loading...');

                img.onload = () => {
                    loadingPlaceholder.remove();
                };

                img.onerror = () => {
                    loadingPlaceholder.setText('No image');
                };

                // Set the src after adding the event handlers to ensure they fire
                img.src = previewUrl;
            } else {
                card.createDiv({ text: 'No Preview', cls: 'dh-theme-name' });
            }

            card.createDiv({ text: theme.name, cls: 'dh-theme-name' });

            card.onClickEvent(() => {
                // Highlight the selected card
                this.themeGrid.querySelectorAll('.dh-theme-card').forEach(el => {
                    el.removeClass('is-selected');
                });
                card.addClass('is-selected');

                this.onSelect(theme.id);

                // Update the parent UI immediately if possible
                if (this.plugin.settingsTab) {
                    this.plugin.settingsTab.display();
                }

                this.close();
            });
        });
    }

    addLoadMoreButton() {
        if (this.loadMoreButton) {
            this.loadMoreButton.remove();
        }

        this.loadMoreButton = this.contentEl.createEl('button', {
            text: 'Load More Themes',
            cls: 'load-more-button'
        });

        this.loadMoreButton.addEventListener('click', async () => {
            if (this.isLoadingMore) return;

            this.isLoadingMore = true;
            this.loadMoreButton!.setText('Loading...');
            this.loadMoreButton!.setAttr('disabled', 'true');

            try {
                const { themes, hasMore } = await dddice.fetchDddiceThemesPage(this.dddiceApi, false);
                this.hasMorePages = hasMore;

                // Update the existing themes
                const existingThemes = this.plugin.settings.dddice.themes || [];
                const mergedThemes = [...existingThemes];
                const newThemes = [];

                for (const theme of themes) {
                    if (!mergedThemes.some(t => t?.id === theme.id)) {
                        mergedThemes.push(theme);
                        newThemes.push(theme);
                    }
                }

                this.plugin.settings.dddice.themes = mergedThemes;

                // Display only the new themes
                this.displayThemes(newThemes);

                if (this.hasMorePages) {
                    this.loadMoreButton!.setText('Load More Themes');
                    this.loadMoreButton!.removeAttribute('disabled');
                } else {
                    this.loadMoreButton!.remove();
                    this.loadMoreButton = null;
                }
            } catch (e) {
                console.error("Failed to load more themes:", e);
                this.loadMoreButton!.setText('Failed to Load More - Try Again');
                this.loadMoreButton!.removeAttribute('disabled');
            } finally {
                this.isLoadingMore = false;
            }
        });
    }

    // Add a loading indicator at the bottom of the theme grid
    addBottomLoadingIndicator() {
        if (this.bottomLoadingEl) {
            this.bottomLoadingEl.remove();
        }

        this.bottomLoadingEl = this.contentEl.createEl('p', {
            text: 'Loading more themes...',
            cls: 'theme-loading-indicator bottom-loading-indicator'
        });
    }

    // Remove the bottom loading indicator
    removeBottomLoadingIndicator() {
        if (this.bottomLoadingEl) {
            this.bottomLoadingEl.remove();
            this.bottomLoadingEl = null;
        }
    }

    // Schedule the next automatic load
    scheduleNextLoad() {
        if (this.autoLoadTimeout) {
            window.clearTimeout(this.autoLoadTimeout);
        }

        this.autoLoadTimeout = window.setTimeout(() => {
            this.loadNextPage();
        }, 500); // Small delay to allow rendering
    }

    // Load the next page of themes
    async loadNextPage() {
        if (this.isLoadingMore || !this.hasMorePages) return;

        this.isLoadingMore = true;

        try {
            if (this.bottomLoadingEl) {
                this.bottomLoadingEl.setText('Loading more themes...');
            } else {
                this.addBottomLoadingIndicator();
            }

            const { themes, hasMore } = await dddice.fetchDddiceThemesPage(this.dddiceApi, false);
            this.hasMorePages = hasMore;

            // Update the existing themes
            const existingThemes = this.plugin.settings.dddice.themes || [];
            const mergedThemes = [...existingThemes];
            const newThemes = [];

            for (const theme of themes) {
                if (!mergedThemes.some(t => t?.id === theme.id)) {
                    mergedThemes.push(theme);
                    newThemes.push(theme);
                }
            }

            this.plugin.settings.dddice.themes = mergedThemes;

            this.displayThemes(newThemes);

            if (this.hasMorePages) {
                this.scheduleNextLoad();
            } else {
                this.removeBottomLoadingIndicator();
            }
        } catch (e) {
            console.error("Failed to load more themes:", e);
            if (this.bottomLoadingEl) {
                this.bottomLoadingEl.setText('Failed to load more themes. Retrying...');
                // Try again after a delay
                this.scheduleNextLoad();
            }
        } finally {
            this.isLoadingMore = false;
        }
    }

    onClose() {
        // Clean up any pending timeouts
        if (this.autoLoadTimeout) {
            window.clearTimeout(this.autoLoadTimeout);
            this.autoLoadTimeout = null;
        }

        let { contentEl } = this;
        contentEl.empty();
    }
}