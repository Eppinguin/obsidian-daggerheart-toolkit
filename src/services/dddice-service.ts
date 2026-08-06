import { Notice } from 'obsidian';
import { DddiceSettings } from 'src/types';
import { ThreeDDiceAPI, ThreeDDice, ThreeDDiceRollEvent } from 'dddice-js';
import type { IRoom, ITheme, IDiceRoll, IDiceRollOptions, IDieType, IRoll, IRoomParticipant } from 'dddice-js';
import DaggerheartStatblockPlugin from 'src/main';
import { RollCompletedPayload } from 'src/DiceTray';

// Re-export types that are needed by the UI
export type { IRoom, ITheme, IRoll };

/**
 * Custom error to signal that a dddice room was not found.
 */
export class DddiceRoomNotFoundError extends Error {
    constructor(message?: string) {
        super(message || 'dddice room not found.');
        this.name = 'DddiceRoomNotFoundError';
    }
}

// Add a type for our structured roll components
export interface RollComponent {
    value: number;
    label: string;
    type: 'hope' | 'fear' | 'advantage' | 'disadvantage' | 'modifier' | 'die';
}

// Add a type for the full result of a dddice roll
export interface DddiceRollResult {
    display: string;
    totalStr: string;
    total: number;
    outcome?: string;
    structuredResult?: RollComponent[];
    rollId: string;
    userUUID?: string;
    diceUUIDs: string[];
    hiddenRolls: boolean[];
    isModifierHidden: boolean;
}

// Private variable to hold the singleton dddice instance
let _dddiceInstance: ThreeDDice | undefined;
let _dddiceCanvas: HTMLCanvasElement | null = null;
let _boundDddiceClear: (() => void) | null = null;
let _currentUserUuid: string | undefined;

async function handleExternalRoll(roll: IRoll, plugin: DaggerheartStatblockPlugin) {
    if (roll.user?.uuid === _currentUserUuid) {
        return;
    }

    let isDaggerheartActionRoll =
        roll.values.some((d) => d.label === 'Hope') && roll.values.some((d) => d.label === 'Fear');

    // Check for 2d12 with different themes as a fallback for identifying duality rolls
    const d12s = roll.values.filter((d) => d.type === 'd12');
    if (!isDaggerheartActionRoll && d12s.length === 2 && d12s[0].theme !== d12s[1].theme) {
        isDaggerheartActionRoll = true;
        // Mutate the roll object to add labels for consistent processing
        d12s[0].label = 'Hope';
        d12s[1].label = 'Fear';
    }

    const processedResult = handleRollResult(roll, isDaggerheartActionRoll);

    const rollerName =
        roll.room?.participants?.find((p) => p.user.uuid === roll.user?.uuid)?.username ||
        roll.user?.username ||
        'Unknown Roller';

    const payload: RollCompletedPayload = {
        rollerName: rollerName,
        context: roll.label || 'External Roll',
        result: processedResult.display,
        total: processedResult.totalStr,
        outcome: processedResult.outcome,
        structuredResult: processedResult.structuredResult,
        // Add new fields for hidden/reveal logic
        rollId: processedResult.rollId,
        userUUID: processedResult.userUUID,
        diceUUIDs: processedResult.diceUUIDs,
        hiddenRolls: processedResult.hiddenRolls,
        isModifierHidden: processedResult.isModifierHidden,
    };

    plugin.app.workspace.trigger('daggerheart-roll-completed', payload);
}

/**
 * Initialize or reinitialize the dddice renderer.
 */
