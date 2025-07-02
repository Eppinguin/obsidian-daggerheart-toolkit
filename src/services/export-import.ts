// src/services/export-import.ts
import { Notice, TFile, TFolder, requestUrl } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';

/**
 * A generic data exporter/importer for Daggerheart content
 * Currently supports: characters
 * Can be extended to support other content types like compendium entries
 */

// Type for exported data
export interface ExportedData<T> {
    type: string;
    version: string;
    exportDate: string;
    data: T;
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
        version: '1.0.0', // Version of the export format
        exportDate: new Date().toISOString(),
        data
    };
}

/**
 * Export data to a JSON string
 * @param type Type of data being exported
 * @param data The data to export
 * @returns JSON string
 */
export function exportToJsonString<T>(type: string, data: T): string {
    const exportData = exportToJson(type, data);
    return JSON.stringify(exportData, null, 2);
}

/**
 * Import data from a JSON string
 * @param jsonString The JSON string to import
 * @returns The parsed data or null if invalid
 */
export function importFromJsonString<T>(jsonString: string): ExportedData<T> | null {
    try {
        const parsed = JSON.parse(jsonString);

        // Check if this is already in our export format
        if (parsed.type && parsed.version && parsed.data) {
            return parsed as ExportedData<T>;
        }

        // If not, check if it's a direct character object (with id and _type properties)
        if (parsed.id && parsed._type === 'character') {
            // Wrap it in our export format
            return {
                type: 'character',
                version: '1.0.0',
                exportDate: new Date().toISOString(),
                data: parsed as unknown as T
            };
        }

        // If it's an array of characters, take the first one
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0]._type === 'character') {
            return {
                type: 'character',
                version: '1.0.0',
                exportDate: new Date().toISOString(),
                data: parsed[0] as unknown as T
            };
        }

        return null;
    } catch (e) {
        console.error("Error parsing import JSON:", e);
        return null;
    }
}

/**
 * Validates that imported data is a valid character
 * @param data The data to validate
 * @returns True if valid character data
 */
export function isValidCharacterData(data: any): boolean {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof data.id === 'string' &&
        data._type === 'character' &&
        typeof data.name === 'string'
    );
}

/**
 * Copy text to clipboard
 * @param text The text to copy
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return Promise.resolve();
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        return Promise.reject(err);
    }
}

/**
 * Save data to a file in the user's downloads folder
 * @param plugin The plugin instance
 * @param filename The filename to save
 * @param content The content to save
 */
export async function saveToFile(filename: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Fetch JSON data from a URL
 * @param url The URL to fetch JSON from
 * @returns Promise that resolves to the JSON string
 */
export async function fetchJsonFromUrl(url: string): Promise<string> {
    try {
        // Handle pastebin URLs
        if (url.includes('pastebin.com') && !url.includes('/raw/')) {
            // Convert regular pastebin URL to raw URL
            url = url.replace('pastebin.com/', 'pastebin.com/raw/');
        }

        // Handle GitHub URLs
        if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
            if (url.includes('/blob/')) {
                // Convert GitHub blob URL to raw URL
                url = url.replace('github.com', 'raw.githubusercontent.com');
                url = url.replace('/blob/', '/');
            } else {
                // Try to convert other GitHub URLs
                url = url.replace('github.com', 'raw.githubusercontent.com');
            }
        }

        // Handle Gist URLs
        if (url.includes('gist.github.com') && !url.includes('raw.githubusercontent.com')) {
            // First try to convert to raw gist URL
            url = url.replace('gist.github.com', 'gist.githubusercontent.com');
            if (!url.includes('/raw')) {
                url += '/raw';
            }
        }

        console.log('Fetching from URL:', url);

        // Use Obsidian's requestUrl API which handles CORS correctly
        const response = await requestUrl({
            url: url,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        // Check if the response is valid
        if (response.status !== 200) {
            throw new Error(`Failed to fetch data: ${response.status} ${response.status}`);
        }

        return response.text;
    } catch (error) {
        console.error('Error fetching JSON from URL:', error);
        throw error;
    }
}
