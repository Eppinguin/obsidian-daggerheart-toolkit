import { Notice } from 'obsidian';
import { TokenTrackerState } from '../types';

/**
 * Analyzes a feature description to determine what type of token tracker it should use
 * @param description The feature description text
 * @returns Object containing token type information
 */
export function getTokenType(description: string): {
    type: string;
    source?: string,
    hasMinimumOne: boolean
} {
    const lowerCaseDesc = description.toLowerCase();

    const traitMatch = lowerCaseDesc.match(/place a number of tokens equal to your (strength|agility|finesse|instinct|presence|knowledge)/);
    if (traitMatch && traitMatch[1]) {
        const traitName = traitMatch[1].charAt(0).toUpperCase() + traitMatch[1].slice(1);
        const hasMinimumOne = lowerCaseDesc.includes('(minimum 1)');
        return { type: 'trait', source: traitName, hasMinimumOne: hasMinimumOne };
    }

    if (lowerCaseDesc.includes('place a number of tokens equal to your spellcast trait')) {
        const hasMinimumOne = lowerCaseDesc.includes('(minimum 1)');
        return { type: 'spellcast', hasMinimumOne: hasMinimumOne };
    }

    if (lowerCaseDesc.includes('place tokens equal to the number of hit points you marked')) {
        return { type: 'event', hasMinimumOne: false };
    }

    if (lowerCaseDesc.includes('place a number of tokens equal to the number of sage domain cards')) {
        return { type: 'complex', source: 'sage_cards', hasMinimumOne: false };
    }

    if (lowerCaseDesc.match(/place a token on this card/)) {
        return { type: 'static_increment', hasMinimumOne: false };
    }

    if (lowerCaseDesc.includes('mark a stress to replenish this card with tokens')) {
        return { type: 'replenish_spellcast', hasMinimumOne: false };
    }

    return { type: 'none', hasMinimumOne: false };
}

/**
 * Creates a token tracker UI element
 * @param parent The parent HTML element to attach the tracker to
 * @param trackerState The state of the tracker
 * @param onUpdate Callback function when the tracker is updated
 */
export function createTokenTracker(
    parent: HTMLElement,
    trackerState: TokenTrackerState,
    onUpdate: (newState: TokenTrackerState) => void
) {
    const trackerEl = parent.createDiv({ cls: 'dh-token-tracker' });

    const decrementBtn = trackerEl.createEl('div', { text: '−', cls: 'dh-token-btn dh-token-btn-decrement' });
    decrementBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (trackerState.tokens > 0) {
            trackerState.tokens--;
            onUpdate(trackerState);
        }
    });

    const displayBox = trackerEl.createDiv({ cls: 'dh-token-display' });
    if (trackerState.max !== undefined) {
        displayBox.title = "Click to reset tokens to maximum";
        displayBox.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            if ((e.target as HTMLElement).closest('.dh-token-max-input')) return;
            trackerState.tokens = trackerState.max ?? 0;
            onUpdate(trackerState);
        });
    }

    const valueWrapper = displayBox.createDiv({ cls: 'dh-token-value-wrapper' });
    valueWrapper.createSpan({ text: String(trackerState.tokens), cls: 'dh-token-value-current' });

    if (trackerState.max !== undefined) {
        valueWrapper.createSpan({ text: '/', cls: 'dh-token-value-separator' });
        const maxDisplay = valueWrapper.createSpan({ text: String(trackerState.max), cls: 'dh-token-max-value' });
        maxDisplay.title = "Click to edit maximum";

        maxDisplay.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const input = createEl('input', { cls: 'dh-token-max-input' });
            input.type = 'text';
            input.value = String(trackerState.max ?? '');
            input.addEventListener('click', e => e.stopPropagation());
            maxDisplay.replaceWith(input);
            input.focus();
            input.select();

            const save = () => {
                const newMax = parseInt(input.value.trim(), 10);
                if (!isNaN(newMax) && newMax >= 0) {
                    trackerState.max = newMax;
                } else {
                    new Notice("Invalid number for max tokens.");
                }
                onUpdate(trackerState);
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
        });
    }

    displayBox.createDiv({ text: trackerState.name || 'Tokens', cls: 'dh-token-label' });

    const incrementBtn = trackerEl.createEl('div', { text: '+', cls: 'dh-token-btn dh-token-btn-increment' });
    incrementBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        trackerState.tokens++;
        onUpdate(trackerState);
    });
}