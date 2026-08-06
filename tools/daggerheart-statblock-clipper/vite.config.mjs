import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

/** Background and content scripts must each be a single self-contained file.
 * MV3 loads the service worker directly (Chromium) or as a classic script
 * (Firefox), and `scripting.executeScript` injects one file — neither can
 * follow an import graph, so these build as IIFE bundles with no code
 * splitting and no shared chunks. */
function singleFileBundle(name, entry, target) {
    return {
        root: projectRoot,
        publicDir: false,
        build: {
            outDir: resolve(projectRoot, 'dist', target),
            emptyOutDir: false,
            target: 'es2022',
            rollupOptions: {
                input: entry,
                output: {
                    format: 'iife',
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        },
    };
}

/** Vite emits `<link rel="modulepreload">` for shared chunks and marks its
 * tags `crossorigin`, both of which assume a web app served over http(s).
 * Neither survives contact with a chrome-extension:// page.
 *
 * Chromium fetches an extension-page preload in a different "world" than the
 * one the page's own module graph resolves in, so the preloaded response is
 * never matched to the `import` that needs it. The chunk is fetched twice and
 * Chromium logs two warnings per popup open:
 *   "…not used because it is a cross-world extension resource mismatch"
 *   "…was preloaded using link preload but not used within a few seconds…"
 * Dropping the tag is a pure win here: verified that the module graph loads
 * and the popup initializes identically without it, with one fetch instead
 * of two. The preload cannot help on this origin, so there is nothing to
 * trade away. `crossorigin` goes too — CORS is meaningless same-origin. */
function stripWebOnlyHints() {
    return {
        name: 'dh-strip-web-only-hints',
        transformIndexHtml: {
            order: 'post',
            handler: (html) =>
                html
                    .replace(/[^\S\n]*<link\b[^>]*\brel="modulepreload"[^>]*>\n?/g, '')
                    .replace(/\s+crossorigin(?=[\s=>])/g, ''),
        },
    };
}

export default defineConfig(({ mode }) => {
    const target = mode === 'firefox' ? 'firefox' : 'chromium';
    const bundle = process.env.DH_BUNDLE;

    if (bundle === 'background') {
        return singleFileBundle('background', resolve(projectRoot, 'src/entries/background.ts'), target);
    }
    if (bundle === 'content-script') {
        return singleFileBundle('content-script', resolve(projectRoot, 'src/entries/content-script.ts'), target);
    }

    // Popup and options are ordinary HTML entries; Vite rewrites their module
    // script tags and emits hashed assets under assets/.
    return {
        root: projectRoot,
        publicDir: false,
        base: './',
        plugins: [stripWebOnlyHints()],
        build: {
            target: 'es2022',
            outDir: resolve(projectRoot, 'dist', target),
            emptyOutDir: true,
            assetsDir: 'assets',
            rollupOptions: {
                input: {
                    popup: resolve(projectRoot, 'popup.html'),
                    options: resolve(projectRoot, 'options.html'),
                },
                output: {
                    entryFileNames: 'assets/[name].js',
                    // Popup and options share lib/storage.ts, so Rollup emits a
                    // common chunk. Name it for what it is rather than after
                    // whichever module happened to seed it.
                    chunkFileNames: 'assets/shared.js',
                    assetFileNames: 'assets/[name][extname]',
                },
            },
        },
    };
});
