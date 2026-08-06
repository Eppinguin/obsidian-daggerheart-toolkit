/** Keeps manifest.json, package.json and versions.json on one version.
 *
 * Obsidian reads the version from manifest.json; the `release` script tags from
 * package.json's. Nothing enforced that they matched, and they drifted: 0.0.3
 * shipped in the manifest while package.json still said 0.0.2, so `pnpm release`
 * would have tagged the wrong number.
 *
 * Run as `npm version <patch|minor|major>`, which sets package.json first and
 * then invokes this through the `version` lifecycle hook. package.json is
 * therefore the input here, and the other two files follow it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 4)}\n`);

/** Maps every released version to the Obsidian build it needs, so older installs
 * resolve the newest release they can actually run. */
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = manifest.minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, 4)}\n`);

console.log(`Set manifest.json and versions.json to ${version} (minAppVersion ${manifest.minAppVersion})`);
