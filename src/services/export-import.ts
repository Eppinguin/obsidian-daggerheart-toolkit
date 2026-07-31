// src/services/export-import.ts
import { Notice, requestUrl } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { AllCompendiumData, StatblockData, StatblockFeature } from '../types';

/** Standard wrapper for exported and imported data. */
export interface ExportedData<T> {
    type: string;
    version: string;
    exportDate: string;
    data: T;
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
    [ContentType.CLASS]: { type: ContentType.CLASS, displayName: 'Class', description: 'Export or import classes', icon: 'shield', collection: 'classes' },
    [ContentType.SUBCLASS]: { type: ContentType.SUBCLASS, displayName: 'Subclass', description: 'Export or import subclasses', icon: 'shield-half', collection: 'subclasses' },
    [ContentType.ANCESTRY]: { type: ContentType.ANCESTRY, displayName: 'Ancestry', description: 'Export or import ancestries', icon: 'dna', collection: 'ancestries' },
    [ContentType.COMMUNITY]: { type: ContentType.COMMUNITY, displayName: 'Community', description: 'Export or import communities', icon: 'home', collection: 'communities' },
    [ContentType.ARMOR]: { type: ContentType.ARMOR, displayName: 'Armor', description: 'Export or import armor', icon: 'shield', collection: 'armors' },
    [ContentType.WEAPON]: { type: ContentType.WEAPON, displayName: 'Weapon', description: 'Export or import weapons', icon: 'sword', collection: 'weapons' },
    [ContentType.ITEM]: { type: ContentType.ITEM, displayName: 'Item', description: 'Export or import items', icon: 'backpack', collection: 'items' },
    [ContentType.CONSUMABLE]: { type: ContentType.CONSUMABLE, displayName: 'Consumable', description: 'Export or import consumables', icon: 'potion', collection: 'consumables' }
};

export function exportToJson<T>(type: string, data: T): ExportedData<T> {
    return { type, version: '1.1.0', exportDate: new Date().toISOString(), data };
}

export function exportToJsonString<T>(type: string, data: T): string {
    return JSON.stringify(exportToJson(type, data), null, 2);
}

function cleanString(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\u00a0/g, ' ').trim() : '';
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || value === '—' || value === '-') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown): number {
    return nullableNumber(value) ?? 0;
}

function parseThresholds(input: any): { major: number | null; severe: number | null } {
    const hpStress = input?.hp_stress;
    if (hpStress && typeof hpStress === 'object') {
        return {
            major: nullableNumber(hpStress.major_hp),
            severe: nullableNumber(hpStress.severe_hp)
        };
    }

    const raw = cleanString(input?.thresholds || input?.damage_thresholds);
    const [major, severe] = raw.split('/').map(part => part.trim());
    return { major: nullableNumber(major), severe: nullableNumber(severe) };
}

function normalizeFeature(feature: any): StatblockFeature | null {
    if (!feature || typeof feature !== 'object') return null;

    let name = cleanString(feature.name) || 'Feature';
    let type = cleanString(feature.type);
    const suffix = name.match(/\s*[-–—]\s*(Passive|Action|Reaction)\s*$/i);
    if (!type && suffix) type = suffix[1];
    if (suffix) name = name.slice(0, suffix.index).trim();

    const description = cleanString(feature.description || feature.desc || feature.text);
    if (!description) return null;

    const costMatch = name.match(/\s*\((Fear|Stress|Hope)\s*(\d+)\)\s*$/i);
    const parsedCost = cleanString(feature.parsedCost || feature.cost) ||
        (costMatch ? `${costMatch[1][0].toUpperCase()}${costMatch[1].slice(1).toLowerCase()} ${costMatch[2]}` : undefined);
    if (costMatch) name = name.slice(0, costMatch.index).trim();

    return {
        name,
        type: type || 'Feature',
        ...(parsedCost ? { parsedCost } : {}),
        ...(feature.countdown !== undefined ? { countdown: feature.countdown } : {}),
        description
    };
}

function isEnvironmentShape(input: any, declaredType?: ContentType): boolean {
    if (declaredType === ContentType.ENVIRONMENT || input?.category === 'environment' || input?._type === 'environment') return true;
    if (declaredType === ContentType.ADVERSARY || input?.category === 'adversary' || input?._type === 'adversary') return false;
    if (input?.impulses || input?.potential_adversaries || input?.adversaries || input?.tone) return true;
    return ['Traversal', 'Event', 'Exploration'].includes(cleanString(input?.type));
}

/**
 * Convert toolkit-native, SRD-shaped, and browser-clipper-shaped statblocks to StatblockData.
 */
