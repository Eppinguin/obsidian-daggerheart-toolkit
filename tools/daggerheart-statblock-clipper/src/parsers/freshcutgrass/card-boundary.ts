/** Picks the correct description for a FreshCutGrass card when several cards
 * share a listing page.
 *
 * Two halves, previously split across two files that could not import each
 * other:
 *
 *  - item repair (`repairFreshCutGrassDomItem`, `parseFreshCutGrassState`),
 *    from the former `freshcutgrass-card-boundary.js`;
 *  - DOM scanning (`domCardDescription`, `enrichFreshCutGrassItems` and their
 *    helpers), which lived inline in `content-script.js` because the injected
 *    file list could not load this module.
 *
 * They share `clean`, `validCardDescription`, and the attribution/date
 * patterns, which is why the inline copy re-declared them.
 */
import {
    repairFreshCutGrassDomItem as originalRepair,
    parseFreshCutGrassState as originalStateParser,
} from './rendered-repair';

const clean = (value: any) =>
    String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
const INVALID =
    /^(?:no comments? yet(?:[.!]\s*)?(?:be the first to comment[.!]?)?|be the first to comment[.!]?|sign in to comment|log in to comment)$/i;
const DATE_PREFIX = /^(?:\d{1,2}[/.-]){2}\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i;
const ATTRIBUTION_TEXT =
    /\bthis\s+(?:adversary|environment)\s+was\s+made\s+by\b|\byou\s+can\s+find\s+more\s+of\b|\b(?:created|designed|submitted|uploaded)\s+by\b|https?:\/\/|\b(?:ko-fi|patreon)\.com\b/i;

function validCardDescription(value: any) {
    const text = clean(value);
    return (
        text.length >= 12 &&
        text.split(/\s+/).length >= 4 &&
        !INVALID.test(text) &&
        !/\bno comments? yet\b|\bbe the first to comment\b/i.test(text) &&
        !DATE_PREFIX.test(text) &&
        !ATTRIBUTION_TEXT.test(text)
    );
}

function descriptionMap(items: any) {
    const map = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const name = clean(item?.name).toLowerCase();
        const description = clean(item?.__cardDescription);
        if (name && validCardDescription(description)) map.set(name, description);
    }
    return map;
}

export function repairFreshCutGrassDomItem(item: any, sourceUrl = '') {
    const cardDescription = clean(item?.__cardDescription);
    const inputStateDescription =
        item?.extractionMethod === 'freshcutgrass-app-state' && validCardDescription(item?.desc)
            ? clean(item.desc)
            : '';
    const repaired = typeof originalRepair === 'function' ? originalRepair(item, sourceUrl) : { ...item };
    if (inputStateDescription) repaired.desc = inputStateDescription;
    else if (validCardDescription(cardDescription)) repaired.desc = cardDescription;
    delete repaired.__cardDescription;
    return repaired;
}

export function parseFreshCutGrassState(input: any, sourceUrl = '', domItems: any[] = []) {
    const byName = descriptionMap(domItems);
    const parsed = typeof originalStateParser === 'function' ? originalStateParser(input, sourceUrl, domItems) : [];
    return (Array.isArray(parsed) ? parsed : []).map((item) => {
        const description = byName.get(clean(item?.name).toLowerCase()) || clean(item?.__cardDescription);
        const output = { ...item };
        const stateDescription =
            output.extractionMethod === 'freshcutgrass-app-state' && validCardDescription(output.desc);
        if (validCardDescription(description) && !stateDescription) output.desc = description;
        delete output.__cardDescription;
        return output;
    });
}

/* ------------------------------------------------------------------------
 * DOM scanning
 *
 * Moved out of `content-script.js`, which declared these inline because the
 * injected file list could not import this module.
 * --------------------------------------------------------------------- */

