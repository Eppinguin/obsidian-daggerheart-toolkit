import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const temporaryModule = resolve(root, '.content-source-test.mjs');
const result = await build({
    entryPoints: [resolve(root, 'src/services/content-source.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
});
await writeFile(temporaryModule, result.outputFiles[0].text);
try {
    const {
        BUILTIN_SOURCE_IDS,
        createDefaultSources,
        createMarkdownSource,
        createUserJsonSource,
        ensureDefaultWriteSource,
        isSourceExportable,
        isSourceWritable,
        markdownSources,
        migrateContentSources,
        normalizeFolderPath,
        orderSourcesByLegacyPriority,
        reorderSource,
        resolveWinner,
        slugifySourceId,
        sortSourcesForMerge,
        sourceFileName,
        syncLegacyCompendiumSettings,
    } = await import(`${pathToFileURL(temporaryModule).href}?${Date.now()}`);

    // Defaults reproduce the pre-registry loading behaviour exactly.
    const legacy = {
        compendiumFolder: 'Daggerheart/Homebrew',
        useSrdAdversaries: true,
        useSrdEnvironments: false,
        userCompendiumFile: 'user-adversaries.json',
    };
    const defaults = createDefaultSources(legacy);
    assert.equal(defaults.length, 4);
    const byId = Object.fromEntries(defaults.map((source) => [source.id, source]));
    assert.equal(byId[BUILTIN_SOURCE_IDS.srdAdversaries].path, 'adversaries.json');
    assert.equal(byId[BUILTIN_SOURCE_IDS.srdAdversaries].enabled, true);
    assert.equal(byId[BUILTIN_SOURCE_IDS.srdEnvironments].path, 'environments.json');
    assert.equal(byId[BUILTIN_SOURCE_IDS.srdEnvironments].enabled, false, 'SRD toggle must carry over');
    assert.equal(byId[BUILTIN_SOURCE_IDS.userJson].path, 'user-adversaries.json');
    assert.equal(byId[BUILTIN_SOURCE_IDS.markdown].path, 'Daggerheart/Homebrew');
    assert.equal(byId[BUILTIN_SOURCE_IDS.markdown].enabled, true);

    // SRD and Markdown are never writable; the fallback user source is never removable.
    assert.equal(isSourceWritable(byId[BUILTIN_SOURCE_IDS.srdAdversaries]), false);
    assert.equal(isSourceWritable(byId[BUILTIN_SOURCE_IDS.markdown]), false);
    assert.equal(isSourceWritable(byId[BUILTIN_SOURCE_IDS.userJson]), true);
    assert.equal(byId[BUILTIN_SOURCE_IDS.userJson].removable, false);

    // An empty markdown folder yields a disabled source rather than a broken one.
    const noFolder = createDefaultSources({ compendiumFolder: '' });
    assert.equal(noFolder.find((s) => s.id === BUILTIN_SOURCE_IDS.markdown).enabled, false);

    // Migration is idempotent. This is the property most likely to break.
    const settings = { ...legacy };
    assert.equal(migrateContentSources(settings), true);
    assert.equal(settings.contentSources.length, 4);
    assert.equal(settings.defaultWriteSourceId, BUILTIN_SOURCE_IDS.userJson);
    const firstPass = JSON.stringify(settings.contentSources);
    assert.equal(migrateContentSources(settings), false, 'second migration must be a no-op');
    assert.equal(settings.contentSources.length, 4, 'sources must not duplicate');
    assert.equal(JSON.stringify(settings.contentSources), firstPass);

    // A user-modified registry survives migration untouched. The order flag is
    // already set, so this is the steady state after the one-shot sort.
    const customised = {
        contentSources: [
            {
                id: 'only',
                label: 'Only',
                kind: 'user-json',
                path: 'only.json',
                enabled: true,
                priority: 100,
                removable: true,
                writable: true,
            },
        ],
        defaultWriteSourceId: 'only',
        sourceOrderMigrated: true,
    };
    assert.equal(migrateContentSources(customised), false);
    assert.equal(customised.contentSources.length, 1);

    // A registry predating explicit ordering is sorted into precedence order
    // exactly once, so the behaviour it had before is preserved.
    const unordered = {
        contentSources: [
            {
                id: 'md',
                kind: 'markdown',
                path: 'A',
                enabled: true,
                priority: 200,
                removable: true,
                writable: false,
            },
            {
                id: 'srd',
                kind: 'builtin-srd',
                path: 'adversaries.json',
                enabled: true,
                priority: 0,
                removable: false,
                writable: false,
            },
            {
                id: 'json',
                kind: 'user-json',
                path: 'a.json',
                enabled: true,
                priority: 100,
                removable: true,
                writable: true,
            },
        ],
        defaultWriteSourceId: 'json',
    };
    assert.equal(migrateContentSources(unordered), true, 'the order migration runs once');
    assert.deepEqual(
        unordered.contentSources.map((s) => s.id),
        ['srd', 'json', 'md'],
        'lowest precedence first, matching the old fixed priorities',
    );
    assert.equal(unordered.sourceOrderMigrated, true);
    // Running again must not re-sort a registry the user has since reordered.
    unordered.contentSources.reverse();
    assert.equal(migrateContentSources(unordered), false, 'the order migration is one-shot');
    assert.deepEqual(
        unordered.contentSources.map((s) => s.id),
        ['md', 'json', 'srd'],
        'a deliberate reorder survives later migrations',
    );

    // A dangling defaultWriteSourceId is repaired rather than left broken.
    const dangling = {
        contentSources: createDefaultSources(legacy),
        defaultWriteSourceId: 'deleted-source',
    };
    assert.equal(ensureDefaultWriteSource(dangling), true);
    assert.equal(dangling.defaultWriteSourceId, BUILTIN_SOURCE_IDS.userJson);
    // Pointing at a read-only source is equally invalid.
    dangling.defaultWriteSourceId = BUILTIN_SOURCE_IDS.srdAdversaries;
    assert.equal(ensureDefaultWriteSource(dangling), true);
    assert.equal(dangling.defaultWriteSourceId, BUILTIN_SOURCE_IDS.userJson);

    // --- Precedence is registry order --------------------------------------
    // Reordering in the UI is only meaningful if the merge follows the list.
    const ordering = createDefaultSources(legacy);
    assert.deepEqual(
        sortSourcesForMerge(ordering).map((s) => s.id),
        ordering.map((s) => s.id),
        'the merge pass must follow registry order verbatim',
    );

    // Moving a source down the list makes it win clashes.
    const movedDown = reorderSource(ordering, BUILTIN_SOURCE_IDS.srdAdversaries, 1);
    assert.deepEqual(
        movedDown.map((s) => s.id),
        [
            BUILTIN_SOURCE_IDS.srdEnvironments,
            BUILTIN_SOURCE_IDS.srdAdversaries,
            BUILTIN_SOURCE_IDS.userJson,
            BUILTIN_SOURCE_IDS.markdown,
        ],
    );
    // Moving up does the reverse, and the original array is left alone.
    const movedUp = reorderSource(ordering, BUILTIN_SOURCE_IDS.userJson, -1);
    assert.deepEqual(
        movedUp.map((s) => s.id),
        [
            BUILTIN_SOURCE_IDS.srdAdversaries,
            BUILTIN_SOURCE_IDS.userJson,
            BUILTIN_SOURCE_IDS.srdEnvironments,
            BUILTIN_SOURCE_IDS.markdown,
        ],
    );
    assert.deepEqual(
        ordering.map((s) => s.id),
        createDefaultSources(legacy).map((s) => s.id),
        'reorderSource must not mutate its input',
    );
    // Moves off either end, and unknown ids, are refused rather than clamped.
    assert.equal(reorderSource(ordering, BUILTIN_SOURCE_IDS.srdAdversaries, -1), null);
    assert.equal(reorderSource(ordering, BUILTIN_SOURCE_IDS.markdown, 1), null);
    assert.equal(reorderSource(ordering, 'no-such-source', 1), null);

    // The last enabled source holding a name is the one that wins it.
    const contenders = [BUILTIN_SOURCE_IDS.srdAdversaries, BUILTIN_SOURCE_IDS.userJson];
    assert.equal(resolveWinner(ordering, contenders), BUILTIN_SOURCE_IDS.userJson);
    // Disabling the winner hands the name back to the next one down.
    const withDisabled = ordering.map((s) => (s.id === BUILTIN_SOURCE_IDS.userJson ? { ...s, enabled: false } : s));
    assert.equal(resolveWinner(withDisabled, contenders), BUILTIN_SOURCE_IDS.srdAdversaries);
    assert.equal(resolveWinner(ordering, ['absent']), undefined);

    // Legacy priorities still seed the initial order.
    const order = orderSourcesByLegacyPriority(createDefaultSources(legacy)).map((source) => source.id);
    assert.deepEqual(order, [
        BUILTIN_SOURCE_IDS.srdAdversaries,
        BUILTIN_SOURCE_IDS.srdEnvironments,
        BUILTIN_SOURCE_IDS.userJson,
        BUILTIN_SOURCE_IDS.markdown,
    ]);

    // File names must never escape user_data/.
    assert.equal(sourceFileName('hope-and-fear'), 'hope-and-fear.json');
    assert.equal(sourceFileName('Hope & Fear.json'), 'Hope---Fear.json');
    assert.doesNotMatch(sourceFileName('../../etc/passwd'), /[\\/]/);
    assert.doesNotMatch(sourceFileName('../../etc/passwd'), /\.\./);
    assert.doesNotMatch(sourceFileName('...hidden'), /^\./);
    assert.equal(sourceFileName(''), 'source.json');

    // Ids stay unique so two sources can never share a registry slot.
    const taken = new Set(['hope-fear']);
    assert.equal(slugifySourceId('Hope & Fear', new Set()), 'hope-fear');
    assert.equal(slugifySourceId('Hope & Fear', taken), 'hope-fear-2');
    assert.equal(slugifySourceId('!!!', new Set()), 'source');

    // Licensed sources are writable but never exportable.
    const licensed = createUserJsonSource('Hope & Fear', defaults, { doNotDistribute: true });
    assert.equal(licensed.id, 'hope-fear');
    assert.equal(licensed.path, 'hope-fear.json');
    assert.equal(licensed.writable, true);
    assert.equal(licensed.removable, true);
    assert.equal(isSourceExportable(licensed), false, 'licensed content must never be exportable');
    assert.equal(isSourceExportable(byId[BUILTIN_SOURCE_IDS.userJson]), true);

    // Legacy keys are mirrored back so a downgrade still finds its data.
    const mirrored = { contentSources: createDefaultSources(legacy) };
    mirrored.contentSources.find((s) => s.id === BUILTIN_SOURCE_IDS.srdAdversaries).enabled = false;
    syncLegacyCompendiumSettings(mirrored);
    assert.equal(mirrored.useSrdAdversaries, false);
    assert.equal(mirrored.useSrdEnvironments, false);
    assert.equal(mirrored.userCompendiumFile, 'user-adversaries.json');
    assert.equal(mirrored.compendiumFolder, 'Daggerheart/Homebrew');

    // --- Multiple Markdown folders -----------------------------------------
    // Folder paths are normalized the same way the loader normalizes them.
    assert.equal(normalizeFolderPath('  /Daggerheart\\Homebrew// '), 'Daggerheart/Homebrew');
    assert.equal(normalizeFolderPath(''), '');

    const withFolders = createDefaultSources(legacy);
    const second = createMarkdownSource('Daggerheart/Imported', withFolders, 'Imported Notes');
    assert.equal(second.kind, 'markdown');
    assert.equal(second.path, 'Daggerheart/Imported');
    assert.equal(second.label, 'Imported Notes');
    assert.equal(second.writable, false, 'vault notes are never written by the plugin');
    assert.equal(second.removable, true, 'added folders can be removed again');
    assert.equal(
        second.priority,
        withFolders.find((s) => s.id === BUILTIN_SOURCE_IDS.markdown).priority,
        'all Markdown folders share one precedence level',
    );
    // A missing label falls back to the folder's own name.
    assert.equal(createMarkdownSource('A/B/Beasts', withFolders).label, 'Beasts');
    // Ids stay distinct even when two folders end in the same name.
    const a = createMarkdownSource('One/Beasts', withFolders);
    const b = createMarkdownSource('Two/Beasts', [...withFolders, a]);
    assert.notEqual(a.id, b.id);

    // Every enabled folder is watched; disabled and pathless ones are skipped.
    const folderSet = [
        ...withFolders,
        second,
        {
            id: 'off',
            kind: 'markdown',
            path: 'X',
            enabled: false,
            priority: 200,
            removable: true,
            writable: false,
        },
        {
            id: 'blank',
            kind: 'markdown',
            path: '',
            enabled: true,
            priority: 200,
            removable: true,
            writable: false,
        },
    ];
    const watched = markdownSources(folderSet).map((s) => s.path);
    assert.deepEqual(watched, ['Daggerheart/Homebrew', 'Daggerheart/Imported']);

    // Only the original folder mirrors back to the legacy setting; extra
    // folders have no legacy equivalent and must not overwrite it.
    const mirrorMulti = { contentSources: [...withFolders, second] };
    syncLegacyCompendiumSettings(mirrorMulti);
    assert.equal(mirrorMulti.compendiumFolder, 'Daggerheart/Homebrew');

    // The bundled SRD files back the two builtin sources; a swap should be loud.
    const adversaries = JSON.parse((await readFile(resolve(root, 'data/adversaries.json'), 'utf8')).replace(/^﻿/, ''));
    const environments = JSON.parse((await readFile(resolve(root, 'data/environments.json'), 'utf8')).replace(/^﻿/, ''));
    assert.equal(adversaries.length, 129);
    assert.equal(environments.length, 19);

    console.log('Content source registry and migration passed');
} finally {
    await rm(temporaryModule, { force: true });
}
