# Changelog

Notable changes to the Daggerheart Toolkit plugin. The browser extension ships
separately and is versioned on its own; see
[its README](tools/daggerheart-statblock-clipper/README.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Installation through BRAT did not include data, so data is now bundled into main.js
- **Connecting to dddice failed** for any account that already had a room.
  Activation always tried to create a new one, which free and guest accounts
  are not allowed to do ("Guest accounts can only create 1 room"). An existing
  room is now reused, and one is only created when the account has none.
- A failed dddice connection wiped the saved API key and room, so the next
  attempt had nothing to fall back on and failed the same way. A failure now
  leaves the previous connection untouched.
- dddice connection errors showed a generic "please try again" with no way to
  tell what went wrong. The server's own message and status are now shown.

### Changed

- **Connecting to dddice is much faster.** Setup fetched every dice theme
  before it would finish — 7 pages and over 4 MB on a large collection — and
  then immediately fetched all of it a second time. It now loads only what it
  needs to pick a default, and the theme picker fills in the rest as you
  scroll. Roughly 10 seconds down to under 1 on a well-stocked account.

### Internal

- bumped dependencies to latest versions
- activated minification
- `ThreeDDiceAPI` writes its auth header into axios' global defaults and skips
  the write when the key is empty, so building a guest client left the previous
  account's token in place. The guest path now clears it explicitly.

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
