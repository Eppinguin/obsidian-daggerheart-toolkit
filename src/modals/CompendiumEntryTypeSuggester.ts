import { App, SuggestModal } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { AdversaryInstance, StatblockData } from '../types';
import { EditAdversaryModal } from './EditAdversaryModal';

type GmCompendiumType = 'Adversary' | 'Environment';

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
    entryType?: GmCompendiumType;
    data?: StatblockData;
};

export class CompendiumEntryTypeSuggester extends SuggestModal<Suggestion> {
    private state = SuggesterState.MAIN;

    constructor(app: App, private plugin: DaggerheartStatblockPlugin) {
        super(app);
        this.setPlaceholder('Choose an action...');
    }

    getSuggestions(query: string): Suggestion[] {
        const lowerQuery = query.toLowerCase();
        let suggestions: Suggestion[];

        if (this.state === SuggesterState.MAIN) {
            suggestions = [
                { id: 'new', label: 'Create New GM Compendium Entry...', action: 'show-new' },
                { id: 'edit', label: 'Edit Custom GM Entry...', action: 'show-edit' },
            ];
        } else if (this.state === SuggesterState.SELECT_NEW_TYPE) {
            suggestions = [
                { id: 'back', label: '‹ Go Back', action: 'go-back' },
                { id: 'new-adversary', label: 'New Adversary', entryType: 'Adversary' },
                { id: 'new-environment', label: 'New Environment', entryType: 'Environment' },
            ];
        } else {
            suggestions = [{ id: 'back', label: '‹ Go Back', action: 'go-back' }];
            for (const data of this.plugin.compendium.statblocks.filter(item => item.isCustom)) {
                const entryType: GmCompendiumType = data.category === 'environment' ? 'Environment' : 'Adversary';
                suggestions.push({
                    id: `edit-${data.category}-${data.name.toLowerCase()}`,
                    label: data.name,
                    sublabel: `Edit ${entryType}`,
                    entryType,
                    data,
                });
            }
        }

        return suggestions.filter(suggestion =>
            suggestion.label.toLowerCase().includes(lowerQuery) ||
            suggestion.sublabel?.toLowerCase().includes(lowerQuery)
        );
    }

    renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
        el.createEl('div', { text: suggestion.label });
        if (suggestion.sublabel) {
            el.createEl('small', { text: suggestion.sublabel, cls: 'dh-suggestion-subtext dh-suggestion-subtext-edit' });
        }
    }

    onChooseSuggestion(suggestion: Suggestion): void {
        if (suggestion.action) {
            this.state = suggestion.action === 'show-new'
                ? SuggesterState.SELECT_NEW_TYPE
                : suggestion.action === 'show-edit'
                    ? SuggesterState.SELECT_EDIT_ITEM
                    : SuggesterState.MAIN;
            this.setPlaceholder(this.state === SuggesterState.MAIN
                ? 'Choose an action...'
                : this.state === SuggesterState.SELECT_NEW_TYPE
                    ? 'Select GM entry type to create...'
                    : 'Select custom GM entry to edit...');
            this.inputEl.value = '';
            this.open();
            return;
        }

        if (!suggestion.entryType) return;
        const category = suggestion.entryType.toLowerCase() as 'adversary' | 'environment';
        const data: StatblockData = suggestion.data || {
            name: `New ${suggestion.entryType}`,
            category,
            hp_stress: { hp: category === 'adversary' ? 10 : 0, stress: 4 },
            isCustom: true,
        };
        const instance: AdversaryInstance = {
            ...data,
            id: `compendium-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            groupId: 'compendium-edit',
            currentHp: data.hp_stress.hp,
            currentStress: 0,
            displayName: data.name,
        };

        new EditAdversaryModal(
            this.app,
            this.plugin,
            instance,
            () => this.plugin.triggerCompendiumUpdate()
        ).open();
    }
}
