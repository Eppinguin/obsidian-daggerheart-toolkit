// The framework-free shared runtime is bundled by esbuild and also copied into
// browser-extension builds. Its public surface is typed below.
// @ts-ignore JavaScript runtime intentionally has no standalone declaration file.
import '../../shared/statblock-format.js';
import type { StatblockData, StatblockFeature } from '../types';

export interface StatblockValidation {
    valid: boolean;
    data: StatblockData | null;
    errors: string[];
    warnings: string[];
}

export interface NormalizedImportEntry<T = any> {
    type: string;
    version: string;
    exportDate: string;
    data: T;
    validation: StatblockValidation | { valid: true; errors: string[]; warnings: string[] };
}

interface StatblockFormatRuntime {
    FORMAT_VERSION: string;
    normalizeFeature(input: any): StatblockFeature | null;
    normalizeStatblock(input: any, declaredType?: string): StatblockData | null;
    validateStatblock(input: any): StatblockValidation;
    detectContentType(input: any): string;
    createEnvelope(input: any | any[]): {
        type: string;
        version: string;
        exportDate: string;
        data: any | any[];
    };
    normalizePayload(input: string | object): NormalizedImportEntry[];
    toYaml(input: any): string;
    toMarkdown(input: any | any[]): string;
    toJson(input: any | any[]): string;
}

const runtime = (globalThis as any).DHStatblockFormat as StatblockFormatRuntime | undefined;
if (!runtime) throw new Error('Daggerheart statblock format runtime failed to load.');

export const STATBLOCK_FORMAT_VERSION = runtime.FORMAT_VERSION;

/**
 * Normalize one feature for display on a card.
 *
 * On top of the shared runtime's parse, the generic 'Feature' fallback becomes
 * 'Passive': a card badge has to name something the GM can act on.
 */
export const normalizeStatblockFeature = (input: any): StatblockFeature | null => {
    const feature = runtime.normalizeFeature(input);
    if (!feature) return null;
    return feature.type === 'Feature' ? { ...feature, type: 'Passive' } : feature;
};
export const normalizeStatblockData = (input: any, declaredType?: string): StatblockData | null =>
    runtime.normalizeStatblock(input, declaredType);
export const validateStatblockData = (input: any): StatblockValidation => runtime.validateStatblock(input);
export const detectStatblockContentType = (input: any): string => runtime.detectContentType(input);
export const createStatblockEnvelope = (input: any | any[]) => runtime.createEnvelope(input);
export const normalizeStatblockPayload = (input: string | object): NormalizedImportEntry[] =>
    runtime.normalizePayload(input);
export const statblockToYaml = (input: any): string => runtime.toYaml(input);
export const statblockToMarkdown = (input: any | any[]): string => runtime.toMarkdown(input);
export const statblockToJson = (input: any | any[]): string => runtime.toJson(input);
