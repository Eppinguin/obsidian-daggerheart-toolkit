/** Static checks on the UI source and manifest overlays.
 *
 * The DOM-id list is the contract between popup.html and popup.ts: the entry
 * point looks these up by id and would fail at runtime if one were renamed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const readJson = (file: string) => JSON.parse(read(file));

/** Every id `popup.ts` resolves with `$()` / `input()`. */
const POPUP_IDS = [
    'status',
    'statusText',
    'result',
    'loadingCard',
    'refresh',
    'name',
    'categoryBadge',
    'typeBadge',
    'description',
    'tierValue',
    'difficultyValue',
    'hpValue',
    'stressValue',
    'attackSection',
    'attackName',
    'attackDetails',
    'motivesSection',
    'motivesValue',
    'featureCount',
    'source',
    'site',
    'sendObsidian',
    'sendLabel',
    'createNote',
    'copyMarkdown',
    'markdownLabel',
    'copyJson',
    'jsonLabel',
    'copyDiagnostics',
    'selectBlock',
    'repick',
    'saveSettings',
    'openOptions',
    'vault',
    'folder',
    'overwrite',
    'destinationSummary',
];

test('popup.html declares every id the popup entry point looks up', () => {
    const popup = read('popup.html');
    const missing = POPUP_IDS.filter((id) => !new RegExp(`id="${id}"`).test(popup));
    assert.deepEqual(missing, [], `popup.html is missing ids: ${missing.join(', ')}`);
});

test('the HTML entries load bundled TypeScript, not hand-ordered scripts', () => {
    const popup = read('popup.html');
    const options = read('options.html');

    assert.match(popup, /<script type="module" src="\.\/src\/entries\/popup\.ts"><\/script>/);
    assert.match(options, /<script type="module" src="\.\/src\/entries\/options\.ts"><\/script>/);

    // The nine-tag load order that had to be kept in sync by hand is gone.
    assert.equal((popup.match(/<script/g) || []).length, 1);
    assert.doesNotMatch(popup, /src="(parser|parser-patch|statblock-format|freshcutgrass|heartofdaggers)[^"]*\.js"/);
});

test('styles keep the compact popup layout', () => {
    assert.match(read('compact-layout.css'), /width:\s*400px/);
    assert.match(read('compact-layout.css'), /\.action-stack/);
    assert.doesNotMatch(read('styles.css'), /linear-gradient/);
});

test('buttons carry a single label line', () => {
    const popup = read('popup.html');
    const stack = popup.slice(popup.indexOf('class="action-stack"'), popup.indexOf('<details id="settings"'));
    // Each action button used to repeat itself in a <small> subtitle beneath
    // the label, doubling its height in a 400px-wide popup.
    assert.doesNotMatch(stack, /<small>/, 'action buttons should not carry subtitle copy');
});

test('detail rows put the label beside the value, not above it', () => {
    const popup = read('popup.html');
    const css = read('styles.css');
    // Stacking a caption over a single value cost a whole line per row.
    assert.match(popup, /class="detail-label"/);
    assert.match(popup, /class="detail-value"/);
    assert.match(css, /\.detail-row \{[^}]*grid-template-columns/);
    // Neither half may collapse the other to zero width: the attack name and
    // its modifier/range/damage both have to survive a long name.
    assert.match(css, /\.detail-value strong \{[^}]*flex: 0 1 auto/);
    assert.match(css, /\.detail-value small \{[^}]*flex: 1 1 auto/);
});

test('the ready popup fits a browser action popup without scrolling', () => {
    // Chromium caps the popup at 600px tall; past that the import buttons fall
    // below the fold behind a scrollbar.
    const compact = read('compact-layout.css');
    assert.match(compact, /max-width:\s*400px/);
    assert.doesNotMatch(read('styles.css'), /\.description \{[^}]*line-clamp:\s*3/);
});

test('copying confirms on the button that was clicked', () => {
    const popup = read('src/entries/popup.ts');
    const css = read('styles.css');
    // The status bar is at the top of the popup and the copy buttons are at the
    // bottom; a status-only response reads as "nothing happened".
    assert.match(popup, /function flashCopied/);
    assert.match(popup, /'copyMarkdown'\)/);
    assert.match(popup, /'copyJson'\)/);
    assert.match(css, /\.button\.is-copied/);
    // Swapped via ::after so an interrupted reset timer cannot strand the
    // button with the wrong label.
    assert.match(css, /\.button--compact\.is-copied::after/);
    assert.doesNotMatch(popup, /textContent = 'Copied'/);
});

test('every interactive control has a visible focus state', () => {
    const css = read('styles.css');
    for (const selector of [
        '\\.button:focus-visible',
        '\\.icon-button:focus-visible',
        '\\.button--link:focus-visible',
        '\\.notice-action:focus-visible',
        '\\.settings-panel summary:focus-visible',
    ]) {
        assert.match(css, new RegExp(selector), `${selector} needs a focus style to be keyboard-usable`);
    }
});

