import type { AdversaryInstance, StatblockData } from '../types';

/**
 * Wrap a compendium entry in the throwaway instance shape EditAdversaryModal
 * expects. Editing a compendium entry is not a real encounter instance, so the
 * runtime fields are placeholders that the store strips again on save.
 */
export function toEditableInstance(data: StatblockData): AdversaryInstance {
    return {
        ...data,
        id: `compendium-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        groupId: 'compendium-edit',
        currentHp: data.hp_stress?.hp ?? 0,
        currentStress: 0,
        displayName: data.name,
    };
}

/** A blank entry of the requested category, used by the "create new" flows. */
export function createBlankStatblock(category: 'adversary' | 'environment'): StatblockData {
    const label = category === 'environment' ? 'Environment' : 'Adversary';
    return {
        name: `New ${label}`,
        category,
        hp_stress: { hp: category === 'adversary' ? 10 : 0, stress: 4 },
        isCustom: true,
    };
}

/** Append "(Copy)", or "(Copy 2)" and so on, avoiding names already in use. */
export function uniqueCopyName(baseName: string, taken: Iterable<string>): string {
    const used = new Set(Array.from(taken, (name) => name.toLowerCase()));
    let candidate = `${baseName} (Copy)`;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
        candidate = `${baseName} (Copy ${counter++})`;
    }
    return candidate;
}
