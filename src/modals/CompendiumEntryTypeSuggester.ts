import { App, Notice, SuggestModal } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { CompendiumCreatorModal } from './CompendiumCreatorModal';
import { CreateCardModal } from './CreateCardModal';
import { EditAdversaryModal } from './EditAdversaryModal';
import { ItemEditModal } from './ItemEditModal';
import {
    AllCompendiumData,
    CompendiumType,
    JsonAbility,
    StatblockData,
    AdversaryInstance,
    CompendiumItem,
    InventoryItem,
    Character,
    JsonWeapon,
    JsonArmor,
    JsonConsumable,
} from '../../types';

enum SuggesterState {
    MAIN,
    SELECT_NEW_TYPE,
    SELECT_EDIT_ITEM,
}

type Suggestion = {
    id: string;
    label: string;
    sublabel?: string;
    action?: 'show-new' | 'show-edit' | 'go-back';
    entryType?: CompendiumType;
    data?: AllCompendiumData;
};

/**
 * Helper function to convert a compendium item to a temporary inventory item
 * suitable for the ItemEditModal. This is an adapter to reuse the existing
 * modal, which is designed to work with items in a character's inventory.
 */
function compendiumToInventoryItem(compendiumItem: CompendiumItem): InventoryItem {
    const base: Partial<InventoryItem> = {
        instanceId: `compendium-edit-${Math.random()}`,
        quantity: 1,
        name: compendiumItem.name,
        isCustom: compendiumItem.isCustom,
    };

    const type = (compendiumItem as any)._type || 'item';

    switch (type) {
        case 'weapon': {
            const weaponData = compendiumItem as JsonWeapon;
            const [damageDice, damageType] = (weaponData.damage || 'd6').split(' ');
            return {
                ...base,
                _type: 'weapon',
                tier: parseInt(weaponData.tier || '1'),
                trait: weaponData.trait || 'Strength',
                range: weaponData.range || 'Melee',
                damage: weaponData.damage || 'd6',
                burden: weaponData.burden || 'One-Handed',
                primaryOrSecondary: weaponData.primary_or_secondary || 'Primary',
                damageDice,
                damageType: damageType || 'phy',
                features: weaponData.feat_name ? [{ name: weaponData.feat_name, description: weaponData.feat_text || '' }] : [],
            } as InventoryItem;
        }
        case 'armor': {
            const armorData = compendiumItem as JsonArmor;
            const [major, severe] = (armorData.base_thresholds || '1 / 2').split('/').map(s => parseInt(s.trim()));
            return {
                ...base,
                _type: 'armor',
                tier: parseInt(armorData.tier || '1'),
                baseScore: parseInt(armorData.base_score || '1'),
                baseThresholds: { major, severe },
                features: armorData.feat_name ? [{ name: armorData.feat_name, description: armorData.feat_text || '' }] : [],
            } as InventoryItem;
        }
        case 'consumable': {
            const consumableData = compendiumItem as JsonConsumable;
            return {
                ...base,
                _type: 'consumable',
                roll: consumableData.roll || '',
            } as InventoryItem;
        }
        case 'item':
        default:
            return { ...base, _type: 'item' } as InventoryItem;
    }
}


export class CompendiumEntryTypeSuggester extends SuggestModal<Suggestion> {
    private state: SuggesterState = SuggesterState.MAIN;

    constructor(app: App, private plugin: DaggerheartStatblockPlugin) {
        super(app);
        this.setPlaceholder("Choose an action...");
    }

    getSuggestions(query: string): Suggestion[] {
        switch (this.state) {
            case SuggesterState.MAIN:
                return this.getMainMenuSuggestions(query);
            case SuggesterState.SELECT_NEW_TYPE:
                return this.getNewTypeSuggestions(query);
            case SuggesterState.SELECT_EDIT_ITEM:
                return this.getEditItemSuggestions(query);
            default:
                return [];
        }
    }

    onChooseSuggestion(suggestion: Suggestion, evt: MouseEvent | KeyboardEvent) {
        if (suggestion.action) {
            switch (suggestion.action) {
                case 'show-new':
                    this.state = SuggesterState.SELECT_NEW_TYPE;
                    this.setPlaceholder("Select type to create...");
                    this.inputEl.value = ''; // Clear search
                    this.open(); // Re-opens the modal to refresh suggestions
                    return;
                case 'show-edit':
                    this.state = SuggesterState.SELECT_EDIT_ITEM;
                    this.setPlaceholder("Select custom entry to edit...");
                    this.inputEl.value = '';
                    this.open();
                    return;
                case 'go-back':
                    this.state = SuggesterState.MAIN;
                    this.setPlaceholder("Choose an action...");
                    this.inputEl.value = '';
                    this.open();
                    return;
            }
        }

        // If no action, it's a final selection, so open the relevant editor modal.
        this.openEditorModal(suggestion);
    }

    renderSuggestion(suggestion: Suggestion, el: HTMLElement) {
        el.createEl('div', { text: suggestion.label });
        if (suggestion.sublabel) {
            el.createEl('small', { text: suggestion.sublabel, cls: `dh-suggestion-subtext dh-suggestion-subtext-edit` });
        }
    }

