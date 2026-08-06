/** Serialization backed by `shared/statblock-format.js`.
 *
 * The legacy `statblock-format-adapter.js` did two unrelated things: it
 * patched these serializers onto the parser object, and it monkey-patched
 * `api.tabs.create` to intercept Obsidian URIs. The launch behavior now lives
 * in `lib/obsidian-launch.ts`; this module is serialization only.
 *
 * `shared/statblock-format.js` stays plain JavaScript because the Obsidian
 * plugin consumes it as CJS, ESM, and raw text. It installs itself on
 * globalThis, so importing it for side effects is how we load it.
 */
import '../../../../shared/statblock-format.js';
import type { StatblockFormatApi } from './shared';
import type { RawStatblock, ToolkitStatblock } from '../types';

function format(): StatblockFormatApi {
    const api = (globalThis as { DHStatblockFormat?: StatblockFormatApi }).DHStatblockFormat;
    if (!api) throw new Error('shared/statblock-format.js did not load.');
    return api;
}

export function toToolkitStatblock(input: RawStatblock): ToolkitStatblock {
    const normalized = format().normalizeStatblock(input, input?.category);
    if (!normalized) throw new Error('No valid statblock is available.');
    return normalized;
}

export const toToolkitExport = (input: RawStatblock) => format().createEnvelope(input);
export const toToolkitYaml = (input: RawStatblock) => format().toYaml(input);
export const toToolkitMarkdown = (input: RawStatblock) => format().toMarkdown(input);
export const toToolkitMarkdownMany = (items: RawStatblock[]) => format().toMarkdown(items);
export const toToolkitJson = (input: RawStatblock) => format().toJson(input);
export const toToolkitJsonMany = (items: RawStatblock[]) => format().toJson(items);
export const validateToolkitStatblock = (input: RawStatblock) => format().validateStatblock(input);
