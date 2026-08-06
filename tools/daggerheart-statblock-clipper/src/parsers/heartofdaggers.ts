/** Heart of Daggers rendered-card selection and attribution filtering.
 *
 * Ported verbatim from the former `heartofdaggers-filter.js`. Note this module
 * uses its own `clean` (collapsing all whitespace including newlines), which
 * differs from `text.ts`'s. Kept separate deliberately.
 */
import type { RawStatblock } from '../types';
import { parseManyFromDocument as coreParseMany } from './core';

const clean = (value: unknown): string =>
    String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const textLines = (value: unknown): string[] =>
    String(value ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map(clean)
        .filter(Boolean);

const ROLES = '(?:Bruiser|Horde|Leader|Minion|Ranged|Skulk|Social|Solo|Standard|Support|Traversal|Event|Exploration)';
const COMPACT_TIER = new RegExp(`^Tier\\s+\\d+\\s+${ROLES}\\b`, 'i');

const ATTRIBUTION_TITLE = new RegExp(
    '^(?:' +
        'this\\s+is\\s+(?:an?\\s+)?(?:conversion|adaptation|port|rework)\\b|' +
        'this\\s+(?:adversary|environment|statblock|homebrew)\\s+(?:is|was|has)\\b|' +
        '(?:a\\s+)?(?:conversion|adaptation|port|rework)\\s+of\\b|' +
        '(?:image|art|artwork|illustration|credit|credits|license|source)\\s+(?:is|by|from|credit|credits)?\\b|' +
        '(?:cc|creative\\s+commons)[-\\s]?(?:by|by-sa|zero|0)?\\b|' +
        '(?:based|adapted|converted|ported)\\s+(?:on|from)\\b|' +
        '(?:original(?:ly)?|created|written|designed)\\s+by\\b|' +
        'u\\/|r\\/|https?:\\/\\/' +
        ')',
    'i',
);

const ATTRIBUTION_CONTENT =
    /\b(?:from\s+reddit|on\s+reddit|image\s+is\s+cc|cc[-\s]?by(?:-sa)?(?:-\d(?:\.\d)?)?|creative\s+commons|attribution\s+license|licensed\s+under)\b/i;

export function attributionTitle(value: unknown): boolean {
    const title = clean(value);
    if (!title) return true;
    if (ATTRIBUTION_TITLE.test(title) || ATTRIBUTION_CONTENT.test(title)) return true;
    return title.split(/\s+/).length > 20 && /[.!?]/.test(title);
}

export function completeHeartOfDaggersItem(item: RawStatblock | null | undefined): boolean {
    if (!item || typeof item !== 'object') return false;
    const name = clean(item.name);
    const type = clean(item.type);
    if (!name || name.length > 140 || attributionTitle(name)) return false;
    if (item.tier == null || item.difficulty == null || !type) return false;

    const adversaryCore = item.hp != null && item.stress != null;
    const environmentCore = Boolean(clean(item.impulses) || clean(item.adversaries) || clean(item.tone));
    return adversaryCore || environmentCore;
}

export function isHeartOfDaggers(location: { hostname?: string } | null | undefined): boolean {
    return /^(?:www\.)?heartofdaggers\.com$/i.test(location?.hostname || '');
}

function visible(element: Element | null): boolean {
    if (!element) return false;
    if (typeof getComputedStyle !== 'function' || !element.getBoundingClientRect) return true;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 160 &&
        rect.height > 100
    );
}

export function renderedCardSignature(value: unknown): boolean {
    const lines = textLines(value);
    if (!lines.some((line) => COMPACT_TIER.test(line))) return false;
    if (!lines.some((line) => /^Features$/i.test(line))) return false;

    const adversaryStats = lines.some(
        (line) =>
            /\bDifficulty\s*:\s*\d+/i.test(line) && /\bHP\s*:\s*\d+/i.test(line) && /\bStress\s*:\s*\d+/i.test(line),
    );
    const adversaryAttack = lines.some((line) => /^ATK\s*:\s*[+−-]?\d+\s*\|/i.test(line));
    const environmentStats =
        lines.some((line) => /^Difficulty\s*:\s*\d+\b/i.test(line)) &&
        lines.some((line) => /^(?:Impulses|Potential Adversaries)\s*:/i.test(line));

    return (adversaryStats && adversaryAttack) || environmentStats;
}

function documentOrder(a: Element, b: Element): number {
    if (a === b || typeof Node === 'undefined' || !a?.compareDocumentPosition) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function renderedCardRoots(doc: Document, selected: Element | null = null): Element[] {
    const scope = selected || doc?.body || doc?.documentElement || (doc as unknown as Element);
    if (!scope) return [];
    const all = [scope, ...Array.from(scope.querySelectorAll?.('*') || [])];
    const candidates = all.filter(
        (element) =>
            visible(element) && renderedCardSignature((element as HTMLElement).innerText || element.textContent || ''),
    );

    const smallest = candidates.filter(
        (candidate) => !candidates.some((other) => other !== candidate && candidate.contains?.(other)),
    );
    return smallest.sort(documentOrder);
}

export function motivesFromText(value: unknown): string {
    const lines = textLines(value);
    const boundary =
        /^(?:Difficulty|Thresholds?|HP|Stress|ATK|Attack|Experience|Features|Passives?|Actions?|Reactions?)\b/i;
    for (let index = 0; index < lines.length; index += 1) {
        const inline = lines[index].match(/^Motives\s*(?:&|and)\s*Tactics\s*:\s*(.*)$/i);
        const heading = /^Motives\s*(?:&|and)\s*Tactics\s*:?$/i.test(lines[index]);
        if (!inline && !heading) continue;
        const parts: string[] = [];
        if (inline?.[1]) parts.push(inline[1]);
        for (let next = index + 1; next < lines.length; next += 1) {
            if (boundary.test(lines[next])) break;
            parts.push(lines[next]);
        }
        return clean(parts.join(' '));
    }
    return '';
}

export function restoreMotives(item: RawStatblock): RawStatblock {
    if (!item || typeof item !== 'object' || clean(item.motives)) return item;
    const motives = motivesFromText(item.rawText || '');
    return motives ? { ...item, motives } : item;
}

export function filterHeartOfDaggersItems(
    items: RawStatblock[],
    location: { hostname?: string } | null,
): RawStatblock[] {
    const input = Array.isArray(items) ? items : [];
    if (!isHeartOfDaggers(location)) return input;
    const seen = new Set<string>();
    return input
        .map(restoreMotives)
        .filter(completeHeartOfDaggersItem)
        .filter((item) => {
            const key = `${clean(item.name).toLowerCase()}|${item.tier ?? ''}|${clean(item.type).toLowerCase()}|${item.difficulty ?? ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/** Heart of Daggers renders every card in the listing, so select rendered-card
 * roots first and parse each one, then drop attribution blocks and duplicates. */
export function parseManyFromDocument(
    doc: Document,
    location: (Location | { href?: string; hostname?: string }) | null,
    selected: Element | null = null,
): RawStatblock[] {
    if (!isHeartOfDaggers(location)) return coreParseMany(doc, location, selected);

    const roots = renderedCardRoots(doc, selected);
    const parsed = roots.length
        ? roots.flatMap((root) => coreParseMany(doc, location, root))
        : coreParseMany(doc, location, selected);
    return filterHeartOfDaggersItems(parsed, location);
}
