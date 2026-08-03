// src/services/content-validators.ts
import { ContentType } from './export-import';
import { Character, SavedEncounter } from '../types';

export function isValidCharacterData(data: any): data is Character {
    return typeof data === 'object' && data !== null &&
        typeof data.id === 'string' && data._type === 'character' && typeof data.name === 'string';
}

export function debugEncounterValidation(data: any): { valid: boolean; details: Record<string, boolean> } {
    const details = {
        isObject: typeof data === 'object',
        notNull: data !== null,
        hasStringId: typeof data?.id === 'string',
        hasStringName: typeof data?.name === 'string',
        hasAdversariesArray: Array.isArray(data?.adversaries),
        hasAdversaryGroupOrderArray: Array.isArray(data?.adversaryGroupOrder)
    };
    return { valid: Object.values(details).every(Boolean), details };
}

export function isValidEncounterData(data: any): data is SavedEncounter {
    return debugEncounterValidation(data).valid;
}

function isValidStatblockData(data: any, category: 'adversary' | 'environment'): boolean {
    if (typeof data !== 'object' || data === null) return false;
    if (data.category !== category || typeof data.name !== 'string' || !data.name.trim()) return false;
    if (typeof data.hp_stress !== 'object' || data.hp_stress === null) return false;
    return Number.isFinite(Number(data.hp_stress.hp)) && Number.isFinite(Number(data.hp_stress.stress));
}

export function isValidContentData(data: any, contentType: ContentType): boolean {
    switch (contentType) {
        case ContentType.CHARACTER:
            return isValidCharacterData(data);
        case ContentType.ENCOUNTER:
            return isValidEncounterData(data);
        case ContentType.ADVERSARY:
            return isValidStatblockData(data, 'adversary');
        case ContentType.ENVIRONMENT:
            return isValidStatblockData(data, 'environment');
        default:
            return typeof data === 'object' && data !== null &&
                typeof data.name === 'string' && data.name.trim().length > 0;
    }
}
