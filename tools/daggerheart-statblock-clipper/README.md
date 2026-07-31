# Daggerheart Statblock Clipper

Local-install browser extension for importing Daggerheart community homebrew from:

- `freshcutgrass.app`
- `heartofdaggers.com`

The extension targets the native statblock format used by **Obsidian Daggerheart Toolkit**.

## Outputs

- **Toolkit Markdown** using a `daggerheart-statblock` YAML code block.
- **Toolkit JSON** using the toolkit export wrapper (`type`, `version`, `exportDate`, and `data`).
- **Add to Obsidian**, which creates a Markdown note through the official `obsidian://new` URI.

Source website, URL, author, and extraction date are preserved in a `source` object.

## Install in Chrome, Edge, Brave, or Arc

1. Open the browser's extensions page, such as `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder.

## Use with Obsidian Daggerheart Toolkit

### One-click Markdown import

1. In the toolkit settings, set **Compendium Folder** to a vault folder such as `Daggerheart/Homebrew`.
2. Enter that same folder in the clipper's **Obsidian Markdown import** settings.
3. Open an individual statblock or statblock modal.
4. Click **Add to Obsidian**.

The extension creates a note containing a `daggerheart-statblock` block. The toolkit loads it from the configured compendium folder.

### Native JSON import

1. Click **Copy Toolkit JSON**.
2. In Obsidian, run **Import Daggerheart Content**.
3. Select **Adversary** or **Environment**.
4. Paste the JSON and import it.

The JSON is saved through the toolkit's custom compendium system rather than as a Markdown note.

## Extraction fallback

FreshCutGrass is a JavaScript application and may change its modal structure. When automatic extraction selects the wrong content:

1. Click **Pick block on page**.
2. Click the visible statblock container.
3. Reopen the extension.

## Limitations

- This is a user-triggered current-page extractor, not a bulk crawler.
- Complex or newly redesigned feature layouts may need minor cleanup.
- The Obsidian Markdown method requires the extension folder and the toolkit's Compendium Folder setting to match.
- Firefox should be close to compatible with Manifest V3, but this package is currently tested structurally for Chromium browsers.

## Privacy

The extension requests temporary access to the active tab, script injection initiated by the user, settings storage, and clipboard write access. It has no persistent all-sites host permission and sends no data to an external service.
