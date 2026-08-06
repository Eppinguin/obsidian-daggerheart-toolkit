/** DOM-aware statblock discovery and parsing.
 *
 * Ported verbatim from the former `parser-patch.js`, which layered these
 * overrides onto `parser.js` at runtime. `parseText` here wraps
 * `parseTextBase` exactly as the patch wrapped `base.parseText`.
 */
import type { ParseMetadata, RawFeature, RawStatblock } from '../types';
import { clean, linesOf as lines, parseTextBase } from './text';

const ROLES = [
    'Bruiser',
    'Horde',
    'Leader',
    'Minion',
    'Ranged',
    'Skulk',
    'Social',
    'Solo',
    'Standard',
    'Support',
    'Traversal',
    'Event',
    'Exploration',
];

const CATEGORY = new Map([
    ['passive', 'Passive'],
    ['passives', 'Passive'],
    ['action', 'Action'],
    ['actions', 'Action'],
    ['reaction', 'Reaction'],
    ['reactions', 'Reaction'],
]);

const UI =
    /^(manage|edit|delete|remove|duplicate|copy|view|preview|open|close|cancel|save|add|add to encounter|remove from encounter|stat block|statblock|adversary overview|environment overview|community homebrew|community adversaries(?:\s*&\s*environments)?|homebrew vault|features|details|actions?|passives?|reactions?|download|share|report(?: this homebrew)?|scale adversary)$/i;

const LABEL =
    /^(tier|type|role|difficulty|hp|stress|attack(?: mod)?|damage thresholds?|thresholds?|standard attack|experience|experiences|motives\s*(?:&|and)\s*tactics|impulses|tone\s*(?:&|and)\s*feel|potential adversaries|features)\s*:?(?:\s+.*)?$/i;

export function usefulName(value: unknown): boolean {
    const line = clean(value);
    if (!line || line.length < 2 || line.length > 120 || UI.test(line) || LABEL.test(line)) return false;
    if (ROLES.some((role) => role.toLowerCase() === line.toLowerCase())) return false;
    if (/^(melee|very close|close|far|very far|physical|magical?|attack|adversary|environment)$/i.test(line))
        return false;
    return !/^[+−-]?\d+(?:\s*\/\s*\d+)?$/.test(line) && !/^(tier|difficulty|hp|stress)\s*\d+/i.test(line);
}

function headingName(value: unknown): boolean {
    const line = clean(value);
    return (
        usefulName(line) &&
        line.length <= 90 &&
        !/[.!?]$/.test(line) &&
        !/^(adversaries?|environments?|designed by|created by|author\b)/i.test(line)
    );
}

export function inferName(text: unknown): string {
    const all = lines(text);
    const stat = all.findIndex((line) => /^(tier|difficulty|type|role|hp|stress)\s*:?(?:\s|$)/i.test(line));
    if (stat > 0) {
        for (let index = stat - 1; index >= Math.max(0, stat - 8); index -= 1) {
            if (headingName(all[index])) return all[index];
        }
    }
    return all.find(usefulName) || 'Untitled Statblock';
}

function cost(value: unknown): string {
    const match = clean(value).match(/^(fear|stress|hope)\s*:?\s*(\d+)$/i);
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : '';
}

function featureName(value: unknown, next: unknown = ''): boolean {
    const line = clean(value);
    if (!line || line.length > 120 || UI.test(line) || LABEL.test(line) || cost(line) || line === '—' || line === '-')
        return false;
    if (/[.!?]$/.test(line) && !/\([^)]*\)$/.test(line)) return false;
    if (cost(next)) return true;
    return (
        line.length <= 80 &&
        line.split(/\s+/).length <= 12 &&
        !/^(when|whenever|while|after|before|if|spend|mark|make|the|a|an|this|that|all|each|target|targets)\b/i.test(
            line,
        )
    );
}

