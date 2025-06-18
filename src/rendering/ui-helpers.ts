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

export function renderRollableContent(plugin: DaggerheartStatblockPlugin, text: string, containerEl: HTMLElement) {
    const pattern = /(\b\d+d\d+(?:\s*[+-]\s*\d+)*\b)|(Mark\s+(?:a|\d+)\s+stress|Spend\s+(?:a|\d+)\s+fear)/gi;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            containerEl.appendText(text.substring(lastIndex, match.index));
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
        containerEl.appendText(text.substring(lastIndex));
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