const lines = (value: any): string[] =>
    String(value ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map(clean)
        .filter(Boolean);

const CARD_SECTION = /^(?:motives\s*(?:&|and)\s*tactics|tone\s*(?:&|and)\s*feel|impulses|potential adversaries)\s*:?$/i;
const CARD_STOP =
    /^(?:motives\s*(?:&|and)\s*tactics|tone\s*(?:&|and)\s*feel|impulses|potential adversaries|difficulty|standard attack|attack|features|experiences?|hp\s*&\s*stress|comments?)\s*:?$/i;
const CARD_META =
    /^(?:tier|type|role)\s*:?$|^(?:tier\s*)?\d+$|^(?:bruiser|horde|leader|minion|ranged|skulk|social|solo|standard|support|traversal|event|exploration|environment(?:exploration|event|social|traversal)?)$/i;
const CARD_UI =
    /^(?:manage|preview|edit|delete|community adversaries?\s*&\s*environments?|liked|in library|comments?)\b/i;

function looksLikeNextCard(linesSource: any, index: any) {
    const line = linesSource[index] || '';
    if (!line || line.length > 90 || CARD_STOP.test(line) || CARD_META.test(line) || CARD_UI.test(line)) return false;
    if (!/^[A-Z0-9][A-Z0-9 '\-–—]+$/.test(line) || line.split(/\s+/).length > 8) return false;
    const nearby = linesSource.slice(index + 1, index + 6);
    return nearby.some((entry: any) => CARD_META.test(entry)) && nearby.some((entry: any) => /^\d+$/.test(entry));
}

export function cardDescriptionCandidatesFromText(text: any, name: any) {
    const source = lines(text);
    const wanted = clean(name).toLowerCase();
    const output: Array<{ description: string; score: number; start: number; stoppedBySection: boolean }> = [];
    for (let start = 0; start < source.length; start += 1) {
        if (clean(source[start]).toLowerCase() !== wanted) continue;
        const parts: string[] = [];
        let stoppedBySection = false;
        for (let index = start + 1; index < source.length && index <= start + 16; index += 1) {
            const line = source[index];
            if (clean(line).toLowerCase() === wanted) break;
            if (CARD_STOP.test(line)) {
                stoppedBySection = true;
                break;
            }
            if (DATE_PREFIX.test(line) || ATTRIBUTION_TEXT.test(line)) break;
            if (parts.length && looksLikeNextCard(source, index)) break;
            if (CARD_META.test(line) || CARD_UI.test(line) || /^[+−-]?\d+(?:\s*[♡♥🔖])?$/u.test(line)) continue;
            if (line.length < 3 || line.length > 800) continue;
            parts.push(line);
            if (parts.join(' ').length > 650) break;
        }
        const description = clean(parts.join(' '));
        if (!validCardDescription(description)) continue;
        let score = 0;
        if (stoppedBySection) score += 100;
        if (description.length <= 350) score += 20;
        if (/^[A-Z]/.test(description)) score += 5;
        if (/[.!?]$/.test(description)) score += 3;
        score -= Math.min(start / 1000, 2);
        output.push({ description, score, start, stoppedBySection });
    }
    const seen = new Set<string>();
    return output
        .filter((entry) => {
            const key = entry.description.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => b.score - a.score || a.start - b.start || a.description.length - b.description.length);
}

export function cardDescriptionFromText(text: any, name: any) {
    return cardDescriptionCandidatesFromText(text, name)[0]?.description || '';
}

function exactNameNodes(root: any, name: any) {
    if (!root?.querySelectorAll || !name) return [];
    const wanted = clean(name).toLowerCase();
    const preferred = Array.from(
        root.querySelectorAll(
            'h1,h2,h3,h4,h5,h6,[role="heading"],[data-testid*="name"],[class*="name"],[class*="title"]',
        ),
    );
    const exact = preferred.filter((node: any) => clean(node.innerText || node.textContent).toLowerCase() === wanted);
    if (exact.length) return exact;
    return Array.from(root.querySelectorAll('*'))
        .filter(
            (node: any) => !node.children?.length && clean(node.innerText || node.textContent).toLowerCase() === wanted,
        )
        .slice(0, 20);
}

function cardContainer(root: any, nameNode: any) {
    let node = nameNode?.parentElement || null;
    let fallback = null;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        if (node !== root && root?.contains && !root.contains(node)) break;
        const text = node.innerText || node.textContent || '';
        const textLines = lines(text);
        const length = clean(text).length;
        if (length > 30 && length < 6000) {
            const cardish = node.matches?.(
                'article,li,[role="listitem"],[data-testid*="card"],[class*="card"],[class*="tile"],[class*="preview"]',
            );
            if (cardish && !fallback) fallback = node;
            if (textLines.some((line) => CARD_SECTION.test(line))) return node;
        }
        if (node === root) break;
    }
    return fallback;
}

export function domCardDescription(root: any, name: any) {
    const pageText = root?.innerText || root?.textContent || '';
    const candidates = cardDescriptionCandidatesFromText(pageText, name).map((entry) => ({
        ...entry,
        source: 'page',
    }));
    for (const nameNode of exactNameNodes(root, name)) {
        const card = cardContainer(root, nameNode);
        if (!card) continue;
        for (const entry of cardDescriptionCandidatesFromText(card.innerText || card.textContent || '', name)) {
            candidates.push({ ...entry, score: entry.score + 25, source: 'container' });
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.start - b.start || a.description.length - b.description.length);
    return candidates[0]?.description || '';
}

/** Only reads `body`/`documentElement` and `hostname`, so the parameters are
 * typed structurally rather than as full `Document`/`Location`. */
export function enrichFreshCutGrassItems(
    items: any,
    doc: { body?: unknown; documentElement?: unknown } = document,
    currentLocation: { hostname?: string } = location,
) {
    if (!/freshcutgrass\.app$/i.test(currentLocation?.hostname || '')) return items;
    return (Array.isArray(items) ? items : []).map((item) => {
        const description = domCardDescription(doc.body || doc.documentElement || doc, item?.name || '');
        return description ? { ...item, desc: description, __cardDescription: description } : item;
    });
}
