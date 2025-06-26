import { ThreeDDiceAPI, IRoom, ITheme, IDiceRoll, IDiceRollOptions, IDieType, ThreeDDice, IApiResponse, IRoll } from 'dddice-js';
import { Notice } from 'obsidian';
import { DddiceSettings } from 'types';

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
 */
export async function rollWithDddice(dddiceSettings: DddiceSettings, diceString: string, context: string, dddiceInstance?: ThreeDDice) {
    const { apiKey, room, theme, hopeTheme, fearTheme, renderInObsidian } = dddiceSettings;
    if (!apiKey || !room || !theme || !hopeTheme || !fearTheme) {
        new Notice("dddice is not fully configured. Please set API Key, Room, and all dice themes in the plugin settings.");
        return;
    }

    const isDaggerheartActionRoll = (diceString.toLowerCase().match(/d12/g) || []).length === 2 && !/[dD][^1]/.test(diceString) && !/[dD]1[^2]/.test(diceString);

    let dicePayload: IDiceRoll[];
    const rollOptions: IDiceRollOptions = { room, label: context };

    if (isDaggerheartActionRoll) {
        dicePayload = [
            { type: 'd12', theme: hopeTheme || undefined, label: 'Hope' },
            { type: 'd12', theme: fearTheme || undefined, label: 'Fear' }
        ];
    } else {
        const parsedDice = parseGenericDiceString(diceString);
        if (parsedDice.length === 0) {
            new Notice(`Invalid dice string for dddice: "${diceString}"`);
            return;
        }
        dicePayload = parsedDice.map(d => ({ ...d, theme: theme || undefined }));
    }

    try {
        if (renderInObsidian && dddiceInstance) {
            const rollPromise = dddiceInstance.roll(dicePayload, rollOptions);
            rollPromise.then((result: IApiResponse<'roll', IRoll>) => {
                if (result?.data) {
                    const rollData = result.data;
                    // Using explicit types for the map function
                    const values = rollData.values.map((v: { value: number }) => v.value);
                    if (isDaggerheartActionRoll && values.length === 2) {
                        const hopeValue = values[0];
                        const fearValue = values[1];
                        const outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Neutral");
                        new Notice(`${context}: Hope [${hopeValue}], Fear [${fearValue}] => ${outcome}`, 7000);
                    } else {
                        new Notice(`${context}: ${rollData.equation} = ${rollData.total_value}`, 7000);
                    }
                }
            });
        } else {
            const dddiceApi = initializeDddiceApi(apiKey);
            const roll = await dddiceApi.roll.create([dicePayload], rollOptions);
            if (roll.data?.[0]) {
                const rollData = roll.data[0];
                // Using explicit types for the map function
                const values = rollData.values.map((v: { value: number }) => v.value);
                const total = rollData.total_value;
                if (isDaggerheartActionRoll && values.length === 2) {
                    const hopeValue = values[0];
                    const fearValue = values[1];
                    const outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Neutral");
                    new Notice(`${context}: Hope [${hopeValue}], Fear [${fearValue}] => ${outcome}`, 7000);
                } else {
                    new Notice(`${context}: ${rollData.equation} = ${total}`, 7000);
                }
            }
        }
    } catch (e: any) {
        new Notice('Failed to roll with dddice. Check settings and console.');
        console.error("dddice Roll Error:", e.response?.data?.data?.message ?? e.message, e);
    }
}
