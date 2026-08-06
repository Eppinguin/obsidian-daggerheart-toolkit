/** Finds the expanded statblock on a FreshCutGrass listing page.
 *
 * `/homebrew?id=…` renders a grid of ~100 preview cards and expands the
 * targeted one in place. The expanded card is a plain `MuiCardContent-root`
 * div, not a dialog — so the generic scope selectors
 * (`[role="dialog"]`, `.modal`, `[class*="drawer"]`, …) match nothing and the
 * parser falls back to `document.body`. It then parses ~26k characters of
 * flattened listing text as one statblock, and neighbouring cards bleed into
 * the extracted fields.
 *
 * The expanded card is distinguishable: only it carries both a `FEATURES`
 * heading and an `HP & STRESS` block (environments carry `Impulses:` or
 * `Potential Adversaries:` instead). Preview cards have neither.
 */

const FEATURES_HEADING = /^\s*FEATURES\s*$/im;
const HP_STRESS_HEADING = /HP\s*&\s*STRESS/i;
const ENVIRONMENT_SECTION = /^\s*(?:Impulses|Potential Adversaries)\s*:/im;
const STAT_LABEL = /^\s*Difficulty\s*:/im;

export function isFreshCutGrass(location: { hostname?: string } | null | undefined): boolean {
    return /(?:^|\.)freshcutgrass\.app$/i.test(location?.hostname || '');
}

/** True when an element's text looks like a fully expanded statblock rather
 * than one of the grid's preview cards. */
export function expandedCardSignature(value: unknown): boolean {
    const text = String(value ?? '');
    if (!STAT_LABEL.test(text)) return false;
    const adversary = FEATURES_HEADING.test(text) && HP_STRESS_HEADING.test(text);
    const environment = FEATURES_HEADING.test(text) && ENVIRONMENT_SECTION.test(text);
    return adversary || environment;
}

/**
 * Return the smallest elements whose text is a complete expanded statblock.
 *
 * Smallest wins: the signature also matches every ancestor up to `<body>`, and
 * taking an ancestor is exactly what pulls in the neighbouring cards.
 */
export function expandedCardRoots(doc: Document, selected: Element | null = null): Element[] {
    const scope = selected || doc?.body || doc?.documentElement;
    if (!scope?.querySelectorAll) return [];

    const candidates = [scope, ...Array.from(scope.querySelectorAll('*'))].filter((element) =>
        expandedCardSignature((element as HTMLElement).innerText || element.textContent || ''),
    );

    return candidates.filter(
        (candidate) => !candidates.some((other) => other !== candidate && candidate.contains?.(other)),
    );
}
