import { AdversaryInstance, StatblockAttack } from '../types';

interface ScalingDeltas {
    difficulty: number;
    major: number | 'none';
    severe: number | 'none';
    hp: number;
    stress: number;
    attack: number;
}

type Role = 'Bruiser' | 'Hordes' | 'Leader' | 'Minions' | 'Ranged' | 'Skulk' | 'Solo' | 'Standard' | 'Support';

const SCALING_TABLES: Record<Role, Record<number, ScalingDeltas>> = {
    Bruiser: {
        2: { difficulty: 2, major: 5, severe: 11, hp: 0, stress: 1, attack: 2 },
        3: { difficulty: 2, major: 7, severe: 13, hp: 1, stress: 0, attack: 1 },
        4: { difficulty: 2, major: 13, severe: 29, hp: 1, stress: 0, attack: 2 },
    },
    Hordes: {
        2: { difficulty: 2, major: 5, severe: 8, hp: 0, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 7, severe: 11, hp: 1, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 5, severe: 11, hp: 1, stress: 1, attack: 1 },
    },
    Leader: {
        2: { difficulty: 2, major: 5, severe: 11, hp: 0, stress: 1, attack: 1 },
        3: { difficulty: 3, major: 7, severe: 13, hp: 1, stress: 1, attack: 2 },
        4: { difficulty: 2, major: 13, severe: 29, hp: 1, stress: 2, attack: 3 },
    },
    Minions: {
        2: { difficulty: 2, major: 'none', severe: 'none', hp: 0, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 'none', severe: 'none', hp: 0, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 'none', severe: 'none', hp: 0, stress: 0, attack: 1 },
    },
    Ranged: {
        2: { difficulty: 3, major: 3, severe: 8, hp: 0, stress: 0, attack: 2 },
        3: { difficulty: 2, major: 7, severe: 12, hp: 1, stress: 1, attack: 0 },
        4: { difficulty: 2, major: 8, severe: 8, hp: 0, stress: 1, attack: 2 },
    },
    Skulk: {
        2: { difficulty: 2, major: 2, severe: 8, hp: 0, stress: 1, attack: 2 },
        3: { difficulty: 2, major: 10, severe: 12, hp: 1, stress: 1, attack: 2 },
        4: { difficulty: 2, major: 7, severe: 10, hp: 0, stress: 0, attack: 1 },
    },
    Solo: {
        2: { difficulty: 2, major: 5, severe: 11, hp: 0, stress: 1, attack: 1 },
        3: { difficulty: 3, major: 7, severe: 13, hp: 2, stress: 1, attack: 2 },
        4: { difficulty: 2, major: 13, severe: 29, hp: 0, stress: 2, attack: 3 },
    },
    Standard: {
        2: { difficulty: 2, major: 4, severe: 8, hp: 1, stress: 0, attack: 1 },
        3: { difficulty: 2, major: 8, severe: 12, hp: 0, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 12, severe: 15, hp: 0, stress: 0, attack: 1 },
    },
    Support: {
        2: { difficulty: 1, major: 4, severe: 8, hp: 0, stress: 1, attack: 1 },
        3: { difficulty: 2, major: 8, severe: 14, hp: 1, stress: 1, attack: 1 },
        4: { difficulty: 2, major: 7, severe: 9, hp: 0, stress: 0, attack: 1 },
    },
};

