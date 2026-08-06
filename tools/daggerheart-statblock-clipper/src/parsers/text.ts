/** Text-level statblock parsing.
 *
 * Ported verbatim from the former `parser.js`. `parseText` here is the base
 * pass; `core.ts` wraps it with the DOM-aware overrides that used to live in
 * `parser-patch.js`.
 */
import type { ParseMetadata, RawFeature, RawStatblock } from '../types';

export const ROLES = [
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

export const ENVIRONMENT_ROLES = new Set(['Traversal', 'Event', 'Exploration']);

export const clean = (value: unknown): string =>
    String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim();

export const linesOf = (text: unknown): string[] =>
    String(text ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map(clean)
        .filter(Boolean);

export function firstMatch(text: unknown, patterns: RegExp[], group = 1): string {
    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (match?.[group] != null) return clean(match[group]);
    }
    return '';
}

export function numberValue(text: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return firstMatch(text, [new RegExp(`(?:^|\\n|\\|)\\s*${escaped}\\s*:?\\s*([+−-]?\\d+)`, 'i')]);
}

export function sectionRaw(text: string, starts: string[], ends: string[]): string {
    const lines = linesOf(text);
    const lower = lines.map((line) => line.toLowerCase());
    const startNames = starts.map((name) => name.toLowerCase());
    const endNames = ends.map((name) => name.toLowerCase());
    const headingIndex = lower.findIndex((line) =>
        startNames.some((name) => line === name || line.startsWith(`${name}:`)),
    );
    if (headingIndex < 0) return '';
    let end = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (endNames.some((name) => lower[index] === name || lower[index].startsWith(`${name}:`))) {
            end = index;
            break;
        }
    }
    return lines.slice(headingIndex + 1, end).join('\n');
}

export function valueAfterLabel(text: string, labels: string[], stops: string[] = []): string {
    const lines = linesOf(text);
    const normalized = labels.map((label) => label.toLowerCase());
    const stopNames = stops.map((label) => label.toLowerCase());
    for (let index = 0; index < lines.length; index += 1) {
        const lower = lines[index].toLowerCase();
        if (stopNames.includes(lower)) break;
        for (const label of normalized) {
            if (lower === label && lines[index + 1]) return lines[index + 1];
            if (lower.startsWith(`${label}:`)) return clean(lines[index].slice(label.length + 1));
        }
    }
    return '';
}

export function inferNameFromMetadata(text: string, metadata: ParseMetadata): string {
    if (metadata.name) return clean(metadata.name);
    const banned =
        /^(community homebrew|community adversaries|stat block|adversary overview|environment overview|features|homebrew vault)$/i;
    return (
        linesOf(text).find((line) => line.length < 100 && !banned.test(line) && !/^tier\b/i.test(line)) ||
        'Untitled Statblock'
    );
}

export function parseThresholds(text: string): string {
    const explicit = String(text).match(/Thresholds?\s*:?\s*([—\d]+)\s*\/\s*([—\d]+)/i);
    if (explicit) return `${explicit[1]}/${explicit[2]}`;
    const block = sectionRaw(
        text,
        ['Damage thresholds', 'Thresholds'],
        ['Standard attack', 'Features', 'Motives & tactics'],
    );
    const values = (block.match(/\b\d+\b/g) || []).filter((value) => !['1', '2', '3'].includes(value));
    return values.length >= 2 ? `${values[0]}/${values[1]}` : '';
}

interface AttackParts {
    weapon: string;
    range: string;
    damage: string;
    attack: string;
}

export function parseAttack(text: string): AttackParts {
    const result: AttackParts = { weapon: '', range: '', damage: '', attack: '' };
    const compact = String(text).match(/ATK\s*:\s*([+−-]?\d+)\s*\|\s*([^|\n:]+)\s*:\s*([^|\n]+)\s*\|\s*([^\n]+)/i);
    if (compact) {
        result.attack = clean(compact[1]).replace('−', '-');
        result.weapon = clean(compact[2]);
        result.range = clean(compact[3]);
        result.damage = clean(compact[4])
            .replace(/\bPhysical\b/i, 'phy')
            .replace(/\bMagical?\b/i, 'mag');
        return result;
    }

    const block = sectionRaw(text, ['Standard attack'], ['Features', 'Motives & tactics', 'Experiences']);
    if (!block) return result;
    result.weapon = linesOf(block).find((line) => !/^(Range|Damage|Attack Mod|Damage Type)\s*:/i.test(line)) || '';
    result.range = firstMatch(block, [/Range\s*:\s*([^|]+?)(?=\s+Damage\s*:|$)/i]);
    const dice = firstMatch(block, [/Damage\s*:\s*([^|]+?)(?=\s+Attack Mod\s*:|$)/i]);
    const type = firstMatch(block, [/Damage Type\s*:\s*(Physical|Magical?)/i]);
    result.damage = clean(`${dice}${type ? ` ${type}` : ''}`)
        .replace(/\bPhysical\b/i, 'phy')
        .replace(/\bMagical?\b/i, 'mag');
    result.attack = firstMatch(block, [/Attack Mod\s*:\s*([+−-]?\d+)/i]).replace('−', '-');
    return result;
}

