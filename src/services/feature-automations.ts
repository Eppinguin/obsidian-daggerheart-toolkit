import DaggerheartStatblockPlugin from '../main';
import { Character, CompendiumFeature, DomainCard, InherentFeature, InventoryItem } from '../types';

/**
 * Checks if a character has a specific feature by name (case-insensitive).
 * @param character The character object.
 * @param featureName The name of the feature to check for.
 * @param plugin The plugin instance to access the compendium.
 * @returns True if the character has the feature.
 */
function hasFeature(character: Character, featureName: string, plugin: DaggerheartStatblockPlugin): boolean {
    const ancestry = plugin.compendium.getAncestry(character.ancestryId);
    const ancestryFeats = ancestry ? ancestry.feats.map((f: { name: string; text: string; }) => ({ name: f.name, description: f.text, source: 'Ancestry' })) : [];

    const allFeatures: (InherentFeature | DomainCard | { name: string; description: string; source: string; })[] = [
        ...character.features,
        ...character.loadout,
        ...ancestryFeats
    ];
    return allFeatures.some(f => f.name.toLowerCase().includes(featureName.toLowerCase()));
}

/**
 * Calculates all Evasion modifiers derived from equipment and features.
 * @param character The character object.
 * @param equippedArmor The character's equipped armor item.
 * @param equippedWeapons An array of the character's equipped weapon items.
 * @param plugin The plugin instance to access the compendium.
 * @returns The total Evasion modifier.
 */
export function getEvasionModifier(
    character: Character,
    equippedArmor: InventoryItem & { _type: 'armor' } | undefined,
    equippedWeapons: (InventoryItem & { _type: 'weapon' })[],
    plugin: DaggerheartStatblockPlugin
): number {
    let modifier = 0;

    // --- Penalties from Equipment ---
    if (equippedArmor?.features?.some((f: CompendiumFeature) => f.name.toLowerCase().includes("heavy"))) {
        modifier += equippedArmor.features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("very heavy")) ? -2 : -1;
    }
    equippedWeapons.forEach(weapon => {
        const features = weapon.features || [];
        if (features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("heavy") || f.name.toLowerCase().includes("massive"))) {
            modifier -= 1;
        }
        if (features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("barrier"))) {
            modifier -= 1;
        }
    });

    // --- Bonuses from Equipment ---
    if (equippedArmor?.features?.some((f: CompendiumFeature) => f.name.toLowerCase().includes("flexible"))) {
        modifier += 1;
    }

    // --- Bonuses from Features ---
    const noWeaponsEquipped = !character.equippedWeaponIds || character.equippedWeaponIds.length === 0;
    if (hasFeature(character, "I am the Weapon", plugin) && noWeaponsEquipped) {
        modifier += 1;
    }

    return modifier;
}

/**
 * Calculates all Armor modifiers derived from equipment and features.
 * @param character The character object.
 * @param equippedWeapons An array of the character's equipped weapon items.
 * @param plugin The plugin instance to access the compendium.
 * @returns The total Armor modifier.
 */
export function getArmorModifier(
    character: Character,
    equippedWeapons: (InventoryItem & { _type: 'weapon' })[],
    plugin: DaggerheartStatblockPlugin
): number {
    let modifier = 0;

    // --- Bonuses from Equipment Features ---
    equippedWeapons.forEach(weapon => {
        const features = weapon.features || [];
        if (features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("protective")) || features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("double duty"))) {
            modifier += weapon.name.toLowerCase().includes("round") ? (weapon.tier || 1) : 1;
        }
        if (features.some((f: CompendiumFeature) => f.name.toLowerCase().includes("barrier"))) {
            modifier += (weapon.tier || 0) + 1; // Tier 1 gives +2, Tier 2 gives +3 etc.
        }
    });

    // --- Bonuses from Character Features ---
    if (hasFeature(character, "Armorer", plugin)) {
        modifier += 1;
    }
    if (hasFeature(character, "Valor-Touched", plugin)) {
        const valorCardCount = character.loadout.filter(c => c.domain.toLowerCase() === "valor").length;
        if (valorCardCount > 3) {
            modifier += 1;
        }
    }

    return modifier;
}

/**
 * Calculates the final damage thresholds for a character.
 * @param character The character object.
 * @param equippedArmor The character's equipped armor item.
 * @param plugin The plugin instance to access the compendium.
 * @returns An object containing the final major and severe thresholds.
 */
export function getFinalDamageThresholds(
    character: Character,
    equippedArmor: InventoryItem & { _type: 'armor' } | undefined,
    plugin: DaggerheartStatblockPlugin
): { major: number; severe: number } {

    let major: number, severe: number;

    if (equippedArmor) {
        major = equippedArmor.baseThresholds.major + character.level;
        severe = equippedArmor.baseThresholds.severe + character.level;
    } else {
        major = character.level;
        severe = character.level * 2;
        if (hasFeature(character, "Bare Bones", plugin)) {
            if (character.level < 2) {
                major = 9 + character.level;
                severe = 19 + character.level;
            } else if (character.level < 5) {
                major = 11 + character.level;
                severe = 24 + character.level;
            } else if (character.level < 8) {
                major = 13 + character.level;
                severe = 31 + character.level;
            } else {
                major = 15 + character.level;
                severe = 38 + character.level;
            }
        }
    }

    // --- Feature Bonuses ---
    if (hasFeature(character, "Fortified Armor", plugin)) {
        major += 2;
        severe += 2;
    }
    if (hasFeature(character, "Shell", plugin)) {
        major += character.proficiency;
        severe += character.proficiency;
    }
    if (hasFeature(character, "Unwavering", plugin)) { major += 1; severe += 1; }
    if (hasFeature(character, "Unrelenting", plugin)) { major += 2; severe += 2; }
    if (hasFeature(character, "Undaunted", plugin)) { major += 3; severe += 3; }


    // --- Beastform Bonuses ---
    if (character.activeBeastformName) {
        const activeBeast = plugin.compendium.beastforms.find((b: { name: string; }) => b.name === character.activeBeastformName);
        if (activeBeast) {
            activeBeast.features.forEach((feature: { name: string; }) => {
                const name = feature.name.toLowerCase();
                if (name.includes("thick hide") || name.includes("undaunted")) {
                    major += 2; severe += 2;
                } else if (name.includes("hollow bones")) {
                    major -= 2; severe -= 2;
                } else if (name.includes("physical defense")) {
                    major += 3; severe += 3;
                }
            });
        }
    }

    // --- Custom Modifiers ---
    major += (character.customModifiers?.majorThreshold || 0);
    severe += (character.customModifiers?.severeThreshold || 0);

    return { major, severe };
}


/**
 * Determines the correct damage formula and type for an unarmed attack based on character features.
 * @param character The character object.
 * @param plugin The plugin instance to access the compendium.
 * @returns An object containing the damage formula, damage type label, and roll context.
 */
export function getUnarmedAttack(character: Character, plugin: DaggerheartStatblockPlugin): { formula: string; type: string; context: string } {
    const proficiency = character.proficiency;
    const noWeaponsEquipped = !character.equippedWeaponIds || character.equippedWeaponIds.length === 0;

    // "I am the Weapon" Brawler Feature
    if (hasFeature(character, "I am the Weapon", plugin) && noWeaponsEquipped) {
        return {
            formula: `${proficiency}d10 + ${proficiency}d6`,
            type: 'phy Damage',
            context: 'I am the Weapon Damage',
        };
    }

    // Default unarmed attack
    return {
        formula: `${proficiency}d4`,
        type: 'Damage',
        context: 'Unarmed Damage',
    };
}
