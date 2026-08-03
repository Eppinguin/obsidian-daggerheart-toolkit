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
    write: false
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
    assert.match(main, /scheduleCompendiumFolderUpdate/);
    assert.match(main, /await this\.plugin\.triggerCompendiumUpdate\(\)/);
    assert.match(main, /app\.vault\.on\('modify'/);

    const compendium = await readFile(resolve(root, 'src/services/compendium.ts'), 'utf8');
    assert.match(compendium, /getMarkdownFiles\(\)/);
    assert.match(compendium, /file\.path\.startsWith\(folderPrefix\)/);
    console.log('Compendium folder path and reload regressions passed');
} finally {
    await rm(temporaryModule, { force: true });
}