test('the popup does not lecture the user about running locally', () => {
    // A privacy footer on every open cost a permanent two lines and told the
    // user nothing actionable; the shortcut legend it sat beside is now
    // rendered on the buttons themselves.
    const popup = read('popup.html');
    assert.doesNotMatch(popup, /Runs locally/);
    assert.doesNotMatch(popup, /class="app-footer"/);
    assert.match(popup, /class="button-kbd"/, 'shortcuts stay discoverable on the buttons');
});

test('manual picking is offered where extraction is reported', () => {
    const popup = read('popup.html');
    const notice = popup.slice(popup.indexOf('id="status"'), popup.indexOf('<main'));
    assert.match(notice, /id="selectBlock"/, 'the recovery action belongs beside the failure message');
});

test('the popup entry still drives the toolkit import flow', () => {
    const popup = read('src/entries/popup.ts');
    assert.match(popup, /obsidian:\/\/daggerheart-import/);
    assert.match(popup, /copyDiagnostics/);
    assert.match(popup, /motives_tactics/);
});

test('diagnostics sit with the settings, not among the primary actions', () => {
    const popup = read('popup.html');
    const settings = popup.slice(popup.indexOf('<details id="settings"'));
    assert.match(settings, /id="copyDiagnostics"/, 'diagnostics belong in the collapsed settings panel');

    const actions = popup.slice(popup.indexOf('class="action-stack"'), popup.indexOf('<details id="settings"'));
    assert.doesNotMatch(actions, /id="copyDiagnostics"/, 'a debugging affordance should not sit beside the imports');
});

test('settings persist without a Save button', () => {
    const popup = read('src/entries/popup.ts');
    // The explicit Save was easy to miss, and a destination that never applied
    // looked like a broken import rather than an unsaved field.
    assert.match(popup, /function queueSave/);
    assert.match(popup, /\$\('vault'\)\.addEventListener\('input', queueSave\)/);
    assert.match(popup, /\$\('folder'\)\.addEventListener\('input', queueSave\)/);
    assert.match(popup, /\$\('overwrite'\)\.addEventListener\('change'/);
});

test('keyboard shortcuts are wired and guarded against text entry', () => {
    const popup = read('src/entries/popup.ts');
    assert.match(popup, /addEventListener\('keydown'/);
    // Without this guard, typing a folder name fires the copy shortcuts.
    assert.match(popup, /function isTypingTarget/);
    assert.match(popup, /if \(isTypingTarget\(event\.target\)\) return;/);
    // Shortcuts route through the same functions as the buttons.
    for (const action of ['copyMarkdown', 'copyJson', 'extract', 'pickBlock', 'importIntoToolkit']) {
        assert.match(popup, new RegExp(`\\b${action}\\(`), `${action} must be callable from a shortcut`);
    }
    // A disabled button cannot be reached by keyboard either.
    assert.match(popup, /function activate\(/);
    assert.match(popup, /\?\.disabled\) return;/);
    // Shortcuts stay discoverable on the controls they trigger rather than in a
    // footer legend the user has to map back onto the buttons.
    const html = read('popup.html');
    assert.match(html, /id="sendObsidian"[\s\S]*?<kbd class="button-kbd"[^>]*>↵</);
    assert.match(html, /id="selectBlock"[^>]*title="[^"]*\(P\)"/);
    assert.match(html, /id="refresh"[\s\S]*?title="[^"]*\(R\)"/);
});

test('the Obsidian handoff goes through the background worker', () => {
    // Replaces the old assertion that statblock-format-adapter.js patched
    // tabs.create; the launch is an explicit call now.
    assert.match(read('src/lib/obsidian-launch.ts'), /DH_OPEN_EXTERNAL_URI/);
    // The handoff navigates the source tab rather than opening a launch tab,
    // so the worker must not create one — see background-launch.test.ts.
    assert.match(read('src/entries/background.ts'), /tabs\.update\(/);
    assert.doesNotMatch(read('src/entries/background.ts'), /tabs\.create\(/);
    assert.doesNotMatch(read('src/format/adapter.ts'), /tabs\.create\s*=/);
});

test('manifest overlays stay browser-specific', () => {
    const base = readJson('manifests/base.json');
    const chromium = readJson('manifests/chromium.json');
    const firefox = readJson('manifests/firefox.json');

    assert.equal(base.manifest_version, 3);
    assert.equal(base.version, undefined, 'version comes from package.json at build time');
    assert.ok(base.commands._execute_action, 'keyboard shortcut is declared');
    assert.ok(!base.permissions.includes('clipboardWrite'), 'async clipboard API needs no permission');

    assert.equal(chromium.background.service_worker, 'background.js');
    assert.equal(chromium.minimum_chrome_version, '111', 'world:MAIN executeScript needs Chrome 111');

    assert.deepEqual(firefox.background.scripts, ['background.js']);
    assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '142.0');
    assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    assert.equal(firefox.minimum_chrome_version, undefined, 'Chromium-only keys must not leak into Firefox');
});

test('the package declares a releasable version and the icon set exists', () => {
    const pkg = readJson('package.json');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    for (const size of [16, 32, 48, 128]) {
        assert.ok(existsSync(join(root, `icons/icon-${size}.png`)), `icons/icon-${size}.png is missing`);
    }
});
