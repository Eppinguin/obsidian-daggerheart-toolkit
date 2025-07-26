import { v4 as uuidv4 } from 'uuid';
import { Character, ActiveEffect, Modification, ICalculatedStat, IModifier, InventoryItem, CompendiumItem, InherentFeature, DomainCard, Condition } from '../types';
import { parseEffect } from './effect-parser';
import { CalculatedStat } from './calculated-stat';

type Identifiable = { id: string } | { instanceId: string };
function getSourceId(source: any): string | null {
    if (source && typeof source === 'object') {
        if ('id' in source) return source.id;
        if ('instanceId' in source) return source.instanceId;
    }
    return null;
}

function getProperty(obj: any, path: string): any {
    return path.split('.').reduce((o, key) => (o && o[key] !== 'undefined' ? o[key] : undefined), obj);
}

/**
 * Recursively traverses a character object to find all instances of CalculatedStat.
 * This is crucial for ensuring that when an effect is removed, its modifiers
 * are purged from every possible stat on the character sheet and their inventory.
 * @param obj The object or value to inspect.
 * @param collection The array to collect the stats in.
 */
function _gatherAllStats(obj: any, collection: ICalculatedStat[]): void {
    if (!obj) return;

    if (obj instanceof CalculatedStat) {
        collection.push(obj);
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            _gatherAllStats(item, collection);
        }
    } else if (typeof obj === 'object') {
        for (const key in obj) {
            // Avoid traversing the parent object in a circular dependency
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                _gatherAllStats(obj[key], collection);
            }
        }
    }
}

function isCalculatedStat(obj: any): obj is ICalculatedStat {
    return obj && typeof obj.getValue === 'function' && typeof obj.addModifier === 'function';
}

/**
 * Finds all ICalculatedStat objects on a character that match a modification's target and scope.
 * This can return multiple stats, for example, if an effect targets all equipped weapons.
 * @param character The character to search within.
 * @param modification The modification defining the target.
 * @returns An array of ICalculatedStat objects that match the target criteria.
 */
function findStatsOnCharacter(character: Character, modification: Modification): ICalculatedStat[] {
    const scope = modification.targetScope;

    if (scope === 'character') {
        const stat = getProperty(character, modification.target);
        return isCalculatedStat(stat) ? [stat] : [];
    }

    if (typeof scope === 'object' && scope.scopeType) {
        const targetItems: InventoryItem[] = [];
        const scopeType = scope.scopeType.toLowerCase();

        // --- FIX: This logic now handles both general and specific scopes ---
        if (scopeType === 'equippedarmor' || scopeType === 'armor') {
            const armor = character.inventory.find(i => i.instanceId === character.equippedArmorId);
            if (armor) targetItems.push(armor);
        } else if (scopeType === 'equippedweapon' || scopeType === 'weapon') {
            character.equippedWeaponIds.forEach(id => {
                const weapon = character.inventory.find(i => i.instanceId === id);
                if (weapon) targetItems.push(weapon);
            });
        }

        const matchingStats: ICalculatedStat[] = [];
        for (const item of targetItems) {
            // Apply filter if it exists
            if (scope.filter) {
                if (scope.filter.type === 'byName' && item.name !== scope.filter.value) continue;
                if (scope.filter.type === 'byTrait' && (item._type !== 'weapon' || item.trait !== scope.filter.value)) continue;
            }

            const stat = getProperty(item, modification.target);
            // --- FIX: Replace instanceof with our new helper ---
            if (isCalculatedStat(stat)) {
                matchingStats.push(stat);
            }
        }
        return matchingStats;
    }

    return [];
}


/**
 * Adds effects from a source to the character by registering modifiers with the
 * relevant CalculatedStat objects.
 * @param character The character to modify.
 * @param source The item, feature, condition, etc., that is the source of the effects.
 */
export function addEffectsFromSource(character: Character, source: (CompendiumItem | InherentFeature | DomainCard | Condition | InventoryItem) & { name: string, effects?: string[] }): void {
    const sourceId = getSourceId(source);
    if (!source.effects || source.effects.length === 0 || !sourceId) {
        return;
    }

    // First, ensure existing effects from this source are purged to prevent duplication.
    removeEffectsFromSource(character, sourceId);

    const newActiveEffect: ActiveEffect = {
        id: uuidv4(),
        sourceId: sourceId,
        sourceName: source.name,
        modifications: [], // We still store the raw modifications for reference
        isEnabled: true,
    };

    for (const effectString of source.effects) {
        if (!effectString.trim()) continue;

        try {
            const modifications = parseEffect(effectString);
            newActiveEffect.modifications.push(...modifications);

            for (const mod of modifications) {
                const targetStats = findStatsOnCharacter(character, mod);
                if (targetStats.length > 0) {
                    const newModifier: IModifier = {
                        sourceId: newActiveEffect.id, // Link to the unique ActiveEffect instance
                        sourceName: newActiveEffect.sourceName,
                        type: mod.type as 'bonus' | 'penalty' | 'override',
                        value: mod.value,
                        condition: mod.condition
                    };

                    for (const stat of targetStats) {
                        stat.addModifier(newModifier);
                    }
                }
            }
        } catch (error) {
            console.error(`[Effects Manager] Failed to parse or apply effect: "${effectString}" from source "${source.name}".`, error);
        }
    }

    if (newActiveEffect.modifications.length > 0) {
        character.activeEffects.push(newActiveEffect);
    }
}

/**
 * Removes all modifiers from a given source across the entire character sheet.
 * @param character The character to modify.
 * @param sourceId The ID of the source whose effects should be removed.
 */
export function removeEffectsFromSource(character: Character, sourceId: string): void {
    const effectsToRemove = character.activeEffects.filter(e => e.sourceId === sourceId);
    if (effectsToRemove.length === 0) {
        return;
    }

    const activeEffectIds = effectsToRemove.map(e => e.id);
    if (activeEffectIds.length === 0) return;

    // Use the helper to find every single stat on the character.
    const allStats: ICalculatedStat[] = [];
    _gatherAllStats(character, allStats);

    // Tell each stat to remove any modifiers that came from the effect instances we're removing.
    for (const stat of allStats) {
        for (const id of activeEffectIds) {
            stat.removeModifiersBySource(id);
        }
    }

    // Finally, remove the ActiveEffect from the character's list.
    character.activeEffects = character.activeEffects.filter(e => e.sourceId !== sourceId);
}