export function parseFeatureLines(input: string[]): RawFeature[] {
    const source = input.map(clean).filter(Boolean);
    const output: RawFeature[] = [];
    let type = 'Feature';
    let current: RawFeature | null = null;
    // Returns the new feature rather than assigning `current` from inside the
    // closure, so TypeScript can follow the dataflow. Behavior is unchanged.
    const start = (name: string, explicitType: string = type, description = ''): RawFeature => {
        const feature: RawFeature = {
            name: clean(name),
            type: clean(explicitType || 'Feature'),
            desc: clean(description),
        };
        output.push(feature);
        return feature;
    };

    for (let index = 0; index < source.length; index += 1) {
        const line = source[index];
        const section = CATEGORY.get(line.toLowerCase());
        if (section) {
            type = section;
            current = null;
            continue;
        }
        if (line === '—' || line === '-') continue;
        const inline = line.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)\s*:?[ \t]*(.*)$/i);
        if (inline) {
            current = start(inline[1], inline[2], inline[3]);
            continue;
        }
        const parsedCost = cost(line);
        if (parsedCost && current) {
            current.parsedCost = parsedCost;
            continue;
        }
        const next = source[index + 1] || '';
        if (!current || (current.desc && featureName(line, next))) {
            if (!current || featureName(line, next)) {
                current = start(line);
                continue;
            }
        }
        if (current) current.desc = clean(`${current.desc} ${line}`);
    }

    const seen = new Set<string>();
    return output.filter((item) => {
        if (!item.name || !item.desc) return false;
        const key = `${item.name}|${item.type}|${item.desc}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function after(start: Element, node: Element): boolean {
    return Boolean(start.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

export function textFeatures(text: unknown): RawFeature[] {
    const all = lines(text);
    const start = all.findIndex((line) => line.toLowerCase() === 'features');
    if (start < 0) return [];
    const boundary = all
        .slice(start + 1)
        .findIndex((line) =>
            /^(motives\s*(?:&|and)\s*tactics|experiences?|scale adversary|report this homebrew|download adversary card)$/i.test(
                line,
            ),
        );
    return parseFeatureLines(all.slice(start + 1, boundary < 0 ? undefined : start + 1 + boundary));
}

function domFeatures(root: Element): RawFeature[] {
    if (!root?.querySelectorAll || typeof Node === 'undefined') return [];
    const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const start = headings.find((node) => clean(node.textContent).toLowerCase() === 'features');
    if (!start) return [];
    const level = Number(start.tagName.slice(1));
    const end = headings.find((node) => after(start, node) && Number(node.tagName.slice(1)) <= level);
    const nodes = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,li,p,[role="listitem"]'))
        .filter((node) => after(start, node) && (!end || after(node, end)))
        .filter((node) => !(node.matches('p,[role="listitem"]') && node.closest('li') && node.closest('li') !== node));

    const output: RawFeature[] = [];
    let type = 'Feature';
    let current: RawFeature | null = null;
    for (const node of nodes) {
        const value = clean((node as HTMLElement).innerText || node.textContent);
        if (!value) continue;
        if (/^H[1-6]$/.test(node.tagName)) {
            const section = CATEGORY.get(value.toLowerCase());
            if (section) {
                type = section;
                current = null;
                continue;
            }
            if (featureName(value)) {
                current = { name: value, type, desc: '' };
                output.push(current);
            }
            continue;
        }
        if (node.matches('li,[role="listitem"]')) {
            const itemLines = lines((node as HTMLElement).innerText || node.textContent);
            if (!itemLines.length || itemLines[0] === '—') continue;
            const strong = node.querySelector('strong,b,h4,h5,h6');
            const name = clean(strong?.textContent || itemLines[0]);
            current = { name, type, desc: '' };
            output.push(current);
            for (const part of itemLines.slice(itemLines[0] === name ? 1 : 0)) {
                const parsedCost = cost(part);
                if (parsedCost && !current.parsedCost) current.parsedCost = parsedCost;
                else current.desc = clean(`${current.desc} ${part}`);
            }
            continue;
        }
        if (current) {
            for (const part of lines((node as HTMLElement).innerText || node.textContent)) {
                const parsedCost = cost(part);
                if (parsedCost && !current.parsedCost) current.parsedCost = parsedCost;
                else current.desc = clean(`${current.desc} ${part}`);
            }
        }
    }

    const seen = new Set<string>();
    return [...output, ...textFeatures((root as HTMLElement).innerText || root.textContent || '')].filter((item) => {
        if (!item.name || !item.desc) return false;
        const key = `${item.name.toLowerCase()}|${item.type}|${item.desc}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function shown(element: Element | null): boolean {
    if (!element) return false;
    if (typeof getComputedStyle !== 'function' || !element.getBoundingClientRect) return true;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 120 &&
        rect.height > 60
    );
}

function count(text: unknown, label: string): number {
    const re = new RegExp(`^${label}\\s*:?(?:\\s|$)`, 'i');
    return lines(text).filter((line) => re.test(line)).length;
}

interface Metrics {
    text: string;
    length: number;
    difficulty: number;
    tier: number;
    hp: number;
    stress: number;
    features: number;
    environment: number;
    attack: number;
}

function metrics(element: Element | null): Metrics {
    const text = (element as HTMLElement)?.innerText || element?.textContent || '';
    return {
        text,
        length: clean(text).length,
        difficulty: count(text, 'difficulty'),
        tier: count(text, 'tier'),
        hp: count(text, 'hp'),
        stress: count(text, 'stress'),
        features: count(text, 'features'),
        environment:
            count(text, 'impulses') + count(text, 'potential adversaries') + count(text, 'tone\\s*(?:&|and)\\s*feel'),
        attack:
            count(text, 'standard attack') + count(text, 'attack mod') + (text.toLowerCase().includes('atk:') ? 1 : 0),
    };
}

function candidateScore(element: Element): number {
    if (!shown(element)) return -1000;
    const item = metrics(element);
    if (item.length < 70 || item.length > 30000 || (!item.difficulty && !item.tier)) return -1000;
    if (!(item.hp || item.stress || item.environment || item.features || item.attack)) return -1000;
    let score = item.difficulty === 1 ? 20 : item.difficulty > 1 ? -30 * (item.difficulty - 1) : 0;
    score += item.tier === 1 ? 10 : item.tier > 1 ? -12 * (item.tier - 1) : 0;
    score += Math.min(item.hp, 1) * 5 + Math.min(item.stress, 1) * 5 + Math.min(item.features, 1) * 6;
    score += Math.min(item.environment, 2) * 4 + Math.min(item.attack, 2) * 3;
    if (element.matches?.('[role="dialog"],dialog,.modal,[class*="modal"],[class*="drawer"]')) score += 8;
    if (inferName(item.text) !== 'Untitled Statblock') score += 12;
    return score - Math.min(item.length / 2500, 8);
}

function directText(element: Element | null): string {
    return clean(
        Array.from(element?.childNodes || [])
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join(' '),
    );
}

function landmark(element: Element): boolean {
    const own = directText(element) || (element.children?.length === 0 ? clean(element.textContent) : '');
    const attrs = clean(
        `${element.getAttribute?.('aria-label') || ''} ${element.getAttribute?.('data-testid') || ''} ${element.className || ''}`,
    );
    return (
        /^(difficulty|tier|hp|stress|features|impulses|potential adversaries|standard attack|damage thresholds?)\b/i.test(
            own,
        ) || /\b(difficulty|stat.?block|hit.?points|stress|features)\b/i.test(attrs)
    );
}

export function scopeFor(doc: Document): Element {
    const selectors = [
        '[role="dialog"]',
        'dialog[open]',
        '.modal',
        '[class*="modal"]',
        '[class*="drawer"]',
        '[class*="popover"]',
    ];
    const found = selectors
        .flatMap((selector) => Array.from(doc.querySelectorAll(selector)))
        .filter(shown)
        .map((element) => ({ element, score: candidateScore(element) }))
        .filter((item) => item.score > 10)
        .sort((a, b) => b.score - a.score);
    return found[0]?.element || doc.body;
}

export function discover(doc: Document, selectedScope: Element | null = null): Element[] {
    const scope = selectedScope || scopeFor(doc);
    const all = [scope, ...Array.from(scope.querySelectorAll?.('*') || [])];
    const candidates = new Map<Element, number>();
    for (const marker of all.filter(landmark).slice(0, 500)) {
        let node: Element | null = marker;
        let best: Element | null = null;
        let score = -1000;
        for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
            if (node !== scope && !scope.contains(node)) break;
            const nextScore = candidateScore(node);
            const item = metrics(node);
            if (nextScore > score && item.difficulty <= 1 && item.tier <= 1) {
                best = node;
                score = nextScore;
            }
            if (item.difficulty > 1 || item.tier > 2 || node === scope) break;
        }
        if (best && score > 15) candidates.set(best, score);
    }
    for (const selector of ['[class*="statblock"]', '[class*="stat-block"]', 'article']) {
        for (const element of Array.from(scope.querySelectorAll?.(selector) || [])) {
            const score = candidateScore(element);
            const item = metrics(element);
            if (score > 15 && item.difficulty <= 1 && item.tier <= 1) candidates.set(element, score);
        }
    }
    const chosen: Array<{ element: Element; score: number; length: number }> = [];
    for (const entry of Array.from(candidates, ([element, score]) => ({
        element,
        score,
        length: metrics(element).length,
    })).sort((a, b) => b.score - a.score || a.length - b.length)) {
        if (
            !chosen.some(
                (item) =>
                    item.element === entry.element ||
                    item.element.contains(entry.element) ||
                    entry.element.contains(item.element),
            )
        )
            chosen.push(entry);
    }
    chosen.sort((a, b) =>
        typeof Node === 'undefined'
            ? 0
            : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING
              ? -1
              : 1,
    );
    return chosen.map((item) => item.element);
}

