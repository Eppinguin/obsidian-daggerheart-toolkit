import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modal = await readFile('src/modals/ImportExportModal.ts', 'utf8');
const preview = await readFile('src/modals/StatblockImportPreviewModal.ts', 'utf8');
const previewStyles = await readFile('src/styles/import-export.css', 'utf8');
const integration = await readFile('src/services/statblock-import-integration.ts', 'utf8');
const batch = await readFile('src/services/statblock-import-batch.ts', 'utf8');
// The clipper is TypeScript now; these were `popup.js` before the rewrite.
const popup = await readFile('tools/daggerheart-statblock-clipper/src/entries/popup.ts', 'utf8');
const obsidianLaunch = await readFile('tools/daggerheart-statblock-clipper/src/lib/obsidian-launch.ts', 'utf8');
const shared = await readFile('shared/statblock-format.js', 'utf8');

assert.doesNotMatch(modal, /importDataArray\s*\[\s*0\s*\]/);
assert.match(modal, /new StatblockImportPreviewModal/);
assert.match(preview, /'rename'\s*\|\s*'update'\s*\|\s*'skip'/);
assert.match(preview, /saveStatblockBatch/);
assert.match(preview, /contentEl\.addClass\('dh-statblock-import-preview-content'\)/);
assert.match(preview, /dh-import-preview-action-label/);
assert.match(previewStyles, /\.dh-statblock-import-preview-modal\s*\{[\s\S]*max-width:\s*min\(720px/);
assert.match(previewStyles, /\.dh-import-preview-item-header\s*\{[\s\S]*grid-template-columns:/);
assert.match(previewStyles, /@media\s*\(max-width:\s*600px\)/);
// The batch writer now delegates to StatblockStore, which owns the single
// write and the single compendium reload for the whole batch.
assert.match(batch, /statblockStore\.upsertMany\(/);
assert.equal((batch.match(/adapter\.write/g) || []).length, 0, 'the batch writer must not write files directly');
const store = await readFile('src/services/statblock-store.ts', 'utf8');
assert.equal((store.match(/adapter\.write/g) || []).length, 1, 'writes must funnel through one place');
assert.match(store, /async upsertMany\([\s\S]*?await this\.writeSource\(/, 'upsertMany must write once for the batch');

// The clipboard import command is installed by monkey-patching this prototype
// method, so it must stay a prototype method with that exact name.
const compendium = await readFile('src/services/compendium.ts', 'utf8');
assert.match(compendium, /async load\(\): Promise<void> \{/);
assert.match(integration, /DaggerheartCompendium\.prototype\.load/);
assert.match(integration, /id:\s*'import-statblocks-from-clipboard'/);
assert.match(integration, /registerObsidianProtocolHandler\?\.\('daggerheart-import'/);
assert.match(integration, /navigator\.clipboard\.readText/);
// The extension copies the payload, then opens the protocol URI; the plugin
// reads the clipboard when the URI fires, so both halves must stay in step.
assert.match(popup, /navigator\.clipboard\.writeText\(toToolkitJsonMany\(items\)\)/);
assert.match(popup, /obsidian:\/\/daggerheart-import/);
assert.match(popup, /openObsidianUri\(/);
// The launch goes through the background worker, which restores the source tab
// once the user returns from Obsidian.
assert.match(obsidianLaunch, /DH_OPEN_EXTERNAL_URI/);
assert.match(shared, /FORMAT_VERSION\s*=\s*'1\.2\.0'/);

// --- Importing a JSON file as, or into, a source ---------------------------
const manager = await readFile('src/modals/compendium/ImportSourceModal.ts', 'utf8');
assert.match(manager, /class ImportSourceModal/);
// Both destinations are offered.
assert.match(manager, /'Create a new source'/);
assert.match(manager, /'Add to an existing source'/);
// Parsing and conflict review are delegated, not reimplemented.
assert.match(manager, /parseImportJson<AllCompendiumData>\(json\)/);
assert.match(manager, /new StatblockImportPreviewModal\(/);
assert.doesNotMatch(manager, /adapter\.write/, 'the manager must not write files itself');
// The chosen destination is carried into the review screen.
assert.match(manager, /destinationId,/);
assert.match(preview, /targetSourceId\?: string/);
assert.match(preview, /targetSourceId \?\? plugin\.getDefaultWriteSourceId\(\)/);

// A source for a new destination is built but not registered until the import
// is confirmed, so cancelling the review leaves no empty source behind.
const submit = manager.match(/private async submit\(\)[\s\S]*?\n    }/m)?.[0] || '';
assert.match(submit, /pendingSource = createUserJsonSource\(/);
assert.doesNotMatch(submit, /addContentSource/, 'the manager must not register the source up front');
assert.match(preview, /private pendingSource: ContentSource \| null/);
// Registration happens inside confirmImport, after the entries are selected.
const confirm = preview.match(/private async confirmImport\(\)[\s\S]*?\n    }\n/m)?.[0] || '';
assert.match(confirm, /addContentSource\(this\.pendingSource\)/);
assert.ok(
    confirm.indexOf('if (!selected.length) return;') < confirm.indexOf('addContentSource'),
    'an empty selection must not create the source',
);
assert.ok(
    confirm.indexOf('addContentSource') < confirm.indexOf('saveStatblockBatch'),
    'the source must exist before entries are written into it',
);

// --- The UI must refresh once, after the import actually lands -------------
// The opener is notified from confirmImport, not when the review screen opens:
// refreshing early would redraw before the new source or entries exist.
assert.match(preview, /onImported\?: \(\) => void/);
assert.match(confirm, /this\.onImported\?\.\(\)/);
assert.ok(
    confirm.indexOf('saveStatblockBatch') < confirm.indexOf('onImported'),
    'the opener must be notified after entries are saved',
);
assert.match(manager, /onImported: \(\) => this\.onImported\(\)/);
// submit() opens the review screen and returns. Completion must be deferred
// into the review's callback, never announced as a bare statement here.
assert.doesNotMatch(
    submit,
    /^\s*this\.onImported\(\);/m,
    'the import flow must not signal completion before the review is confirmed',
);

// The compendium panel caches the statblock list, so a reload event has to
// refresh that cache rather than repainting the same stale entries.
const view = await readFile('src/views/EncounterBuilderView.ts', 'utf8');
const updateHandler = view.match(/on\('daggerheart-compendium-update'[\s\S]*?\n        \);/m)?.[0] || '';
assert.match(
    updateHandler,
    /await this\.loadCompendium\(\)/,
    'the compendium-update handler must re-read the statblock list',
);
assert.ok(updateHandler.indexOf('loadCompendium') < updateHandler.indexOf('drawUI'), 'reload before redrawing');

console.log('Reviewed batch and direct statblock import regression passed');
