import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

/** The manager is split across several files; assert against all of them. */
async function readManager() {
    const dir = resolve(root, 'src/modals/compendium');
    const files = await readdir(dir);
    const parts = await Promise.all(
        files.filter((name) => name.endsWith('.ts')).map((name) => readFile(resolve(dir, name), 'utf8')),
    );
    parts.push(await read('src/modals/ManageCompendiumModal.ts'));
    return parts.join('\n');
}

const gitignore = await read('.gitignore');
const store = await read('src/services/statblock-store.ts');
const contentSource = await read('src/services/content-source.ts');
const manager = await readManager();
const importExport = await read('src/modals/ImportExportModal.ts');
const preview = await read('src/modals/StatblockImportPreviewModal.ts');

// --- Personal content must never be committed ------------------------------
// Sources live in the plugin's user_data folder; if that stops being ignored,
// licensed content would land in the user's tracked vault repository.
assert.match(gitignore, /^user_data\/$/m, 'user_data/ must stay gitignored');
assert.match(gitignore, /^data\.json$/m, 'data.json holds the doNotDistribute flags');

// --- The flag exists and is honoured at the service boundary ----------------
assert.match(contentSource, /doNotDistribute\?: boolean/);
assert.match(contentSource, /export function isSourceExportable/);
// A licensed source is never exportable, regardless of anything else.
assert.match(contentSource, /doNotDistribute !== true/);

// exportSource and exportEntry throw rather than trusting the UI to hide buttons.
const exportSource = store.slice(store.indexOf('async exportSource('), store.indexOf('exportEntry('));
assert.match(exportSource, /isSourceExportable/);
assert.match(exportSource, /throw new Error/);
const exportEntry = store.slice(store.indexOf('exportEntry('), store.indexOf('async deleteSource('));
assert.match(exportEntry, /isSourceExportable/);
assert.match(exportEntry, /throw new Error/);

// --- Every export affordance in the UI is guarded --------------------------
// The main pre-existing export surface filters on exportability, not just isCustom.
assert.match(
    importExport,
    /isSourceExportable\(this\.plugin\.getSource\(item\.sourceId\)\)/,
    'the export dropdown must exclude personal content',
);
assert.doesNotMatch(
    importExport,
    /filter\(\(item: any\) => item\.isCustom\)/,
    'the old isCustom-only export filter must be gone',
);
// prepareExportData can be reached with a caller-supplied id, so it guards too.
assert.match(importExport, /isSourceExportable\(this\.plugin\.getSource\(data\.sourceId\)\)/);

// Every export affordance in the manager sits behind an exportability check:
// the per-source backup, the per-row copy, and the bulk export.
const sourcesTab = await read('src/modals/compendium/SourcesTab.ts');
const entriesTab = await read('src/modals/compendium/EntriesTab.ts');
assert.match(
    sourcesTab,
    /if \(isSourceExportable\(source\)[^)]*\) \{[\s\S]{0,400}?exportSource/,
    'the per-source export button must be conditional',
);
assert.match(
    entriesTab,
    /if \(isSourceExportable\(source\)\) \{[\s\S]{0,400}?exportEntry/,
    'the per-row export button must be conditional',
);
assert.match(entriesTab, /isSourceExportable\(entry\.source\)/, 'bulk export must filter personal content');
// Merging personal content somewhere exportable is a silent downgrade, so it
// has to be called out before it happens.
assert.match(
    manager,
    /doNotDistribute && target && !target\.doNotDistribute/,
    'merging personal content into an exportable source must warn',
);

// --- The user is told which content is personal ----------------------------
assert.match(manager, /setIcon\(lock, 'lock'\)/, 'licensed sources need a visible lock');
assert.match(manager, /excluded from export/i);
assert.match(preview, /dh-import-preview-locked-banner/, 'importing into a licensed source must warn');
assert.match(manager, /Personal licensed content/);

// --- Imports can be targeted at a source -----------------------------------
assert.match(preview, /targetSourceId/);
assert.match(preview, /saveStatblockBatch\(this\.plugin, selected, this\.targetSourceId\)/);
// Conflicts are scoped to the destination; clashes elsewhere are only shadows.
assert.match(preview, /getEntriesForSource\(this\.targetSourceId\)/);
assert.match(preview, /shadows/);

console.log('Licensed content containment passed');
