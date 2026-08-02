# Daggerheart Statblock Clipper

Cross-browser extension for importing Daggerheart homebrew from FreshCutGrass and Heart of Daggers into Obsidian Daggerheart Toolkit.

## Browser support

- Chromium-based browsers: Chrome, Edge, Brave, Arc
- Firefox 128 or newer

Both builds use Manifest V3. The Firefox output adds a stable Gecko extension ID and declares that the extension does not collect or transmit data.

## Build project

This directory contains source files, not committed browser builds. Vite builds the popup and options pages. Runtime-injected parser files retain fixed package names.

```text
manifests/     shared manifest plus browser overlays
scripts/       build, validation, packaging, and publishing scripts
tests/         parser, browser, UI, and manifest regressions
dist/          generated unpacked builds (ignored)
artifacts/     generated ZIP/XPI packages (ignored)
```

```bash
npm install
npm test
npm run build
npm run validate
npm run test:browser
npm run lint:firefox
npm run package
```

Node.js 20.19 or newer is required. The browser integration test needs Chromium and a display server; CI installs Playwright Chromium and runs it through Xvfb.

Generated builds:

```text
dist/chromium/
dist/firefox/
```

Generated packages:

```text
artifacts/daggerheart-statblock-clipper-chromium.zip
artifacts/daggerheart-statblock-clipper-firefox.xpi
```

The local Firefox XPI is unsigned. For temporary testing, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`.

## Obsidian import

**Import into toolkit** is the primary action:

1. The extension serializes the selected statblock or batch using the repository's shared canonical format.
2. It copies that JSON locally to the clipboard.
3. It opens `obsidian://daggerheart-import`.
4. The plugin reads the clipboard and shows a confirmation preview.
5. Conflicts can be imported as a copy, used to replace the existing entry, or skipped.
6. The plugin performs one batched compendium write after confirmation.

The custom URI never includes the statblock itself and never saves automatically. **Create Markdown note** remains available as a fallback using `obsidian://new`.

The Obsidian command **Import Statblocks from Clipboard** opens the same reviewed import flow without the extension.

## Diagnostics

**Copy diagnostics** produces a sanitized JSON report containing the extension/browser version, page URL, extraction strategy, detected-item count, and normalized selected statblocks. It does not copy the full page HTML.

## Shared format

`../../shared/statblock-format.js` is consumed by both the extension and plugin. It owns field normalization, feature costs, validation, JSON envelopes, and Markdown serialization so fields cannot drift between products.

## Validation

Regression tests cover FreshCutGrass state and rendered fallbacks, Heart of Daggers rendered-card selection, multi-statblock pages, features, Motives & Tactics, thresholds, attribution filtering, shared serialization, and a packaged Chromium extension test that drives the actual popup against representative site fixtures.

Store release setup is documented in [STORE_PUBLISHING.md](STORE_PUBLISHING.md).
