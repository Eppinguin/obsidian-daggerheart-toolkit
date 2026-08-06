/** The parser entry point.
 *
 * The legacy build expressed this chain as an ordered list of `<script>` tags
 * repeated in four places (popup.html, popup.js `inject()`, build.mjs, and each
 * test file) — and those lists disagreed, so the popup, the injected content
 * script, and the tests each ran a different effective parser. Composition now
 * lives here, once.
 *
 * Precedence matches what the popup actually shipped: the Heart of Daggers
 * filter wraps the core multi-card parse, and the FreshCutGrass repair chain
 * (parser -> rendered-repair -> card-boundary) supplies the state parser and
 * item repair.
 */
import type { RawStatblock } from '../types';
import { withDiagnostics, type ExtractionResult } from './diagnostics';
import { parseManyFromDocument as parseManyWithHeartOfDaggers } from './heartofdaggers';
import { expandedCardRoots, isFreshCutGrass } from './freshcutgrass/expanded-card';

export { parseFeatureLines, parseText, discover as discoverStatblockRoots } from './core';
export {
    attributionTitle,
    completeHeartOfDaggersItem,
    filterHeartOfDaggersItems,
    motivesFromText,
    renderedCardRoots,
    renderedCardSignature,
    restoreMotives,
} from './heartofdaggers';
export { parseFreshCutGrassState, repairFreshCutGrassDomItem } from './freshcutgrass/card-boundary';
export { collectFreshCutGrassState } from './freshcutgrass/state';
export { expandedCardRoots, expandedCardSignature } from './freshcutgrass/expanded-card';
export type { ExtractionResult } from './diagnostics';

type Loc = (Location | { href?: string; hostname?: string }) | null;

/** Parse every statblock on the page, applying the site-specific chain. */
export function parseManyFromDocument(doc: Document, location: Loc, selected: Element | null = null): RawStatblock[] {
    // FreshCutGrass expands the targeted statblock inside a listing grid of
    // ~100 preview cards, and the expanded card is not a dialog — so without
    // this the generic scope selectors miss it, the parser falls back to
    // <body>, and neighbouring cards bleed into the extracted fields.
    if (!selected && isFreshCutGrass(location)) {
        const roots = expandedCardRoots(doc);
        if (roots.length) return roots.flatMap((root) => parseManyWithHeartOfDaggers(doc, location, root));
    }
    return parseManyWithHeartOfDaggers(doc, location, selected);
}

export const parseFromDocument = (doc: Document, location: Loc, selected: Element | null = null): RawStatblock =>
    parseManyFromDocument(doc, location, selected)[0];

/** Parse with candidate/rejection counters attached, for the diagnostics report. */
export function extractWithDiagnostics(
    doc: Document,
    location: Loc,
    selected: Element | null = null,
): ExtractionResult {
    return withDiagnostics(doc, location, selected, parseManyFromDocument);
}
