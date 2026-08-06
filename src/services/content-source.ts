/**
 * The content-source registry.
 *
 * Every statblock belongs to exactly one source. A source is either bundled SRD
 * data, a JSON file under user_data/, or a folder of Markdown notes. Sources can
 * be toggled, reordered by priority, and flagged as personal licensed content
 * that must never leave the vault.
 *
 * This module is deliberately free of Obsidian imports so the migration logic
 * can be exercised by a plain node script.
 */

export type ContentSourceKind = 'builtin-srd' | 'user-json' | 'markdown';

export interface ContentSource {
    /** Stable kebab-case identifier. Never changes once a source exists. */
    id: string;
    label: string;
    kind: ContentSourceKind;
    /**
     * user-json: a file name inside user_data/.
     * builtin-srd: a file name inside data/.
     * markdown: a vault folder path.
     */
    path: string;
    enabled: boolean;
    /** Higher wins when two sources define the same name. */
    priority: number;
    /** Whether the user may delete this source. */
    removable: boolean;
    /** Whether the plugin may write to it. False for SRD and Markdown. */
    writable: boolean;
    /** Personal licensed content: every export affordance is suppressed. */
    doNotDistribute?: boolean;
    /** builtin-srd files use a flat wire format rather than StatblockData. */
    wireFormat?: 'srd-flat';
    /** builtin-srd only: the category every entry in the file takes. */
    forcedCategory?: 'adversary' | 'environment';
}

export const BUILTIN_SOURCE_IDS = {
    srdAdversaries: 'srd-adversaries',
    srdEnvironments: 'srd-environments',
    userJson: 'user-custom',
    markdown: 'markdown-folder',
} as const;

/**
 * Merge order. Markdown beats JSON beats SRD, which reproduces the ordering the
 * loader had before sources existed.
 */
export const SOURCE_PRIORITY = {
    builtin: 0,
    userJson: 100,
    markdown: 200,
} as const;

const DEFAULT_USER_FILE = 'user-adversaries.json';

export function isSourceWritable(source: ContentSource | undefined | null): boolean {
    return !!source && source.writable === true;
}

/** Licensed sources are never exportable, whatever else they allow. */
export function isSourceExportable(source: ContentSource | undefined | null): boolean {
    return !!source && source.doNotDistribute !== true;
}

/**
 * Sort for the merge pass: lowest precedence first, so later sources overwrite
 * earlier ones on a name clash.
 *
 * Registry order is the authority, which is what makes reordering in the UI
 * meaningful. `priority` is retained only to seed the order on registries
 * written before reordering existed.
 */
export function sortSourcesForMerge(sources: ContentSource[]): ContentSource[] {
    return [...sources];
}

/**
 * Put a registry into precedence order once, so an existing install keeps the
 * behaviour it had before order became explicit.
 */
export function orderSourcesByLegacyPriority(sources: ContentSource[]): ContentSource[] {
    return sources
        .map((source, index) => ({ source, index }))
        .sort((a, b) => (a.source.priority ?? 0) - (b.source.priority ?? 0) || a.index - b.index)
        .map((entry) => entry.source);
}

/**
 * Move a source one step through the precedence order.
 *
 * `delta` is +1 toward winning clashes (later in the list) and -1 toward losing
 * them. Returns null when the move is not possible.
 */
