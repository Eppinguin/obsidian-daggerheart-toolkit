import { App, FuzzySuggestModal } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { StatblockData } from '../../types';

export class AdversaryReferenceModal extends FuzzySuggestModal<StatblockData> {
    plugin: DaggerheartStatblockPlugin;
    onChoose: (result: StatblockData) => void;
    items: StatblockData[] = [];
    itemCategory: 'adversary' | 'environment' | 'all';

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onChoose: (result: StatblockData) => void, itemCategory: 'adversary' | 'environment' | 'all' = 'all') {
        super(app);
        this.plugin = plugin;
        this.onChoose = onChoose;
        this.itemCategory = itemCategory;

        let placeholderText = "Search for an item to embed...";
        if (this.itemCategory === 'adversary') {
            placeholderText = "Search for an adversary to embed...";
        } else if (this.itemCategory === 'environment') {
            placeholderText = "Search for an environment to embed...";
        }
        this.setPlaceholder(placeholderText);
    }

    async onOpen() {
        const allItems = await this.plugin.compendium.getStatblocks();
        if (this.itemCategory !== 'all') {
            this.items = allItems.filter(item => item.category === this.itemCategory);
        } else {
            this.items = allItems;
        }
        super.onOpen();
    }

    getItems(): StatblockData[] {
        return this.items;
    }

    getItemText(item: StatblockData): string {
        return item.name;
    }

    onChooseItem(item: StatblockData, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}