export function initializeDddiceRenderer(
    settings: DddiceSettings,
    plugin: DaggerheartStatblockPlugin,
): ThreeDDice | undefined {
    destroyDddiceRenderer();

    if (!settings.apiKey || !settings.renderInObsidian || !settings.room) {
        return undefined;
    }

    try {
        _dddiceCanvas = document.body.createEl('canvas', { attr: { id: 'dddice-canvas' } });
        _dddiceCanvas.style.cssText =
            'top:0px; left:0; position:fixed; pointer-events:none; z-index:95; width:100vw; height:100vh;';
        _dddiceInstance = new ThreeDDice().initialize(
            _dddiceCanvas,
            settings.apiKey,
            undefined,
            'Daggerheart-Obsidian',
        );

        // Fetch and cache the current user's UUID to prevent processing our own rolls from the server
        _dddiceInstance?.api?.user.get().then((userResponse) => {
            if (userResponse?.data) {
                _currentUserUuid = userResponse.data.uuid;
            }
        });

        _dddiceInstance.connect(settings.room);
        // Use the correct event enum to listen for finished rolls
        _dddiceInstance.on(ThreeDDiceRollEvent.RollFinished, (roll: IRoll) => {
            handleExternalRoll(roll, plugin);
        });
        _dddiceInstance.start();
        _boundDddiceClear = () => {
            if (_dddiceInstance && !_dddiceInstance.isDiceThrowing) {
                _dddiceInstance.clear();
            }
        };
        document.body.addEventListener('click', _boundDddiceClear);
        console.log('dddice renderer initialized.');
        return _dddiceInstance;
    } catch (e) {
        console.error('Failed to initialize dddice renderer:', e);
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
 * Get the current dddice instance if it initialized.
 * @returns The current ThreeDDice instance or undefined if not initialized.
 */
export function getDddiceInstance(): ThreeDDice | undefined {
    return _dddiceInstance;
}

/**
 * Get the current dddice user's UUID if available.
 * @returns The current user's UUID or undefined.
 */
export function getCurrentUserUuid(): string | undefined {
    return _currentUserUuid;
}

/**
 * Reveals a hidden roll.
 * @param rollId The UUID of the roll to reveal.
 * @param diceUUIDs The UUIDs of all dice in the roll.
 */
export async function revealRoll(rollId: string, diceUUIDs: string[]): Promise<void> {
    if (!_dddiceInstance?.api) {
        new Notice('dddice API not initialized.');
        return;
    }

    try {
        const diceUpdatePayload = diceUUIDs.map((uuid) => ({ uuid, is_hidden: false }));
        // CORRECTION: Removed the top-level `is_hidden` property from the update payload to match the library's type definition.
        await _dddiceInstance.api.roll.update(rollId, { dice: diceUpdatePayload });
        new Notice('Roll revealed!');
    } catch (e: any) {
        console.error('dddice: Failed to reveal roll:', e);
        new Notice('Failed to reveal roll. See console for details.');
    }
}

/**
 * Initializes the dddice API with the provided key for data fetching.
 */
export function initializeDddiceApi(apiKey: string): ThreeDDiceAPI {
    if (!apiKey) {
        throw new Error('API Key is required to connect to dddice.');
    }
    return new ThreeDDiceAPI(apiKey, 'Daggerheart-Obsidian-Plugin');
}

/**
 * Fetches the latest data for a specific roll from the dddice server.
 * @param rollId The UUID of the roll to fetch.
 * @returns The roll data or null if not found.
 */
export async function getRoll(rollId: string): Promise<IRoll | null> {
    const api = getDddiceInstance()?.api;
    if (!api) {
        console.warn('dddice API not initialized. Cannot fetch roll update.');
        return null;
    }

    try {
        const response = await api.roll.get(rollId);
        return response?.data ?? null;
    } catch (e: any) {
        if (e?.response?.status !== 404) {
            new Notice('Failed to fetch roll update from dddice.');
            console.error(`dddice: Failed to get roll ${rollId}`, e);
        }
        return null;
    }
}

// ... (fetch methods are unchanged) ...
export async function fetchDddiceRooms(api: ThreeDDiceAPI): Promise<IRoom[]> {
    try {
        const { data } = await api.room.list();
        return data ?? [];
    } catch (e) {
        new Notice('Failed to fetch dddice rooms. Check API key and network.');
        console.error('dddice API Error fetching rooms:', e);
        return [];
    }
}

export async function fetchDddiceThemesPage(
    api: ThreeDDiceAPI,
    isFirstPage: boolean = true,
): Promise<{ themes: ITheme[]; hasMore: boolean }> {
    try {
        let response;
        if (isFirstPage) {
            response = await api.diceBox.list();
        } else {
            response = await api.diceBox.next();
        }

        const themes = response?.data || [];
        let hasMore = themes.length >= 10;

        console.log(`Fetched ${themes.length} themes, hasMore: ${hasMore}`);
        return { themes, hasMore };
    } catch (e) {
        new Notice('Failed to fetch dddice themes page.');
        console.error('dddice API Error fetching themes page:', e);
        return { themes: [], hasMore: false };
    }
}

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
        console.error('dddice API Error fetching themes:', e);
        return [];
    }
}

