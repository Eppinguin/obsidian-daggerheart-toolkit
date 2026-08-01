# Daggerheart Statblock Clipper

Local-install browser extension for importing Daggerheart community homebrew from:

- `freshcutgrass.app`
- `heartofdaggers.com`

The extension targets the native statblock format used by **Obsidian Daggerheart Toolkit**.

## Interface in 0.5.2

Version 0.5.2 keeps the restrained visual style while returning the popup to a compact extension-sized layout:

- a deliberate 400-pixel popup width with a 360-pixel minimum,
- one consistent single-column flow at every size,
- no wide two-column workspace,
- tighter header, status, content, and footer spacing,
- centered content only as a fallback when a browser forces a larger host surface,
- native light and dark themes with keyboard-visible focus states.

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

The extractor first tries the page's application state, then repairs the rendered preview when needed. Version 0.4.5 also reads descriptions from the nearest visible community card before considering broad page text. This prevents short or visually wrapped summaries from inheriting the next card's description.

Version 0.4.5 rejects creator metadata even when FreshCutGrass combines a timestamp, attribution, and URL into one line. Such lines can no longer be selected or preserved as a statblock description.

The rendered repair also:

- reads HP and Stress when labels and values are separate elements,
- reconstructs major/severe thresholds from the HP & STRESS track,
- reconstructs Standard Attack fields from separate or combined attack rows,
- rejects navigation headings as attack names,
- stops feature parsing before comments, likes, library counts, and footer content,
- joins wrapped feature descriptions,
- infers Fear, Stress, and Hope costs,
- rejects timestamps and comment placeholders as descriptions,
- prefers explicit “made by” attribution over profile labels.

### Duplicate card layouts

Version 0.4.5 evaluates every exact-name occurrence on FreshCutGrass instead of accepting the first DOM match. It prefers a description block that ends at the selected card’s own **Motives & Tactics** or **Tone & Feel** heading. This prevents hidden/responsive copies of the second grid column from borrowing the next card’s summary. Application-state descriptions also take precedence over rendered-card fallbacks.

### Encounter pages

The extension detects each complete adversary or environment card separately. When several statblocks are found:

- choose an individual entry from the selector, or
- keep **Export all detected statblocks** enabled.

**Add to Obsidian** creates one note containing all selected `daggerheart-statblock` blocks. The toolkit can load every block from that note.

## Heart of Daggers

Heart of Daggers detail pages contain both a labelled overview panel and a compact printable card. The extractor selects only the compact card by its combined tier/role and stat-row signature, so the same homebrew is not offered twice. Attribution, conversion, image-credit, and licensing prose remain excluded as a secondary safeguard.

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

The extension requests temporary access to the active tab, user-triggered script injection, settings storage, and clipboard write access. It has no persistent all-sites host permission and sends no data to an external service.