export class AdversaryScaler {
    public static scale(adversary: AdversaryInstance, targetTier: number): AdversaryInstance {
        if (!adversary.tier && adversary.tier !== 0) return adversary; // Cannot scale if no tier

        // Clamp target tier to 1-4
        if (targetTier < 1) targetTier = 1;
        if (targetTier > 4) targetTier = 4;

        // --- Reversibility Logic ---
        // If this is the first time we scale, save the current stats as "Original".
        if (!adversary._originalStats) {
            adversary._originalStats = JSON.parse(JSON.stringify(adversary));
            // Ensure original stats don't contain themselves (circular safety, though JSON.stringify handles basic objects)
            delete adversary._originalStats?._originalStats;
        }

        // Always scale FROM the original stats
        const original = adversary._originalStats as AdversaryInstance;
        const originalTier = Number(original.tier);
        if (isNaN(originalTier)) return adversary;

        // If target is same as original, just restore original values (but keep currentHP/Stress etc if we want? No, usually scale resets stats)
        // Actually, for "revert", we want to restore base stats.
        // We create a FRESH copy from original to apply changes to.
        const newAdversary = JSON.parse(JSON.stringify(original)) as AdversaryInstance;
        // Restore reference to original stats so future scalings work
        newAdversary._originalStats = adversary._originalStats;

        const role = this.detectRole(newAdversary.type || 'Standard');

        // Calculate steps from Original Tier to Target Tier
        const tierDiff = targetTier - originalTier;

        if (tierDiff > 0) {
            for (let t = originalTier + 1; t <= targetTier; t++) {
                this.applyDelta(newAdversary, role, t, 1);
            }
        } else if (tierDiff < 0) {
            for (let t = originalTier; t > targetTier; t--) {
                this.applyDelta(newAdversary, role, t, -1);
            }
        }

        newAdversary.tier = targetTier;
        newAdversary.attack = this.scaleDamageDice(newAdversary.attack, originalTier, targetTier);
        newAdversary.features = this.scaleFeatures(original.features, originalTier, targetTier);

        // Scaling changes the template stats, not the live encounter identity or marked resources.
        newAdversary.id = adversary.id;
        newAdversary.groupId = adversary.groupId;
        newAdversary.displayName = adversary.displayName;
        // Without this the rename flag is lost and the automatic "Name #N"
        // numbering reclaims the name the next time the group changes.
        newAdversary.hasCustomName = adversary.hasCustomName;
        newAdversary.currentHp = Math.min(adversary.currentHp, newAdversary.hp_stress.hp);
        newAdversary.currentStress = Math.min(adversary.currentStress, newAdversary.hp_stress.stress);
        newAdversary.conditions = adversary.conditions ? JSON.parse(JSON.stringify(adversary.conditions)) : undefined;

        return newAdversary;
    }

    private static scaleFeatures(features: any[] | undefined, oldTier: number, newTier: number): any[] | undefined {
        if (!features || !Array.isArray(features)) return features;

        const tierDiff = newTier - oldTier;
        if (tierDiff === 0) return features;

        return features.map((feature) => {
            const newFeature = { ...feature };
            if (newFeature.description) {
                // Regex to find dice notations like "2d6", "1d8", etc.
                // We use a replacer function to adjust the dice count.
                // Avoid matching things that aren't dice (safeguard).
                // Pattern: Digit+ 'd' Digit+
                newFeature.description = newFeature.description.replace(
                    /(\d+)d(\d+)/g,
                    (match: string, countStr: string, dieStr: string) => {
                        let count = parseInt(countStr);
                        // Logic: Increase dice count by difference in Tier.
                        // Guide: "In general you can increase damage by a die"
                        // Assumption: Dice in features usually represent damage or effect magnitude that scales.

                        if (!isNaN(count)) {
                            count += tierDiff;
                            if (count < 1) count = 1; // Minimum 1 die
                            return `${count}d${dieStr}`;
                        }
                        return match;
                    },
                );
            }
            return newFeature;
        });
    }

    private static detectRole(type: string): Role {
        // Simple fuzzy matching or direct mapping
        const t = type.toLowerCase();
        if (t.includes('bruiser')) return 'Bruiser';
        if (t.includes('horde')) return 'Hordes';
        if (t.includes('leader')) return 'Leader';
        if (t.includes('minion')) return 'Minions';
        if (t.includes('ranged')) return 'Ranged';
        if (t.includes('skulk')) return 'Skulk';
        if (t.includes('solo')) return 'Solo';
        if (t.includes('support')) return 'Support';
        return 'Standard';
    }

