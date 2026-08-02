import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { TARGETS, writeManifest } from './manifest.mjs';

const target = process.argv[2];
if (!TARGETS.has(target)) {
  console.error('Usage: node scripts/build.mjs <chromium|firefox>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(root, '..', '..');
const output = resolve(root, 'dist', target);
await build({ configFile: resolve(root, 'vite.config.mjs'), mode: target });
await mkdir(output, { recursive: true });

const fixedFiles = [
  'background.js',
  'parser.js', 'parser-patch.js', 'statblock-format-adapter.js',
  'heartofdaggers-filter.js', 'extraction-diagnostics.js',
  'freshcutgrass-parser.js', 'freshcutgrass-state.js',
  'freshcutgrass-rendered-repair.js', 'freshcutgrass-card-boundary.js',
  'content-script.js', 'popup.js', 'options.js'
];
await Promise.all(fixedFiles.map((file) => cp(resolve(root, file), resolve(output, file))));
await cp(resolve(repositoryRoot, 'shared', 'statblock-format.js'), resolve(output, 'statblock-format.js'));
await cp(resolve(root, 'icons'), resolve(output, 'icons'), { recursive: true });
const manifest = await writeManifest(root, target, output);
console.log(`Built ${target} extension ${manifest.version} in ${output}`);
