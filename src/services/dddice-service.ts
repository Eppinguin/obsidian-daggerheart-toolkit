import { ThreeDDiceAPI, IRoom, ITheme, IDiceRoll, IDiceRollOptions, IDieType, ThreeDDice, IApiResponse, IRoll } from 'dddice-js';
import { Notice } from 'obsidian';
import { DddiceSettings } from 'types';
import { displayRollNotice } from './dice-helpers';

/**
 * Initializes the dddice API with the provided key for data fetching.
 * This is used when a full renderer instance isn't needed.
 * @param apiKey The user's dddice API key.
 * @returns An instance of the ThreeDDiceAPI.
 */
export function initializeDddiceApi(apiKey: string): ThreeDDiceAPI {
    if (!apiKey) {
        throw new Error("API Key is required to connect to dddice.");
    }
    return new ThreeDDiceAPI(apiKey, 'Daggerheart-Obsidian-Plugin');
}

/**
 * Fetches the list of available rooms from the dddice API.
 * @param api The initialized ThreeDDiceAPI instance.
 * @returns A promise that resolves to an array of IRoom objects.
 */
export async function fetchDddiceRooms(api: ThreeDDiceAPI): Promise<IRoom[]> {
    try {
        const { data } = await api.room.list();
        return data ?? [];
    } catch (e) {
        new Notice('Failed to fetch dddice rooms. Check API key and network.');
        console.error("dddice API Error fetching rooms:", e);
        return [];
    }
}

/**
 * Fetches all available themes (dice boxes) from the dddice API, handling pagination.
 * @param api The initialized ThreeDDiceAPI instance.
 * @returns A promise that resolves to an array of ITheme objects.
 */
export async function fetchDddiceThemes(api: ThreeDDiceAPI): Promise<ITheme[]> {
    try {
        let allThemes: ITheme[] = [];
        let response = await api.diceBox.list();

        if (response?.data) {
            allThemes = allThemes.concat(response.data);
        }

        while (true) {
            const nextPageResponse = await api.diceBox.next();
            if (nextPageResponse?.data && nextPageResponse.data.length > 0) {
                allThemes = allThemes.concat(nextPageResponse.data);
            } else {
                break;
            }
        }
        return allThemes;
    } catch (e) {
        new Notice('Failed to fetch dddice themes.');
        console.error("dddice API Error fetching themes:", e);
        return [];
    }
}

/**
 * Parses a generic dice string like "2d6", "1d20+5", "d8-1" into the dddice IDiceRoll[] format.
 * @param notation The dice string to parse.
 * @returns An array of IDiceRoll objects for the API.
 */
function parseGenericDiceString(notation: string): IDiceRoll[] {
    const dice: IDiceRoll[] = [];
    const pattern = /([+-]?)(\d*d\d+|\d+)/g;
    let match;

    const cleanedNotation = notation.replace(/\s/g, '');

    while ((match = pattern.exec(cleanedNotation)) !== null) {
        const sign = match[1] === '-' ? -1 : 1;
        let part = match[2];

        if (part.includes('d')) {
            let [countStr, sizeStr] = part.split('d');
            const count = countStr === '' ? 1 : parseInt(countStr, 10);
            const size = parseInt(sizeStr, 10);

            if (!isNaN(count) && !isNaN(size)) {
                for (let i = 0; i < count; i++) {
                    dice.push({ type: `d${size}` as IDieType });
                }
            }
        } else {
            const value = parseInt(part, 10);
            if (!isNaN(value)) {
                dice.push({ type: 'mod', value: value * sign });
            }
        }
    }
    return dice;
}

/**
 * Sends a dice roll request to the dddice API, using a renderer if available.
 * @param dddiceSettings The dddice settings from the plugin.
 * @param diceString The dice string to roll (e.g., "1d12+1d12" or "2d6").
 * @param context A string describing the context of the roll.
 * @param dddiceInstance An optional instance of the ThreeDDice renderer.
 * @param traitName An optional name of the trait being used for the roll (e.g., "Strength").
 */
