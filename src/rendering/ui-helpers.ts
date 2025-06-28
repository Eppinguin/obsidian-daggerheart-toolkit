import DaggerheartStatblockPlugin from '../../main';
import { Notice } from 'obsidian';

/**
 * Renders basic markdown formatting for descriptions.
 * Handles bold, italic, and lists.
 * @param plugin The main plugin instance.
 * @param text The text to render.
 * @param containerEl The HTML element to render the markdown into.
 */
export function renderMarkdown(plugin: DaggerheartStatblockPlugin, text: string, containerEl: HTMLElement) {
    try {
        // First, handle basic inline formatting (bold, italic)
        let processedText = text
            // Handle bold italic (***text***) - must come before bold and italic
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            // Handle bold (**text**)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Special handling for lists
        const lines = processedText.split('\n');
        let inList = false;
        let listType = '';
        let listHtml = '';
        let finalHtml = '';

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            const unorderedMatch = line.match(/^\s*([\*\-\+])\s+(.*)$/);
            if (unorderedMatch) {
                const content = unorderedMatch[2].replace(/\*(.*?)\*/g, '<em>$1</em>');
                if (!inList || listType !== 'ul') {
                    if (inList) listHtml += `</${listType}>`;
                    listHtml += '<ul style="margin: 0; padding-left: 1.5em; margin-top: 0.2em; margin-bottom: 0.2em;">';
                    listType = 'ul';
                    inList = true;
                }
                listHtml += `<li style="margin: 0; padding: 0;">${content}</li>`;
                continue;
            }

            const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
                const content = orderedMatch[2].replace(/\*(.*?)\*/g, '<em>$1</em>');
                if (!inList || listType !== 'ol') {
                    if (inList) listHtml += `</${listType}>`;
                    listHtml += '<ol style="margin: 0; padding-left: 1.5em; margin-top: 0.2em; margin-bottom: 0.2em;">';
                    listType = 'ol';
                    inList = true;
                }
                listHtml += `<li style="margin: 0; padding: 0;">${content}</li>`;
                continue;
            }

            if (inList) {
                listHtml += `</${listType}>`;
                finalHtml += listHtml;
                listHtml = '';
                inList = false;
                listType = '';
            }

            line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');
            finalHtml += line + (i < lines.length - 1 ? '<br>' : '');
        }

        if (inList) {
            listHtml += `</${listType}>`;
            finalHtml += listHtml;
        }

        containerEl.innerHTML = finalHtml;
    } catch (error) {
        console.error("Error formatting markdown:", error);
        containerEl.appendText(text);
    }
}

/**
 * Renders content with rollable dice strings and feature costs.
 * @param plugin The main plugin instance.
 * @param text The text to process.
 * @param containerEl The parent element for the rendered content.
 * @param context A string describing what the roll is for (e.g., an attack or feature name).
 */
export function renderRollableContent(plugin: DaggerheartStatblockPlugin, text: string, containerEl: HTMLElement, context: string) {
    const pattern = /(\b\d+d\d+(?:\s*[+-]\s*\d+)*\b)|(Mark\s+(?:a|\d+)\s+stress|Spend\s+(?:a|\d+)\s+fear)/gi;
    let lastIndex = 0;
    let match;

    const isDiceRollerConfigured = plugin.settings.diceProvider === 'dice-roller' && plugin.settings.enableDiceRoller && plugin.isDiceRollerEnabled;
    const isDddiceConfigured = plugin.settings.diceProvider === 'dddice' && !!plugin.settings.dddice.apiKey;
    const isRollable = isDiceRollerConfigured || isDddiceConfigured;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const textFragment = text.substring(lastIndex, match.index);
            const fragmentEl = containerEl.createSpan();
            renderMarkdown(plugin, textFragment, fragmentEl);
        }

        const dicePart = match[1];
        const costPart = match[2];

        if (dicePart && isRollable) {
            const diceString = dicePart.replace(/\s/g, '');
            containerEl.createSpan({
                text: dicePart,
                cls: 'dh-rollable-dice',
                title: `Click to roll ${diceString} for ${context}`
            }).addEventListener('click', (e) => {
                e.stopPropagation();
                // Pass the context of the roll to the main dice rolling function
                // Extract trait name from context if possible (e.g., "Weapon Attack with Strength")
                const traitMatch = context.match(/with\s+(\w+)(?:\s|$)/i);
                const traitName = traitMatch ? traitMatch[1] : undefined;
                plugin.rollDice(diceString, context, traitName);
            });
        } else if (costPart) {
            containerEl.createEl('strong', { text: costPart, cls: 'dh-feature-cost-text' });
        } else {
            containerEl.appendText(match[0]);
        }

        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        const remainingEl = containerEl.createSpan();
        renderMarkdown(plugin, remainingText, remainingEl);
    }
}

/**
 * Creates an interactive track with pips for things like HP and Stress.
 * @param parentEl The parent element to attach the track to.
 * @param label The label for the track (e.g., "HP").
 * @param maxValue The maximum value for the track.
 * @param trackIdPrefix A prefix for generating unique IDs.
 * @param currentValue The initial value of the track.
 * @param updateCallback A function to call when the value is updated.
 */
export function createInteractiveTrack(
    parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string,
    currentValue: number, updateCallback: (newValue: number) => void
) {
    const trackDiv = parentEl.createDiv({ cls: `dh-interactive-track dh-${label.toLowerCase()}-track` });
    trackDiv.createSpan({ text: label.toUpperCase(), cls: 'dh-track-label' });
    const controlsDiv = trackDiv.createDiv({ cls: 'dh-track-controls' });
    const decrementButton = controlsDiv.createEl('button', { text: '−', cls: 'dh-track-btn dh-track-btn-decrement' });
    const pipsContainer = controlsDiv.createDiv({ cls: 'dh-pips-container' });
    const pips: HTMLDivElement[] = [];

    const updatePipsAndState = (newVal: number) => {
        let actualNewValue = Math.max(0, Math.min(newVal, maxValue));
        pips.forEach((p, idx) => p.classList.toggle('dh-pip-marked', idx < actualNewValue));
        updateCallback(actualNewValue);
    };

    for (let i = 0; i < maxValue; i++) {
        const pip = pipsContainer.createDiv({ cls: 'dh-pip' });
        pip.dataset.index = i.toString();
        if (i < currentValue) pip.classList.add('dh-pip-marked');
        pip.addEventListener('click', () => {
            const clickedIndex = parseInt(pip.dataset.index!);
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            const isLastPip = clickedIndex === currentMarkedCount - 1;
            updatePipsAndState(pip.classList.contains('dh-pip-marked') && isLastPip ? clickedIndex : clickedIndex + 1);
        });
        pips.push(pip);
    }

    const incButton = controlsDiv.createEl('button', { text: '+', cls: 'dh-track-btn dh-track-btn-increment' });
    decrementButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount > 0) updatePipsAndState(currentMarkedCount - 1);
    });
    incButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount < maxValue) updatePipsAndState(currentMarkedCount + 1);
    });
}
