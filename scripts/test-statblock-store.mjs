import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const store = await read('src/services/statblock-store.ts');
const editModal = await read('src/modals/EditAdversaryModal.ts');
const compendium = await read('src/services/compendium.ts');
const batch = await read('src/services/statblock-import-batch.ts');
const main = await read('src/main.ts');

/**
 * Strip comments so assertions about what the code *does* are not tripped by
 * prose that merely describes the bug being guarded against.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// --- The environment persistence regression -------------------------------
// Custom environments used to be written to user-environments.json, which the
// loader never read, so they vanished on reload. Nothing may reintroduce a
// category-dependent destination file.
assert.doesNotMatch(
    code(editModal),
    /user-environments\.json/,
    'EditAdversaryModal must not target a phantom environments file',
);
assert.doesNotMatch(
    code(editModal),
    /category === 'environment' \? '[^']*\.json'/,
    'destination must not be chosen by category',
);
for (const [name, source] of [
    ['store', store],
    ['compendium', compendium],
    ['import batch', batch],
]) {
    assert.doesNotMatch(code(source), /user-environments\.json/, `${name} must not write to the phantom file`);
}
// No writer may pick its destination file from the entry's category again.
for (const [name, source] of [
    ['store', store],
    ['import batch', batch],
]) {
    assert.doesNotMatch(
        code(source),
        /category === 'environment' \? '[^']*\.json'/,
        `${name} must resolve destinations from the registry`,
    );
}
// The edit modal now resolves a registry source instead of a file name.
assert.match(editModal, /targetSourceId/);
assert.match(editModal, /statblockStore\.(upsert|rename)/);

// --- Writability is enforced in the service, not only the UI ---------------
assert.match(store, /private requireWritable\(/);
assert.match(store, /isSourceWritable\(source\)/);
for (const method of ['async upsert(', 'async upsertMany(', 'async rename(', 'async removeMany(']) {
    const body = store.slice(store.indexOf(method));
    const guardIndex = body.indexOf('requireWritable');
    const writeIndex = body.indexOf('writeSource');
    assert.ok(guardIndex > -1, `${method} must guard writability`);
    assert.ok(writeIndex === -1 || guardIndex < writeIndex, `${method} must guard before writing`);
}

// --- Transient instance state never reaches disk ---------------------------
const transientBlock = store.slice(store.indexOf('TRANSIENT_FIELDS'), store.indexOf('] as const'));
for (const field of [
    'sourceId',
    'id',
    'groupId',
    'currentHp',
    'currentStress',
    'displayName',
    'hasCustomName',
    'conditions',
    '_originalStats',
]) {
    assert.match(transientBlock, new RegExp(`'${field}'`), `sanitize must strip ${field}`);
}
// The old hand-rolled delete block in the modal is gone.
assert.doesNotMatch(editModal, /delete \(dataToSave as any\)\.currentHp/);

// --- move() must not lose data on a partial failure ------------------------
const moveBody = store.slice(store.indexOf('async move('), store.indexOf('async readSource('));
const upsertAt = moveBody.indexOf('upsertMany');
const removeAt = moveBody.indexOf('removeMany');
assert.ok(upsertAt > -1 && removeAt > -1, 'move must copy then delete');
assert.ok(upsertAt < removeAt, 'move must write the destination before deleting the origin');

// --- Merging sources -------------------------------------------------------
const mergeBody = store.slice(store.indexOf('async mergeSource('), store.indexOf('/** Read one source'));
// All three conflict strategies are honoured.
for (const strategy of ["'skip'", "'replace'"]) {
    assert.match(mergeBody, new RegExp(`onConflict === ${strategy}`), `merge must handle ${strategy}`);
}
assert.match(mergeBody, /uniqueName\(entry\.name, taken\)/, 'rename must avoid clashing again');
// Merging into itself would delete the source's own contents.
assert.match(mergeBody, /fromSourceId === toSourceId/);
assert.match(mergeBody, /requireWritable\(toSourceId\)/, 'the destination must accept writes');
// A read-only origin is copied from, never emptied.
assert.match(mergeBody, /canEmptyOrigin = isSourceWritable\(from\)/);
// Same ordering rule as move(): write the destination before emptying.
assert.ok(
    mergeBody.indexOf('upsertMany') < mergeBody.indexOf('removeMany'),
    'merge must write the destination before emptying the origin',
);

// --- Licensed content cannot be exported through the service ---------------
const exportBody = store.slice(store.indexOf('async exportSource('), store.indexOf('exportEntry('));
assert.match(exportBody, /isSourceExportable/);
assert.match(exportBody, /throw new Error/);

// --- Contracts other code depends on ---------------------------------------
assert.match(batch, /export async function saveStatblockBatch\(/, 'the import integration imports this exact name');
assert.match(batch, /sourceId\?: string/, 'imports must be able to target a source');
// The clipboard-import integration monkey-patches this prototype method.
assert.match(compendium, /async load\(\): Promise<void> \{/, 'load must stay a prototype method');
// Deprecated wrappers still exist so older call sites keep working.
assert.match(main, /saveCustomCompendiumData\(fileName: string/);
assert.match(main, /renameCustomCompendiumEntry\(fileName: string/);
assert.match(main, /statblockStore\.upsert\(/);

// --- The loader stamps provenance on every entry ---------------------------
assert.match(compendium, /entriesBySource/);
assert.match(compendium, /shadowed/);
assert.match(compendium, /sourceId: source\.id/);

console.log('Statblock store and environment-persistence regressions passed');
