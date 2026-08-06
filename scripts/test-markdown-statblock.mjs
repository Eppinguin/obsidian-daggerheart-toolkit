import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const temporaryModule = resolve(root, '.markdown-statblock-test.mjs');
const result = await build({
    entryPoints: [resolve(root, 'src/services/markdown-statblock.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
});
await writeFile(temporaryModule, result.outputFiles[0].text);
try {
    const { blockMatchesName, findStatblockBlocks, removeStatblockBlock, replaceStatblockBlock } = await import(
        `${pathToFileURL(temporaryModule).href}?${Date.now()}`
    );

    const note = [
        '# My Homebrew',
        '',
        'Some prose about the first monster.',
        '',
        '```daggerheart-statblock',
        'name: Shadow Hag',
        'category: adversary',
        'tier: 2',
        '```',
        '',
        'Prose in between that must survive.',
        '',
        '```daggerheart-statblock',
        'name: Bog Wraith',
        'category: adversary',
        'tier: 3',
        '```',
        '',
        'Trailing prose.',
        '',
    ].join('\n');

    // --- Finding blocks ----------------------------------------------------
    const blocks = findStatblockBlocks(note);
    assert.equal(blocks.length, 2, 'both statblocks are found');
    assert.equal(blocks[0].index, 0);
    assert.equal(blocks[1].index, 1);
    assert.match(blocks[0].body, /Shadow Hag/);
    assert.match(blocks[1].body, /Bog Wraith/);
    // Offsets must isolate the YAML body, not the fences.
    assert.equal(note.slice(blocks[0].bodyStart, blocks[0].bodyEnd), blocks[0].body);
    assert.doesNotMatch(blocks[0].body, /```/);

    // Other fenced languages are ignored.
    const mixed = '```js\nconst a = 1;\n```\n\n```daggerheart-statblock\nname: Only One\ncategory: adversary\n```';
    assert.equal(findStatblockBlocks(mixed).length, 1);
    assert.equal(findStatblockBlocks('# Nothing here').length, 0);

    // --- Replacing one block -----------------------------------------------
    const edited = replaceStatblockBlock(note, 0, 'name: Shadow Hag\ncategory: adversary\ntier: 4');
    assert.match(edited, /tier: 4/, 'the edit is applied');
    assert.match(edited, /# My Homebrew/, 'the heading survives');
    assert.match(edited, /Prose in between that must survive\./, 'prose between blocks survives');
    assert.match(edited, /Trailing prose\./, 'trailing prose survives');
    assert.match(edited, /name: Bog Wraith/, 'the other statblock is untouched');
    assert.equal(findStatblockBlocks(edited).length, 2, 'still two well-formed blocks');
    // Editing the second block leaves the first alone.
    const editedSecond = replaceStatblockBlock(note, 1, 'name: Bog Wraith\ncategory: adversary\ntier: 1');
    assert.match(editedSecond, /tier: 2/, 'the first block keeps its tier');
    assert.match(editedSecond, /tier: 1/, 'the second block is updated');
    // An index that does not exist must refuse rather than write somewhere.
    assert.equal(replaceStatblockBlock(note, 5, 'name: Nope'), null);
    assert.equal(replaceStatblockBlock('# no blocks', 0, 'name: Nope'), null);

    // --- Removing one block ------------------------------------------------
    const removed = removeStatblockBlock(note, 0);
    assert.doesNotMatch(removed, /Shadow Hag/, 'the chosen block is gone');
    assert.match(removed, /Bog Wraith/, 'the other block remains');
    assert.match(removed, /# My Homebrew/, 'prose survives the removal');
    assert.match(removed, /Prose in between that must survive\./);
    assert.equal(findStatblockBlocks(removed).length, 1);
    assert.doesNotMatch(removed, /\n{3,}/, 'no growing blank-line gap is left behind');
    assert.equal(removeStatblockBlock(note, 9), null);

    // Deleting bottom-up keeps indices valid for multi-block removal.
    let both = note;
    for (const index of [1, 0]) both = removeStatblockBlock(both, index);
    assert.equal(findStatblockBlocks(both).length, 0);
    assert.match(both, /# My Homebrew/, 'the note itself is never destroyed');

    // --- Guarding against a stale index ------------------------------------
    assert.equal(blockMatchesName(blocks[0].body, 'Shadow Hag'), true);
    assert.equal(blockMatchesName(blocks[0].body, 'shadow hag'), true, 'name check is case-insensitive');
    assert.equal(
        blockMatchesName(blocks[0].body, 'Bog Wraith'),
        false,
        'a block holding a different entry must not be overwritten',
    );
    assert.equal(blockMatchesName('category: adversary', 'Shadow Hag'), false);
    assert.equal(blockMatchesName('name: "Quoted Name"', 'Quoted Name'), true);
    assert.equal(blockMatchesName("name: 'Single'", 'Single'), true);

    // --- Formatting variations found in real notes -------------------------
    const crlf = '```daggerheart-statblock\r\nname: CRLF Beast\r\ncategory: adversary\r\n```';
    assert.equal(findStatblockBlocks(crlf).length, 1, 'Windows line endings are handled');
    assert.match(findStatblockBlocks(crlf)[0].body, /CRLF Beast/);
    const tilded = '````daggerheart-statblock\nname: Long Fence\ncategory: adversary\n````';
    assert.equal(findStatblockBlocks(tilded).length, 1, 'longer fences are handled');

    // --- The loader and the writer must agree on indices --------------------
    const compendium = await readFile(resolve(root, 'src/services/compendium.ts'), 'utf8');
    assert.match(
        compendium,
        /findStatblockBlocks\(content\)/,
        'the loader must use the shared scanner so indices line up with writes',
    );
    assert.match(compendium, /sourceBlockIndex: block\.index/);

    const store = await readFile(resolve(root, 'src/services/statblock-store.ts'), 'utf8');
    // Writes must verify the block still holds the expected entry.
    for (const method of ['async updateMarkdownEntry(', 'async removeMarkdownEntry(']) {
        const body = store.slice(store.indexOf(method));
        const guard = body.indexOf('blockMatchesName');
        const write = body.indexOf('vault.modify');
        assert.ok(guard > -1 && guard < write, `${method} must verify the block before writing`);
    }
    // Provenance fields must never be serialized into the note.
    const transient = store.slice(store.indexOf('TRANSIENT_FIELDS'), store.indexOf('] as const'));
    assert.match(transient, /'sourceFile'/);
    assert.match(transient, /'sourceBlockIndex'/);

    // --- Writing to notes is opt-in ----------------------------------------
    // Encounter instances are snapshots, so tweaking an adversary mid-session
    // must never rewrite the homebrew note it came from.
    const editModal = await readFile(resolve(root, 'src/modals/EditAdversaryModal.ts'), 'utf8');
    assert.match(editModal, /allowNoteEdits\?: boolean/);
    assert.match(editModal, /this\.canEditNote\s*=\s*options\.allowNoteEdits === true/);

    const view = await readFile(resolve(root, 'src/views/EncounterBuilderView.ts'), 'utf8');
    const encounterEdit = view.slice(view.indexOf('new EditAdversaryModal('));
    assert.doesNotMatch(
        encounterEdit.slice(0, 400),
        /allowNoteEdits/,
        'the encounter view must not enable in-place note edits',
    );

    // The compendium-editing entry points do opt in.
    const manager = await readFile(resolve(root, 'src/modals/compendium/EntriesTab.ts'), 'utf8');
    const suggester = await readFile(resolve(root, 'src/modals/CompendiumEntryTypeSuggester.ts'), 'utf8');
    assert.match(manager, /allowNoteEdits: true/);
    assert.match(suggester, /allowNoteEdits: true/);

    // Deleting several blocks from one note must go bottom-up, or removing an
    // earlier block would renumber the ones still queued.
    const bulk = manager.slice(manager.indexOf('private confirmBulkDelete('));
    assert.match(
        bulk,
        /\(b\.sourceBlockIndex \?\? 0\) - \(a\.sourceBlockIndex \?\? 0\)/,
        'markdown bulk deletes must be ordered by descending block index',
    );

    console.log('Markdown statblock read/write round-trip passed');
} finally {
    await rm(temporaryModule, { force: true });
}