function beside(label: Element): string {
    const candidates: Element[] = [];
    if (label.nextElementSibling) candidates.push(label.nextElementSibling);
    const parent = label.parentElement;
    if (parent) {
        const children = Array.from(parent.children || []);
        const index = children.indexOf(label);
        if (index >= 0) candidates.push(...children.slice(index + 1));
        if (parent.nextElementSibling) candidates.push(parent.nextElementSibling);
    }
    for (const node of candidates) {
        const value = lines((node as HTMLElement).innerText || node.textContent || '')[0] || '';
        if (value && !LABEL.test(value) && !UI.test(value)) return value;
    }
    return '';
}

function fields(root: Element): Record<string, string> {
    const definitions: Array<[string, RegExp]> = [
        ['tier', /^tier$/i],
        ['type', /^(type|role)$/i],
        ['difficulty', /^difficulty$/i],
        ['hp', /^(hp|hit points?)$/i],
        ['stress', /^stress$/i],
        ['attack', /^attack mod(?:ifier)?$/i],
        ['experience', /^experiences?$/i],
        ['motives', /^motives\s*(?:&|and)\s*tactics$/i],
        ['impulses', /^impulses$/i],
        ['adversaries', /^potential adversaries$/i],
        ['tone', /^tone\s*(?:&|and)\s*feel$/i],
    ];
    const output: Record<string, string> = {};
    for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
        const raw = directText(element) || (element.children?.length === 0 ? clean(element.textContent) : '');
        // Sites render these labels both bare ("Motives & Tactics") and
        // colon-suffixed ("Motives & Tactics:"). The patterns are anchored, so
        // the colon has to come off before matching or the field is skipped.
        const label = raw.replace(/\s*:\s*$/, '');
        const definition = label.length <= 40 && definitions.find(([, pattern]) => pattern.test(label));
        if (definition && !output[definition[0]]) output[definition[0]] = beside(element);
    }
    return output;
}