export function reorderSource(sources: ContentSource[], sourceId: string, delta: number): ContentSource[] | null {
    const from = sources.findIndex((source) => source.id === sourceId);
    if (from < 0) return null;
    const to = from + delta;
    if (to < 0 || to >= sources.length) return null;

    const next = [...sources];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

/** Which source currently wins a given entry name, if any. */
export function resolveWinner(sources: ContentSource[], candidates: string[]): string | undefined {
    for (let index = sources.length - 1; index >= 0; index--) {
        const source = sources[index];
        if (source.enabled && candidates.includes(source.id)) return source.id;
    }
    return undefined;
}

/** Kebab-case an arbitrary label, disambiguating against ids already taken. */
export function slugifySourceId(label: string, taken: Set<string> = new Set()): string {
    const base =
        String(label ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'source';

    if (!taken.has(base)) return base;
    let counter = 2;
    while (taken.has(`${base}-${counter}`)) counter++;
    return `${base}-${counter}`;
}

/**
 * Derive a safe file name for a user-json source.
 *
 * The result is interpolated into `${manifest.dir}/user_data/${path}`, so path
 * separators and parent-directory hops have to be stripped rather than merely
 * discouraged.
 */
export function sourceFileName(value: string): string {
    const cleaned = String(value ?? '')
        .trim()
        .replace(/[\\/]/g, '-')
        .replace(/\.\.+/g, '.')
        .replace(/^[.-]+/, '')
        .replace(/[^A-Za-z0-9._-]/g, '-');

    const name = cleaned || 'source';
    return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

/** The four sources every install has, derived from the pre-registry settings. */
export function createDefaultSources(settings: any): ContentSource[] {
    const markdownPath = String(settings?.compendiumFolder ?? '').trim();
    return [
        {
            id: BUILTIN_SOURCE_IDS.srdAdversaries,
            label: 'SRD Adversaries',
            kind: 'builtin-srd',
            path: 'adversaries.json',
            enabled: settings?.useSrdAdversaries !== false,
            priority: SOURCE_PRIORITY.builtin,
            removable: false,
            writable: false,
            wireFormat: 'srd-flat',
            forcedCategory: 'adversary',
        },
        {
            id: BUILTIN_SOURCE_IDS.srdEnvironments,
            label: 'SRD Environments',
            kind: 'builtin-srd',
            path: 'environments.json',
            enabled: settings?.useSrdEnvironments !== false,
            priority: SOURCE_PRIORITY.builtin,
            removable: false,
            writable: false,
            wireFormat: 'srd-flat',
            forcedCategory: 'environment',
        },
        {
            id: BUILTIN_SOURCE_IDS.userJson,
            label: 'My Custom Content',
            kind: 'user-json',
            path: sourceFileName(settings?.userCompendiumFile || DEFAULT_USER_FILE),
            enabled: true,
            priority: SOURCE_PRIORITY.userJson,
            // Not removable: this is the fallback write target, so deleting it
            // would leave nowhere for new entries to go.
            removable: false,
            writable: true,
        },
        {
            id: BUILTIN_SOURCE_IDS.markdown,
            label: markdownPath || 'Markdown Folder',
            kind: 'markdown',
            path: markdownPath,
            enabled: !!markdownPath,
            priority: SOURCE_PRIORITY.markdown,
            // The original folder is kept in the registry so the legacy
            // compendiumFolder setting always has something to mirror, but its
            // path is editable and further folders can be added alongside it.
            removable: false,
            writable: false,
        },
    ];
}

/** Build a new Markdown folder source from a vault-relative path. */
export function createMarkdownSource(folderPath: string, existing: ContentSource[], label?: string): ContentSource {
    const path = normalizeFolderPath(folderPath);
    const taken = new Set(existing.map((source) => source.id));
    const name = String(label ?? '').trim() || path.split('/').pop() || 'Markdown Folder';
    return {
        id: slugifySourceId(`md-${name}`, taken),
        label: name,
        kind: 'markdown',
        path,
        enabled: !!path,
        priority: SOURCE_PRIORITY.markdown,
        removable: true,
        writable: false,
    };
}

/**
 * Normalize a vault folder path the same way the loader does, so a path typed
 * with stray slashes or backslashes still matches the files under it.
 */
export function normalizeFolderPath(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

/** Every configured Markdown folder, for the file watcher and the loader. */
export function markdownSources(sources: ContentSource[]): ContentSource[] {
    return sources.filter((source) => source.kind === 'markdown' && source.enabled && !!source.path);
}

/**
 * Populate the registry on installs that predate it.
 *
 * Idempotent by design: an existing non-empty registry is left completely
 * alone. Running twice must never duplicate a source.
 *
 * @returns true when settings were changed and need saving.
 */
export function migrateContentSources(settings: any): boolean {
    if (!settings) return false;
    if (Array.isArray(settings.contentSources) && settings.contentSources.length) {
        let changed = ensureDefaultWriteSource(settings);
        // Registry order became the precedence authority. Sort once, so an
        // install written before that keeps the ordering it already had.
        if (!settings.sourceOrderMigrated) {
            settings.contentSources = orderSourcesByLegacyPriority(settings.contentSources);
            settings.sourceOrderMigrated = true;
            changed = true;
        }
        return changed;
    }

    settings.contentSources = createDefaultSources(settings);
    settings.defaultWriteSourceId = BUILTIN_SOURCE_IDS.userJson;
    settings.sourceOrderMigrated = true;
    return true;
}

/** Keep defaultWriteSourceId pointing at a source that actually accepts writes. */
export function ensureDefaultWriteSource(settings: any): boolean {
    const sources: ContentSource[] = settings?.contentSources ?? [];
    const current = sources.find((source) => source.id === settings.defaultWriteSourceId);
    if (isSourceWritable(current)) return false;

    const fallback =
        sources.find((source) => source.id === BUILTIN_SOURCE_IDS.userJson && source.writable) ??
        sources.find(isSourceWritable);
    if (!fallback) return false;

    settings.defaultWriteSourceId = fallback.id;
    return true;
}

/**
 * Mirror the registry back onto the pre-registry settings keys, so downgrading
 * to an older build still finds the same SRD toggles and user file.
 */
export function syncLegacyCompendiumSettings(settings: any): void {
    const sources: ContentSource[] = settings?.contentSources ?? [];
    const find = (id: string) => sources.find((source) => source.id === id);

    const srdAdversaries = find(BUILTIN_SOURCE_IDS.srdAdversaries);
    if (srdAdversaries) settings.useSrdAdversaries = srdAdversaries.enabled;

    const srdEnvironments = find(BUILTIN_SOURCE_IDS.srdEnvironments);
    if (srdEnvironments) settings.useSrdEnvironments = srdEnvironments.enabled;

    const userJson = find(BUILTIN_SOURCE_IDS.userJson);
    if (userJson) settings.userCompendiumFile = userJson.path;

    // Only the original folder is mirrored back. Additional Markdown folders
    // have no legacy equivalent, so an older build simply would not see them.
    const markdown = find(BUILTIN_SOURCE_IDS.markdown);
    if (markdown) settings.compendiumFolder = markdown.enabled ? markdown.path : '';
}

/** Build a new user-json source from a label the user typed. */
export function createUserJsonSource(
    label: string,
    existing: ContentSource[],
    options: { doNotDistribute?: boolean } = {},
): ContentSource {
    const taken = new Set(existing.map((source) => source.id));
    const id = slugifySourceId(label, taken);
    return {
        id,
        label: String(label ?? '').trim() || id,
        kind: 'user-json',
        path: sourceFileName(id),
        enabled: true,
        priority: SOURCE_PRIORITY.userJson,
        removable: true,
        writable: true,
        doNotDistribute: options.doNotDistribute === true,
    };
}
