/** Globals the repointed regression tests publish.
 *
 * These assertions were written against the globals the old IIFE chain
 * installed. The tests now republish the module exports under the same names
 * so the coverage keeps running against the shipping code; this declares them
 * so `tsc` accepts the pattern.
 */
declare global {
    // eslint-disable-next-line no-var
    var DHStatblockParser: any;
    // eslint-disable-next-line no-var
    var DHFreshCutGrassCardBoundary: any;
    // eslint-disable-next-line no-var
    var DHFreshCutGrassCollector: any;
}

export {};
