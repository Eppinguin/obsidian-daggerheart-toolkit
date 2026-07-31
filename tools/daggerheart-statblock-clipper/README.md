# Daggerheart Statblock Clipper

Local-install browser extension for importing Daggerheart community homebrew from:

- `freshcutgrass.app`
- `heartofdaggers.com`

The extension targets the native statblock format used by **Obsidian Daggerheart Toolkit**.

## Outputs

- **Toolkit Markdown** using one or more `daggerheart-statblock` YAML code blocks.
- **Toolkit JSON** using the toolkit export wrapper for one item, or an array of native toolkit statblocks for several items.
- **Add to Obsidian**, which creates a Markdown note through the official `obsidian://new` URI.

Source website, URL, author, and extraction date are preserved in a `source` object.

## Install in Chrome, Edge, Brave, or Arc

1. Open the browser's extensions page, such as `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove or reload any older Daggerheart Statblock Clipper installation.
4. Choose **Load unpacked**.
5. Select this folder.
6. Refresh any already-open FreshCutGrass tabs after installing or reloading the extension.

## FreshCutGrass

The extractor first reads FreshCutGrass application state for the requested homebrew ID. If that state is unavailable, version 0.4.2 repairs the rendered-card result before export.

Version 0.4.2:

- parses combined attack rows such as `Moon Staff: Far | 2d10+3`,
- rejects navigation headings such as `COMMUNITY ADVERSARIES & ENVIRONMENTS` as attack names,
- limits description extraction to the current card intro before Difficulty, Attack, or Features,
- rejects comment placeholders such as `No comments yet. Be the first to comment!`,
- retains the HP, Stress, threshold, feature, cost, and attribution repairs from 0.4.1.

Regression fixtures cover the Shadow Hag and Mushroom entanglement pages.

## Heart of Daggers

The parser reads the full Features section, including separate Passive, Action, and Reaction groups. Fear, Stress, and Hope cost lines are converted to `parsedCost`.

## Use with Obsidian Daggerheart Toolkit

Use **Add to Obsidian** for a Markdown note or **Copy Toolkit JSON** for the toolkit import modal. Set the same compendium folder in the toolkit and extension settings for one-click Markdown import.

## Privacy

The extension requests temporary access to the active tab, user-triggered script injection, settings storage, and clipboard write access. It has no persistent all-sites host permission and sends no data to an external service.
