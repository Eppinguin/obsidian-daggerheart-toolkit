import { App, SuggestModal } from 'obsidian';
import type { ContentSource } from '../services/content-source';

/**
 * Pick a destination content source. Only writable sources are offered, so a
 * move or import can never target the SRD or a Markdown folder.
 */
export class SourcePickerModal extends SuggestModal<ContentSource> {
    constructor(
        app: App,
        private sources: ContentSource[],
        private onChoose: (source: ContentSource) => void,
        placeholder = 'Select a destination source...',
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    getSuggestions(query: string): ContentSource[] {
        const lowerQuery = query.toLowerCase();
        return this.sources.filter((source) => source.label.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(source: ContentSource, el: HTMLElement): void {
        el.createEl('div', { text: source.label });
        const details: string[] = [source.path];
        if (source.doNotDistribute) details.push('personal content');
        if (!source.enabled) details.push('currently disabled');
        el.createEl('small', { text: details.join(' · '), cls: 'dh-suggestion-subtext' });
    }

    onChooseSuggestion(source: ContentSource): void {
        this.onChoose(source);
    }
}
