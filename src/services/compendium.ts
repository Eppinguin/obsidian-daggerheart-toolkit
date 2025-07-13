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
    StatblockHpStress,
    StatblockFeature,
    InventoryItem
} from '../types';
import DaggerheartStatblockPlugin from '../main';
import { v4 as uuidv4 } from 'uuid';

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

        const userAncestries = await this.loadUserFile<JsonAncestry>('user-ancestries.json');
        const userClasses = await this.loadUserFile<JsonClass>('user-classes.json');
        const userSubclasses = await this.loadUserFile<JsonSubclass>('user-subclasses.json');
        const userAbilities = await this.loadUserFile<JsonAbility>('user-abilities.json');
        const userCommunities = await this.loadUserFile<JsonCommunity>('user-communities.json');

        this.ancestries = this.mergeData(srdAncestries, userAncestries);
        this.communities = this.mergeData(srdCommunities, userCommunities);
        this.classes = this.mergeData(srdClasses, userClasses);
        this.subclasses = this.mergeData(srdSubclasses, userSubclasses);
        this.abilities = this.mergeData(srdAbilities, userAbilities);

        this.armors = this.mergeData(
            (await this.loadSrdFile<JsonArmor>('armor.json')).map(a => ({ ...a, _type: 'armor' })),
            (await this.loadUserFile<ArmorItem>('user-armor.json'))
        );
        this.weapons = this.mergeData(
            (await this.loadSrdFile<JsonWeapon>('weapons.json')).map(w => ({ ...w, _type: 'weapon' })),
            (await this.loadUserFile<WeaponItem>('user-weapons.json'))
        );
        this.items = this.mergeData(
            (await this.loadSrdFile<JsonItem>('items.json')).map(i => ({ ...i, _type: 'item' })),
            (await this.loadUserFile<GenericItem>('user-items.json'))
        );
        this.consumables = this.mergeData(
            (await this.loadSrdFile<JsonConsumable>('consumables.json')).map(c => ({ ...c, _type: 'consumable' })),
            (await this.loadUserFile<ConsumableItem>('user-consumables.json'))
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
        const userAdversaries = await this.loadUserFile<StatblockData>('user-adversaries.json');
        userAdversaries.forEach(item => itemsMap.set(item.name.toLowerCase(), item));
        const userEnvironments = await this.loadUserFile<StatblockData>('user-environments.json');
        userEnvironments.forEach(item => itemsMap.set(item.name.toLowerCase(), item));
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
            const features: StatblockFeature[] = (srd.feats || []).map((feat: any) => ({
                name: feat.name,
                type: feat.type || 'Passive', // Use SRD type if available, otherwise default.
                description: feat.text,
            }));

            const thresholds = srd.thresholds?.split('/').map((s: string) => s.trim()).filter(Boolean);

            const statblock: StatblockData = {
                name: srd.name,
                category: category,
                tier: srd.tier,
                type: srd.type,
                description: srd.description,
                motives_tactics: srd.motives_and_tactics || srd.motives_tactics, // Check for both keys
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
        };

        switch (item._type) {
            case 'armor':
                const [major, severe] = item.base_thresholds.split(' / ').map(s => parseInt(s.trim()));
                return {
                    ...base,
                    _type: 'armor',
                    description: item.feat_text,
                    tier: parseInt(item.tier),
                    baseScore: parseInt(item.base_score),
                    baseThresholds: { major, severe },
                    features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                };
            case 'weapon':
                const [damageDice, damageType] = item.damage.split(' ');
                return {
                    ...base,
                    _type: 'weapon',
                    description: item.feat_text,
                    tier: parseInt(item.tier),
                    burden: item.burden as 'One-Handed' | 'Two-Handed',
                    range: item.range,
                    trait: item.trait,
                    primaryOrSecondary: item.primary_or_secondary as 'Primary' | 'Secondary',
                    damage: item.damage,
                    damageDice,
                    damageType,
                    features: item.feat_name ? [{ name: item.feat_name, description: item.feat_text || '' }] : [],
                };
            case 'consumable':
                return { ...base, _type: 'consumable', description: item.description, roll: item.roll };
            case 'item':
                return { ...base, _type: 'item', description: item.description };
        }
    }

    public convertInventoryItemToCompendiumItem(item: InventoryItem): CompendiumItem {
        switch (item._type) {
            case 'armor':
                return {
                    _type: 'armor',
                    name: item.name,
                    tier: String(item.tier),
                    base_score: String(item.baseScore),
                    base_thresholds: `${item.baseThresholds.major} / ${item.baseThresholds.severe}`,
                    feat_name: item.features?.[0]?.name,
                    feat_text: item.features?.[0]?.description,
                    isCustom: item.isCustom,
                };
            case 'weapon':
                return {
                    _type: 'weapon',
                    name: item.name,
                    tier: String(item.tier),
                    damage: item.damage,
                    range: item.range,
                    trait: item.trait,
                    burden: item.burden,
                    primary_or_secondary: item.primaryOrSecondary,
                    physical_or_magical: 'physical', // Assuming default
                    feat_name: item.features?.[0]?.name,
                    feat_text: item.features?.[0]?.description,
                    isCustom: item.isCustom,
                };
            case 'consumable':
                return {
                    _type: 'consumable',
                    name: item.name,
                    description: item.description || '',
                    roll: item.roll,
                    isCustom: item.isCustom,
                };
            case 'item':
                return {
                    _type: 'item',
                    name: item.name,
                    description: item.description || '',
                    isCustom: item.isCustom,
                };
        }
    }
}
