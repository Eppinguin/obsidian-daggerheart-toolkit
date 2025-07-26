// effects-engine.ts
import { Character, InventoryItem, WeaponDamageComponents } from '../types';
import { CalculatedStat } from './calculated-stat';

/**
 * A type guard to check if a value is a plain object.
 * @param value The value to check.
 * @returns True if the value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Initializes a fully-loaded character object by converting its raw numeric stats
 * into live CalculatedStat instances. This prepares the character for the effects system.
 * This function MUTATES the character object passed to it.
 * @param character The raw character object, typically from a JSON file.
 */
export function initializeCharacter(character: Character): void {
    const characterStatPaths = new Set([
        'proficiency',
        'evasion',
        'damageThresholds.major',
        'damageThresholds.severe',
        'hitPoints.max',
        'stress.max',
        'hope.max',
        'armorSlots.max',
        'traits.Strength',
        'traits.Agility',
        'traits.Finesse',
        'traits.Instinct',
        'traits.Presence',
        'traits.Knowledge',
    ]);

    _hydrate(character, characterStatPaths);
    if (character.unarmedDamage) {
        initializeUnarmedDamageComponents(character.unarmedDamage);
    }
    character.inventory.forEach(initializeInventoryItem);
}



/**
 * Initializes a single inventory item by converting its raw numeric stats
 * into live CalculatedStat instances, and parsing weapon damage strings.
 * This function MUTATES the item object passed to it.
 * @param item The raw inventory item object.
 */
export function initializeInventoryItem(item: InventoryItem): void {
    if (item._type === 'armor') {
        _hydrate(item, new Set(['baseScore', 'baseThresholds.major', 'baseThresholds.severe']));
    } else if (item._type === 'weapon') {
        const rawWeapon = item as any;
        const damageString = rawWeapon.damage || 'd6 phy';
        const damageParts = damageString.split(' ');
        const dicePart = damageParts[0];
        const typePart = damageParts[1] || 'phy';

        let baseDice = dicePart;
        let baseModifier = 0;

        const modifierMatch = dicePart.match(/([+-]\d+)$/);
        if (modifierMatch) {
            baseModifier = parseInt(modifierMatch[1]);
            baseDice = dicePart.replace(modifierMatch[0], '');
        }

        // Initialize with raw values; _hydrate will convert these later if targetted directly
        item.damageComponents = {
            baseDice: baseDice,
            baseModifier: baseModifier,
            damageType: typePart,
            // --- FIX: The base number of bonus dice is 0 ---
            numberOfDice: 0,
            flatBonus: baseModifier
        } as unknown as WeaponDamageComponents;

        // Now, explicitly hydrate the components within item.damageComponents
        initializeWeaponDamageComponents(item.damageComponents);

        // Remove the old raw 'damage' property that held the string
        delete rawWeapon.damage;
    }
}

function initializeWeaponDamageComponents(components: WeaponDamageComponents): void {
    const weaponDamageStatPaths = new Set([
        'numberOfDice',
        'flatBonus'
    ]);
    _hydrate(components, weaponDamageStatPaths);
}

function initializeUnarmedDamageComponents(components: WeaponDamageComponents): void {
    const unarmedStatPaths = new Set([
        'numberOfDice',
        'flatBonus'
    ]);
    _hydrate(components, unarmedStatPaths);
}

/**
 * Recursively traverses a data structure and replaces numeric properties with instances
 * of CalculatedStat based on a Set of keys.
 * @param current The object or array to traverse.
 * @param keysToConvert A Set of strings representing the paths to convert.
 * @param path The current path in the traversal.
 */
function _hydrate(current: unknown, keysToConvert: Set<string>, path = ''): void {
    if (!current) {
        return;
    }

    if (isObject(current)) {
        for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                const newPath = path ? `${path}.${key}` : key;
                const value = current[key];

                if (keysToConvert.has(newPath)) {
                    // FIX: This now handles both initial hydration and re-hydration from a save file.
                    if (typeof value === 'number') {
                        // Case 1: The value is a raw number (e.g., initial character creation).
                        current[key] = new CalculatedStat(value);
                    } else if (isObject(value) && 'base' in value && !(value instanceof CalculatedStat)) {
                        // Case 2: The value is an object from a JSON file that needs to be re-instantiated.
                        current[key] = new CalculatedStat(value.base as number);
                    }
                    // If it's already a CalculatedStat instance, we do nothing.

                } else if (keysToConvert.has(newPath) && typeof value === 'string' && (newPath.endsWith('spellCastTrait') || newPath.endsWith('baseDice') || newPath.endsWith('damageType'))) {
                    // This is an explicit exclusion for non-numeric properties that might share a path, which is fine.
                }
                else {
                    // Recurse into other objects and arrays.
                    _hydrate(value, keysToConvert, newPath);
                }
            }
        }
    } else if (Array.isArray(current)) {
        for (const item of current) {
            _hydrate(item, keysToConvert, path);
        }
    }
}