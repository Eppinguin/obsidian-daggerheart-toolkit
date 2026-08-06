import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { TARGETS, writeManifest } from './manifest.mjs';

const target = process.argv[2];
if (!TARGETS.has(target)) {
    console.error('Usage: node scripts/build.mjs <chromium|firefox>');
    process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist', target);
const configFile = resolve(root, 'vite.config.mjs');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

/** Three passes: the HTML entries first (it owns emptyOutDir), then the two
 * single-file IIFE bundles that MV3 requires. The previous build copied a
 * hand-maintained list of 13 source files here; Vite emits the module graph
 * now, so a file that nothing imports cannot ship. */
await build({ configFile, mode: target });

for (const bundle of ['background', 'content-script']) {
    process.env.DH_BUNDLE = bundle;
    await build({ configFile, mode: target });
}
delete process.env.DH_BUNDLE;

await cp(resolve(root, 'icons'), resolve(output, 'icons'), { recursive: true });
const manifest = await writeManifest(root, target, output);
console.log(`Built ${target} extension ${manifest.version} in ${output}`);
