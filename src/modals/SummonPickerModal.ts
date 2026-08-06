import { App, SuggestModal } from 'obsidian';
import type { StatblockData } from '../types';

/**
 * Choose which adversary a summon brings in.
 *
 * Opened when a feature names a kind rather than a creature ("summon 1d4 Tier 1
 * adversaries", "summon Tier X Minions"), which the rules leave to the GM. The
 * phrase from the feature seeds the search, so the common case is one keystroke
 * away from the right entry.
 */
export class SummonPickerModal extends SuggestModal<StatblockData> {
    constructor(
        app: App,
        private adversaries: StatblockData[],
        private initialQuery: string,
        private onChoose: (chosen: StatblockData) => void,
    ) {
        super(app);
        this.setPlaceholder(`Summon which adversary?`);
    }

    onOpen(): void {
        super.onOpen();
        // Seeding the input rather than filtering the list keeps every entry
        // reachable: the GM can clear it and pick something else entirely.
        if (this.initialQuery) {
            this.inputEl.value = this.initialQuery;
            this.inputEl.select();
            this.inputEl.dispatchEvent(new Event('input'));
        }
    }

    getSuggestions(query: string): StatblockData[] {
        const term = query.toLowerCase().trim();
        const pool = this.adversaries.filter((entry) => entry.category !== 'environment');
        if (!term) return pool;

        // Word-prefix matches first, so typing "gua" puts "Bladed Guard" above
        // an entry that merely contains those letters mid-word.
        const scored = pool
            .map((entry) => ({ entry, score: scoreMatch(entry, term) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

        return scored.map((item) => item.entry);
    }

    renderSuggestion(entry: StatblockData, el: HTMLElement): void {
        el.createDiv({ text: entry.name });
        const meta = [entry.tier ? `Tier ${entry.tier}` : '', entry.type || ''].filter(Boolean).join(' · ');
        if (meta) el.createEl('small', { text: meta, cls: 'dh-summon-suggestion-meta' });
    }

    onChooseSuggestion(entry: StatblockData): void {
        this.onChoose(entry);
    }
}

function scoreMatch(entry: StatblockData, term: string): number {
    const name = entry.name.toLowerCase();
    if (name === term) return 100;
    if (name.startsWith(term)) return 50;
    if (name.split(/\s+/).some((word) => word.startsWith(term))) return 25;
    if (name.includes(term)) return 10;
    // Fall back to the type, so "minion" still surfaces something usable when
    // the feature text names a role the compendium does not use as a name.
    if ((entry.type || '').toLowerCase().includes(term)) return 5;
    return 0;
}