    private getMainMenuSuggestions(query: string): Suggestion[] {
        const items: Suggestion[] = [
            { id: 'new', label: 'Create New Compendium Entry...', action: 'show-new' },
            { id: 'edit', label: 'Edit Custom Entry...', action: 'show-edit' },
        ];
        return items.filter(i => i.label.toLowerCase().includes(query.toLowerCase()));
    }

    private getNewTypeSuggestions(query: string): Suggestion[] {
        const lowerQuery = query.toLowerCase();
        const suggestions: Suggestion[] = [];

        const allEntryTypes: CompendiumType[] = [
            'Class', 'Subclass', 'Ancestry', 'Community', 'Ability', 'Weapon', 'Armor', 'Item', 'Consumable', 'Adversary', 'Environment'
        ];

        allEntryTypes.forEach(type => {
            suggestions.push({
                id: `new-${type.toLowerCase()}`,
                label: `New ${type}`,
                entryType: type,
            });
        });

        // Add a "Go Back" option
        suggestions.unshift({ id: 'back', label: '‹ Go Back', action: 'go-back' });

        return suggestions.filter(s => s.label.toLowerCase().includes(lowerQuery));
    }

    private getEditItemSuggestions(query: string): Suggestion[] {
        const lowerQuery = query.toLowerCase();
        const suggestions: Suggestion[] = [];

        const addCustomItems = (items: any[] | undefined, type: CompendiumType) => {
            if (!items) return;
            items.filter(item => item.isCustom).forEach(item => {
                suggestions.push({
                    id: `edit-${type.toLowerCase()}-${item.name.toLowerCase()}`,
                    label: item.name,
                    sublabel: `Edit ${type}`,
                    entryType: type,
                    data: item,
                });
            });
        };

        addCustomItems(this.plugin.compendium.classes, 'Class');
        addCustomItems(this.plugin.compendium.subclasses, 'Subclass');
        addCustomItems(this.plugin.compendium.ancestries, 'Ancestry');
        addCustomItems(this.plugin.compendium.communities, 'Community');
        addCustomItems(this.plugin.compendium.abilities, 'Ability');
        addCustomItems(this.plugin.compendium.weapons, 'Weapon');
        addCustomItems(this.plugin.compendium.armors, 'Armor');
        addCustomItems(this.plugin.compendium.items.filter(i => (i as JsonConsumable).roll), 'Consumable');
        addCustomItems(this.plugin.compendium.items.filter(i => !(i as JsonConsumable).roll), 'Item');
        addCustomItems(this.plugin.compendium.statblocks.filter(s => s.category === 'adversary'), 'Adversary');
        addCustomItems(this.plugin.compendium.statblocks.filter(s => s.category === 'environment'), 'Environment');

        // Add a "Go Back" option
        suggestions.unshift({ id: 'back', label: '‹ Go Back', action: 'go-back' });

        return suggestions.filter(s =>
            s.label.toLowerCase().includes(lowerQuery) ||
            s.sublabel?.toLowerCase().includes(lowerQuery)
        );
    }

    private openEditorModal(suggestion: Suggestion) {
        const isNew = !suggestion.data;

        switch (suggestion.entryType) {
            case 'Class':
            case 'Subclass':
            case 'Ancestry':
            case 'Community':
                new CompendiumCreatorModal(this.app, this.plugin, suggestion.entryType, suggestion.data).open();
                break;

            case 'Ability':
                new CreateCardModal(
                    this.app,
                    this.plugin,
                    () => { this.plugin.triggerCompendiumUpdate(); },
                    suggestion.data as JsonAbility
                ).open();
                break;

            case 'Adversary':
            case 'Environment': {
                let data: StatblockData;
                if (isNew) {
                    data = {
                        name: 'New ' + suggestion.entryType,
                        category: suggestion.entryType.toLowerCase() as 'adversary' | 'environment',
                        hp_stress: { hp: 10, stress: 4 },
                        isCustom: true,
                    };
                } else {
                    data = suggestion.data as StatblockData;
                }

                const instance: AdversaryInstance = {
                    ...data,
                    id: `compendium-edit-${Math.random()}`,
                    groupId: 'compendium-edit',
                    currentHp: data.hp_stress?.hp || 10,
                    currentStress: 0,
                    displayName: data.name,
                };

                new EditAdversaryModal(
                    this.app,
                    this.plugin,
                    instance,
                    () => { this.plugin.triggerCompendiumUpdate(); }
                ).open();
                break;
            }

            case 'Item':
            case 'Weapon':
            case 'Armor':
            case 'Consumable': {
                let itemForModal: InventoryItem | null = null;
                if (!isNew) {
                    itemForModal = compendiumToInventoryItem(suggestion.data as CompendiumItem);
                }

                new ItemEditModal(
                    this.app,
                    this.plugin,
                    {} as Character, // The modal doesn't use the character object when saving to compendium.
                    itemForModal,
                    () => { this.plugin.triggerCompendiumUpdate(); },
                    isNew ? undefined : () => {
                        new Notice('Deletion from this modal is not yet implemented.');
                    }
                ).open();
                break;
            }

            default:
                if (suggestion.entryType) {
                    new Notice(`Editing for "${suggestion.entryType}" is not yet implemented.`);
                }
        }
    }
}
