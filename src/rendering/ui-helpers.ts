import DaggerheartStatblockPlugin from '../main';
import { Notice } from 'obsidian';
import { EVENT_CREATE_COUNTDOWN, EVENT_SPEND_FEAR } from '../constants';

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

            const unorderedMatch = line.match(/^\s*([*\-+])\s+(.*)$/);
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
        console.error('Error formatting markdown:', error);
        containerEl.appendText(text);
    }
}

/**
 * Whether the configured dice provider can take a roll right now. Shared by
 * every roll target so the attack and damage chips on one card never disagree
 * about whether they are clickable.
 */
export function canRollDice(plugin: DaggerheartStatblockPlugin): boolean {
    const isDiceRollerConfigured =
        plugin.settings.diceProvider === 'dice-roller' &&
        plugin.settings.enableDiceRoller &&
        plugin.isDiceRollerEnabled;
    const isDddiceConfigured = plugin.settings.diceProvider === 'dddice' && !!plugin.settings.dddice.apiKey;
    return isDiceRollerConfigured || isDddiceConfigured;
}

/**
 * Renders content with rollable dice strings and feature costs.
 * @param plugin The main plugin instance.
 * @param text The text to process.
 * @param containerEl The parent element for the rendered content.
 * @param context A string describing what the roll is for (e.g., an attack or feature name).
 */
