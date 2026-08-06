# Obsidian Daggerheart Toolkit

Obsidian plugin for Daggerheart GMs: adversary statblocks, environments, encounters, Fear, countdowns, and dice rolling.

## Content sources

Every statblock belongs to a **content source**. Out of the box there are four: SRD Adversaries, SRD Environments, My Custom Content (`user_data/user-adversaries.json`), and one Markdown folder. Each can be switched on or off independently without deleting anything.

Open **Manage Compendium** — from the button in the encounter builder's compendium panel, or from settings — to search, edit, duplicate, move, delete, and export entries, and to manage sources. Three kinds can be added there:

- **Add JSON source** — an empty file in the plugin's `user_data/` folder that you can save entries into.
- **Add Markdown folder** — any number of vault folders to read statblocks from. Each gets its own name and toggle. Removing a folder source only stops the plugin reading it; the notes stay where they are.
- **Import JSON…** — load a statblock file either into an existing source or into a new source created from it. Conflicts are reviewed before anything is saved.

When two sources define the same name, the higher-priority one wins: Markdown beats JSON sources, which beat the SRD. The hidden entry is not lost; the manager still lists it, struck through, with a note saying which source is covering it.

### Personal content you may not redistribute

To use material you own but cannot share, add a source in the manager and turn on **Personal licensed content**. Entries in that source work everywhere in the plugin but are excluded from every export path: they do not appear in the export dropdown, they have no export buttons in the manager, and the export service refuses them outright.

Source files live in the plugin's `user_data/` folder, which is listed in `.gitignore`, so this content cannot be committed by accident. Note the same folder is cleared when the plugin is reinstalled — use **Export source** in the manager to keep a backup first. Do not paste licensed content into the Markdown compendium folder; that lives in the vault proper and is not ignored.

## Markdown homebrew compendium

Add folders through **Manage Compendium → Add Markdown folder**. Use a vault-relative path such as `Daggerheart/Homebrew`; do not include the vault name. The field suggests folders that exist, and rejects paths that do not.

The plugin scans each configured folder and all its nested folders for fenced `daggerheart-statblock` blocks. Leading/trailing slashes and Windows-style backslashes are normalized automatically. Creating, editing, renaming, or deleting Markdown files inside any configured folder reloads the compendium automatically.

Entries from these folders can be edited from the manager like any other. Saving rewrites **only** that one fenced block inside its note — frontmatter, prose, links, and any other statblocks in the same file are left byte-identical. Deleting removes just that block. Each row also gets an **Open note** button if you would rather edit the file directly, and the edit dialog still offers **Save a Copy** if you want the change in a JSON source instead of in the note.

Before writing, the plugin checks that the block it is about to replace still holds the entry it was read from. If the note changed in the meantime it refuses and asks you to refresh, rather than overwriting the wrong statblock.