function domName(root: Element): string {
    const candidates: Array<{ value: string; score: number }> = [];
    const all = lines((root as HTMLElement).innerText || root.textContent || '');
    const stat = all.findIndex((line) => /^(tier|difficulty|type|role|hp|stress)\s*:?(?:\s|$)/i.test(line));
    if (stat > 0) {
        for (let index = stat - 1; index >= Math.max(0, stat - 8); index -= 1) {
            if (headingName(all[index])) candidates.push({ value: all[index], score: 40 - (stat - index) });
        }
    }
    for (const node of Array.from(
        root.querySelectorAll?.('h1,h2,h3,h4,h5,h6,[data-testid*="name"],[class*="name"],[class*="title"]') || [],
    )) {
        const value = lines((node as HTMLElement).innerText || node.textContent || '')[0] || '';
        if (!headingName(value)) continue;
        const level = /^H[1-6]$/.test(node.tagName) ? Number(node.tagName.slice(1)) : 0;
        let score = level ? 72 - level * 5 : 48;
        if (/name|title/i.test(`${node.getAttribute?.('data-testid') || ''} ${node.className || ''}`)) score += 8;
        candidates.push({ value, score });
    }
    return (
        candidates.sort((a, b) => b.score - a.score || a.value.length - b.value.length)[0]?.value ||
        inferName((root as HTMLElement).innerText || root.textContent || '')
    );
}

