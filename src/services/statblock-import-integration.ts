import { Notice } from 'obsidian';
import { DaggerheartCompendium } from './compendium';
import type DaggerheartStatblockPlugin from '../main';
import { openStatblockImportPreviewFromJson } from '../modals/StatblockImportPreviewModal';

const installed = new WeakSet<object>();

async function readClipboardText(): Promise<string> {
    try {
        return await navigator.clipboard.readText();
    } catch (webClipboardError) {
        try {
            const electronClipboard = (window as any).require?.('electron')?.clipboard;
            if (electronClipboard?.readText) return electronClipboard.readText();
        } catch (electronClipboardError) {
            console.debug('Daggerheart | Electron clipboard fallback unavailable:', electronClipboardError);
        }
        throw webClipboardError;
    }
}

async function openClipboardImport(
    plugin: DaggerheartStatblockPlugin,
    sourceLabel: string,
    addToEncounter = false,
): Promise<void> {
    try {
        const text = await readClipboardText();
        if (!text.trim()) {
            new Notice('The clipboard is empty. Copy statblock JSON first.');
            return;
        }
        if (!openStatblockImportPreviewFromJson(plugin.app, plugin, text, sourceLabel, { addToEncounter })) {
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
        callback: () => openClipboardImport(plugin, 'clipboard'),
    });

    const protocolPlugin = plugin as DaggerheartStatblockPlugin & {
        registerObsidianProtocolHandler?: (
            action: string,
            handler: (params: Record<string, string>) => void | Promise<void>,
        ) => void;
    };
    protocolPlugin.registerObsidianProtocolHandler?.('daggerheart-import', async (params) => {
        const source = params.source ? `browser extension (${params.source})` : 'browser extension';
        // The current extension never sends `target=encounter`: the review
        // screen owns that choice, since only this side knows whether an
        // encounter is open. Still honoured as a pre-tick so an older installed
        // extension keeps working.
        await openClipboardImport(plugin, source, params.target === 'encounter');
    });
}

// main.ts imports the modal barrel before constructing/loading the compendium.
// Install the integration at the first compendium load without adding another
// dependency to the already-large main plugin module.
const originalLoad = DaggerheartCompendium.prototype.load;
if (!(DaggerheartCompendium.prototype as any).__statblockImportIntegration) {
    (DaggerheartCompendium.prototype as any).__statblockImportIntegration = true;
    DaggerheartCompendium.prototype.load = async function (): Promise<void> {
        const plugin = (this as any).plugin as DaggerheartStatblockPlugin;
        installStatblockImportIntegration(plugin);
        return originalLoad.call(this);
    };
}
