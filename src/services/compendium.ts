import { TFile, TFolder, Notice } from 'obsidian';
import * as YAML from 'js-yaml';
import {
    StatblockData,
    JsonAncestry,
    JsonClass,
    JsonCommunity,
    JsonSubclass,
    JsonArmor,
    JsonWeapon,
    JsonItem,
    JsonAbility,
    JsonConsumable,
    CompendiumItem,
    DomainCard,
    GenericItem,
    ArmorItem,
    WeaponItem,
    ConsumableItem,
    InventoryItem,
    Beastform,
    Stances
} from '../types';
import DaggerheartStatblockPlugin from '../main';
import { v4 as uuidv4 } from 'uuid';
import { CalculatedStat } from './calculated-stat';

const DATA_PATH = "data";
const USER_DATA_PATH = "user_data";

export class DaggerheartCompendium {
    private plugin: DaggerheartStatblockPlugin;

    public ancestries: JsonAncestry[] = [];
    public communities: JsonCommunity[] = [];
    public classes: JsonClass[] = [];
    public subclasses: JsonSubclass[] = [];
    public abilities: JsonAbility[] = [];
    public armors: CompendiumItem[] = [];
    public weapons: CompendiumItem[] = [];
    public items: CompendiumItem[] = [];
    public consumables: CompendiumItem[] = [];
    public statblocks: StatblockData[] = [];
    public beastforms: Beastform[] = [];
    public stances: Stances[] = [];

    constructor(plugin: DaggerheartStatblockPlugin) {
        this.plugin = plugin;
    }