/** Text parse with the DOM-derived field overrides layered on top. */
export function parseText(text: unknown, metadata: ParseMetadata = {}): RawStatblock {
    const result = parseTextBase(text, metadata);
    if (!metadata.name || !usefulName(result.name)) result.name = inferName(text);
    if (!metadata.features?.length) {
        const parsed = textFeatures(text);
        if (parsed.length) result.features = parsed;
    }
    const values = metadata.fields || {};
    if (values.tier) result.tier = Number(values.tier) || result.tier;
    if (values.type) result.type = clean(values.type);
    if (values.difficulty) result.difficulty = Number(values.difficulty) || result.difficulty;
    if (values.hp) result.hp = Number(values.hp) || result.hp;
    if (values.stress) result.stress = Number(values.stress) || result.stress;
    if (values.attack) result.attack = clean(values.attack);
    if (values.experience) result.xp = clean(values.experience);
    if (values.motives) result.motives = clean(values.motives);
    if (values.impulses) result.impulses = clean(values.impulses);
    if (values.adversaries) result.adversaries = clean(values.adversaries);
    if (values.tone) result.tone = clean(values.tone);
    return result;
}

function parseRoot(root: Element, location: Location | { href?: string; hostname?: string } | null): RawStatblock {
    const text = (root as HTMLElement).innerText || root.textContent || '';
    return parseText(text, {
        name: domName(root),
        source: location?.href || '',
        sourceSite: location?.hostname || '',
        author:
            (text.match(/Designed by\s+([^\n•]+)/i) ||
                text.match(/Created by\s+([^\n•]+)/i) ||
                text.match(/Author\s*:\s*([^\n]+)/i) ||
                [])[1] || '',
        features: domFeatures(root),
        fields: fields(root),
    });
}

function quality(item: RawStatblock): number {
    return (
        (usefulName(item.name) ? 5 : 0) +
        (item.tier != null ? 2 : 0) +
        (item.difficulty != null ? 2 : 0) +
        (item.hp != null || item.impulses || item.adversaries ? 2 : 0) +
        (item.features?.length ? 2 : 0) +
        (item.weapon || item.type ? 1 : 0)
    );
}

export function parseManyFromDocument(
    doc: Document,
    location: Location | { href?: string; hostname?: string } | null,
    selected: Element | null = null,
): RawStatblock[] {
    let roots = discover(doc, selected);
    if (!roots.length && selected) roots = [selected];
    if (!roots.length) roots = [scopeFor(doc)];
    const seen = new Set<string>();
    const output = roots
        .map((root) => parseRoot(root, location))
        .filter((item) => quality(item) >= 7)
        .filter((item) => {
            const key = `${clean(item.name).toLowerCase()}|${item.tier || ''}|${item.difficulty || ''}|${clean(item.weapon).toLowerCase()}|${clean(item.type).toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    if (output.length) return output;
    const fallback = parseRoot(selected || scopeFor(doc), location);
    fallback.extractionWarning =
        'No complete statblock card was detected. Open the preview or use Pick block(s) on page.';
    return [fallback];
}

export const parseFromDocument = (
    doc: Document,
    location: Location | { href?: string; hostname?: string } | null,
    selected: Element | null = null,
): RawStatblock => parseManyFromDocument(doc, location, selected)[0];

export const bestRoot = (doc: Document): Element => discover(doc)[0] || scopeFor(doc);
