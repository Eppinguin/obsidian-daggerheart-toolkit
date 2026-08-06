import { setIcon } from 'obsidian';
import { EVENT_SUMMON } from '../constants';
import type { StatblockData } from '../types';
import { findSummonTargets, summonLabel, type SummonTarget } from '../services/summon-parser';

/**
 * Attach summon controls to a feature whose text brings creatures into play.
 *
 * The control is rendered as a row beneath the feature's description rather
 * than inline in the prose. Inline was the first instinct — it matches how
 * "Spend a Fear" and "Countdown (6)" work — but a summon phrase is a span of
 * several words ("summon 1d4 Bladed Guards"), and turning that much running
 * text into a button made the paragraph hard to read. A chip on its own line
 * keeps the statblock legible and gives the button a real hit target.
 *
 * @param descriptionEl The already-rendered feature description.
 * @param text          The feature's raw text, which is what gets parsed.
 * @param compendium    Entries to resolve creature names against.
 * @param context       Feature name, used for the notice and the tooltip.
 */
export function renderSummonControls(
    descriptionEl: HTMLElement,
    text: string,
    compendium: StatblockData[],
    context: string,
): void {
    const targets = findSummonTargets(text, compendium);
    if (targets.length === 0) return;

    const row = descriptionEl.createDiv({ cls: 'dh-summon-row' });
    for (const target of targets) {
        renderSummonChip(row, target, context);
    }
}

function renderSummonChip(parentEl: HTMLElement, target: SummonTarget, context: string): void {
    const resolved = !!target.match;
    const chip = parentEl.createEl('button', {
        cls: 'dh-summon-chip',
        attr: {
            type: 'button',
            // The phrase the chip came from, so a GM can tell at a glance which
            // part of a multi-summon feature this button corresponds to.
            title: resolved
                ? `${target.sourceText} — adds ${target.match!.name} to the encounter`
                : `${target.sourceText} — pick which adversary to add`,
        },
    });

    // Plain "add" and "search" glyphs, matching the icons the rest of the
    // plugin uses. An unresolved target opens the picker instead of adding, so
    // the GM should know a choice is coming before they click.
    setIcon(chip.createSpan({ cls: 'dh-summon-chip-icon' }), resolved ? 'plus-circle' : 'search');

    // An unresolved chip is a prompt rather than a name, so the phrase from the
    // feature ("adversaries", "Minions") is capitalised to read as one.
    const name = resolved ? target.match!.name : capitalize(target.name);
    chip.createSpan({ cls: 'dh-summon-chip-label', text: summonChipLabel(target, name) });
    if (!resolved) chip.addClass('is-unresolved');

    chip.addEventListener('click', (event) => {
        // Feature rows toggle their own description on click; without this the
        // summon would also collapse the text it came from.
        event.stopPropagation();
        chip.dispatchEvent(
            new CustomEvent(EVENT_SUMMON, {
                detail: { target, context },
                bubbles: true,
                composed: true,
            }),
        );
    });
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "3× Jagged Knife Lackey", "1d4× Bladed Guard", or just the name for one. */
function summonChipLabel(target: SummonTarget, name: string): string {
    if (target.countDice) return `${target.countDice}× ${name}`;
    if (target.count && target.count > 1) return `${target.count}× ${name}`;
    return name;
}

export { summonLabel };
