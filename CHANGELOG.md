# Changelog

Notable changes to the Daggerheart Toolkit plugin. The browser extension ships
separately and is versioned on its own; see
[its README](tools/daggerheart-statblock-clipper/README.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-08-06

### Added

- **Encounter budget.** A bar showing how much of the budget an encounter
  spends, which flags when you go over.
- **Spend Fear from a feature.** A feature's cost text is clickable, so Fear
  can be spent from the card instead of the header tracker.
- **Summons.** Summon adversaries directly from a feature, with a picker for
  what to summon and a prompt for how many.
- **Tier scaling.** Scale an adversary to a different tier from the card, with
  a summary of exactly what changed.
- **Countdowns** that loop, for effects that repeat on a timer.
- **Content sources.** Import, pick between, and manage multiple compendium
  sources from one place.
- **Markdown statblocks.** Write a statblock in a fenced code block and have it
  render in a note.
- **Browser extension** (Daggerheart Statblock Clipper) for importing
  adversaries and environments from FreshCutGrass and Heart of Daggers. Ships
  for Chrome and Firefox and is released separately.

### Changed

- Collapsed adversary cards get a real header bar and stay readable in a narrow
  side panel.
- Conditions are colour-coded and update in place instead of redrawing the
  whole group.
- Instance names can be renamed inline, and encounter cards reorder by drag and
  drop.
- The compendium list shows category and tier at a glance.
- Adversary cards keep their live state pinned to the bottom, and the encounter
  area wraps onto multiple rows.

### Fixed

- Instances no longer lose their name after being renamed and added to a group.
- Card controls no longer overlap the adversary name.
- The tier scaler dismisses on an outside click.
- Condition hover and card height containment behave correctly again.

### Internal

- `package.json` sat on 0.0.2 while `manifest.json` shipped 0.0.3, so the
  release script would have tagged the wrong version. Added `version-bump.mjs`
  and `versions.json` to keep them in step.
- The plugin release now attaches `main.js`, `manifest.json` and `styles.css`
  as individual assets. Obsidian's installer cannot read them out of the zip,
  so 0.0.2 could not be installed from its release page.
- Removed 45 dead CSS rules left behind by features that were tried and
  dropped: a damage-threshold display, an import/export modal, filter chips,
  and a renamed cost class. `styles.css` is 88kb, down from 94kb.
- Added oxlint and oxfmt with a CI quality workflow.

## [0.0.2] - 2025-07-21

Initial public releases.

## [0.0.1] - 2025-07-09

[Unreleased]: https://github.com/Eppinguin/obsidian-daggerheart-toolkit/compare/0.0.3...HEAD
[0.0.3]: https://github.com/Eppinguin/obsidian-daggerheart-toolkit/compare/0.0.2...0.0.3
[0.0.2]: https://github.com/Eppinguin/obsidian-daggerheart-toolkit/compare/0.0.1...0.0.2
[0.0.1]: https://github.com/Eppinguin/obsidian-daggerheart-toolkit/releases/tag/0.0.1
