import DaggerheartStatblockPlugin from "main";
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
        this.abilities = await this.loadFile<JsonAbility>('abilities.json');

        this.armors = (await this.loadFile<JsonArmor>('armor.json')).map(a => ({ ...a, _type: 'armor' }));
        this.weapons = (await this.loadFile<JsonWeapon>('weapons.json')).map(w => ({ ...w, _type: 'weapon' }));
        this.items = (await this.loadFile<JsonItem>('items.json')).map(i => ({ ...i, _type: 'item' }));
        this.consumables = (await this.loadFile<JsonConsumable>('consumables.json')).map(i => ({ ...i, _type: 'consumable' }));

        console.log("Daggerheart | Character Compendium loaded successfully.");
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

    // This method still needs to process the data for use in the character sheet
    public getAbility(name: string): DomainCard | undefined {
        const ability = this.abilities.find(a => a.name === name);
        if (!ability) return undefined;
        return {
            _type: 'domainCard',
            id: ability.name,
            name: ability.name,
            level: parseInt(ability.level),
            domain: ability.domain,
            type: ability.type,
            description: ability.text
        }
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