export function parseFeaturesFromText(text: string): RawFeature[] {
    const block = sectionRaw(
        text,
        ['Features'],
        ['Motives & tactics', 'Experiences', 'Scale Adversary', 'Report this Homebrew'],
    );
    const features: RawFeature[] = [];
    let current: RawFeature | null = null;
    for (const line of linesOf(block)) {
        const match = line.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)\s*:\s*(.+)$/i);
        if (match) {
            current = { name: clean(match[1]), type: clean(match[2]), desc: clean(match[3]) };
            features.push(current);
        } else if (current && !/^(Passives?|Actions?|Reactions?)$/i.test(line)) {
            current.desc = clean(`${current.desc} ${line}`);
        }
    }
    return features;
}

export function parseDescription(text: string, name: string): string {
    const overview = sectionRaw(text, ['Adversary overview', 'Environment overview'], ['Stat block']);
    if (overview) {
        const lines = linesOf(overview);
        return lines.length > 1 && lines[0].length < 90 ? clean(lines.slice(1).join(' ')) : clean(overview);
    }
    const lines = linesOf(text);
    const start = lines.indexOf(name);
    const candidates = start >= 0 ? lines.slice(start + 1) : lines;
    return (
        candidates.find(
            (line) =>
                line.length > 20 &&
                line.length < 500 &&
                !/^(Adversaries|Environments|Designed by|Tier\b|Type\b|Difficulty\b|HP\b|Stress\b|Attack mod\b|Motives & tactics\b|Tone & feel\b)/i.test(
                    line,
                ),
        ) || ''
    );
}

/** Base text parse. `core.ts` layers the DOM-derived overrides on top. */
export function parseTextBase(text: unknown, metadata: ParseMetadata = {}): RawStatblock {
    const normalized = String(text ?? '').replace(/\r/g, '');
    const name = inferNameFromMetadata(normalized, metadata);
    const type =
        valueAfterLabel(normalized, ['Type', 'Role']) ||
        ROLES.find((role) => new RegExp(`\\b${role}\\b`, 'i').test(normalized)) ||
        '';
    const isEnvironment =
        ENVIRONMENT_ROLES.has(type) || /\b(tone\s*&\s*feel|potential adversaries|impulses)\b/i.test(normalized);
    const attack = parseAttack(normalized);
    const result: RawStatblock = {
        name,
        tier: Number(numberValue(normalized, 'Tier') || firstMatch(normalized, [/\bTier\s+(\d)\b/i])) || undefined,
        type,
        desc: parseDescription(normalized, name),
        difficulty: Number(numberValue(normalized, 'Difficulty')) || undefined,
        features: metadata.features?.length ? metadata.features : parseFeaturesFromText(normalized),
        source: metadata.source || '',
        sourceSite: metadata.sourceSite || '',
        author: metadata.author || '',
        extractedAt: new Date().toISOString(),
        rawText: normalized.trim(),
    };

    if (isEnvironment) {
        result.tone = valueAfterLabel(
            normalized,
            ['Tone & feel', 'Tone and feel'],
            ['Potential adversaries', 'Features'],
        );
        result.adversaries = valueAfterLabel(normalized, ['Potential adversaries'], ['Features', 'Experiences']);
        result.impulses = valueAfterLabel(
            normalized,
            ['Impulses'],
            ['Tone & feel', 'Potential adversaries', 'Features'],
        );
    } else {
        result.weapon = attack.weapon;
        result.range = attack.range;
        result.damage = attack.damage;
        result.hp = Number(numberValue(normalized, 'HP')) || undefined;
        result.stress = Number(numberValue(normalized, 'Stress')) || undefined;
        result.thresholds = parseThresholds(normalized);
        result.attack = attack.attack || numberValue(normalized, 'Attack mod');
        result.xp =
            valueAfterLabel(normalized, ['Experience', 'Experiences'], ['Features']) ||
            firstMatch(normalized, [/Experience\s*:\s*([^\n]+)/i]);
        result.motives = valueAfterLabel(
            normalized,
            ['Motives & tactics', 'Motives and tactics'],
            ['Experiences', 'Features'],
        );
    }

    for (const key of Object.keys(result) as Array<keyof RawStatblock>) {
        const value = result[key];
        if (value === '' || value === undefined || (Array.isArray(value) && !value.length)) delete result[key];
    }
    return result;
}
