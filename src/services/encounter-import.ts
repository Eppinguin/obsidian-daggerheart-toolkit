import { ENCOUNTER_BUILDER_VIEW_TYPE, type EncounterBuilderView } from '../views/EncounterBuilderView';
import type DaggerheartStatblockPlugin from '../main';
import type { StatblockData } from '../types';

/**
 * Bridges an import to the open encounter builder.
 *
 * The import preview can offer to drop what it just imported straight into the
 * encounter the user is working on, so a statblock clipped from the browser
 * does not have to be found again in the compendium afterwards.
 */

/** The encounter builder view, if one is open with an encounter loaded. */
export function getActiveEncounterView(plugin: DaggerheartStatblockPlugin): EncounterBuilderView | null {
    const leaf = plugin.app.workspace.getLeavesOfType(ENCOUNTER_BUILDER_VIEW_TYPE)[0];
    const view = leaf?.view as EncounterBuilderView | undefined;
    return view?.currentEncounterId ? view : null;
}

/** Display name of the encounter that `addImportedToEncounter` would target. */
export function getActiveEncounterName(plugin: DaggerheartStatblockPlugin): string | null {
    const view = getActiveEncounterView(plugin);
    if (!view?.currentEncounterId) return null;
    return plugin.getSavedEncounter(view.currentEncounterId)?.name ?? null;
}

/**
 * Add freshly imported statblocks to the open encounter.
 *
 * Adversaries and environments alike: the encounter builder treats both as
 * members ("Add adversaries or environments"), and its own compendium list adds
 * either through the same call. Returns how many landed so the caller can
 * report accurately.
 */
export function addImportedToEncounter(
    plugin: DaggerheartStatblockPlugin,
    statblocks: StatblockData[],
): { added: number } {
    const view = getActiveEncounterView(plugin);
    if (!view) return { added: 0 };

    for (const statblock of statblocks) {
        // Owns group creation, ordering, persistence, and the redraw.
        view.addItemToActiveEncounter(statblock, 1);
    }
    return { added: statblocks.length };
}
