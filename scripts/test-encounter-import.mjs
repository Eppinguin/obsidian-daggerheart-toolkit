import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * "Import into encounter": the browser extension asks for it, the review
 * screen decides whether to honour it, and the encounter view does the work.
 */

const service = await readFile('src/services/encounter-import.ts', 'utf8');
const preview = await readFile('src/modals/StatblockImportPreviewModal.ts', 'utf8');
const view = await readFile('src/views/EncounterBuilderView.ts', 'utf8');
const popup = await readFile('tools/daggerheart-statblock-clipper/src/entries/popup.ts', 'utf8');
const popupHtml = await readFile('tools/daggerheart-statblock-clipper/popup.html', 'utf8');

// --- The service delegates rather than reimplementing encounter mechanics ---
// addItemToActiveEncounter already owns group creation, ordering, persistence
// and the redraw, so the service must not duplicate any of that.
assert.match(view, /^\s{4}addItemToActiveEncounter\(/m, 'the view must keep exposing addItemToActiveEncounter');
assert.match(view, /^\s{4}currentEncounterId: string \| null/m, 'the view must keep exposing currentEncounterId');
assert.match(service, /view\.addItemToActiveEncounter\(/);
assert.doesNotMatch(service, /adversaryGroupOrder/, 'group ordering belongs to the view');
assert.doesNotMatch(service, /updateSavedEncounter|autoSave/, 'persistence belongs to the view');

// Adversaries and environments alike. The encounter builder prompts to "Add
// adversaries or environments" and its own compendium list adds either through
// addItemToActiveEncounter, so the import must not filter by category.
assert.doesNotMatch(service, /category === 'environment'/, 'environments belong in encounters too');
assert.match(view, /Add adversaries or environments/, 'the builder still accepts both categories');

// --- The review screen is the authority on whether an encounter is open -----
assert.match(preview, /getActiveEncounterName/);
assert.match(preview, /addImportedToEncounter/);
// Off unless explicitly requested: adding to the encounter is a side effect
// beyond the plain "import" the user asked for.
assert.match(preview, /private addToEncounter = false;/);
// A request that cannot be honoured is cleared, not left dangling.
assert.match(preview, /if \(!encounterName\)/);
assert.match(preview, /this\.addToEncounter = false;/);

// The compendium write happens first, so a failure there never leaves
// encounter instances referencing statblocks that were not saved.
const confirm = preview.match(/private async confirmImport\(\)[\s\S]*?\n    }\n/m)?.[0] || '';
assert.ok(confirm, 'confirmImport must still exist');
assert.ok(
    confirm.indexOf('saveStatblockBatch') < confirm.indexOf('addImportedToEncounter'),
    'entries must be saved to the compendium before they are added to the encounter',
);

// --- The extension does not pre-empt that decision --------------------------
// The clipper used to carry a second "add to encounter" button that set a
// `target` param on the import URI. Adding to the open encounter is the review
// screen's call — it renders that toggle whenever an encounter is open — and a
// button here could only pre-tick it, silently degrading to a plain import when
// no encounter was open. The extension now sends one unqualified import.
assert.doesNotMatch(popupHtml, /id="sendEncounter"/, 'the encounter button belongs to the review screen');
assert.doesNotMatch(popup, /params\.set\('target'/, 'the import URI carries no encounter target');
assert.match(popup, /obsidian:\/\/daggerheart-import/, 'the extension still imports through the protocol URI');

// --- The multi-statblock chooser is gone ------------------------------------
// Both supported sites expose one statblock at a time, so the dropdown and
// export-all toggle could never appear.
for (const id of ['itemSelect', 'exportAll', 'resultCount', 'currentPosition', 'collectionTitle']) {
    assert.doesNotMatch(popupHtml, new RegExp(`id="${id}"`), `popup.html still declares the removed #${id}`);
    assert.doesNotMatch(popup, new RegExp(`'${id}'`), `popup.ts still references the removed #${id}`);
}
// The array plumbing stays: root selection needs it to reject FreshCutGrass's
// ~100 preview cards, and the manual picker can capture several blocks.
assert.match(popup, /const selectedItems = \(\): RawStatblock\[\] => currentItems;/);

console.log('Encounter import and popup simplification regression passed');
