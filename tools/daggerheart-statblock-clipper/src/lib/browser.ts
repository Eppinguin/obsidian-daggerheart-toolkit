/** The WebExtension API surface.
 *
 * Firefox exposes `browser`, Chromium exposes `chrome`. The legacy files each
 * re-derived this with `globalThis.browser || globalThis.chrome`.
 *
 * Resolution is deferred to first property access rather than done at module
 * load: an eager lookup would throw while the module graph is still being
 * imported, which breaks tests that install a mock in `beforeEach` and any
 * context where the API arrives late.
 */
type BrowserApi = typeof chrome;

function resolve(): BrowserApi {
    const found = (globalThis as { browser?: BrowserApi }).browser ?? (globalThis as { chrome?: BrowserApi }).chrome;
    if (!found) throw new Error('No WebExtension API is available in this context.');
    return found;
}

export const api: BrowserApi = new Proxy({} as BrowserApi, {
    get: (_target, property) => Reflect.get(resolve(), property),
    has: (_target, property) => Reflect.has(resolve(), property),
});
