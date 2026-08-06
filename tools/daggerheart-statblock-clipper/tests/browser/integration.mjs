import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import selfsigned from 'selfsigned';
import { createServer } from 'node:https';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const builtDir = resolve(root, 'dist', 'chromium');

/** The test needs `tabs` and host permissions that the shipped extension does
 * not request. Copy the build and widen the copy, rather than editing
 * dist/chromium in place and restoring it in a finally block: that made the
 * tested artifact differ from the shipped one and left the build dirty
 * whenever the run crashed. */
const extensionDir = await mkdtemp(join(tmpdir(), 'dh-clipper-ext-'));
await cp(builtDir, extensionDir, { recursive: true });

const manifestPath = resolve(extensionDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.permissions = [...new Set([...(manifest.permissions || []), 'tabs'])];
manifest.host_permissions = [
    ...new Set([...(manifest.host_permissions || []), 'https://freshcutgrass.app/*', 'https://heartofdaggers.com/*']),
];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const fixtures = {
    'freshcutgrass.app': await readFile(resolve(import.meta.dirname, 'fixtures', 'freshcutgrass.html')),
    'heartofdaggers.com': await readFile(resolve(import.meta.dirname, 'fixtures', 'heartofdaggers.html')),
};
const certificates = await selfsigned.generate([{ name: 'commonName', value: 'freshcutgrass.app' }], {
    days: 1,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'freshcutgrass.app' },
                { type: 2, value: 'heartofdaggers.com' },
                { type: 7, ip: '127.0.0.1' },
            ],
        },
    ],
});
const server = createServer({ key: certificates.private, cert: certificates.cert }, (request, response) => {
    const hostname = String(request.headers.host || '').split(':')[0];
    const fixture = fixtures[hostname];
    if (!fixture) {
        response.writeHead(404).end('Not found');
        return;
    }
    // No keep-alive: Chromium reusing a pooled TLS socket across navigations
    // intermittently stalled, producing a ~20% timeout rate in this test.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture);
});
server.keepAliveTimeout = 0;
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
const port = address.port;
const profile = await mkdtemp(join(tmpdir(), 'dh-clipper-playwright-'));

async function extensionId() {
    const files = [join(profile, 'Default', 'Preferences'), join(profile, 'Default', 'Secure Preferences')];
    for (let attempt = 0; attempt < 100; attempt += 1) {
        for (const file of files) {
            try {
                const preferences = JSON.parse(await readFile(file, 'utf8'));
                const settings = preferences?.extensions?.settings || {};
                for (const [id, value] of Object.entries(settings)) {
                    // Compare resolved paths: on macOS mkdtemp yields /var/...
                    // while Chrome records the /private/var/... realpath.
                    const recorded = String(value?.path || '');
                    if (!recorded) continue;
                    try {
                        if (realpathSync(recorded) === realpathSync(extensionDir)) return id;
                    } catch {
                        /* path no longer resolvable */
                    }
                }
            } catch (_error) {
                /* profile file not written yet */
            }
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error('Could not determine the unpacked extension ID.');
}

/** Belt-and-braces retry. The real fix for the ~20% flake this test used to
 * have was disabling HTTP keep-alive on the fixture server (see `connection:
 * close` above): Chromium pooled a TLS connection across navigations and the
 * reused socket sometimes stalled, so the server logged the request but the
 * response never completed. The retry stays as cheap insurance. */
async function gotoWithRetry(page, url, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            return;
        } catch (error) {
            lastError = error;
            if (attempt < attempts) await page.waitForTimeout(500);
        }
    }
    throw lastError;
}

async function openPopup(context, id, targetUrl) {
    const popup = await context.newPage();
    await popup.addInitScript(() => {
        globalThis.__DH_TEST_CLIPBOARD = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text) => {
                    globalThis.__DH_TEST_CLIPBOARD = String(text);
                },
                readText: async () => globalThis.__DH_TEST_CLIPBOARD,
            },
        });
    });
    await gotoWithRetry(popup, `chrome-extension://${id}/popup.html?targetUrl=${encodeURIComponent(targetUrl)}`);
    await popup.locator('#name').waitFor({ state: 'visible', timeout: 15000 });
    return popup;
}

