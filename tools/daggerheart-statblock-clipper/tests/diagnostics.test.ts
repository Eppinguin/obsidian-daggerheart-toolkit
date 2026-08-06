/** Diagnostics wiring.
 *
 * The legacy `extraction-diagnostics.js` was broken two ways at once: nothing
 * ever loaded it, and it wrote its result to `base.lastDiagnostics` while the
 * popup read `response.diagnostics` off the message. So `rejectedCount` was
 * always 0 and `rejectionReasons` always empty in the report users send when
 * an extraction goes wrong.
 */
import { expect, test, vi } from 'vitest';

import { withDiagnostics } from '../src/parsers/diagnostics';
import type { RawStatblock } from '../src/types';

const doc = {} as Document;
const freshCutGrass = { hostname: 'freshcutgrass.app', href: 'https://freshcutgrass.app/homebrew' } as any;
const heartOfDaggers = { hostname: 'heartofdaggers.com', href: 'https://heartofdaggers.com/homebrew' } as any;

const items = (count: number): RawStatblock[] =>
    Array.from({ length: count }, (_, i) => ({ name: `Statblock ${i + 1}` }) as RawStatblock);

test('diagnostics travel with the items rather than a side channel', () => {
    const result = withDiagnostics(doc, freshCutGrass, null, () => items(2));
    expect(result.items).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({ candidateCount: 2, rejectedCount: 0, rejectionReasons: [] });
});

test('the non-Heart-of-Daggers path reports the structured-DOM strategy', () => {
    const { diagnostics } = withDiagnostics(doc, freshCutGrass, null, () => items(1));
    expect(diagnostics.siteStrategy).toBe('structured-dom-candidates');
});

/** A Heart of Daggers card whose text carries the rendered-card signature
 * (compact tier line, Features heading, stats, and an ATK line). */
function card(name: string): Element {
    const text = [
        name,
        'Tier 2 Standard',
        'Difficulty: 14 HP: 5 Stress: 4',
        'ATK: +2 | Errata: Close | 2d6+1 mag',
        'Features',
        'Objection – Reaction: Interrupt a roll.',
    ].join('\n');

    const element = {
        innerText: text,
        textContent: text,
        children: [],
        querySelectorAll: () => [] as Element[],
        contains: (other: unknown) => other === element,
    };
    return element as unknown as Element;
}

test('rejected candidates are counted and explained', () => {
    // Three signature-bearing cards on the page; the filter keeps one.
    const scope = (() => {
        const cards = [card('RULES LAWYER'), card('ERRATA WRAITH'), card('FOOTNOTE FIEND')];
        const root = {
            innerText: '',
            textContent: '',
            children: cards,
            querySelectorAll: () => cards,
            contains: () => false,
        };
        return root as unknown as Element;
    })();

    const parse = vi.fn(() => items(1));
    const { diagnostics } = withDiagnostics({ body: scope } as unknown as Document, heartOfDaggers, null, parse);

    expect(diagnostics.candidateCount).toBe(3);
    expect(diagnostics.rejectedCount).toBe(2);
    expect(diagnostics.rejectionReasons).toHaveLength(1);
    expect(diagnostics.rejectionReasons[0]).toMatch(/complete rendered statblock signature|duplicated/i);
    expect(diagnostics.siteStrategy).toBe('rendered-card-signature');
    expect(parse).toHaveBeenCalledOnce();
});

test('an empty extraction still produces a well-formed report', () => {
    const { items: extracted, diagnostics } = withDiagnostics(doc, freshCutGrass, null, () => []);
    expect(extracted).toEqual([]);
    expect(diagnostics).toMatchObject({ candidateCount: 0, rejectedCount: 0, rejectionReasons: [] });
});