export async function fetchDddiceRoom(api: ThreeDDiceAPI, roomSlug: string): Promise<IRoom | null> {
    try {
        const response = await api.room.get(roomSlug);
        return response?.data || null;
    } catch (e) {
        new Notice(`Failed to fetch dddice room with slug: ${roomSlug}`);
        console.error('dddice API Error fetching room:', e);
        return null;
    }
}

export async function fetchDddiceTheme(api: ThreeDDiceAPI, themeId: string): Promise<ITheme | null> {
    try {
        const response = await api.theme.get(themeId);
        return response?.data || null;
    } catch (e) {
        new Notice(`Failed to fetch dddice theme with ID: ${themeId}`);
        console.error('dddice API Error fetching theme:', e);
        return null;
    }
}

export async function updateParticipantName(settings: DddiceSettings, newName: string): Promise<void> {
    if (!settings.apiKey || !settings.room || !newName) {
        return;
    }

    try {
        const api = getDddiceInstance()?.api ?? initializeDddiceApi(settings.apiKey);
        const roomSlug = settings.room;

        if (!api.roomSlug) {
            await api.connect(roomSlug);
        }

        const userResponse = await api.user.get();
        const user = userResponse?.data;
        if (!user) {
            console.error('dddice: Could not get user to update participant name.');
            return;
        }

        _currentUserUuid = user.uuid;

        let room = (await api.room.get(roomSlug))?.data;

        if (!room) {
            console.error(`dddice: Room with slug "${roomSlug}" not found.`);
            return;
        }

        let participant = room.participants.find((p: IRoomParticipant) => p.user.uuid === user.uuid);

        if (!participant) {
            try {
                const joinedRoom = (await api.room.join(roomSlug))?.data;
                if (joinedRoom) {
                    participant = joinedRoom.participants.find((p: IRoomParticipant) => p.user.uuid === user.uuid);
                }
            } catch (joinError: any) {
                if (!joinError?.response?.data?.data?.message?.includes('already a participant')) {
                    console.error('dddice: Failed to join room to update participant name:', joinError);
                }
            }
        }

        if (!participant) {
            console.warn('dddice: Could not find or add user to room. Name not updated.');
            return;
        }

        if (participant.username !== newName) {
            await api.room.updateParticipant(roomSlug, participant.id, { username: newName });
            console.log(`dddice: Updated participant name to "${newName}".`);
        }
    } catch (e: any) {
        if (e?.response?.status !== 404) {
            console.error('dddice: Failed to update participant name:', e);
        }
    }
}

function parseGenericDiceString(notation: string): {
    dice: IDiceRoll[];
    operator?: IDiceRollOptions['operator'];
} {
    const dice: IDiceRoll[] = [];
    const negativeIndices: number[] = [];
    const pattern = /([+-])?\s*(\d*d\d+|\d+)/g;
    let match;
    const cleanedNotation = notation.replace(/\s/g, '');
    const isFirstTermNegative = cleanedNotation.startsWith('-');

    while ((match = pattern.exec(cleanedNotation)) !== null) {
        const sign = match[1];
        let part = match[2];

        if (part.includes('d')) {
            let [countStr, sizeStr] = part.split('d');
            const count = countStr === '' ? 1 : parseInt(countStr, 10);
            const size = parseInt(sizeStr, 10);
            if (!isNaN(count) && !isNaN(size)) {
                for (let i = 0; i < count; i++) {
                    dice.push({ type: `d${size}` as IDieType });
                    if (sign === '-') {
                        negativeIndices.push(dice.length - 1);
                    }
                }
            }
        } else {
            const value = parseInt(part, 10);
            if (!isNaN(value)) {
                const isNegative = sign === '-' || (isFirstTermNegative && match.index === 0 && !sign);
                dice.push({ type: 'mod', value: isNegative ? -value : value });
            }
        }
    }

    let operator: IDiceRollOptions['operator'] | undefined = undefined;
    if (negativeIndices.length > 0) {
        operator = { '*': { '-1': negativeIndices } };
    }

    return { dice, operator };
}