    private static applyDelta(adv: AdversaryInstance, role: Role, tierIndex: number, direction: 1 | -1) {
        const table = SCALING_TABLES[role];
        if (!table || !table[tierIndex]) return; // No scaling data for this tier/role

        const delta = table[tierIndex];

        // Difficulty
        if (adv.difficulty) {
            const diff = parseInt(String(adv.difficulty));
            if (!isNaN(diff)) {
                adv.difficulty = diff + delta.difficulty * direction;
            }
        }

        // Stats
        if (adv.hp_stress) {
            // HP
            // Handle HP like "2 (4)"? Guide says "HP: 5", "HP: +1". Assuming number.
            if (typeof adv.hp_stress.hp === 'number') {
                adv.hp_stress.hp += delta.hp * direction;
            }
            // Stress
            if (typeof adv.hp_stress.stress === 'number') {
                adv.hp_stress.stress += delta.stress * direction;
            }

            // Major Threshold
            if (delta.major !== 'none') {
                // Initialize if missing (e.g. tier 0 might not have it?)
                // Actually thresholds usually exist.
                const current = adv.hp_stress.major_hp ?? 0;
                adv.hp_stress.major_hp = current + delta.major * direction;
            }
            // Severe Threshold
            if (delta.severe !== 'none') {
                const current = adv.hp_stress.severe_hp ?? 0;
                adv.hp_stress.severe_hp = current + delta.severe * direction;
            }
        }

        // Attack Modifier
        if (adv.attack) {
            const mod = parseInt(String(adv.attack.modifier));
            if (!isNaN(mod)) {
                adv.attack.modifier = mod + delta.attack * direction;
            }
        }
    }

    private static scaleDamageDice(
        attack: StatblockAttack | undefined,
        oldTier: number,
        newTier: number,
    ): StatblockAttack | undefined {
        if (!attack) return undefined;

        // Create a copy to avoid mutating the original stats!
        const newAttack = { ...attack };

        // "Increase damage by a die" per tier.
        // "Increase die type by a step" per tier.

        let damage = newAttack.damage;
        // Basic parser for "XdY+Z" or just "XdY"
        const diceRegex = /(\d+)d(\d+)(.*)/;
        const match = damage.match(diceRegex);

        if (match) {
            let count = parseInt(match[1]);
            let die = parseInt(match[2]);
            const rest = match[3]; // suffix like "+2"

            const tierDiff = newTier - oldTier;

            // Scale Count
            count += tierDiff;
            if (count < 1) count = 1; // Min 1 die

            // Scale Die Type
            die = this.scaleDieType(die, tierDiff);

            // Modifier scaling: "use tier*2 for the damage modifier".
            const bonusRegex = /([+-]\s*)?(\d+)/;
            const suffixWithoutBonus = rest.replace(bonusRegex, '').trim();

            let newBonus = 0;
            if (newTier <= 1)
                newBonus = 1; // Default fallback for T1/T0
            else newBonus = newTier * 2;

            if (newTier === 2) newBonus = 2; // Match example

            const sign = newBonus >= 0 ? '+' : '';
            newAttack.damage = `${count}d${die}${sign}${newBonus} ${suffixWithoutBonus}`.trim();
        }

        return newAttack;
    }

    private static scaleDieType(currentDie: number, steps: number): number {
        // Progression: 4 -> 6 -> 8 -> 10 -> 12. Caps at 12. d20 stays d20 (or maybe handling d20 specifically if needed, but guide implies d12 max usually).
        // If it's d20, let's leave it as d20 for now unless requested otherwise, as it's often a special case.
        if (currentDie === 20) return 20;

        const progression = [4, 6, 8, 10, 12];
        let index = progression.indexOf(currentDie);

        if (index === -1) {
            // If current die isn't standard (e.g. d3, d5), just return it as is or try to map to nearest?
            // Safer to return or map to nearest? Let's return for safety.
            return currentDie;
        }

        let newIndex = index + steps;
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= progression.length) newIndex = progression.length - 1;

        return progression[newIndex];
    }
}
