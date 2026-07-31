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

## FreshCutGrass

### Homebrew stat preview

1. Open a community adversary or environment preview.
2. Open the extension.
3. Confirm the displayed name and feature count.
4. Copy the result or choose **Add to Obsidian**.

The extractor first reads FreshCutGrass application state for the requested homebrew ID. If that state is unavailable, version 0.4.1 repairs the rendered-card result before export.

The rendered repair:

- reads HP and Stress when labels and values are separate elements,
- reconstructs major/severe thresholds from the HP & STRESS track,
- reconstructs Standard Attack fields from separate name, range, damage, type, and modifier elements,
- stops feature parsing before HP & STRESS, comments, likes, library counts, and attribution/footer content,
- joins wrapped feature descriptions instead of treating continuation lines as new features,
- infers Fear, Stress, and Hope costs from feature descriptions,
- rejects timestamps as descriptions,
- prefers explicit “made by” attribution over the profile/uploader label.

The MAIN-world React collector also traverses Fiber `child` and `sibling` links while keeping those cyclic links out of copied results.

Regression fixtures cover `homebrew?id=uoHvyG83mBqs4YAxPpGB8n` and verify the complete **Shadow Hag** record from both app state and the rendered preview fallback.

### Encounter pages

The extension detects each complete adversary or environment card separately. When several statblocks are found:

- choose an individual entry from the selector, or
- keep **Export all detected statblocks** enabled.

**Add to Obsidian** creates one note containing all selected `daggerheart-statblock` blocks. The toolkit can load every block from that note.

## Heart of Daggers

The parser reads the full **Features** section, including separate Passive, Action, and Reaction groups. Fear, Stress, and Hope cost lines are converted to `parsedCost`.

## Use with Obsidian Daggerheart Toolkit

### One-click Markdown import

1. In the toolkit settings, set **Compendium Folder** to a vault folder such as `Daggerheart/Homebrew`.
2. Enter that same folder in the clipper's **Obsidian Markdown import** settings.
3. Open a stat preview, individual statblock, or encounter.
4. Click **Add to Obsidian**.

The toolkit loads every `daggerheart-statblock` block from the created note.

### Native JSON import

1. Click **Copy Toolkit JSON**.
2. In Obsidian, run **Import Daggerheart Content**.
3. Select **Adversary** or **Environment**.
4. Paste the JSON and import it.

For a multi-statblock encounter, Markdown import is currently the most convenient route because one note can contain every detected block.

## Extraction fallback

When automatic extraction does not select the intended content:

1. Click **Pick block(s) on page**.
2. Click one statblock, or a container holding several statblocks.
3. Reopen the extension.

## Privacy

The extension requests temporary access to the active tab, user-triggered script injection, settings storage, and clipboard write access. On FreshCutGrass it inspects only JSON-safe objects that resemble statblocks in the current page's application state. It does not return cookies, authentication tokens, or arbitrary account data. It has no persistent all-sites host permission and sends no data to an external service.