export async function rollWithDddice(dddiceSettings: DddiceSettings, diceString: string, context: string, dddiceInstance?: ThreeDDice, traitName?: string) {
    const { apiKey, room, theme, hopeTheme, fearTheme, renderInObsidian } = dddiceSettings;
    if (!apiKey || !room || !theme || !hopeTheme || !fearTheme) {
        new Notice("dddice is not fully configured. Please set API Key, Room, and all dice themes in the plugin settings.");
        return;
    }

    const isDaggerheartActionRoll = diceString.toLowerCase().startsWith("1d12+1d12");

    const modifierMatch = isDaggerheartActionRoll ?
        diceString.match(/1d12\+1d12((?:[+-]\d+)*)(?:[+-]1d6)?/i) : null;

    let disadvantageValue: number | null = null;

    let dicePayload: IDiceRoll[];
    const rollOptions: IDiceRollOptions = { room, label: context };

    if (isDaggerheartActionRoll) {
        // First, create the hope and fear dice
        dicePayload = [
            { type: 'd12', theme: hopeTheme || undefined, label: 'Hope' },
            { type: 'd12', theme: fearTheme || undefined, label: 'Fear' }
        ];

        // Check for advantage or disadvantage dice - add these next
        if (diceString.includes('+1d6')) {
            dicePayload.push({ type: 'd6', theme: theme || undefined, label: 'Advantage' });
        } else if (diceString.includes('-1d6')) {
            // For disadvantage, generate a random number between 1-6 and add it as a negative modifier
            const randomD6Value = Math.floor(Math.random() * 6) + 1;
            disadvantageValue = randomD6Value;
            dicePayload.push({
                type: 'mod',
                value: -randomD6Value,  // Negative modifier to simulate disadvantage
                label: 'Disadvantage (d6)'
            });
        }

        // Now handle trait modifiers - should be at the end of the string
        // Look for modifiers that aren't part of dice specifications
        console.log("Dice string for modifier parsing:", diceString);
        const modifiers = [];

        // Use a more robust approach to extract modifiers
        // First check if there's a modifier at the end of the string
        const endModifierMatch = diceString.match(/([+-]\d+)$/);
        if (endModifierMatch) {
            modifiers.push(endModifierMatch[1]);
        }

        // Also look for modifiers between dice components
        const otherModifierMatches = diceString.match(/(?:(?:\d*d\d+)|(?:\d+))([+-]\d+)(?=[+-])/g);
        if (otherModifierMatches) {
            otherModifierMatches.forEach(match => {
                const modMatch = match.match(/([+-]\d+)$/);
                if (modMatch) {
                    modifiers.push(modMatch[1]);
                }
            });
        }

        console.log("Detected modifiers:", modifiers);

        modifiers.forEach(mod => {
            const value = parseInt(mod, 10);
            if (!isNaN(value)) {
                dicePayload.push({
                    type: 'mod',
                    value: value,
                    label: traitName ? `${traitName} Modifier` : 'Trait Modifier'
                });
            }
        });
    } else {
        // Handle regular rolls as before
        const parsedDice = parseGenericDiceString(diceString);
        if (parsedDice.length === 0) {
            new Notice(`Invalid dice string for dddice: "${diceString}"`);
            return;
        }
        dicePayload = parsedDice.map(d => ({ ...d, theme: theme || undefined }));
    }

    try {
        if (renderInObsidian && dddiceInstance) {
            // Handle rolls with rendering enabled
            const rollPromise = dddiceInstance.roll(dicePayload, rollOptions);
            rollPromise.then((result: IApiResponse<'roll', IRoll>) => {
                if (result?.data) {
                    handleRollResult(result.data, context, isDaggerheartActionRoll, diceString, modifierMatch, disadvantageValue, traitName);
                }
            });
        } else {
            // Handle rolls without rendering
            let dddiceApi: ThreeDDiceAPI;

            if (dddiceInstance?.api) {
                // Use the existing API instance if available
                dddiceApi = dddiceInstance.api;
            } else {
                // Create a new API instance if needed
                dddiceApi = initializeDddiceApi(apiKey);

                // Connect to the room if not already connected
                if (room) {
                    dddiceApi.connect(room);
                }
            }
            const roll = await dddiceApi.roll.create(dicePayload, rollOptions);

            if (roll.data) {
                handleRollResult(roll.data, context, isDaggerheartActionRoll, diceString, modifierMatch, disadvantageValue, traitName);
            }
        }
    } catch (e: any) {
        new Notice('Failed to roll with dddice. Check settings and console.');
        console.error("dddice Roll Error:", e.response?.data?.data?.message ?? e.message, e);
    }
}

/**
 * Helper function to handle the roll result and display the appropriate notification.
 */
function handleRollResult(
    rollData: IRoll,
    context: string,
    isDaggerheartActionRoll: boolean,
    diceString: string,
    modifierMatch: RegExpMatchArray | null,
    disadvantageValue: number | null,
    traitName?: string
) {
    // Using explicit types for the map function
    const values = rollData.values.map((v: { value: number }) => v.value);

    if (isDaggerheartActionRoll && values.length >= 2) {
        const hopeValue = values[0];
        const fearValue = values[1];

        // Get total with all modifiers and ensure it's a string
        const totalWithModifiers = String(rollData.total_value);

        // Determine outcome based on Hope vs Fear comparison
        const outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Critical!");

        // Prepare a detailed message that includes modifiers and advantage/disadvantage
        let resultDisplay = `${hopeValue}[Hope]+${fearValue}[Fear]`;

        // Add advantage/disadvantage information
        if (diceString.includes('+1d6') && values.length > 2) {
            const advantageDie = values[2]; // The advantage die should be the third value
            resultDisplay += `+${advantageDie}[Advantage]`;
        } else if (diceString.includes('-1d6') && disadvantageValue !== null) {
            // For disadvantage, use the stored random value we generated
            resultDisplay += `-${disadvantageValue}[Disadvantage]`;
        }

        // Add trait modifier if present
        // Find any trait modifiers in the roll values
        const traitModifiers = [];
        for (let i = (diceString.includes('+1d6') ? 3 : 2); i < values.length; i++) {
            traitModifiers.push(values[i]);
        }

        console.log("Trait Modifiers from values:", traitModifiers);

        // Display any trait modifiers that were found - but combine them into a single value
        if (traitModifiers.length > 0) {
            const totalTraitMod = traitModifiers.reduce((sum, mod) => sum + mod, 0);
            // Only show the trait modifier if it's not zero
            if (totalTraitMod !== 0) {
                const sign = totalTraitMod > 0 ? '+' : '';
                resultDisplay += `${sign}${totalTraitMod}[${traitName || 'Trait'}]`;
            }
        }

        // Use the standardized display function
        displayRollNotice(context, resultDisplay, totalWithModifiers, outcome);
    } else {
        // For non-Daggerheart rolls, use the simpler format
        try {
            // Ensure both values are strings to avoid type issues
            const equationStr = String(rollData.equation || '');
            const totalStr = String(rollData.total_value || '0');

            displayRollNotice(context, equationStr, totalStr);
        } catch (e) {
            // Fallback in case of any conversion errors
            new Notice(`${context}: Roll completed`, 5000);
            console.error("Error formatting dice result:", e);
        }
    }
}
