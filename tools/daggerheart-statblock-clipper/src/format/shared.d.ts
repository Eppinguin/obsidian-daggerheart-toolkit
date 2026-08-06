/** Types for `shared/statblock-format.js`, which stays framework-free JavaScript
 * so the Obsidian plugin can keep consuming it as CJS, ESM, and raw text.
 * Keep this in sync with the `api` object at the bottom of that file.
 */
import type { RawStatblock, ToolkitStatblock, ToolkitFeature } from '../types';

export interface StatblockFormatApi {
    FORMAT_VERSION: string;
    clean(value: unknown): string;
    normalizeFeature(feature: unknown): ToolkitFeature | null;
    normalizeStatblock(input: unknown, category?: string): ToolkitStatblock | null;
    validateStatblock(input: unknown): { valid: boolean; errors: string[] };
    detectContentType(input: unknown): string;
    createEnvelope(input: unknown): {
        type: string;
        version: string;
        exportDate: string;
        data: ToolkitStatblock | ToolkitStatblock[];
    };
    normalizePayload(input: unknown): ToolkitStatblock[];
    toYaml(input: RawStatblock | ToolkitStatblock): string;
    toMarkdown(input: RawStatblock | ToolkitStatblock | Array<RawStatblock | ToolkitStatblock>): string;
    toJson(input: RawStatblock | ToolkitStatblock | Array<RawStatblock | ToolkitStatblock>): string;
}

declare global {
    // eslint-disable-next-line no-var
    var DHStatblockFormat: StatblockFormatApi | undefined;
}

declare const api: StatblockFormatApi;
export default api;