export function handleRollResult(
    rollData: IRoll,
    isDaggerheartActionRoll: boolean,
    traitName?: string,
    operator?: IDiceRollOptions['operator'],
): DddiceRollResult {
    let total: number;
    if (typeof rollData.total_value === 'number') {
        total = rollData.total_value;
    } else {
        total = rollData.values.reduce((sum, die) => sum + Number(die.value), 0);
    }
    if (isNaN(total)) {
        console.error('Could not determine total from dddice roll:', rollData);
        total = 0;
    }

    const components: RollComponent[] = [];
    const diceValues = rollData.values.filter((v) => v.type !== 'mod');
    const modifierValues = rollData.values.filter((v) => v.type === 'mod');

    if (isDaggerheartActionRoll) {
        let hopeValue: number | null = null;
        let fearValue: number | null = null;

        rollData.values.forEach((die) => {
            const value = Number(die.value);
            const type = die.type as IDieType | 'mod';
            const label = die.label;

            if (label === 'Hope' && type === 'd12') {
                hopeValue = value;
                components.push({ value, label: 'Hope', type: 'hope' });
            } else if (label === 'Fear' && type === 'd12') {
                fearValue = value;
                components.push({ value, label: 'Fear', type: 'fear' });
            } else if (label === 'Advantage' && type === 'd6') {
                components.push({ value, label: 'Advantage', type: 'advantage' });
            } else if (label === 'Disadvantage' && type === 'd6') {
                components.push({ value: -value, label: 'Disadvantage', type: 'disadvantage' });
            } else if (type === 'mod') {
                components.push({ value, label: traitName || 'Mod', type: 'modifier' });
            } else {
                components.push({ value, label: type, type: 'die' });
            }
        });

        const outcome =
            hopeValue !== null && fearValue !== null
                ? hopeValue > fearValue
                    ? 'with Hope'
                    : fearValue > hopeValue
                      ? 'with Fear'
                      : 'Critical!'
                : undefined;

        let displayString = '';
        components.forEach((c, index) => {
            displayString += `${index > 0 ? ` ${c.value < 0 ? '-' : '+'} ` : c.value < 0 ? '-' : ''}${Math.abs(c.value)}[${c.label}]`;
        });

        return {
            display: displayString,
            totalStr: String(total),
            total,
            outcome,
            structuredResult: components,
            rollId: rollData.uuid,
            userUUID: rollData.user?.uuid,
            diceUUIDs: rollData.values.map((v) => v.uuid),
            hiddenRolls: diceValues.map((v) => v.is_hidden ?? false),
            isModifierHidden: modifierValues.some((v) => v.is_hidden ?? false),
        };
    } else {
        // Handle generic rolls
        const equationStr = String(rollData.equation || '');
        const opTimes = operator?.['*'];
        const negativeDiceIndices = typeof opTimes === 'object' && opTimes?.['-1'] ? (opTimes['-1'] as number[]) : [];

        if (rollData.values) {
            // Dice are processed first, in order, so indices match our payload.
            diceValues.forEach((v, index) => {
                const value = Number(v.value);
                const finalValue = negativeDiceIndices.includes(index) ? -value : value;
                components.push({ value: finalValue, label: v.type, type: 'die' });
            });

            // Modifiers are processed last and their values are already signed correctly.
            modifierValues.forEach((v) => {
                const value = Number(v.value);
                components.push({ value, label: 'Modifier', type: 'modifier' });
            });
        }

        return {
            display: equationStr,
            totalStr: String(total),
            total,
            outcome: undefined,
            structuredResult: components,
            rollId: rollData.uuid,
            userUUID: rollData.user?.uuid,
            diceUUIDs: rollData.values.map((v) => v.uuid),
            hiddenRolls: diceValues.map((v) => v.is_hidden ?? false),
            isModifierHidden: modifierValues.some((v) => v.is_hidden ?? false),
        };
    }
}

