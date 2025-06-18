import { App, FuzzySuggestModal } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';
import { StatblockData } from '../../types';

export class AdversaryReferenceModal extends FuzzySuggestModal<StatblockData> {
    plugin: DaggerheartStatblockPlugin;
    onChoose: (result: StatblockData) => void;
    adversaries: StatblockData[] = [];

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onChoose: (result: StatblockData) => void) {
        super(app);
        this.plugin = plugin;
        this.onChoose = onChoose;
        this.setPlaceholder("Search for an adversary to embed...");
    }

    async onOpen() {
        this.adversaries = await this.plugin.getCompendiumAdversaries();
        super.onOpen();
    }

    getItems(): StatblockData[] {
        return this.adversaries;
    }

    getItemText(item: StatblockData): string {
        return item.name;
    }

    onChooseItem(item: StatblockData, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}
