import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const TARGETS = new Set(['chromium', 'firefox']);

function merge(base, overlay) {
  if (Array.isArray(base) || Array.isArray(overlay)) return structuredClone(overlay ?? base);
  if (!base || typeof base !== 'object') return structuredClone(overlay ?? base);
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(overlay || {})) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(output[key] || {}, value)
      : structuredClone(value);
  }
  return output;
}

export async function createManifest(projectRoot, target) {
  if (!TARGETS.has(target)) throw new Error(`Unsupported browser target: ${target}`);
  const [base, overlay, pkg] = await Promise.all([
    readFile(resolve(projectRoot, 'manifests/base.json'), 'utf8').then(JSON.parse),
    readFile(resolve(projectRoot, `manifests/${target}.json`), 'utf8').then(JSON.parse),
    readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse)
  ]);
  return { ...merge(base, overlay), version: pkg.version };
}

export async function writeManifest(projectRoot, target, outputDir) {
  const manifest = await createManifest(projectRoot, target);
  await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
