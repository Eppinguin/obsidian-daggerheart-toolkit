import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modal = await readFile('src/modals/ImportExportModal.ts', 'utf8');
const preview = await readFile('src/modals/StatblockImportPreviewModal.ts', 'utf8');
const integration = await readFile('src/services/statblock-import-integration.ts', 'utf8');
const batch = await readFile('src/services/statblock-import-batch.ts', 'utf8');
const popup = await readFile('tools/daggerheart-statblock-clipper/popup.js', 'utf8');
const shared = await readFile('shared/statblock-format.js', 'utf8');

assert.doesNotMatch(modal, /importDataArray\s*\[\s*0\s*\]/);
assert.match(modal, /new StatblockImportPreviewModal/);
assert.match(preview, /'rename'\s*\|\s*'update'\s*\|\s*'skip'/);
assert.match(preview, /saveStatblockBatch/);
assert.match(batch, /for \(const item of items\)/);
assert.equal((batch.match(/adapter\.write/g) || []).length, 1);
assert.equal((batch.match(/triggerCompendiumUpdate/g) || []).length, 1);
assert.match(integration, /id:\s*'import-statblocks-from-clipboard'/);
assert.match(integration, /registerObsidianProtocolHandler\?\.\('daggerheart-import'/);
assert.match(integration, /navigator\.clipboard\.readText/);
assert.match(popup, /navigator\.clipboard\.writeText\(json\)/);
assert.match(popup, /obsidian:\/\/daggerheart-import/);
assert.match(shared, /FORMAT_VERSION\s*=\s*'1\.2\.0'/);

console.log('Reviewed batch and direct statblock import regression passed');
