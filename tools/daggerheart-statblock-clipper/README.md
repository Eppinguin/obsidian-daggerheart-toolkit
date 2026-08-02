# Daggerheart Statblock Clipper

Cross-browser browser extension for importing Daggerheart homebrew from FreshCutGrass and Heart of Daggers into Obsidian Daggerheart Toolkit.

## Browser support

- Chromium-based browsers: Chrome, Edge, Brave, Arc
- Firefox 128 or newer

Both builds use Manifest V3. The Firefox output adds a stable Gecko extension ID and declares that the extension does not collect or transmit data.

## Build project

This directory contains source files, not a committed browser build. Vite builds the popup and options pages. The parser and content scripts remain plain fixed-name files because `scripting.executeScript()` addresses them by package path.

```text
manifests/     shared manifest plus browser overlays
scripts/       build and validation scripts
tests/         parser, site, UI, and manifest regressions
dist/          generated unpacked builds (ignored)
artifacts/     generated ZIP/XPI packages (ignored)
```

### Install and test

```bash
npm install
npm test
npm run build
npm run validate
npm run lint:firefox
npm run package
```

Node.js 20.19 or newer is required.

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

The local Firefox XPI is unsigned. Permanent installation in standard Firefox requires signing through Mozilla Add-ons. For temporary testing, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`.

## Obsidian import

The extension exports toolkit-native `daggerheart-statblock` Markdown and wrapped JSON. **Add to Obsidian** copies Markdown and opens an `obsidian://new` link. It never reads the vault and sends no data to an external service.

## Motives & Tactics

Version 0.6.1 restores adversary **Motives & Tactics** across both supported sites. Heart of Dagers compact cards use a spaced label form such as `Motives & Tactics : ...`; the parser now accepts whitespace around the colon and continues searching when the Features section appears before Motives & Tactics. The value is preserved as `motives_tactics` in Toolkit Markdown and JSON and is shown in the popup preview.

## Extraction behavior

Regression tests cover FreshCutGrass application-state extraction, rendered-card fallbacks, multi-statblock pages, feature parsing, card boundaries, attribution filtering, Motives & Tactics parsing, and toolkit serialization.
