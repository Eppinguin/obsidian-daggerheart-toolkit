// src/services/export-import.ts
import { Notice, requestUrl } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { AllCompendiumData } from '../types';

// --- DATA STRUCTURES & ENUMS ---

/**
 * The standard wrapper for all exported data.
 */
export interface ExportedData<T> {
    type: string;
    version: string;
    exportDate: string;
    data: T;
}

/**
 * Content types that can be exported/imported.
 */
export enum ContentType {
    CHARACTER = 'character',
    ENCOUNTER = 'encounter',
    ADVERSARY = 'adversary',
    ENVIRONMENT = 'environment',
    ABILITY = 'ability',
    CLASS = 'class',
    SUBCLASS = 'subclass',
    ANCESTRY = 'ancestry',
    COMMUNITY = 'community',
    ARMOR = 'armor',
    WEAPON = 'weapon',
    ITEM = 'item',
    CONSUMABLE = 'consumable'
}

/**
 * Content type metadata
 */
export interface ContentTypeInfo {
    type: ContentType;
    displayName: string;
    description: string;
    icon: string;
    collection: string;
}

/**
 * Content type info lookup
 */
export const CONTENT_TYPE_INFO: Record<ContentType, ContentTypeInfo> = {
    [ContentType.CHARACTER]: {
        type: ContentType.CHARACTER,
        displayName: 'Character',
        description: 'Export or import character sheets',
        icon: 'user',
        collection: 'characters'
    },
    [ContentType.ENCOUNTER]: {
        type: ContentType.ENCOUNTER,
        displayName: 'Encounter',
        description: 'Export or import saved encounters',
        icon: 'swords',
        collection: 'encounters'
    },
    [ContentType.ADVERSARY]: {
        type: ContentType.ADVERSARY,
        displayName: 'Adversary',
        description: 'Export or import adversary statblocks',
        icon: 'skull',
        collection: 'statblocks'
    },
    [ContentType.ENVIRONMENT]: {
        type: ContentType.ENVIRONMENT,
        displayName: 'Environment',
        description: 'Export or import environment statblocks',
        icon: 'mountain-snow',
        collection: 'statblocks'
    },
    [ContentType.ABILITY]: {
        type: ContentType.ABILITY,
        displayName: 'Ability',
        description: 'Export or import abilities',
        icon: 'zap',
        collection: 'abilities'
    },
    [ContentType.CLASS]: {
        type: ContentType.CLASS,
        displayName: 'Class',
        description: 'Export or import classes',
        icon: 'shield',
        collection: 'classes'
    },
    [ContentType.SUBCLASS]: {
        type: ContentType.SUBCLASS,
        displayName: 'Subclass',
        description: 'Export or import subclasses',
        icon: 'shield-half',
        collection: 'subclasses'
    },
    [ContentType.ANCESTRY]: {
        type: ContentType.ANCESTRY,
        displayName: 'Ancestry',
        description: 'Export or import ancestries',
        icon: 'dna',
        collection: 'ancestries'
    },
    [ContentType.COMMUNITY]: {
        type: ContentType.COMMUNITY,
        displayName: 'Community',
        description: 'Export or import communities',
        icon: 'home',
        collection: 'communities'
    },
    [ContentType.ARMOR]: {
        type: ContentType.ARMOR,
        displayName: 'Armor',
        description: 'Export or import armor',
        icon: 'shield',
        collection: 'armors'
    },
    [ContentType.WEAPON]: {
        type: ContentType.WEAPON,
        displayName: 'Weapon',
        description: 'Export or import weapons',
        icon: 'sword',
        collection: 'weapons'
    },
    [ContentType.ITEM]: {
        type: ContentType.ITEM,
        displayName: 'Item',
        description: 'Export or import items',
        icon: 'backpack',
        collection: 'items'
    },
    [ContentType.CONSUMABLE]: {
        type: ContentType.CONSUMABLE,
        displayName: 'Consumable',
        description: 'Export or import consumables',
        icon: 'potion',
        collection: 'consumables'
    }
}

/**
 * Export data to a JSON object
 * @param type Type of data being exported (e.g., "character", "compendium-entry")
 * @param data The data to export
 * @returns Formatted export data object
 */
export function exportToJson<T>(type: string, data: T): ExportedData<T> {
    return {
        type,
        version: '1.1.0',
        exportDate: new Date().toISOString(),
        data
    };
}

/**
 * Creates a formatted JSON string from data for export.
 * @param type Type of data being exported.
 * @param data The data to export.
 * @returns JSON string.
 */
export function exportToJsonString<T>(type: string, data: T): string {
    const exportData = exportToJson(type, data);
    return JSON.stringify(exportData, null, 2);
}

// --- IMPORT FUNCTIONS ---

/**
 * Detects the content type of a given data object by checking for unique properties.
 * @param data The object to inspect.
 * @returns The detected ContentType or 'unknown'.
 */