export function renderRollableContent(
    plugin: DaggerheartStatblockPlugin,
    text: string,
    containerEl: HTMLElement,
    context: string,
) {
    const pattern =
        /(\b\d+d\d+(?:\s*[+-]\s*\d+)*\b)|(Mark\s+(?:a|\d+)\s+stress|Spend\s+(?:a|\d+)\s+(?:hope|fear))|\b(Countdown\s*\((Loop\s+)?(.*?)\))/gi;
    let lastIndex = 0;
    let match;

    const isRollable = canRollDice(plugin);

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const textFragment = text.substring(lastIndex, match.index);
            const fragmentEl = containerEl.createSpan();
            renderMarkdown(plugin, textFragment, fragmentEl);
        }

        const dicePart = match[1];
        const costPart = match[2];
        const countdownPart = match[3];
        const countdownLoop = match[4];
        const countdownValue = match[5];

        if (dicePart && isRollable) {
            const diceString = dicePart.replace(/\s/g, '');
            containerEl
                .createSpan({
                    text: dicePart,
                    cls: 'dh-rollable-dice',
                    title: `Click to roll ${diceString} for ${context}`,
                })
                .addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Pass the context of the roll to the main dice rolling function
                    // Extract trait name from context if possible (e.g., "Weapon Attack with Strength")
                    const traitMatch = context.match(/with\s+(\w+)(?:\s|$)/i);
                    const traitName = traitMatch ? traitMatch[1] : undefined;
                    plugin.rollDice(diceString, context, traitName);
                });
        } else if (costPart) {
            // "Spend a Fear" / "Spend 2 Fear" drives the encounter's Fear
            // tracker directly. "Mark a Stress" drives the adversary's own
            // Stress track, but only when the card holds a single instance —
            // with a group there is no telling whose Stress it means. Hope
            // belongs to the players' sheets and stays plain emphasis.
            const fearMatch = costPart.match(/^Spend\s+(a|\d+)\s+fear$/i);
            const stressMatch = costPart.match(/^Mark\s+(a|\d+)\s+stress$/i);
            const costEl = containerEl.createEl('strong', {
                text: costPart,
                cls: 'dh-feature-cost-text dh-interactive-cost',
            });

            if (fearMatch) {
                const amount = /^a$/i.test(fearMatch[1]) ? 1 : parseInt(fearMatch[1], 10);
                costEl.addClass('dh-spend-fear');
                costEl.title = `Click to spend ${amount} Fear`;
                costEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    costEl.dispatchEvent(
                        new CustomEvent(EVENT_SPEND_FEAR, {
                            detail: { amount, context },
                            bubbles: true,
                            composed: true,
                        }),
                    );
                });
            } else if (stressMatch) {
                const amount = /^a$/i.test(stressMatch[1]) ? 1 : parseInt(stressMatch[1], 10);
                costEl.addClass('dh-mark-stress');
                costEl.addEventListener('click', (e) => {
                    // Resolved at click time rather than render time: group
                    // members are added and removed without redrawing the
                    // statblock, so the card's shape can change underneath it.
                    const stressTrack = findSoleStressTrack(costEl);
                    if (!stressTrack) return;
                    e.stopPropagation();
                    markStress(stressTrack, amount, context);
                });
                costEl.addEventListener('mouseenter', () => {
                    costEl.title = findSoleStressTrack(costEl) ? `Click to mark ${amount} Stress` : '';
                });
            }
        } else if (countdownPart && countdownValue) {
            const countdownEl = containerEl.createSpan({
                text: countdownPart,
                cls: 'dh-rollable-dice',
                title: `Click to create a Countdown`,
            });

            countdownEl.addEventListener('click', async (e) => {
                e.stopPropagation();

                let finalValue: number | null = null;
                const trimmedValue = countdownValue.trim();
                const cleanName = context.replace(countdownPart, '').trim();
                const diceContext = `${cleanName} Countdown`;

                const diceRegex = /^\d+d\d+(?:\s*[+-]\s*\d+)*$/i;
                if (diceRegex.test(trimmedValue)) {
                    if (isRollable) {
                        finalValue = await plugin.rollDice(trimmedValue, diceContext);
                    } else {
                        new Notice('Dice roller not configured. Cannot roll for countdown.');
                        return;
                    }
                } else if (!isNaN(parseInt(trimmedValue, 10))) {
                    finalValue = parseInt(trimmedValue, 10);
                }

                if (finalValue !== null) {
                    // The loop used to be concatenated onto the name, which left
                    // the tracker unable to tell a looping countdown from one
                    // that merely says "Loop" in its title. It travels as data
                    // now, so the name stays the feature's own.
                    containerEl.dispatchEvent(
                        new CustomEvent(EVENT_CREATE_COUNTDOWN, {
                            detail: {
                                name: cleanName || 'Countdown',
                                value: finalValue,
                                start: trimmedValue,
                                loops: !!countdownLoop,
                            },
                            bubbles: true,
                            composed: true,
                        }),
                    );
                } else {
                    new Notice(`Invalid countdown value: "${countdownValue}"`);
                }
            });
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
 * The Stress track a "Mark a Stress" link should drive, or null when there is
 * no single answer: outside an encounter card, on an environment, or on a card
 * holding a group.
 */
function findSoleStressTrack(el: HTMLElement): HTMLElement | null {
    const card = el.closest('.dh-adversary-instance-card');
    if (!card) return null;
    const tracks = card.querySelectorAll<HTMLElement>('.dh-hp-stress-container .dh-stress-track');
    return tracks.length === 1 ? tracks[0] : null;
}

/**
 * Mark Stress through the track's own + button, so the pips, the saved state
 * and any callbacks move exactly as if the GM had clicked it.
 */
function markStress(track: HTMLElement, amount: number, context: string) {
    const incButton = track.querySelector<HTMLButtonElement>('.dh-track-btn-increment');
    if (!incButton) return;
    const max = track.querySelectorAll('.dh-pip').length;
    const marked = () => track.querySelectorAll('.dh-pip.dh-pip-marked').length;
    const room = max - marked();
    if (room <= 0) {
        new Notice(`${context}: Stress is already full.`);
        return;
    }
    for (let i = 0; i < Math.min(amount, room); i++) incButton.click();
    if (amount > room) new Notice(`${context}: only ${room} Stress left to mark.`);
}

/**
 * Enter and Space activation for an element given role="button", matching what
 * a native button does. Only fires for the element itself, not a nested control.
 */
export function onActivateKey(el: HTMLElement, handler: (e: KeyboardEvent) => void) {
    el.addEventListener('keydown', (e) => {
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        handler(e);
    });
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
    parentEl: HTMLElement,
    label: string,
    maxValue: number,
    trackIdPrefix: string,
    currentValue: number,
    updateCallback: (newValue: number) => void,
) {
    const trackDiv = parentEl.createDiv({
        cls: `dh-interactive-track dh-${label.toLowerCase()}-track`,
    });
    trackDiv.createSpan({ text: label.toUpperCase(), cls: 'dh-track-label' });
    const controlsDiv = trackDiv.createDiv({ cls: 'dh-track-controls' });
    const decrementButton = controlsDiv.createEl('button', {
        text: '−',
        cls: 'dh-track-btn dh-track-btn-decrement',
        attr: { type: 'button', 'aria-label': `Clear one ${label}` },
    });
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
            const currentMarkedCount = pips.filter((p) => p.classList.contains('dh-pip-marked')).length;
            const isLastPip = clickedIndex === currentMarkedCount - 1;
            updatePipsAndState(pip.classList.contains('dh-pip-marked') && isLastPip ? clickedIndex : clickedIndex + 1);
        });
        pips.push(pip);
    }

    const incButton = controlsDiv.createEl('button', {
        text: '+',
        cls: 'dh-track-btn dh-track-btn-increment',
        attr: { type: 'button', 'aria-label': `Mark one ${label}` },
    });
    decrementButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter((p) => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount > 0) updatePipsAndState(currentMarkedCount - 1);
    });
    incButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter((p) => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount < maxValue) updatePipsAndState(currentMarkedCount + 1);
    });
}
