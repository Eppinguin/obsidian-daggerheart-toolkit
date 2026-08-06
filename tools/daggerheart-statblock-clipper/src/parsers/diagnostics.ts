/** Extraction diagnostics.
 *
 * Ported from the former `extraction-diagnostics.js`, which shipped in both
 * builds but was never loaded by any page or injection, so its counters never
 * ran. It also wrote to `base.lastDiagnostics` while the popup read
 * `response.diagnostics` off the message — two reasons the numbers could not
 * arrive. This version returns the diagnostics alongside the items so the
 * caller can put them on the wire.
 */
import type { ExtractionDiagnostics, RawStatblock } from '../types';
import { isHeartOfDaggers, renderedCardRoots } from './heartofdaggers';

export interface ExtractionResult {
    items: RawStatblock[];
    diagnostics: ExtractionDiagnostics & { siteStrategy: string };
}

/** Wraps an extraction pass and reports how many candidate roots were found
 * versus how many survived filtering. */
export function withDiagnostics(
    doc: Document,
    location: (Location | { href?: string; hostname?: string }) | null,
    selected: Element | null,
    parse: (
        doc: Document,
        location: (Location | { href?: string; hostname?: string }) | null,
        selected: Element | null,
    ) => RawStatblock[],
): ExtractionResult {
    const isHeart = isHeartOfDaggers(location);
    const roots = isHeart ? renderedCardRoots(doc, selected) : [];
    const items = parse(doc, location, selected);
    const rejectedCount = Math.max(0, roots.length - items.length);

    return {
        items,
        diagnostics: {
            candidateCount: roots.length || items.length,
            rejectedCount,
            rejectionReasons: rejectedCount
                ? ['Candidate did not contain a complete rendered statblock signature or duplicated another card.']
                : [],
            siteStrategy: isHeart ? 'rendered-card-signature' : 'structured-dom-candidates',
        },
    };
}
