import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const temporaryModule = resolve(root, '.compendium-path-test.mjs');
const result = await build({
    entryPoints: [resolve(root, 'src/services/compendium-path.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
});
await writeFile(temporaryModule, result.outputFiles[0].text);
try {
    const helpers = await import(`${pathToFileURL(temporaryModule).href}?${Date.now()}`);
    assert.equal(helpers.normalizeCompendiumPath('  /Daggerheart\\Homebrew// '), 'Daggerheart/Homebrew');
    assert.equal(helpers.normalizeCompendiumPath('Daggerheart/Homebrew/'), 'Daggerheart/Homebrew');
    assert.equal(helpers.isPathInsideCompendium('Daggerheart/Homebrew/Shadow Hag.md', 'Daggerheart/Homebrew'), true);
    assert.equal(helpers.isPathInsideCompendium('Daggerheart/Homebrew/Nested/Hag.md', 'Daggerheart/Homebrew/'), true);
    assert.equal(helpers.isPathInsideCompendium('Daggerheart/Other/Hag.md', 'Daggerheart/Homebrew'), false);
    assert.equal(helpers.isPathInsideCompendium('Daggerheart/Homebrew/image.png', 'Daggerheart/Homebrew'), false);

    const main = await readFile(resolve(root, 'src/main.ts'), 'utf8');
    const saveSettings = main.match(/async saveSettings\(\)[\s\S]*?\n    }/m)?.[0] || '';
    assert.doesNotMatch(saveSettings, /settingsTab\.display/);
    // Changing a folder must reload the compendium, not just re-render. Folders
    // are now content sources, and updateContentSource reloads.
    const updateSource = main.match(/public async updateContentSource\([\s\S]*?\n    }/m)?.[0] || '';
    assert.match(updateSource, /await this\.triggerCompendiumUpdate\(\)/);
    assert.match(main, /app\.vault\.on\('modify'/);

    // The watcher must consider every configured folder. Checking only the
    // legacy setting would leave folders added later without auto-reload.
    const watcher = main.match(/private scheduleMarkdownCompendiumReload\([\s\S]*?\n    }/m)?.[0] || '';
    assert.match(watcher, /markdownSources\(/);
    assert.match(watcher, /\.some\(/);
    assert.doesNotMatch(
        watcher,
        /this\.settings\.compendiumFolder/,
        'the watcher must not be limited to the single legacy folder',
    );

    // Folder configuration lives in the manager now, not a settings text field.
    const compendiumSettings =
        main.match(/renderCompendiumSettings\(containerEl: HTMLElement\)[\s\S]*?\n    }\n/m)?.[0] || '';
    assert.doesNotMatch(
        compendiumSettings,
        /workspace\.trigger\('daggerheart-compendium-update'\)/,
        'source toggles must go through updateContentSource, which reloads first',
    );
    assert.doesNotMatch(
        compendiumSettings,
        /setName\('Compendium Folder'\)/,
        'the standalone folder field is replaced by Markdown folder sources',
    );
    assert.match(compendiumSettings, /ManageCompendiumModal/);

    // Multiple Markdown folders are first-class sources.
    const sourceModals = await readFile(resolve(root, 'src/modals/compendium/SourceModals.ts'), 'utf8');
    const sourcesTab = await readFile(resolve(root, 'src/modals/compendium/SourcesTab.ts'), 'utf8');
    assert.match(sourceModals, /createMarkdownSource/);
    assert.match(sourceModals, /class MarkdownSourceModal/);
    assert.match(sourcesTab, /Add Markdown folder/);
    // Removing a folder source must never delete the user's notes.
    assert.match(sourcesTab, /source\.kind === 'markdown'\s*\?\s*`Stop reading statblocks/);
    const store = await readFile(resolve(root, 'src/services/statblock-store.ts'), 'utf8');
    const deleteSource = store.match(/async deleteSource\([\s\S]*?\n    }/m)?.[0] || '';
    assert.match(deleteSource, /if \(source\.kind === 'user-json'\)/, 'only JSON sources have a file to remove');

    const compendium = await readFile(resolve(root, 'src/services/compendium.ts'), 'utf8');
    assert.match(compendium, /getMarkdownFiles\(\)/);
    assert.match(compendium, /file\.path\.startsWith\(folderPrefix\)/);
    console.log('Compendium folder path and reload regressions passed');
} finally {
    await rm(temporaryModule, { force: true });
}