export function normalizeStatblockData(input: any, declaredType?: ContentType): StatblockData | null {
    if (!input || typeof input !== 'object' || !cleanString(input.name)) return null;

    const category: 'adversary' | 'environment' = isEnvironmentShape(input, declaredType) ? 'environment' : 'adversary';
    const thresholds = parseThresholds(input);
    const sourceInput = input.source && typeof input.source === 'object' ? input.source : {};
    const source = {
        site: cleanString(sourceInput.site || input.sourceSite),
        url: cleanString(sourceInput.url || (typeof input.source === 'string' ? input.source : '')),
        author: cleanString(sourceInput.author || input.author),
        importedAt: cleanString(sourceInput.importedAt || input.extractedAt) || new Date().toISOString()
    };

    const normalized: StatblockData & {
        source?: typeof source;
        tone?: string;
    } = {
        name: cleanString(input.name),
        category,
        ...(input.image ? { image: cleanString(input.image) } : {}),
        ...(input.tier !== undefined && input.tier !== '' ? { tier: input.tier } : {}),
        ...(input.type ? { type: cleanString(input.type) } : {}),
        ...(input.description || input.desc ? { description: cleanString(input.description || input.desc) } : {}),
        ...(input.difficulty !== undefined && input.difficulty !== '' ? { difficulty: input.difficulty } : {}),
        hp_stress: {
            hp: numberOrZero(input.hp_stress?.hp ?? input.hp),
            stress: numberOrZero(input.hp_stress?.stress ?? input.stress),
            major_hp: thresholds.major,
            severe_hp: thresholds.severe
        },
        features: (Array.isArray(input.features) ? input.features : Array.isArray(input.feats) ? input.feats : [])
            .map(normalizeFeature)
            .filter((feature: StatblockFeature | null): feature is StatblockFeature => feature !== null),
        source,
        isCustom: true
    };

    if (category === 'adversary') {
        const hasLegacyWeapon = Boolean(input.weapon);
        const attackObject = input.attack && typeof input.attack === 'object' ? input.attack : null;
        normalized.attack = {
            name: cleanString(attackObject?.name || input.weapon || (!hasLegacyWeapon ? input.attack : '') || 'Attack'),
            range: cleanString(attackObject?.range || input.range),
            damage: cleanString(attackObject?.damage || input.damage),
            modifier: attackObject?.modifier ?? input.atk ?? input.attack_modifier ?? (hasLegacyWeapon ? input.attack : '0') ?? '0'
        };
        normalized.experience = input.experience ?? input.xp;
        normalized.motives_tactics = input.motives_tactics ?? input.motives_and_tactics ?? input.motives;
    } else {
        normalized.impulses = cleanString(input.impulses);
        normalized.potential_adversaries = cleanString(input.potential_adversaries || input.adversaries);
        normalized.tone = cleanString(input.tone);
    }

    return normalized;
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

    if (data.category === 'environment' || data.impulses || data.potential_adversaries || data.adversaries || data.tone) {
        return ContentType.ENVIRONMENT;
    }
    if (data.category === 'adversary' || data.hp_stress || data.hp !== undefined || data.stress !== undefined || data.weapon || data.motives) {
        return ContentType.ADVERSARY;
    }

    if (Array.isArray(data.feats)) return ContentType.ANCESTRY;
    if (data.name && data.description) return ContentType.ITEM;
    return 'unknown';
}

function normalizeItem(item: any, contentType: ContentType): any | null {
    if (contentType === ContentType.ADVERSARY || contentType === ContentType.ENVIRONMENT) {
        return normalizeStatblockData(item, contentType);
    }
    if (!item.id) item.id = uuidv4();
    return item;
}

/** Import raw objects, arrays, or the toolkit export wrapper. */
export function importFromJsonString<T extends AllCompendiumData>(jsonString: string): ExportedData<T>[] | null {
    try {
        const parsed = JSON.parse(jsonString.trim());
        const processedData: ExportedData<T>[] = [];

        if (parsed?.type && parsed?.version && parsed?.data !== undefined) {
            const declaredType = Object.values(ContentType).includes(parsed.type as ContentType)
                ? parsed.type as ContentType
                : null;
            const wrappedItems = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

            for (const item of wrappedItems) {
                const contentType = declaredType || detectContentType(item);
                if (contentType === 'unknown') continue;
                const normalized = normalizeItem(item, contentType);
                if (!normalized) continue;
                processedData.push({
                    type: contentType,
                    version: parsed.version || '1.1.0',
                    exportDate: parsed.exportDate || new Date().toISOString(),
                    data: normalized as T
                });
            }
        } else {
            const itemsToProcess = Array.isArray(parsed) ? parsed :
                (typeof parsed === 'object' && parsed !== null ? [parsed] : []);

            for (const item of itemsToProcess) {
                if (!item || typeof item !== 'object') continue;
                const contentType = detectContentType(item);
                if (contentType === 'unknown') {
                    console.warn('Could not determine content type for an item, skipping.', item);
                    continue;
                }
                const normalized = normalizeItem(item, contentType);
                if (!normalized) continue;
                processedData.push({
                    type: contentType,
                    version: '1.1.0',
                    exportDate: new Date().toISOString(),
                    data: normalized as T
                });
            }
        }

        if (!processedData.length) {
            new Notice('Import failed. No valid content could be identified in the file.');
            return null;
        }

        new Notice(`Successfully parsed ${processedData.length} item(s) for import.`);
        return processedData;
    } catch (error) {
        console.error('Error parsing import JSON:', error);
        new Notice('Import failed. The file contains invalid JSON.');
        return null;
    }
}

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
    try {
        let fetchUrl = url;
        if (fetchUrl.includes('pastebin.com') && !fetchUrl.includes('/raw/')) {
            fetchUrl = fetchUrl.replace('pastebin.com/', 'pastebin.com/raw/');
        }
        if (fetchUrl.includes('github.com') && fetchUrl.includes('/blob/')) {
            fetchUrl = fetchUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }
        if (fetchUrl.includes('gist.github.com') && !fetchUrl.includes('raw.githubusercontent.com')) {
            fetchUrl = fetchUrl.replace('gist.github.com', 'gist.githubusercontent.com');
            if (!fetchUrl.includes('/raw')) fetchUrl += '/raw';
        }

        const response = await requestUrl({ url: fetchUrl });
        if (response.status !== 200) throw new Error(`Failed to fetch data: Status ${response.status}`);
        return response.text;
    } catch (error) {
        console.error('Error fetching JSON from URL:', error);
        throw error;
    }
}
