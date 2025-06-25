import DaggerheartStatblockPlugin from "main";
import {
    CompendiumAncestry, CompendiumClass, CompendiumCommunity, Feature,
    ArmorItem, WeaponItem, GenericItem, CompendiumItem, CompendiumSubclass
} from "types";

const DATA_PATH = "data";

export class CharacterCompendium {
    private plugin: DaggerheartStatblockPlugin;

    public ancestries: CompendiumAncestry[] = [];
    public communities: CompendiumCommunity[] = [];
    public classes: CompendiumClass[] = [];
    public subclasses: CompendiumSubclass[] = [];
    public features: Feature[] = [];
    public armors: ArmorItem[] = [];
    public weapons: WeaponItem[] = [];
    public items: GenericItem[] = [];

    constructor(plugin: DaggerheartStatblockPlugin) {
        this.plugin = plugin;
    }

    async load() {
        console.log("Daggerheart | Loading Character Compendium...");

        // Load all compendium files and transform them from objects to arrays
        this.ancestries = await this.loadAndTransformData<CompendiumAncestry>('ancestries.json');
        this.communities = await this.loadAndTransformData<CompendiumCommunity>('communities.json');
        this.classes = await this.loadAndTransformData<CompendiumClass>('classes.json');
        this.subclasses = await this.loadAndTransformData<CompendiumSubclass>('subclasses.json');
        this.features = await this.loadAndTransformData<Feature>('features.json');
        this.armors = (await this.loadAndTransformData<ArmorItem>('armor.json')).map(armor => ({ ...armor, tier: armor.tier || 1 }));
        this.weapons = (await this.loadAndTransformData<WeaponItem>('weapon.json')).map(weapon => ({ ...weapon, tier: weapon.tier || 1 }));
        this.items = await this.loadAndTransformData<GenericItem>('items.json');

        console.log("Daggerheart | Character Compendium loaded successfully.");
    }

    private async loadAndTransformData<T extends { id?: string }>(fileName: string): Promise<T[]> {
        const filePath = `${this.plugin.manifest.dir}/${DATA_PATH}/${fileName}`;
        try {
            if (await this.plugin.app.vault.adapter.exists(filePath)) {
                const content = await this.plugin.app.vault.adapter.read(filePath);
                const dataObject = JSON.parse(content) as { [key: string]: Omit<T, 'id'> };

                // Transform the object of objects into an array of objects
                return Object.entries(dataObject).map(([id, value]) => ({
                    id,
                    ...value,
                } as T));
            } else {
                console.error(`Daggerheart | Compendium file not found: ${filePath}`);
                return [];
            }
        } catch (e) {
            console.error(`Daggerheart | Error loading or transforming compendium file ${fileName}:`, e);
            return [];
        }
    }

    public getClass(id: string): CompendiumClass | undefined { return this.classes.find(c => c.id === id); }
    public getSubclass(id: string): CompendiumSubclass | undefined { return this.subclasses.find(s => s.id === id); }
    public getAncestry(id: string): CompendiumAncestry | undefined { return this.ancestries.find(a => a.id === id); }
    public getCommunity(id: string): CompendiumCommunity | undefined { return this.communities.find(c => c.id === id); }
    public getFeature(id: string): Feature | undefined { return this.features.find(f => f.id === id); }

    public getAllItems(): CompendiumItem[] {
        return [
            ...this.armors.map(i => ({ ...i, _type: 'armor' }) as ArmorItem),
            ...this.weapons.map(i => ({ ...i, _type: 'weapon' }) as WeaponItem),
            ...this.items.map(i => ({ ...i, _type: 'item' }) as GenericItem),
        ];
    }
}
