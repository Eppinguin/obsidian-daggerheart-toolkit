// src/services/export-import.ts
import { Notice, requestUrl } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { AllCompendiumData } from '../types';
import {
    STATBLOCK_FORMAT_VERSION,
    createStatblockEnvelope,
    normalizeStatblockData,
    validateStatblockData
} from './statblock-format';

export interface ExportedData<T> {
    type: string;
    version: string;
    exportDate: string;
    data: T;
    validation?: { valid: boolean; errors: string[]; warnings: string[] };
}

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

export interface ContentTypeInfo {
    type: ContentType;
    displayName: string;
    description: string;
    icon: string;
    collection: string;
}

export const CONTENT_TYPE_INFO: Record<ContentType, ContentTypeInfo> = {
    [ContentType.CHARACTER]: { type: ContentType.CHARACTER, displayName: 'Character', description: 'Export or import character sheets', icon: 'user', collection: 'characters' },
    [ContentType.ENCOUNTER]: { type: ContentType.ENCOUNTER, displayName: 'Encounter', description: 'Export or import saved encounters', icon: 'swords', collection: 'encounters' },
    [ContentType.ADVERSARY]: { type: ContentType.ADVERSARY, displayName: 'Adversary', description: 'Export or import adversary statblocks', icon: 'skull', collection: 'statblocks' },
    [ContentType.ENVIRONMENT]: { type: ContentType.ENVIRONMENT, displayName: 'Environment', description: 'Export or import environment statblocks', icon: 'mountain-snow', collection: 'statblocks' },
    [ContentType.ABILITY]: { type: ContentType.ABILITY, displayName: 'Ability', description: 'Export or import abilities', icon: 'zap', collection: 'abilities' },
    [ContentType.CLASS]: { type: ContentType.CLASS, displayName: 'Class', description: 'Export or import classes', icon: 'shield-half', collection: 'classes' },
    [ContentType.SUBCLASS]: { type: ContentType.SUBCLASS, displayName: 'Subclass', description: 'Export or import subclasses', icon: 'shield-half', collection: 'subclasses' },
    [ContentType.ANCESTRY]: { type: ContentType.ANCESTRY, displayName: 'Ancestry', description: 'Export or import ancestries', icon: 'dna', collection: 'ancestries' },
    [ContentType.COMMUNITY]: { type: ContentType.COMMUNITY, displayName: 'Community', description: 'Export or import communities', icon: 'home', collection: 'communities' },
    [ContentType.ARMOR]: { type: ContentType.ARMOR, displayName: 'Armor', description: 'Export or import armor', icon: 'shield', collection: 'armors' },
    [ContentType.WEAPON]: { type: ContentType.WEAPON, displayName: 'Weapon', description: 'Export or import weapons', icon: 'sword', collection: 'weapons' },
    [ContentType.ITEM]: { type: ContentType.ITEM, displayName: 'Item', description: 'Export or import items', icon: 'backpack', collection: 'items' },
    [ContentType.CONSUMABLE]: { type: ContentType.CONSUMABLE, displayName: 'Consumable', description: 'Export or import consumables', icon: 'potion', collection: 'consumables' }
};

function isStatblockType(type: string): boolean {
    return type === ContentType.ADVERSARY || type === ContentType.ENVIRONMENT || type === 'statblocks';
}

export function exportToJson<T>(type: string, data: T): ExportedData<T> {
    if (isStatblockType(type)) return createStatblockEnvelope(data) as ExportedData<T>;
    return { type, version: STATBLOCK_FORMAT_VERSION, exportDate: new Date().toISOString(), data };
}

export function exportToJsonString<T>(type: string, data: T): string {
    return JSON.stringify(exportToJson(type, data), null, 2);
}