export async function rollWithDddice(
    dddiceSettings: DddiceSettings,
    diceString: string,
    context: string,
    traitName?: string,
    isHidden?: boolean,
): Promise<DddiceRollResult | null> {
    const { apiKey, room, theme, hopeTheme, fearTheme } = dddiceSettings;
    if (!apiKey || !room || !theme || !hopeTheme || !fearTheme) {
        new Notice(
            'dddice is not fully configured. Please set API Key, Room, and all dice themes in the plugin settings.',
        );
        return null;
    }

    const cleanedDiceString = diceString.trim().toLowerCase();

    const dualityKeywords = ['dr', 'duality'];
    let isDaggerheartActionRoll = false;
    let modifiers = '';

    for (const keyword of dualityKeywords) {
        if (cleanedDiceString.startsWith(keyword)) {
            isDaggerheartActionRoll = true;
            modifiers = cleanedDiceString.substring(keyword.length);
            break;
        }
    }

    let dicePayload: IDiceRoll[];
    // CORRECTION: Removed '(local)' suffix from label and `is_hidden` from the top-level options.
    const rollOptions: IDiceRollOptions = { room, label: context };
    let operator: IDiceRollOptions['operator'] | undefined;
    const dieOptions = { theme: theme || undefined, is_hidden: isHidden };

    if (isDaggerheartActionRoll) {
        dicePayload = [
            { type: 'd12', theme: hopeTheme || undefined, label: 'Hope', is_hidden: isHidden },
            { type: 'd12', theme: fearTheme || undefined, label: 'Fear', is_hidden: isHidden },
        ];

        const pattern = /([+-])?\s*(\d*d\d+|\d+)/g;
        let match;

        while ((match = pattern.exec(modifiers)) !== null) {
            const sign = match[1] || '+';
            const part = match[2];

            if (part.toLowerCase() === '1d6' || part.toLowerCase() === 'd6') {
                if (sign === '-') {
                    dicePayload.push({ type: 'd6', ...dieOptions, label: 'Disadvantage' });
                    rollOptions.operator = { '*': { '-1': [dicePayload.length - 1] } };
                } else {
                    dicePayload.push({ type: 'd6', ...dieOptions, label: 'Advantage' });
                }
                continue;
            }

            if (part.includes('d')) {
                const [countStr, sizeStr] = part.split('d');
                const count = countStr === '' ? 1 : parseInt(countStr, 10);
                const size = parseInt(sizeStr, 10);
                if (!isNaN(count) && !isNaN(size)) {
                    for (let i = 0; i < count; i++) {
                        dicePayload.push({ type: `d${size}` as IDieType, ...dieOptions });
                    }
                }
            } else {
                const value = parseInt(part, 10);
                if (!isNaN(value)) {
                    dicePayload.push({
                        type: 'mod',
                        value: sign === '-' ? -value : value,
                        is_hidden: isHidden,
                    });
                }
            }
        }
    } else {
        const parsedResult = parseGenericDiceString(diceString);
        operator = parsedResult.operator;
        const parsedDice = parsedResult.dice;
        if (parsedDice.length === 0) {
            new Notice(`Invalid dice string for dddice: "${diceString}"`);
            return null;
        }
        dicePayload = parsedDice.map((d) => ({ ...d, ...dieOptions }));
        if (operator) {
            Object.assign(rollOptions, { operator });
        }
    }

    try {
        if (!_dddiceInstance?.api) throw new Error('dddice API not initialized');
        const dddiceApi = _dddiceInstance.api;
        if (room && dddiceApi.roomSlug !== room) {
            await dddiceApi.connect(room);
        }

        const rollPromise = dddiceApi.roll.create(dicePayload, rollOptions);

        const result = await rollPromise;

        if (result?.data) {
            // After our own roll, update our UUID in case it was a guest account that just got created
            if (!_currentUserUuid && result.data.user?.uuid) {
                _currentUserUuid = result.data.user.uuid;
            }
            return handleRollResult(result.data, isDaggerheartActionRoll, traitName, operator);
        } else {
            return null;
        }
    } catch (e: any) {
        if (e?.response?.status === 404) {
            console.warn('dddice: Roll failed because the room was not found (404).');
            throw new DddiceRoomNotFoundError();
        }
        new Notice('Failed to roll with dddice. Check settings and console.');
        console.error('dddice Roll Error:', e.response?.data?.data?.message ?? e.message, e);
        return null;
    }
}
