# Obsidian Daggerheart Toolkit

Obsidian plugin for Daggerheart adversary statblocks, environments, encounters, and character sheets.

## Markdown homebrew compendium

Set **Compendium Folder** in the plugin settings to a vault-relative folder such as:

```text
Daggerheart/Homebrew
```

The plugin scans that folder and all nested folders for fenced `daggerheart-statblock` blocks. Folder paths are normalized automatically, so leading/trailing slashes and Windows-style backslashes are accepted.

Changes are applied after a short typing delay without rebuilding the settings screen. Creating, editing, renaming, or deleting Markdown files inside the configured folder automatically reloads the compendium.