let context;
try {
    context = await chromium.launchPersistentContext(profile, {
        headless: false,
        ignoreHTTPSErrors: true,
        args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
            '--host-resolver-rules=MAP freshcutgrass.app 127.0.0.1, MAP heartofdaggers.com 127.0.0.1',
            '--ignore-certificate-errors',
            '--no-sandbox',
        ],
    });
    const id = await extensionId();
    // Open a fresh page rather than reusing `context.pages()[0]`, Chromium's
    // initial about:blank tab, whose lifecycle overlaps extension startup.
    const fixturePage = await context.newPage();

    const freshUrl = `https://freshcutgrass.app:${port}/homebrew?id=uoHvyG83mBqs4YAxPpGB8n`;
    await gotoWithRetry(fixturePage, freshUrl);
    const freshPopup = await openPopup(context, id, freshUrl);
    assert.equal(await freshPopup.locator('#name').textContent(), 'SHADOW HAG');
    assert.equal(await freshPopup.locator('#hpValue').textContent(), '8');
    assert.equal(await freshPopup.locator('#stressValue').textContent(), '6');
    assert.match((await freshPopup.locator('#attackDetails').textContent()) || '', /\+2.*Far.*2d10\+3/i);
    assert.match((await freshPopup.locator('#motivesValue').textContent()) || '', /Feed on nightmares/i);
    await freshPopup.locator('#copyMarkdown').click();
    const freshMarkdown = await freshPopup.evaluate(() => globalThis.__DH_TEST_CLIPBOARD);
    assert.match(freshMarkdown, /name: "SHADOW HAG"/);
    assert.match(freshMarkdown, /motives_tactics: "Feed on nightmares/);
    assert.match(freshMarkdown, /major_hp: 14/);
    // Both labelled sections must survive. The fixture uses the colon-suffixed
    // form with the value on the next line, and singular "Experience:", exactly
    // as the live page renders them.
    assert.match(freshMarkdown, /experience: "Ageless Knowledge \+2"/);
    assert.doesNotMatch(freshMarkdown, /object Object/);
    // The expanded card sits in a grid of preview cards. None of their text may
    // leak in: the parser used to fall back to <body> and swallow the lot.
    for (const neighbour of [
        'Ambush, Feed, Grapple',
        'Deeproot Defender',
        'Damp, dark',
        'GIANT SPIDER',
        'DENSE JUNGLE',
        'ANCIENT TUNNELS',
    ]) {
        assert.doesNotMatch(
            freshMarkdown,
            new RegExp(neighbour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
            `neighbouring card text bled in: ${neighbour}`,
        );
    }
    // Keyboard shortcuts: M copies Markdown without touching the mouse.
    await freshPopup.evaluate(() => {
        globalThis.__DH_TEST_CLIPBOARD = '';
    });
    await freshPopup.locator('body').press('m');
    assert.match(
        await freshPopup.evaluate(() => globalThis.__DH_TEST_CLIPBOARD),
        /name: "SHADOW HAG"/,
        'pressing M should copy the toolkit Markdown',
    );

    // A single letter typed into a settings field must reach the field rather
    // than firing the shortcut.
    await freshPopup.evaluate(() => {
        globalThis.__DH_TEST_CLIPBOARD = '';
        // The settings live in a collapsed <details>; open it so the field is
        // focusable.
        document.getElementById('settings')?.setAttribute('open', '');
    });
    await freshPopup.locator('#folder').fill('');
    await freshPopup.locator('#folder').press('m');
    assert.equal(
        await freshPopup.evaluate(() => globalThis.__DH_TEST_CLIPBOARD),
        '',
        'typing in a settings field must not trigger a shortcut',
    );
    assert.equal(await freshPopup.locator('#folder').inputValue(), 'm', 'the character should reach the field');

    // Adding to the open encounter is the review screen's decision, not the
    // extension's: the plugin renders that toggle whenever an encounter is
    // open. A second button here could only pre-tick it, and silently degraded
    // to a plain import whenever no encounter was open.
    assert.equal(await freshPopup.locator('#sendEncounter').count(), 0);
    await freshPopup.close();

    const heartUrl = `https://heartofdaggers.com:${port}/homebrew/adversaries/rules-lawyer/`;
    await gotoWithRetry(fixturePage, heartUrl);
    const heartPopup = await openPopup(context, id, heartUrl);
    assert.equal(await heartPopup.locator('#name').textContent(), 'RULES LAWYER');
    // Heart of Daggers renders one statblock per page. The multi-item chooser
    // that used to be asserted hidden here is gone: neither supported site ever
    // yields more than one block from automatic extraction.
    assert.equal(await heartPopup.locator('#collection').count(), 0);
    assert.match((await heartPopup.locator('#motivesValue').textContent()) || '', /Change the pace/);
    await heartPopup.locator('#copyMarkdown').click();
    const heartMarkdown = await heartPopup.evaluate(() => globalThis.__DH_TEST_CLIPBOARD);
    assert.equal((heartMarkdown.match(/```daggerheart-statblock/g) || []).length, 1);
    assert.match(heartMarkdown, /name: "RULES LAWYER"/);
    assert.match(heartMarkdown, /damage: "3d6\+15 mag"/i);
    await heartPopup.close();

    console.log('Chromium packaged-extension integration passed');
} finally {
    await context?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(profile, { recursive: true, force: true });
    await rm(extensionDir, { recursive: true, force: true });
}
