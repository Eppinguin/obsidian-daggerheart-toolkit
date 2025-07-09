import { App, FuzzySuggestModal } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { SavedEncounter } from '../types';

export class EncounterLinkModal extends FuzzySuggestModal<SavedEncounter> {
    plugin: DaggerheartStatblockPlugin;
    onChoose: (result: SavedEncounter) => void;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onChoose: (result: SavedEncounter) => void) {
        super(app);
        this.plugin = plugin;
        this.onChoose = onChoose;
        this.setPlaceholder("Search for an encounter to link...");
    }

    getItems(): SavedEncounter[] {
        return this.plugin.settings.savedEncounters;
    }

    getItemText(item: SavedEncounter): string {
        return item.name;
    }

    onChooseItem(item: SavedEncounter, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}
