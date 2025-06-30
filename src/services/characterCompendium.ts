import DaggerheartStatblockPlugin from "main";
import { Notice } from "obsidian";
import {
    JsonAncestry, JsonClass, JsonCommunity, JsonSubclass, JsonArmor, JsonWeapon, JsonItem, JsonAbility, JsonConsumable, CompendiumItem, DomainCard
} from "types";

const DATA_PATH = "data";

export class CharacterCompendium {
    private plugin: DaggerheartStatblockPlugin;

    // Store data in its raw JSON format
    public ancestries: JsonAncestry[] = [];
    public communities: JsonCommunity[] = [];
    public classes: JsonClass[] = [];
    public subclasses: JsonSubclass[] = [];
    public abilities: JsonAbility[] = [];
    public userAbilities: JsonAbility[] = [];
    public armors: CompendiumItem[] = [];
    public weapons: CompendiumItem[] = [];
    public items: CompendiumItem[] = [];
    public consumables: CompendiumItem[] = [];

    constructor(plugin: DaggerheartStatblockPlugin) {
        this.plugin = plugin;
    }

    async load() {
        console.log("Daggerheart | Loading Character Compendium...");

        // Load data without transforming it, only adding _type for items.
        this.ancestries = await this.loadFile<JsonAncestry>('ancestries.json');
        this.communities = await this.loadFile<JsonCommunity>('communities.json');
        this.classes = await this.loadFile<JsonClass>('classes.json');
        this.subclasses = await this.loadFile<JsonSubclass>('subclasses.json');

        const srdAbilities = await this.loadFile<JsonAbility>('abilities.json');
        this.userAbilities = await this.loadUserAbilities();

        // Combine and de-duplicate, with user abilities taking precedence
        const abilityMap = new Map<string, JsonAbility>();
        srdAbilities.forEach(ability => abilityMap.set(ability.name.toLowerCase(), ability));
        this.userAbilities.forEach(ability => abilityMap.set(ability.name.toLowerCase(), ability));
        this.abilities = Array.from(abilityMap.values());

        this.armors = (await this.loadFile<JsonArmor>('armor.json')).map(a => ({ ...a, _type: 'armor' }));
        this.weapons = (await this.loadFile<JsonWeapon>('weapons.json')).map(w => ({ ...w, _type: 'weapon' }));
        this.items = (await this.loadFile<JsonItem>('items.json')).map(i => ({ ...i, _type: 'item' }));
        this.consumables = (await this.loadFile<JsonConsumable>('consumables.json')).map(i => ({ ...i, _type: 'consumable' }));

        console.log("Daggerheart | Character Compendium loaded successfully.");
    }

    private async loadUserAbilities(): Promise<JsonAbility[]> {
        if (!this.plugin.settings.userAbilitiesFile) {
            return [];
        }
        const path = `${this.plugin.manifest.dir}/${this.plugin.settings.userAbilitiesFile}`;
        if (await this.plugin.app.vault.adapter.exists(path)) {
            try {
                const data = await this.plugin.app.vault.adapter.read(path);
                // Remove BOM if it exists
                const cleanData = data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data;
                if (cleanData.trim() === '') return []; // Handle empty file
                return JSON.parse(cleanData) as JsonAbility[];
            } catch (e) {
                console.error(`Daggerheart | Error reading or parsing ${this.plugin.settings.userAbilitiesFile}`, e);
                new Notice(`Could not read user abilities file: ${this.plugin.settings.userAbilitiesFile}`);
                return [];
            }
        }
        return [];
    }

    private async loadFile<T>(fileName: string): Promise<T[]> {
        const filePath = `${this.plugin.manifest.dir}/${DATA_PATH}/${fileName}`;
        try {
            if (await this.plugin.app.vault.adapter.exists(filePath)) {
                let content = await this.plugin.app.vault.adapter.read(filePath);
                // Remove BOM if it exists, which causes JSON parsing errors.
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                return JSON.parse(content) as T[];
            } else {
                console.error(`Daggerheart | Compendium file not found: ${filePath}`);
                return [];
            }
        } catch (e) {
            console.error(`Daggerheart | Error loading or transforming compendium file ${fileName}:`, e);
            return [];
        }
    }

    // Getters now return the raw JSON types
    public getClass(name: string): JsonClass | undefined { return this.classes.find(c => c.name === name); }
    public getSubclass(name: string): JsonSubclass | undefined { return this.subclasses.find(s => s.name === name); }
    public getAncestry(name: string): JsonAncestry | undefined { return this.ancestries.find(a => a.name === name); }
    public getCommunity(name: string): JsonCommunity | undefined { return this.communities.find(c => c.name === name); }

    public getAbility(name: string): DomainCard | undefined {
        const ability = this.abilities.find(a => a.name.toLowerCase() === name.toLowerCase());
        if (!ability) return undefined;
        return {
            _type: 'domainCard',
            id: ability.name,
            name: ability.name,
            level: parseInt(ability.level),
            domain: ability.domain,
            type: ability.type,
            recall: parseInt(ability.recall) || 0,
            description: ability.text
        }
    }

    public getAllDomains(): string[] {
        const domains = this.abilities.map(a => a.domain).filter(d => d); // filter out any null/undefined domains
        return [...new Set(domains)].sort();
    }

    public getAllLevels(): number[] {
        const levels = this.abilities.map(a => parseInt(a.level));
        const uniqueLevels = [...new Set(levels)].filter(l => !isNaN(l)); // filter out any NaN values
        return uniqueLevels.sort((a, b) => a - b);
    }

    public getAllItems(): CompendiumItem[] {
        return [
            ...this.armors,
            ...this.weapons,
            ...this.items,
            ...this.consumables,
        ];
    }
}
