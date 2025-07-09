import { Notice } from 'obsidian';
import { DddiceSettings } from 'src/types';
import { displayRollNotice } from './dice-helpers';
import { ThreeDDiceAPI, ThreeDDice } from 'dddice-js';
import type { IRoom, ITheme, IDiceRoll, IDiceRollOptions, IDieType, IApiResponse, IRoll } from 'dddice-js';

// Re-export types that are needed by the UI
export type { IRoom, ITheme };

// Private variable to hold the singleton dddice instance
let _dddiceInstance: ThreeDDice | undefined;
let _dddiceCanvas: HTMLCanvasElement | null = null;
let _boundDddiceClear: (() => void) | null = null;

/**
 * Initialize or reinitialize the dddice renderer.
 * @param settings The dddice settings object.
 * @returns The initialized ThreeDDice instance if successful, undefined otherwise.
 */
export function initializeDddiceRenderer(settings: DddiceSettings): ThreeDDice | undefined {
    destroyDddiceRenderer();

    if (!settings.apiKey || !settings.renderInObsidian || !settings.room) {
        return undefined;
    }

    try {
        // Create the canvas for rendering
        _dddiceCanvas = document.body.createEl('canvas', { attr: { id: 'dddice-canvas' } });
        _dddiceCanvas.style.cssText = 'top:0px; left:0; position:fixed; pointer-events:none; z-index:95; width:100vw; height:100vh;';

        // Initialize the dddice instance
        _dddiceInstance = new ThreeDDice().initialize(_dddiceCanvas, settings.apiKey, undefined, 'Daggerheart-Obsidian');
        _dddiceInstance.connect(settings.room);
        _dddiceInstance.start();

        // Set up the clear handler
        _boundDddiceClear = () => {
            if (_dddiceInstance && !_dddiceInstance.isDiceThrowing) {
                _dddiceInstance.clear();
            }
        };
        document.body.addEventListener('click', _boundDddiceClear);

        console.log("dddice renderer initialized.");
        return _dddiceInstance;
    } catch (e) {
        console.error("Failed to initialize dddice renderer:", e);
        destroyDddiceRenderer();
        return undefined;
    }
}

/**
 * Clean up and destroy the dddice renderer instance.
 */
export function destroyDddiceRenderer(): void {
    if (_dddiceInstance) {
        _dddiceInstance.stop();
        if (_dddiceInstance.api) {
            _dddiceInstance.api.disconnect();
        }
        _dddiceInstance = undefined;
    }

    if (_dddiceCanvas) {
        if (_boundDddiceClear) {
            document.body.removeEventListener('click', _boundDddiceClear);
            _boundDddiceClear = null;
        }
        _dddiceCanvas.remove();
        _dddiceCanvas = null;
    }
}

/**
 * Get the current dddice instance if initialized.
 * @returns The current ThreeDDice instance or undefined if not initialized.
 */
export function getDddiceInstance(): ThreeDDice | undefined {
    return _dddiceInstance;
}

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
 * Fetches a single page of themes (dice boxes) from the dddice API.
 * @param api The initialized ThreeDDiceAPI instance.
 * @param isFirstPage Whether to fetch the first page or the next page.
 * @returns A promise that resolves to an object with the fetched themes and a hasMore flag.
 */
