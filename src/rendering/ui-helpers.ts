import DaggerheartStatblockPlugin from '../../main';
import { Notice } from 'obsidian';

async function rollDice(plugin: DaggerheartStatblockPlugin, diceString: string) {
    const diceRollerPlugin = (plugin.app as any).plugins.getPlugin("obsidian-dice-roller");
    if (!diceRollerPlugin) {
        new Notice("Dice Roller plugin is not enabled. Please install or enable it to roll dice.");
        return;
    }

    const DiceRollerAPI = diceRollerPlugin.api;
    if (!DiceRollerAPI || typeof DiceRollerAPI.getRoller !== 'function') {
        new Notice("Dice Roller plugin API not available. Please ensure Dice Roller is up to date.");
        console.error("Daggerheart: Dice Roller plugin is active, but its API is not available or is missing getRoller.");
        return;
    }

    try {
        const roller = await DiceRollerAPI.getRoller(diceString);
        if (plugin.settings.useGraphicalDice) {
            await roller.roll({ showDice: true, throw: true });
        } else {
            await roller.roll();
            new Notice(`Rolled ${diceString}: ${roller.result}`, 5000);
        }
    } catch (e) {
        console.error("Daggerheart: Error rolling dice:", e);
        new Notice(`Error rolling dice for "${diceString}". See console for details.`);
    }
}

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

            // Handle unordered lists (*, -, +)
            const unorderedMatch = line.match(/^\s*([\*\-\+])\s+(.*)$/);
            if (unorderedMatch) {
                const content = unorderedMatch[2].replace(/\*(.*?)\*/g, '<em>$1</em>'); // Process italic in list items
                if (!inList || listType !== 'ul') {
                    // Start a new list or close previous list
                    if (inList) {
                        listHtml += `</${listType}>`;
                    }
                    listHtml += '<ul style="margin: 0; padding-left: 1.5em; margin-top: 0.2em; margin-bottom: 0.2em;">';
                    listType = 'ul';
                    inList = true;
                }

                listHtml += `<li style="margin: 0; padding: 0;">${content}</li>`;
                continue;
            }

            // Handle ordered lists (1., 2., etc.)
            const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
                const content = orderedMatch[2].replace(/\*(.*?)\*/g, '<em>$1</em>'); // Process italic in list items

                if (!inList || listType !== 'ol') {
                    // Start a new list or close previous list
                    if (inList) {
                        listHtml += `</${listType}>`;
                    }
                    listHtml += '<ol style="margin: 0; padding-left: 1.5em; margin-top: 0.2em; margin-bottom: 0.2em;">';
                    listType = 'ol';
                    inList = true;
                }

                listHtml += `<li style="margin: 0; padding: 0;">${content}</li>`;
                continue;
            }

            // Not a list item
            if (inList) {
                // End the current list
                listHtml += `</${listType}>`;
                finalHtml += listHtml;
                listHtml = '';
                inList = false;
                listType = '';
            }

            // Process normal line with italic formatting
            line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');

            // Add the line to the final HTML
            finalHtml += line + (i < lines.length - 1 ? '<br>' : '');
        }

        // Close any open list
        if (inList) {
            listHtml += `</${listType}>`;
            finalHtml += listHtml;
        }

        // Set the HTML content
        containerEl.innerHTML = finalHtml;
    } catch (error) {
        console.error("Error formatting markdown:", error);
        // Fallback to plain text if formatting fails
        containerEl.appendText(text);
    }
}

export function renderRollableContent(plugin: DaggerheartStatblockPlugin, text: string, containerEl: HTMLElement) {
    const pattern = /(\b\d+d\d+(?:\s*[+-]\s*\d+)*\b)|(Mark\s+(?:a|\d+)\s+stress|Spend\s+(?:a|\d+)\s+fear)/gi;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            // Render the text between matches as markdown
            const textFragment = text.substring(lastIndex, match.index);
            const fragmentEl = containerEl.createSpan();
            renderMarkdown(plugin, textFragment, fragmentEl);
        }

        const dicePart = match[1];
        const costPart = match[2];

        if (dicePart && plugin.isDiceRollerEnabled) {
            const diceString = dicePart.replace(/\s/g, '');
            containerEl.createSpan({
                text: dicePart,
                cls: 'dh-rollable-dice',
                title: `Click to roll ${diceString}`
            }).addEventListener('click', (e) => {
                e.stopPropagation();
                rollDice(plugin, diceString);
            });
        } else if (costPart) {
            containerEl.createEl('strong', { text: costPart, cls: 'dh-feature-cost-text' });
        } else {
            containerEl.appendText(match[0]);
        }

        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
        // Render any remaining text as markdown
        const remainingText = text.substring(lastIndex);
        const remainingEl = containerEl.createSpan();
        renderMarkdown(plugin, remainingText, remainingEl);
    }
}

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
            updatePipsAndState(pip.classList.contains('dh-pip-marked') && clickedIndex === currentMarkedCount - 1 ? clickedIndex : clickedIndex + 1);
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
