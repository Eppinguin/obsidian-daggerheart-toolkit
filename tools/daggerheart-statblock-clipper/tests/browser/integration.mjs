import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import selfsigned from 'selfsigned';
import { createServer } from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const extensionDir = resolve(root, 'dist', 'chromium');
const manifestPath = resolve(extensionDir, 'manifest.json');
const originalManifest = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(originalManifest);
manifest.permissions = [...new Set([...(manifest.permissions || []), 'tabs'])];
manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'https://freshcutgrass.app/*', 'https://heartofdaggers.com/*'])];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const fixtures = {
  'freshcutgrass.app': await readFile(resolve(import.meta.dirname, 'fixtures', 'freshcutgrass.html')),
  'heartofdaggers.com': await readFile(resolve(import.meta.dirname, 'fixtures', 'heartofdaggers.html'))
};
const certificates = await selfsigned.generate(
  [{ name: 'commonName', value: 'freshcutgrass.app' }],
  {
    days: 1,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [
      { type: 2, value: 'freshcutgrass.app' },
      { type: 2, value: 'heartofdaggers.com' },
      { type: 7, ip: '127.0.0.1' }
    ] }]
  }
);
const server = createServer({ key: certificates.private, cert: certificates.cert }, (request, response) => {
  const hostname = String(request.headers.host || '').split(':')[0];
  const fixture = fixtures[hostname];
  if (!fixture) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fixture);
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
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
          if (String(value?.path || '').replaceAll('\\', '/').endsWith('/dist/chromium')) return id;
        }
      } catch (_error) { /* profile file not written yet */ }
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Could not determine the unpacked extension ID.');
}

async function openPopup(context, id, targetUrl) {
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    globalThis.__DH_TEST_CLIPBOARD = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { globalThis.__DH_TEST_CLIPBOARD = String(text); },
        readText: async () => globalThis.__DH_TEST_CLIPBOARD
      }
    });
  });
  await popup.goto(`chrome-extension://${id}/popup.html?targetUrl=${encodeURIComponent(targetUrl)}`);
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
      '--no-sandbox'
    ]
  });
  const id = await extensionId();
  const fixturePage = context.pages()[0] || await context.newPage();

  const freshUrl = `https://freshcutgrass.app:${port}/homebrew?id=uoHvyG83mBqs4YAxPpGB8n`;
  await fixturePage.goto(freshUrl);
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
  await freshPopup.close();

  const heartUrl = `https://heartofdaggers.com:${port}/homebrew/adversaries/rules-lawyer/`;
  await fixturePage.goto(heartUrl);
  const heartPopup = await openPopup(context, id, heartUrl);
  assert.equal(await heartPopup.locator('#name').textContent(), 'RULES LAWYER');
  assert.equal(await heartPopup.locator('#collection').evaluate(node => node.classList.contains('hidden')), true);
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
  await new Promise(resolveClose => server.close(resolveClose));
  await writeFile(manifestPath, originalManifest);
  await rm(profile, { recursive: true, force: true });
}
