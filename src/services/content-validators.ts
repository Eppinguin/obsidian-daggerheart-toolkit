// src/services/content-validators.ts
import { ContentType } from './export-import';
import { Character, SavedEncounter } from '../types';

/**
 * Validates that data is a valid character
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
 * Debug helper for encounter validation - logs detailed validation info
 * @param data The data to validate
 * @returns Object with validation details
 */
export function debugEncounterValidation(data: any): { valid: boolean, details: Record<string, boolean> } {
    const details = {
        isObject: typeof data === 'object',
        notNull: data !== null,
        hasStringId: typeof data?.id === 'string',
        hasStringName: typeof data?.name === 'string',
        hasAdversariesArray: Array.isArray(data?.adversaries),
        hasAdversaryGroupOrderArray: Array.isArray(data?.adversaryGroupOrder)
    };

    const valid = Object.values(details).every(value => value === true);

    console.log('Encounter validation details:', details);
    return { valid, details };
}

/**
 * Validates that data is a valid encounter
 * @param data The data to validate
 * @returns True if valid encounter data
 */
export function isValidEncounterData(data: any): boolean {
    // Run debug validation and log results
    const validation = debugEncounterValidation(data);

    return (
        typeof data === 'object' &&
        data !== null &&
        typeof data.id === 'string' &&
        typeof data.name === 'string' &&
        Array.isArray(data.adversaries) &&
        Array.isArray(data.adversaryGroupOrder)
    );
}

/**
 * Validates that imported data is valid for the specified content type
 * @param data The data to validate
 * @param contentType The expected content type
 * @returns True if valid content data
 */
export function isValidContentData(data: any, contentType: ContentType): boolean {
    // Basic validation for all content types
    if (typeof data !== 'object' || data === null || typeof data.id !== 'string') {
        return false;
    }

    // Content type specific validation
    switch (contentType) {
        case ContentType.CHARACTER:
            return isValidCharacterData(data);

        case ContentType.ENCOUNTER:
            return isValidEncounterData(data);

        case ContentType.ADVERSARY:
            return data._type === 'adversary' && typeof data.name === 'string';

        case ContentType.ENVIRONMENT:
            return data._type === 'environment' && typeof data.name === 'string';

        // Add validation for other content types as needed

        default:
            // Basic validation for unsupported types - just check it has an ID and name
            return typeof data.name === 'string';
    }
}