    async load() {
        console.log("Daggerheart | Loading all compendiums...");

        const srdAncestries = await this.loadSrdFile<JsonAncestry>('ancestries.json');
        const srdCommunities = await this.loadSrdFile<JsonCommunity>('communities.json');
        const srdClasses = await this.loadSrdFile<JsonClass>('classes.json');
        const srdSubclasses = await this.loadSrdFile<JsonSubclass>('subclasses.json');
        const srdAbilities = await this.loadSrdFile<JsonAbility>('abilities.json');
        const srdBeastforms = await this.loadSrdFile<Beastform>('beastforms.json');
        const srdStances = await this.loadSrdFile<Stances>('stances.json');

        // Use settings to load user files
        const userAncestries = await this.loadUserFile<JsonAncestry>(this.plugin.settings.userAncestriesFile);
        const userClasses = await this.loadUserFile<JsonClass>(this.plugin.settings.userClassesFile);
        const userSubclasses = await this.loadUserFile<JsonSubclass>(this.plugin.settings.userSubclassesFile);
        const userAbilities = await this.loadUserFile<JsonAbility>(this.plugin.settings.userAbilitiesFile);
        const userCommunities = await this.loadUserFile<JsonCommunity>(this.plugin.settings.userCommunitiesFile);

        this.ancestries = this.mergeData(srdAncestries, userAncestries);
        this.communities = this.mergeData(srdCommunities, userCommunities);
        this.classes = this.mergeData(srdClasses, userClasses);
        this.subclasses = this.mergeData(srdSubclasses, userSubclasses);
        this.abilities = this.mergeData(srdAbilities, userAbilities);
        this.beastforms = srdBeastforms;
        this.stances = srdStances;

        this.armors = this.mergeData(
            (await this.loadSrdFile<JsonArmor>('armor.json')).map(a => ({ ...a, _type: 'armor' })),
            (await this.loadUserFile<ArmorItem>(this.plugin.settings.userArmorFile))
        );
        this.weapons = this.mergeData(
            (await this.loadSrdFile<JsonWeapon>('weapons.json')).map(w => ({ ...w, _type: 'weapon' })),
            (await this.loadUserFile<WeaponItem>(this.plugin.settings.userWeaponsFile))
        );
        this.items = this.mergeData(
            (await this.loadSrdFile<JsonItem>('items.json')).map(i => ({ ...i, _type: 'item' })),
            (await this.loadUserFile<GenericItem>(this.plugin.settings.userItemsFile))
        );
        this.consumables = this.mergeData(
            (await this.loadSrdFile<JsonConsumable>('consumables.json')).map(c => ({ ...c, _type: 'consumable' })),
            (await this.loadUserFile<ConsumableItem>(this.plugin.settings.userConsumablesFile))
        );

        const itemsMap = new Map<string, StatblockData>();
        if (this.plugin.settings.useSrdAdversaries) {
            const srdAdversaries = await this.loadSrdFile<any>('adversaries.json');
            srdAdversaries.forEach(raw => this.parseAndAddStatblock(raw, 'adversary', itemsMap));
        }
        if (this.plugin.settings.useSrdEnvironments) {
            const srdEnvironments = await this.loadSrdFile<any>('environments.json');
            srdEnvironments.forEach(raw => this.parseAndAddStatblock(raw, 'environment', itemsMap));
        }
        // Load user statblocks from the generic compendium file
        const userStatblocks = await this.loadUserFile<StatblockData>(this.plugin.settings.userCompendiumFile);
        userStatblocks.forEach(item => itemsMap.set(item.name.toLowerCase(), item));

        const mdAdversaries = await this.loadMarkdownStatblocks();
        mdAdversaries.forEach(item => itemsMap.set(item.name.toLowerCase(), item));
        this.statblocks = Array.from(itemsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        console.log(`Daggerheart | Compendium load finished. Total statblocks: ${this.statblocks.length}`);
    }

    private mergeData<T extends { name: string }>(srdData: T[], userData: T[]): T[] {
        const map = new Map<string, T>();
        srdData.forEach(item => map.set(item.name.toLowerCase(), item));
        userData.forEach(item => map.set(item.name.toLowerCase(), item));
        return Array.from(map.values());
    }

    private async loadUserFile<T extends { isCustom?: boolean }>(fileName: string): Promise<T[]> {
        if (!fileName) return [];
        const path = `${this.plugin.manifest.dir}/${USER_DATA_PATH}/${fileName}`;
        if (await this.plugin.app.vault.adapter.exists(path)) {
            try {
                let data = await this.plugin.app.vault.adapter.read(path);
                if (data.trim() === '') return [];
                if (data.charCodeAt(0) === 0xFEFF) {
                    data = data.slice(1);
                }

                const items = JSON.parse(data) as T[];
                items.forEach(item => item.isCustom = true);
                return items;
            } catch (e) {
                new Notice(`Could not read user file: ${fileName}. Check console for details.`);
                console.error(e);
                return [];
            }
        }
        return [];
    }

    private async loadSrdFile<T>(fileName: string): Promise<T[]> {
        const filePath = `${this.plugin.manifest.dir}/${DATA_PATH}/${fileName}`;
        try {
            if (await this.plugin.app.vault.adapter.exists(filePath)) {
                let content = await this.plugin.app.vault.adapter.read(filePath);
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                return JSON.parse(content) as T[];
            }
        } catch (e) {
            console.error(`Daggerheart | Error loading SRD file ${fileName}:`, e);
        }
        return [];
    }

    public getClass(name: string): JsonClass | undefined { return this.classes.find(c => c.name === name); }
    public getSubclass(name: string): JsonSubclass | undefined { return this.subclasses.find(s => s.name === name); }
    public getAncestry(name: string): JsonAncestry | undefined { return this.ancestries.find(a => a.name === name); }
    public getCommunity(name: string): JsonCommunity | undefined { return this.communities.find(c => c.name === name); }
    public getAbility(name: string): DomainCard | undefined {
        const ability = this.abilities.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (!ability) return undefined;
        return {
            _type: 'domainCard', id: ability.name, name: ability.name,
            level: parseInt(ability.level), domain: ability.domain, type: ability.type,
            recall: parseInt(ability.recall) || 0, description: ability.text, isCustom: ability.isCustom,
        }
    }
    public getAllDomains(): string[] { return [...new Set(this.abilities.map(a => a.domain).filter(d => d))].sort(); }
    public getAllLevels(): number[] { return [...new Set(this.abilities.map(a => parseInt(a.level)).filter(l => !isNaN(l)))].sort((a, b) => a - b); }
    public getAllItems(): CompendiumItem[] {
        return [...this.armors, ...this.weapons, ...this.items, ...this.consumables];
    }

    public getStatblocks(): StatblockData[] {
        return this.statblocks;
    }

    private parseAndAddStatblock(srd: any, category: 'adversary' | 'environment', map: Map<string, StatblockData>) {
        try {
            const features: { name: string; type: string; description: string; }[] = (srd.feats || []).map((feat: any) => ({
                name: feat.name,
                type: feat.type || 'Passive',
                description: feat.text,
            }));

            const thresholds = srd.thresholds?.split('/').map((s: string) => s.trim()).filter(Boolean);

            const statblock: StatblockData = {
                name: srd.name,
                category: category,
                tier: srd.tier,
                type: srd.type,
                description: srd.description,
                motives_tactics: srd.motives_and_tactics || srd.motives_tactics,
                impulses: srd.impulses,
                potential_adversaries: srd.potential_adversaries,
                difficulty: srd.difficulty,
                hp_stress: {
                    hp: Number(srd.hp) || 0,
                    stress: Number(srd.stress) || 0,
                    major_hp: thresholds?.[0] ? Number(thresholds[0]) : null,
                    severe_hp: thresholds?.[1] ? Number(thresholds[1]) : null,
                },
                attack: { name: srd.attack || "Attack", range: srd.range || "", damage: srd.damage || "", modifier: srd.atk || "0" },
                features: features,
            };
            map.set(statblock.name.toLowerCase(), statblock);
        } catch (e) {
            console.error(`Error parsing SRD ${category}:`, srd, e);
        }
    }

    private async loadMarkdownStatblocks(): Promise<StatblockData[]> {
        const folderPath = this.plugin.settings.compendiumFolder;
        if (!folderPath) return [];

        const abstractFileOrFolder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        const mdStatblocks: StatblockData[] = [];
        if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            const content = await this.plugin.app.vault.cachedRead(abstractFileOrFolder);
            this.extractStatblocksFromFile(content, abstractFileOrFolder.path, mdStatblocks);
        } else if (abstractFileOrFolder instanceof TFolder) {
            for (const file of abstractFileOrFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')) {
                const content = await this.plugin.app.vault.cachedRead(file);
                this.extractStatblocksFromFile(content, file.path, mdStatblocks);
            }
        }
        return mdStatblocks;
    }

