/**
 * Adversary and environment role helpers.
 *
 * Published types are not safe to use directly as CSS class fragments or as
 * lookup keys: the Horde variants carry their damage rule in the name
 * ("Horde (3/HP)"), so a bare toLowerCase() yields "horde-(3/hp)" — parens and
 * a slash are invalid in an unescaped class selector, and an exact-match switch
 * misses it entirely. Everything that keys off a role goes through here.
 *
 * Framework-free and Obsidian-free so the test scripts can import it directly.
 */

/**
 * The role families the plugin styles and prices. Anything outside this set is
 * homebrew: it still renders, just with the neutral fallback.
 */
export const ROLE_FAMILIES = [
    'bruiser',
    'horde',
    'leader',
    'minion',
    'ranged',
    'skulk',
    'social',
    'solo',
    'standard',
    'support',
    // Environments
    'event',
    'exploration',
    'traversal',
] as const;

export type RoleFamily = (typeof ROLE_FAMILIES)[number];

const ROLE_FAMILY_SET = new Set<string>(ROLE_FAMILIES);

/** Fallback family for missing, empty, or unrecognised types. */
export const DEFAULT_ROLE_FAMILY = 'default';

/**
 * Reduce a published type to its family slug.
 *
 * "Horde (3/HP)" -> "horde", "Solo" -> "solo", "" -> "default".
 * Plural spellings ("Minions") collapse onto the singular family so the SRD and
 * hand-written content agree.
 */
export function normalizeRoleFamily(type?: string | null): string {
    if (!type) return DEFAULT_ROLE_FAMILY;
    const slug = String(type)
        .split('(')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug) return DEFAULT_ROLE_FAMILY;
    const singular = slug.endsWith('s') && ROLE_FAMILY_SET.has(slug.slice(0, -1)) ? slug.slice(0, -1) : slug;
    return singular;
}

/** True when the family is one the plugin has styling and pricing for. */
export function isKnownRoleFamily(family: string): family is RoleFamily {
    return ROLE_FAMILY_SET.has(family);
}

/** The three feature types a card badge can show. */
export type FeatureType = 'Action' | 'Reaction' | 'Passive';

/**
 * Canonicalise a feature type for display and for the `data-feature-type` hook.
 * Anything unrecognised reads as Passive: it is the type that asks least of the
 * GM, so a mislabelled feat degrades quietly rather than implying a turn action.
 */
export function normalizeFeatureType(raw?: string | null): FeatureType {
    const t = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (t === 'action') return 'Action';
    if (t === 'reaction') return 'Reaction';
    return 'Passive';
}