function detectContentType(data: any): ContentType | 'unknown' {
    if (!data || typeof data !== 'object') {
        return 'unknown';
    }

    // Check for a specific _type property first, as it's the most reliable
    if (data._type && Object.values(ContentType).includes(data._type as ContentType)) {
        return data._type as ContentType;
    }

    // More specific structural checks based on unique properties from `types.ts`
    if (data['dg-character'] && data.ancestryId) return ContentType.CHARACTER;
    if (Array.isArray(data.adversaries) && Array.isArray(data.adversaryGroupOrder)) return ContentType.ENCOUNTER;
    if (Array.isArray(data.class_feats) && data.domain_1) return ContentType.CLASS;
    if (Array.isArray(data.foundations) && Array.isArray(data.specializations)) return ContentType.SUBCLASS;
    if (Array.isArray(data.feats) && data.note) return ContentType.COMMUNITY;
    if (Array.isArray(data.feats)) return ContentType.ANCESTRY;
    if (data.recall && data.domain) return ContentType.ABILITY;
    if (data.base_score && data.base_thresholds) return ContentType.ARMOR;
    if (data.primary_or_secondary && data.damage) return ContentType.WEAPON;
    if (data.roll && data.name && data.description) return ContentType.CONSUMABLE;
    if (data.hp_stress && data.category === 'adversary') return ContentType.ADVERSARY;
    if (data.hp_stress && data.category === 'environment') return ContentType.ENVIRONMENT;

    // Fallback for a generic item, should be checked last
    if (data.name && data.description) return ContentType.ITEM;

    return 'unknown';
}


/**
 * Imports data from a JSON string, handling both raw and pre-exported formats.
 * @param jsonString The JSON string to import.
 * @returns An array of processed data items or null if invalid.
 */
export function importFromJsonString<T extends AllCompendiumData>(jsonString: string): ExportedData<T>[] | null {
    try {
        const parsed = JSON.parse(jsonString.trim());

        // Case 1: The file is already in our standard export format.
        if (parsed.type && parsed.version && parsed.data) {
            new Notice(`Imported ${parsed.type} data successfully!`);
            // It's a valid, exported file. Return it directly, wrapped in an array for consistency.
            return [parsed as ExportedData<T>];
        }

        // Case 2: The file is a raw JSON object or array that needs to be processed.
        let itemsToProcess: any[] = [];
        if (Array.isArray(parsed)) {
            itemsToProcess = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
            itemsToProcess = [parsed];
        } else {
            new Notice("Import failed. File is not a valid JSON object or array.");
            return null;
        }

        const processedData: ExportedData<T>[] = [];
        let importedCount = 0;

        for (const item of itemsToProcess) {
            if (typeof item !== 'object' || item === null) continue;

            const contentType = detectContentType(item);
            if (contentType === 'unknown') {
                console.warn("Could not determine content type for an item, skipping.", item);
                continue;
            }

            // Ensure a unique ID exists for the data item itself.
            if (!item.id) {
                item.id = uuidv4();
            }

            processedData.push({
                type: contentType,
                version: '1.1.0',
                exportDate: new Date().toISOString(),
                data: item as T,
            });
            importedCount++;
        }

        if (processedData.length > 0) {
            new Notice(`Successfully imported ${importedCount} item(s).`);
            return processedData;
        } else {
            new Notice("Import failed. No valid content could be identified in the file.");
            return null;
        }

    } catch (e) {
        console.error("Error parsing import JSON:", e);
        new Notice("Import failed. The file contains invalid JSON.");
        return null;
    }
}


// --- UTILITY FUNCTIONS ---

/**
 * Re-export of validators from the content-validators file.
 */
export { isValidCharacterData, isValidContentData } from './content-validators';

/**
 * Copy text to clipboard.
 * @param text The text to copy.
 */
export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        new Notice('Copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        new Notice('Error: Could not copy to clipboard.');
    }
}

/**
 * Save data to a file in the user's downloads folder.
 * @param filename The filename to save.
 * @param content The content to save.
 */
export async function saveToFile(filename: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    new Notice(`Saved to ${filename}`);
}

/**
 * Fetch JSON data from a URL, handling various hosting providers.
 * @param url The URL to fetch JSON from.
 * @returns Promise that resolves to the JSON string.
 */
export async function fetchJsonFromUrl(url: string): Promise<string> {
    try {
        let fetchUrl = url;
        // Handle Pastebin URLs
        if (fetchUrl.includes('pastebin.com') && !fetchUrl.includes('/raw/')) {
            fetchUrl = fetchUrl.replace('pastebin.com/', 'pastebin.com/raw/');
        }
        // Handle GitHub Blob URLs
        if (fetchUrl.includes('github.com') && fetchUrl.includes('/blob/')) {
            fetchUrl = fetchUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }
        // Handle Gist URLs
        if (fetchUrl.includes('gist.github.com') && !fetchUrl.includes('raw.githubusercontent.com')) {
            fetchUrl = fetchUrl.replace('gist.github.com', 'gist.githubusercontent.com');
            if (!fetchUrl.includes('/raw')) {
                fetchUrl += '/raw';
            }
        }

        const response = await requestUrl({ url: fetchUrl });

        if (response.status !== 200) {
            throw new Error(`Failed to fetch data: Status ${response.status}`);
        }

        return response.text;
    } catch (error) {
        console.error('Error fetching JSON from URL:', error);
        throw error;
    }
}