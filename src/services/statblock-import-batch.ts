import { Notice } from 'obsidian';
import type DaggerheartStatblockPlugin from '../main';
import type { StatblockData } from '../types';

const USER_COMPENDIUM_FOLDER = 'user_data';

export async function saveStatblockBatch(plugin: DaggerheartStatblockPlugin, items: StatblockData[]): Promise<void> {
    if (!items.length) return;
    const folder = `${plugin.manifest.dir}/${USER_COMPENDIUM_FOLDER}`;
    const path = `${folder}/${plugin.settings.userCompendiumFile}`;
    if (!(await plugin.app.vault.adapter.exists(folder))) await plugin.app.vault.adapter.mkdir(folder);

    let compendium: StatblockData[] = [];
    if (await plugin.app.vault.adapter.exists(path)) {
        try {
            const raw = await plugin.app.vault.adapter.read(path);
            compendium = raw.trim() ? JSON.parse(raw) : [];
            if (!Array.isArray(compendium)) compendium = [];
        } catch (error) {
            console.error('Daggerheart | Could not read user statblock compendium:', error);
            new Notice(`Could not read ${plugin.settings.userCompendiumFile}; import was cancelled.`);
            throw error;
        }
    }

    for (const item of items) {
        item.isCustom = true;
        const index = compendium.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase());
        if (index >= 0) compendium[index] = item;
        else compendium.push(item);
    }

    await plugin.app.vault.adapter.write(path, JSON.stringify(compendium, null, 2));
    await plugin.triggerCompendiumUpdate();
}