function detectContentType(data: any): ContentType | 'unknown' {
    if (!data || typeof data !== 'object') return 'unknown';
    if (data._type && Object.values(ContentType).includes(data._type as ContentType)) return data._type as ContentType;
    if (data['dg-character'] && data.ancestryId) return ContentType.CHARACTER;
    if (Array.isArray(data.adversaries) && Array.isArray(data.adversaryGroupOrder)) return ContentType.ENCOUNTER;
    if (Array.isArray(data.class_feats) && data.domain_1) return ContentType.CLASS;
    if (Array.isArray(data.foundations) && Array.isArray(data.specializations)) return ContentType.SUBCLASS;
    if (Array.isArray(data.feats) && data.note) return ContentType.COMMUNITY;
    if (data.recall && data.domain) return ContentType.ABILITY;
    if (data.base_score && data.base_thresholds) return ContentType.ARMOR;
    if (data.primary_or_secondary && data.damage) return ContentType.WEAPON;
    if (data.roll && data.name && data.description) return ContentType.CONSUMABLE;
    if (data.category === 'environment' || data.impulses || data.potential_adversaries || data.tone) return ContentType.ENVIRONMENT;
    if (data.category === 'adversary' || data.hp_stress || data.hp !== undefined || data.stress !== undefined || data.weapon || data.motives || data.motives_tactics) return ContentType.ADVERSARY;
    if (Array.isArray(data.feats)) return ContentType.ANCESTRY;
    if (data.name && data.description) return ContentType.ITEM;
    return 'unknown';
}

function normalizeItem(item: any, contentType: ContentType): { data: any; validation?: { valid: boolean; errors: string[]; warnings: string[] } } | null {
    if (contentType === ContentType.ADVERSARY || contentType === ContentType.ENVIRONMENT) {
        const validation = validateStatblockData({ ...item, category: contentType });
        if (!validation.data) return null;
        return { data: validation.data, validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings } };
    }
    if (!item.id) item.id = uuidv4();
    return { data: item };
}

/** Parse raw objects, arrays, or toolkit envelopes without discarding batch entries. */
export function parseImportJson<T extends AllCompendiumData>(jsonString: string): ExportedData<T>[] {
    const parsed = JSON.parse(jsonString.trim());
    const processed: ExportedData<T>[] = [];

    if (parsed?.type && parsed?.data !== undefined) {
        const declared = Object.values(ContentType).includes(parsed.type as ContentType) ? parsed.type as ContentType : null;
        const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
        for (const item of items) {
            const contentType = declared || detectContentType(item);
            if (contentType === 'unknown') continue;
            const normalized = normalizeItem(item, contentType);
            if (!normalized) continue;
            processed.push({
                type: contentType,
                version: parsed.version || STATBLOCK_FORMAT_VERSION,
                exportDate: parsed.exportDate || new Date().toISOString(),
                data: normalized.data as T,
                validation: normalized.validation
            });
        }
        return processed;
    }

    const items = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    for (const item of items) {
        const contentType = detectContentType(item);
        if (contentType === 'unknown') continue;
        const normalized = normalizeItem(item, contentType);
        if (!normalized) continue;
        processed.push({
            type: contentType,
            version: STATBLOCK_FORMAT_VERSION,
            exportDate: new Date().toISOString(),
            data: normalized.data as T,
            validation: normalized.validation
        });
    }
    return processed;
}

export function importFromJsonString<T extends AllCompendiumData>(jsonString: string): ExportedData<T>[] | null {
    try {
        const processed = parseImportJson<T>(jsonString);
        if (!processed.length) {
            new Notice('Import failed. No valid content could be identified in the file.');
            return null;
        }
        new Notice(`Successfully parsed ${processed.length} item(s) for import.`);
        return processed;
    } catch (error) {
        console.error('Error parsing import JSON:', error);
        new Notice('Import failed. The file contains invalid JSON.');
        return null;
    }
}

export { normalizeStatblockData };
export { isValidCharacterData, isValidContentData } from './content-validators';

export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        new Notice('Copied to clipboard!');
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        new Notice('Error: Could not copy to clipboard.');
    }
}

export async function saveToFile(filename: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    new Notice(`Saved to ${filename}`);
}

export async function fetchJsonFromUrl(url: string): Promise<string> {
    let fetchUrl = url;
    if (fetchUrl.includes('pastebin.com') && !fetchUrl.includes('/raw/')) fetchUrl = fetchUrl.replace('pastebin.com/', 'pastebin.com/raw/');
    if (fetchUrl.includes('github.com') && fetchUrl.includes('/blob/')) fetchUrl = fetchUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    if (fetchUrl.includes('gist.github.com') && !fetchUrl.includes('raw.githubusercontent.com')) {
        fetchUrl = fetchUrl.replace('gist.github.com', 'gist.githubusercontent.com');
        if (!fetchUrl.includes('/raw')) fetchUrl += '/raw';
    }
    const response = await requestUrl({ url: fetchUrl });
    if (response.status !== 200) throw new Error(`Failed to fetch data: Status ${response.status}`);
    return response.text;
}