    private extractStatblocksFromFile(content: string, filePath: string, statblocksArray: StatblockData[]) {
        const codeBlockRegex = /```daggerheart-statblock\s*([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            try {
                const statblock = YAML.load(match[1]) as StatblockData;
                if (statblock?.name) {
                    statblock.isCustom = true;
                    statblock.sourceFile = filePath;
                    statblocksArray.push(statblock);
                }
            } catch (e: any) { console.warn(`Failed to parse YAML in ${filePath}: ${e.message}.`); }
        }
    }

    public convertCompendiumItemToInventoryItem(item: CompendiumItem, instanceId?: string): InventoryItem {
        const base = {
            instanceId: instanceId || uuidv4(),
            name: item.name,
            quantity: 1,
            isCustom: item.isCustom,
            effects: (item as any).effects || [],
        };

        switch (item._type) {
            case 'armor': {
                const armor = item as ArmorItem;
                const [major, severe] = armor.base_thresholds.split(' / ').map(s => parseInt(s.trim()));
                return {
                    ...base,
                    _type: 'armor',
                    description: armor.feat_text,
                    tier: parseInt(armor.tier),
                    // FIX: Create new CalculatedStat instances for each stat
                    baseScore: new CalculatedStat(parseInt(armor.base_score)),
                    baseThresholds: {
                        major: new CalculatedStat(major),
                        severe: new CalculatedStat(severe)
                    },
                    features: armor.feat_name ? [{ name: armor.feat_name, description: armor.feat_text || '' }] : [],
                };
            }
            case 'weapon': {
                const weapon = item as WeaponItem;
                // FIX: Parse the damage string and create a valid damageComponents object
                const damageString = weapon.damage || 'd6 phy';
                const damageParts = damageString.split(' ');
                const dicePart = damageParts[0];
                const typePart = damageParts[1] || 'phy';

                let baseDice = dicePart;
                let baseModifier = 0;

                const modifierMatch = dicePart.match(/([+-]\d+)$/);
                if (modifierMatch) {
                    baseModifier = parseInt(modifierMatch[1]);
                    baseDice = dicePart.replace(modifierMatch[0], '');
                }

                return {
                    ...base,
                    _type: 'weapon',
                    description: weapon.feat_text,
                    tier: parseInt(weapon.tier),
                    burden: weapon.burden as 'One-Handed' | 'Two-Handed',
                    range: weapon.range,
                    trait: weapon.trait,
                    primaryOrSecondary: weapon.primary_or_secondary as 'Primary' | 'Secondary',
                    features: weapon.feat_name ? [{ name: weapon.feat_name, description: weapon.feat_text || '' }] : [],
                    damageComponents: {
                        baseDice: baseDice,
                        baseModifier: baseModifier,
                        damageType: typePart,
                        numberOfDice: new CalculatedStat(0), // Base bonus dice is always 0
                        flatBonus: new CalculatedStat(baseModifier)
                    }
                };
            }
            case 'consumable':
                const consumable = item as ConsumableItem;
                return { ...base, _type: 'consumable', description: consumable.description, roll: consumable.roll };
            case 'item':
                const generic = item as GenericItem;
                return { ...base, _type: 'item', description: generic.description };
        }
    }

    public convertInventoryItemToCompendiumItem(item: InventoryItem): CompendiumItem {
        switch (item._type) {
            case 'armor':
                return {
                    _type: 'armor',
                    name: item.name,
                    tier: String(item.tier),
                    // FIX: Safely access the .base property of the CalculatedStat
                    base_score: String(item.baseScore?.base ?? 0),
                    base_thresholds: `${item.baseThresholds?.major?.base ?? 0} / ${item.baseThresholds?.severe?.base ?? 0}`,
                    feat_name: item.features?.[0]?.name,
                    feat_text: item.features?.[0]?.description,
                    isCustom: item.isCustom,
                    effects: item.effects,
                };
            case 'weapon':
                // FIX: Safely reconstruct the damage string from damageComponents
                const dice = item.damageComponents?.baseDice || 'd6';
                const mod = item.damageComponents?.flatBonus?.base ?? 0;
                const type = item.damageComponents?.damageType || 'phy';
                const damageString = `${dice}${mod !== 0 ? (mod > 0 ? `+${mod}` : mod) : ''} ${type}`;

                return {
                    _type: 'weapon',
                    name: item.name,
                    tier: String(item.tier),
                    damage: damageString.trim(),
                    range: item.range,
                    trait: item.trait,
                    burden: item.burden,
                    primary_or_secondary: item.primaryOrSecondary,
                    physical_or_magical: 'physical', // Assuming default
                    feat_name: item.features?.[0]?.name,
                    feat_text: item.features?.[0]?.description,
                    isCustom: item.isCustom,
                    effects: item.effects,
                };
            case 'consumable':
                return {
                    _type: 'consumable',
                    name: item.name,
                    description: item.description || '',
                    roll: item.roll,
                    isCustom: item.isCustom,
                    effects: item.effects,
                };
            case 'item':
                return {
                    _type: 'item',
                    name: item.name,
                    description: item.description || '',
                    isCustom: item.isCustom,
                    effects: item.effects,
                };
        }
    }
}
