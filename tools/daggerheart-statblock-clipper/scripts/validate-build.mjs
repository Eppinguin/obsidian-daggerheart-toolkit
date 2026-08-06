import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Files the browser loads directly. Everything else is reached through the
 * module graph, so there is no hand-maintained source list here.
 *
 * The previous validator asserted that 13 *source* files had been copied into
 * dist. That is how `extraction-diagnostics.js` passed validation for its whole
 * life while being imported by nothing: present on disk, dead at runtime. */
const REQUIRED_ENTRIES = [
    'manifest.json',
    'popup.html',
    'options.html',
    'background.js',
    'content-script.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
];

/** Bundles that must not import at runtime: MV3 loads the service worker
 * directly and `executeScript` injects a single file. */
const SELF_CONTAINED = ['background.js', 'content-script.js'];

const LEGACY_FILE =
    /^(parser|parser-patch|statblock-format|statblock-format-adapter|heartofdaggers-filter|freshcutgrass-.*|extraction-diagnostics|popup|options)\.js$/;

for (const target of ['chromium', 'firefox']) {
    const dir = resolve(root, 'dist', target);

    await Promise.all(
        REQUIRED_ENTRIES.map(async (file) => {
            try {
                await access(resolve(dir, file));
            } catch {
                throw new Error(`${target}: missing required file ${file}`);
            }
        }),
    );

    for (const file of SELF_CONTAINED) {
        const source = await readFile(resolve(dir, file), 'utf8');
        assert.doesNotMatch(
            source,
            /^\s*(import|export)\s/m,
            `${target}: ${file} must be self-contained with no import/export statements`,
        );
    }

    // The popup must load exactly one module entry. The old build hand-ordered
    // nine <script> tags here, and that order was duplicated in three other
    // places that disagreed with each other.
    const popup = await readFile(resolve(dir, 'popup.html'), 'utf8');
    assert.equal(
        (popup.match(/<script[^>]*src=/g) || []).length,
        1,
        `${target}: popup.html should load exactly one bundled entry`,
    );
    assert.doesNotMatch(
        popup,
        /src="[^"]*(parser|statblock-format|freshcutgrass|heartofdaggers)[^"]*\.js"/,
        `${target}: popup.html still references a legacy script`,
    );

    const stray = (await readdir(dir)).filter((name) => LEGACY_FILE.test(name));
    assert.deepEqual(stray, [], `${target}: unbundled legacy files reached dist: ${stray.join(', ')}`);

    const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.commands?._execute_action, `${target}: keyboard shortcut command is missing`);
    assert.ok(
        !manifest.permissions.includes('clipboardWrite'),
        `${target}: clipboardWrite is not needed for the async clipboard API`,
    );

    // Every file the manifest names must exist in the build.
    const declared = [
        manifest.action?.default_popup,
        manifest.options_ui?.page,
        manifest.background?.service_worker,
        ...(manifest.background?.scripts || []),
        ...Object.values(manifest.icons || {}),
    ].filter(Boolean);
    for (const file of declared) {
        try {
            await access(resolve(dir, file));
        } catch {
            throw new Error(`${target}: manifest references ${file}, which is not in the build`);
        }
    }

    if (target === 'firefox') {
        assert.equal(manifest.browser_specific_settings.gecko.id, 'daggerheart-statblock-clipper@eppinguin.dev');
        assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
        assert.equal(manifest.minimum_chrome_version, undefined, 'firefox manifest must not carry Chromium-only keys');
        assert.deepEqual(manifest.background.scripts, ['background.js']);
    } else {
        assert.equal(manifest.browser_specific_settings, undefined);
        assert.equal(manifest.background.service_worker, 'background.js');
        assert.equal(manifest.minimum_chrome_version, '111', 'world:MAIN executeScript requires Chrome 111');
    }
}

console.log('Chromium and Firefox build validation passed');
