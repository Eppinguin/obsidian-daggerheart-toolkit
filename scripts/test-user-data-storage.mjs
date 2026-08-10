import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const temporaryModule = resolve(root, '.user-data-storage-test.mjs');
const result = await build({
    entryPoints: [resolve(root, 'src/services/user-data-storage.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
});
await writeFile(temporaryModule, result.outputFiles[0].text);

try {
    const { ensureUserDataFolder, writeUserDataJson } = await import(
        `${pathToFileURL(temporaryModule).href}?${Date.now()}`
    );
    const directories = new Set(['/vault/.obsidian/plugins/daggerheart-toolkit']);
    const files = new Map();
    const adapter = {
        async exists(path) {
            return directories.has(path) || files.has(path);
        },
        async mkdir(path) {
            directories.add(path);
        },
        async write(path, data) {
            const parent = path.slice(0, path.lastIndexOf('/'));
            if (!directories.has(parent)) throw new Error(`Missing parent: ${parent}`);
            files.set(path, data);
        },
    };
    const pluginDir = '/vault/.obsidian/plugins/daggerheart-toolkit';

    await writeUserDataJson(adapter, pluginDir, 'encounters.json', [{ id: 'first' }]);
    assert.equal(
        files.get(`${pluginDir}/user_data/encounters.json`),
        '[\n  {\n    "id": "first"\n  }\n]',
        'a clean release install must create user_data before its first encounter save',
    );

    await ensureUserDataFolder(adapter, pluginDir);
    assert.equal(directories.size, 2, 'ensuring an existing folder must be harmless');
    console.log('Clean-install user-data persistence regression passed');
} finally {
    await rm(temporaryModule, { force: true });
}
