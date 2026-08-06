import { Notice } from 'obsidian';

/**
 * Handles adding advantage or disadvantage to a dice roll based on keyboard modifiers
 * @param event The click event containing modifier key information
 * @param baseDiceString The base dice string to modify
 * @param rollTitle The current roll title
 * @returns An object with modified dice string and roll title
 */
export function handleAdvantageDisadvantage(
    event: MouseEvent,
    baseDiceString: string,
    rollTitle: string,
): { diceString: string; rollTitle: string } {
    let advantageString = '';
    let newRollTitle = rollTitle;

    // Check for Shift key (add a d6)
    if (event.shiftKey) {
        advantageString += '+1d6';
        newRollTitle += ' [Advantage]';
    }

    // Check for Alt key (subtract a d6)
    if (event.altKey) {
        advantageString += '-1d6';
        newRollTitle += ' [Disadvantage]';
    }

    return {
        diceString: `${baseDiceString}${advantageString}`,
        rollTitle: newRollTitle,
    };
}

/**
 * Formats a trait modifier as a string with appropriate sign
 * @param traitValue The numeric trait value
 * @returns A formatted string (e.g., "+2" or "-1")
 */
export function formatTraitModifier(traitValue: number): string {
    if (traitValue === 0) return '';
    return traitValue > 0 ? `+${traitValue}` : `${traitValue}`;
}

/**
 * Displays a standardized roll result notice for Daggerheart
 * @param context The context of the roll (e.g., "Strength Roll")
 * @param result The roll result to display
 * @param totalValue The total value of the roll
 * @param outcomeText Optional outcome text (e.g., "with Hope")
 */
export function displayRollNotice(
    context: string,
    result: string,
    totalValue: number | string,
    outcomeText?: string,
): void {
    // Clean up the context by removing any [Advantage] or [Disadvantage] markers
    const cleanContext = context.replace(/\s*\[(Advantage|Disadvantage)\]/g, '');

    let message = `${cleanContext}: ${result} = ${totalValue}`;
    if (outcomeText) {
        message += ` ${outcomeText}`;
    }

    new Notice(message, 7000);
}