export async function fetchDddiceThemesPage(api: ThreeDDiceAPI, isFirstPage: boolean = true): Promise<{ themes: ITheme[], hasMore: boolean }> {
    try {
        let response;
        if (isFirstPage) {
            response = await api.diceBox.list();
        } else {
            response = await api.diceBox.next();
        }

        const themes = response?.data || [];

        // Determine if there are more pages
        // For the dddice API, we can check if the next() call would return more results
        // by attempting a peek at the next page without actually consuming it
        let hasMore = false;

        if (themes.length > 0) {
            // Check if there are more pages available
            // The exact check depends on the API's response structure
            // This is a simplified check - if we got results, assume there might be more
            // until we get an empty page

            // Try to access any pagination info that might be in the response
            // If not available, assume there's more if we got a full page
            hasMore = themes.length >= 10; // Assuming 10 is a typical page size

            // For a more accurate check, we'd need to know how the API indicates
            // there are more pages. Update this logic based on API documentation.
        }

        console.log(`Fetched ${themes.length} themes, hasMore: ${hasMore}`);
        return { themes, hasMore };
    } catch (e) {
        new Notice('Failed to fetch dddice themes page.');
        console.error("dddice API Error fetching themes page:", e);
        return { themes: [], hasMore: false };
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

export async function fetchDddiceRoom(api: ThreeDDiceAPI, roomSlug: string): Promise<IRoom | null> {
    try {
        const response = await api.room.get(roomSlug);
        return response?.data || null;
    } catch (e) {
        new Notice(`Failed to fetch dddice room with slug: ${roomSlug}`);
        console.error("dddice API Error fetching room:", e);
        return null;
    }
}

export async function fetchDddiceTheme(api: ThreeDDiceAPI, themeId: string): Promise<ITheme | null> {
    try {
        const response = await api.theme.get(themeId);
        return response?.data || null;
    } catch (e) {
        new Notice(`Failed to fetch dddice theme with ID: ${themeId}`);
        console.error("dddice API Error fetching theme:", e);
        return null;
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
 * Sends a dice roll request to the dddice API and returns the total value.
 * @returns A promise that resolves to the total roll value, or null if an error occurs.
 */
export async function rollWithDddice(dddiceSettings: DddiceSettings, diceString: string, context: string, traitName?: string): Promise<number | null> {
    const { apiKey, room, theme, hopeTheme, fearTheme, renderInObsidian } = dddiceSettings;
    if (!apiKey || !room || !theme || !hopeTheme || !fearTheme) {
        new Notice("dddice is not fully configured. Please set API Key, Room, and all dice themes in the plugin settings.");
        return null;
    }

    const isDaggerheartActionRoll = diceString.toLowerCase().startsWith("1d12+1d12");
    const modifierMatch = isDaggerheartActionRoll ? diceString.match(/1d12\+1d12((?:[+-]\d+)*)(?:[+-]1d6)?/i) : null;
    let disadvantageValue: number | null = null;
    let dicePayload: IDiceRoll[];
    const rollOptions: IDiceRollOptions = { room, label: context };

    if (isDaggerheartActionRoll) {
        dicePayload = [
            { type: 'd12', theme: hopeTheme || undefined, label: 'Hope' },
            { type: 'd12', theme: fearTheme || undefined, label: 'Fear' }
        ];
        if (diceString.includes('+1d6')) {
            dicePayload.push({ type: 'd6', theme: theme || undefined, label: 'Advantage' });
        } else if (diceString.includes('-1d6')) {
            const randomD6Value = Math.floor(Math.random() * 6) + 1;
            disadvantageValue = randomD6Value;
            dicePayload.push({ type: 'd6', theme: theme || undefined, label: 'Disadvantage' });
        }
        const endModifierMatch = diceString.match(/([+-]\d+)$/);
        if (endModifierMatch) {
            const value = parseInt(endModifierMatch[1], 10);
            if (!isNaN(value)) {
                dicePayload.push({ type: 'mod', value: value, label: traitName ? `${traitName} Modifier` : 'Trait Modifier' });
            }
        }
    } else {
        const parsedDice = parseGenericDiceString(diceString);
        if (parsedDice.length === 0) {
            new Notice(`Invalid dice string for dddice: "${diceString}"`);
            return null;
        }
        dicePayload = parsedDice.map(d => ({ ...d, theme: theme || undefined }));
    }

    return new Promise((resolve) => {
        try {
            if (renderInObsidian && _dddiceInstance) {
                const disadvantageIndex = dicePayload.findIndex(d => d.label?.includes('Disadvantage'));
                if (disadvantageIndex !== -1) {
                    rollOptions.operator = { "*": { "-1": [2] } };
                }
                const rollPromise = _dddiceInstance.roll(dicePayload, rollOptions);
                rollPromise.then((result: IApiResponse<'roll', IRoll>) => {
                    if (result?.data) {
                        handleRollResult(result.data, context, isDaggerheartActionRoll, diceString, modifierMatch, disadvantageValue, traitName);
                        if (typeof result.data.total_value === 'number') {
                            resolve(result.data.total_value);
                        } else if (typeof result.data.total_value === 'string') {
                            resolve(parseInt(result.data.total_value, 10));
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                }).catch((e: unknown) => {
                    console.error("dddice Roll Promise Error:", e);
                    resolve(null);
                });
            } else {
                const dddiceApi = _dddiceInstance?.api ?? initializeDddiceApi(apiKey);
                if (room) dddiceApi.connect(room);
                dddiceApi.roll.create(dicePayload, rollOptions).then((roll: IApiResponse<'roll', IRoll>) => {
                    if (roll.data) {
                        handleRollResult(roll.data, context, isDaggerheartActionRoll, diceString, modifierMatch, disadvantageValue, traitName);
                        if (typeof roll.data.total_value === 'number') {
                            resolve(roll.data.total_value);
                        } else if (typeof roll.data.total_value === 'string') {
                            resolve(parseInt(roll.data.total_value, 10));
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                }).catch((e: unknown) => {
                    console.error("dddice API Roll Error:", e);
                    resolve(null);
                });
            }
        } catch (e: any) {
            new Notice('Failed to roll with dddice. Check settings and console.');
            console.error("dddice Roll Error:", e.response?.data?.data?.message ?? e.message, e);
            resolve(null);
        }
    });
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
    const values = rollData.values.map((v: { value: number }) => v.value);

    if (isDaggerheartActionRoll && values.length >= 2) {
        const hopeValue = values[0];
        const fearValue = values[1];
        const totalWithModifiers = String(rollData.total_value);
        const outcome = hopeValue > fearValue ? "with Hope" : (fearValue > hopeValue ? "with Fear" : "Critical!");
        let resultDisplay = `${hopeValue}[Hope]+${fearValue}[Fear]`;
        if (diceString.includes('+1d6') && values.length > 2) {
            const advantageDie = values[2];
            resultDisplay += `+${advantageDie}[Advantage]`;
        } else if (diceString.includes('-1d6') && disadvantageValue !== null) {
            resultDisplay += `-${disadvantageValue}[Disadvantage]`;
        }
        const traitModifiers = [];
        for (let i = (diceString.includes('+1d6') ? 3 : 2); i < values.length; i++) {
            traitModifiers.push(values[i]);
        }
        if (traitModifiers.length > 0) {
            const totalTraitMod = traitModifiers.reduce((sum, mod) => sum + mod, 0);
            if (totalTraitMod !== 0) {
                const sign = totalTraitMod > 0 ? '+' : '';
                resultDisplay += `${sign}${totalTraitMod}[${traitName || 'Trait'}]`;
            }
        }
        displayRollNotice(context, resultDisplay, totalWithModifiers, outcome);
    } else {
        try {
            const equationStr = String(rollData.equation || '');
            const totalStr = String(rollData.total_value || '0');
            displayRollNotice(context, equationStr, totalStr);
        } catch (e) {
            new Notice(`${context}: Roll completed`, 5000);
            console.error("Error formatting dice result:", e);
        }
    }
}
