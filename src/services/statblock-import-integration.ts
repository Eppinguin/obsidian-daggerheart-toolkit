import { Notice } from 'obsidian';
import { DaggerheartCompendium } from './compendium';
import DaggerheartStatblockPlugin from '../main';
import { openStatblockImportPreviewFromJson } from '../modals/StatblockImportPreviewModal';

const installed = new WeakSet<object>();

async function openClipboardImport(plugin: DaggerheartStatblockPlugin, sourceLabel: string): Promise<void> {
    try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            new Notice('The clipboard is empty. Copy statblock JSON first.');
            return;
        }
        if (!openStatblockImportPreviewFromJson(plugin.app, plugin, text, sourceLabel)) {
            new Notice('The clipboard does not contain a supported Daggerheart statblock.');
        }
    } catch (error) {
        console.error('Daggerheart | Could not read statblock JSON from clipboard:', error);
        new Notice('Could not read the clipboard. Use Import Daggerheart Content and paste the JSON manually.');
    }
}

export function installStatblockImportIntegration(plugin: DaggerheartStatblockPlugin): void {
    if (installed.has(plugin)) return;
    installed.add(plugin);

    plugin.addCommand({
        id: 'import-statblocks-from-clipboard',
        name: 'Import Statblocks from Clipboard',
        callback: () => openClipboardImport(plugin, 'clipboard')
    });

    const protocolPlugin = plugin as DaggerheartStatblockPlugin & {
        registerObsidianProtocolHandler?: (action: string, handler: (params: Record<string, string>) => void | Promise<void>) => void;
    };
    protocolPlugin.registerObsidianProtocolHandler?.('daggerheart-import', async params => {
        const source = params.source ? `browser extension (${params.source})` : 'browser extension';
        await openClipboardImport(plugin, source);
    });
}

// main.ts already imports the modal barrel after DaggerheartCompendium. Installing
// this side effect from the barrel lets us register once when the compendium is
// first loaded without adding more lifecycle code to main.ts.
const originalLoad = DaggerheartCompendium.prototype.load;
if (!(DaggerheartCompendium.prototype as any).__statblockImportIntegration) {
    (DaggerheartCompendium.prototype as any).__statblockImportIntegration = true;
    DaggerheartCompendium.prototype.load = async function (...args: any[]): Promise<void> {
        const plugin = (this as any).plugin as DaggerheartStatblockPlugin;
        installStatblockImportIntegration(plugin);
        return originalLoad.apply(this, args as []);
    };
}
