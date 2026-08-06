/** Shared shapes for the clipper. `RawStatblock` is the loose intermediate the
 * parsers produce; `ToolkitStatblock` is the canonical form owned by
 * `shared/statblock-format.js`.
 */

export interface RawFeature {
    name: string;
    type: string;
    desc: string;
    description?: string;
    parsedCost?: string;
}

/** Loose parser output. Fields are deleted when empty, so nearly all optional. */
export interface RawStatblock {
    name: string;
    tier?: number;
    type?: string;
    desc?: string;
    description?: string;
    difficulty?: number;
    features?: RawFeature[];
    source?: string;
    sourceSite?: string;
    author?: string;
    extractedAt?: string;
    rawText?: string;

    // Adversary-only.
    weapon?: string;
    range?: string;
    damage?: string;
    hp?: number;
    stress?: number;
    thresholds?: string;
    attack?: string;
    xp?: string;
    motives?: string;

    // Environment-only.
    tone?: string;
    adversaries?: string;
    impulses?: string;

    // Extraction bookkeeping.
    extractionWarning?: string;
    extractionMethod?: string;
    category?: string;
    /** Set by the FreshCutGrass card-boundary pass, stripped before export. */
    __cardDescription?: string;
    /** Ranking scratch used while choosing among app-state candidates. */
    __stateScore?: number;
    /** Whether the candidate matched the ?id= in the page URL. */
    __targetContext?: boolean;

    /** Parsers assign fields conditionally by key; keeps that legal. */
    [key: string]: unknown;
}

export interface ParseMetadata {
    name?: string;
    source?: string;
    sourceSite?: string;
    author?: string;
    features?: RawFeature[];
    fields?: Record<string, string>;
}

export interface ToolkitFeature {
    name: string;
    type: string;
    parsedCost?: string;
    countdown?: string;
    description: string;
}

export interface ToolkitStatblock {
    name: string;
    category: 'adversary' | 'environment';
    tier?: number;
    type?: string;
    description?: string;
    difficulty?: number;
    hp_stress?: {
        hp?: number;
        stress?: number;
        major_hp?: number | null;
        severe_hp?: number | null;
    };
    features?: ToolkitFeature[];
    source?: {
        site?: string;
        url?: string;
        author?: string;
        importedAt?: string;
    };
    isCustom?: boolean;
    attack?: {
        name: string;
        range?: string;
        damage?: string;
        modifier?: string;
    };
    experience?: string;
    motives_tactics?: string;
    impulses?: string;
    potential_adversaries?: string;
    tone?: string;
}

/** Where a set of items came from; surfaced in the diagnostics report. */
export type ExtractionPath =
    | 'manual-selection'
    | 'freshcutgrass-app-state'
    | 'freshcutgrass-rendered-dom'
    | 'heartofdaggers-rendered-card'
    | 'browser-extension';

export interface ExtractionDiagnostics {
    candidateCount: number;
    rejectedCount: number;
    rejectionReasons: string[];
}

/** Messages exchanged between the popup and the injected content script. */
export type ClipperMessage =
    | { type: 'DH_EXTRACT' }
    | { type: 'DH_SELECT' }
    | {
          type: 'DH_OPEN_EXTERNAL_URI';
          uri: string;
          sourceTabId?: number;
      };

export interface ExtractResponse {
    ok: boolean;
    error?: string;
    items?: RawStatblock[];
    diagnostics?: ExtractionDiagnostics;
}

export interface LaunchResponse {
    ok: boolean;
    error?: string;
}

/** Persisted by the on-page picker, consumed by the popup. */
export interface ManualSelection {
    lastExtractions: RawStatblock[];
    lastExtractionUrl: string;
    lastExtractionManual: boolean;
    /** Added by the rewrite so stale picks expire rather than shadowing fresh ones. */
    lastExtractionAt: number;
}

export interface ClipperSettings {
    vault: string;
    folder: string;
    overwrite: boolean;
}
