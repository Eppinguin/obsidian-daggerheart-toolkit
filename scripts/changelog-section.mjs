/** Prints one version's section of CHANGELOG.md, for release notes.
 *
 * `gh release --generate-notes` lists raw commit subjects, which for 0.0.3
 * would have been 49 lines of "more fixes" and "style fixes" — accurate and
 * useless to someone deciding whether to update. The changelog is written for
 * that reader instead, and this lifts the matching section out of it.
 *
 * Usage: node scripts/changelog-section.mjs 0.0.3
 * Exits non-zero when the version has no section, so a release cannot
 * silently ship with empty notes.
 */
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
    console.error('Usage: node scripts/changelog-section.mjs <version>');
    process.exit(2);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

// Headings look like `## [0.0.3] - 2026-08-06`. Capture everything up to the
// next `## ` heading, so the section keeps its own `###` subheadings.
const lines = changelog.split('\n');
const start = lines.findIndex((line) => line.startsWith('## ') && line.includes(`[${version}]`));

if (start === -1) {
    console.error(`CHANGELOG.md has no section for ${version}.`);
    console.error('Add one under a `## [<version>] - <date>` heading before releasing.');
    process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith('## '));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!body) {
    console.error(`The ${version} section of CHANGELOG.md is empty.`);
    process.exit(1);
}

console.log(body);
