import type DaggerheartStatblockPlugin from './main';
import { Notice, setIcon } from 'obsidian';
import * as dddice from './services/dddice-service';

export interface RollComponent {
    value: number;
    label: string;
    type: 'hope' | 'fear' | 'advantage' | 'disadvantage' | 'modifier' | 'die';
}

// This interface now matches the one in main.ts
export interface RollCompletedPayload {
    rollerName?: string;
    context: string;
    result: string;
    structuredResult?: RollComponent[];
    total: string;
    outcome?: string;
    rollId?: string;
    userUUID?: string;
    diceUUIDs?: string[];
    hiddenRolls?: boolean[];
    isModifierHidden?: boolean;
}

interface RollHistoryEntry extends RollCompletedPayload {
    id: string; // Changed to string for UUIDs
    timestamp: string;
}

export class DiceTray {
    plugin: DaggerheartStatblockPlugin;
    private trayButton: HTMLElement | null = null;
    private trayContainer: HTMLElement | null = null;
    private formulaInput!: HTMLInputElement;
    private modifierInput!: HTMLInputElement;
    private historyContainer!: HTMLElement;
    private rolls: RollHistoryEntry[] = [];
    private isOpen: boolean = false;
    private manuallyOpened: boolean = false;
    private autoHideTimer: number | null = null;
    private formulaContext: string | null = null;

    constructor(plugin: DaggerheartStatblockPlugin) {
        this.plugin = plugin;
        this.plugin.app.workspace.on('daggerheart-roll-completed', this.handleNewRoll);
    }

    // Renders the entire tray UI into a parent element
    public render(parent: HTMLElement) {
        if (!this.trayButton) {
            this.trayButton = parent.createEl('div', { cls: 'dh-dice-tray-button' });
            setIcon(this.trayButton, 'dices');
            this.trayButton.setAttribute('aria-label', 'Open Dice Tray');
            this.trayButton.addEventListener('click', () => this.toggle());
        }

        if (!this.trayContainer) {
            this.trayContainer = parent.createEl('div', { cls: 'dh-dice-tray-container' });
            this.trayContainer.style.display = 'none';

            this.historyContainer = this.trayContainer.createDiv({ cls: 'dh-dice-tray-history' });

            const controlsWrapper = this.trayContainer.createDiv({
                cls: 'dh-dice-tray-controls-wrapper',
            });

            const diceButtonsContainer = controlsWrapper.createDiv({ cls: 'dh-dice-buttons-container' });
            const diceTypes = [4, 6, 8, 10, 12, 20];
            diceTypes.forEach((sides) => {
                const btn = diceButtonsContainer.createEl('button', {
                    text: `d${sides}`,
                    cls: 'dh-dice-button',
                });
                btn.title = `Left-click to add 1d${sides}.\nRight-click to remove 1d${sides}.`;
                btn.addEventListener('click', () => this.addFormulaPart(`1d${sides}`));
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.removeFormulaPart(`d${sides}`);
                });
            });

            const mainControlsGrid = controlsWrapper.createDiv({ cls: 'dh-main-controls-grid' });

            const dualityBtn = mainControlsGrid.createEl('button', {
                text: 'Duality',
                cls: 'dh-duality-button',
            });
            dualityBtn.title = 'Setup a Duality Roll (dr)';
            dualityBtn.addEventListener('click', () => {
                this.setFormula('dr', 'Duality Roll');
            });

            const advDisContainer = mainControlsGrid.createDiv({ cls: 'dh-adv-dis-container' });
            const advBtn = advDisContainer.createEl('button', {
                cls: 'dh-adv-dis-button dh-advantage-button',
            });
            setIcon(advBtn, 'dice');
            advBtn.title = 'Add Advantage (+1d6)';
            advBtn.addEventListener('click', () => this.addFormulaPart('+1d6'));
            advBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.removeFormulaPart('d6');
            });

            const disBtn = advDisContainer.createEl('button', {
                cls: 'dh-adv-dis-button dh-disadvantage-button',
            });
            setIcon(disBtn, 'dice');
            disBtn.title = 'Add Disadvantage (-1d6)';
            disBtn.addEventListener('click', () => this.addFormulaPart('-1d6'));
            disBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.removeFormulaPart('d6');
            });

            this.formulaInput = mainControlsGrid.createEl('input', {
                type: 'text',
                cls: 'dh-dice-tray-input',
            });
            this.formulaInput.placeholder = 'e.g., dr, 2d6+3';
            this.formulaInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.rollFromInput();
            });

            const stepperWrapper = mainControlsGrid.createDiv({ cls: 'dh-stepper-wrapper' });
            const downBtn = stepperWrapper.createEl('button', { text: '−' });
            this.modifierInput = stepperWrapper.createEl('input', { type: 'number', value: '0' });
            const upBtn = stepperWrapper.createEl('button', { text: '+' });

            downBtn.addEventListener('click', () => {
                this.modifierInput.stepDown();
            });
            upBtn.addEventListener('click', () => {
                this.modifierInput.stepUp();
            });

            const buttonRow = controlsWrapper.createDiv({ cls: 'dh-button-row' });
            const rollBtn = buttonRow.createEl('button', { text: 'Roll' });
            rollBtn.addEventListener('click', () => this.rollFromInput());

            if (this.plugin.settings.diceProvider === 'dddice') {
                const hiddenRollBtn = buttonRow.createEl('button', { cls: 'dh-icon-button' });
                setIcon(hiddenRollBtn, 'eye-off');
                hiddenRollBtn.title = 'Roll hidden from other players';
                hiddenRollBtn.addEventListener('click', () => this.rollFromInput(true));
                buttonRow.addClass('has-hidden-button');
            }

            // IMPROVEMENT: Changed Clear button to use an icon
            const clearBtn = buttonRow.createEl('button', { cls: 'dh-icon-button' });
            setIcon(clearBtn, 'brush-cleaning');
            clearBtn.title = 'Clear input';
            clearBtn.addEventListener('click', () => {
                if (this.formulaInput) this.formulaInput.value = '';
                if (this.modifierInput) this.modifierInput.value = '0';
                this.formulaContext = null;
            });
        }
    }

    private handleNewRoll = (payload: RollCompletedPayload) => {
        const existingIndex = this.rolls.findIndex((r) => r.id === payload.rollId);

        if (existingIndex !== -1) {
            const updatedRoll = {
                ...this.rolls[existingIndex],
                ...payload,
                id: payload.rollId as string,
            };
            this.rolls[existingIndex] = updatedRoll;
        } else {
            const newRoll: RollHistoryEntry = {
                id: payload.rollId || String(Date.now()),
                ...payload,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            this.rolls.unshift(newRoll);
        }

        if (this.rolls.length > 20) this.rolls.pop();
        this.renderHistory();

        if (!this.manuallyOpened && existingIndex === -1) {
            this.showHistoryTemporarily();
        }
    };

    private showHistoryTemporarily() {
        if (!this.trayContainer || !this.trayButton) return;
        if (this.autoHideTimer) clearTimeout(this.autoHideTimer);

        this.isOpen = true;
        this.trayContainer.addClass('is-history-only');
        this.trayContainer.style.display = 'flex';
        this.trayButton.removeClass('is-active');

        this.autoHideTimer = window.setTimeout(() => this.hide(), 5000);
    }

    private async rollFromInput(isHidden: boolean = false) {
        if (!this.formulaInput || !this.modifierInput) return;
        let formula = this.formulaInput.value.trim();
        const modifier = parseInt(this.modifierInput.value, 10) || 0;

        if (!formula && modifier === 0) return;

        if (modifier !== 0) {
            formula = `${formula} ${modifier > 0 ? '+' : ''}${modifier}`.trim();
        }

        const context = this.formulaContext || 'Tray Roll';
        const result = await this.plugin.rollDice(formula, context, undefined, isHidden);

        if (result !== null) {
            this.formulaInput.value = '';
            this.modifierInput.value = '0';
            this.formulaContext = null;
        }
    }

    private async checkForRollUpdate(rollId: string, buttonEl: HTMLElement) {
        if (!rollId) return;

        setIcon(buttonEl, 'loader-circle');

        const updatedRollData = await dddice.getRoll(rollId);

        if (updatedRollData) {
            const isStillHidden = updatedRollData.values.some((v) => v.is_hidden);

            if (!isStillHidden) {
                // The roll has been revealed. Process it and update the history.
                let isDaggerheartActionRoll =
                    updatedRollData.values.some((d) => d.label === 'Hope') &&
                    updatedRollData.values.some((d) => d.label === 'Fear');
                const d12s = updatedRollData.values.filter((d) => d.type === 'd12');
                if (!isDaggerheartActionRoll && d12s.length === 2 && d12s[0].theme !== d12s[1].theme) {
                    isDaggerheartActionRoll = true;
                    d12s[0].label = 'Hope';
                    d12s[1].label = 'Fear';
                }

                const processedResult = dddice.handleRollResult(updatedRollData, isDaggerheartActionRoll);
                const rollerName =
                    updatedRollData.room?.participants?.find((p) => p.user.uuid === updatedRollData.user?.uuid)
                        ?.username ||
                    updatedRollData.user?.username ||
                    'Unknown Roller';

                const payload: RollCompletedPayload = {
                    rollerName,
                    context: updatedRollData.label || 'External Roll',
                    result: processedResult.display,
                    total: processedResult.totalStr,
                    outcome: processedResult.outcome,
                    structuredResult: processedResult.structuredResult,
                    rollId: processedResult.rollId,
                    userUUID: processedResult.userUUID,
                    diceUUIDs: processedResult.diceUUIDs,
                    hiddenRolls: processedResult.hiddenRolls,
                    isModifierHidden: processedResult.isModifierHidden,
                };
                this.plugin.app.workspace.trigger('daggerheart-roll-completed', payload);
            } else {
                new Notice('Roll has not been revealed yet.');
                setIcon(buttonEl, 'refresh-cw');
            }
        } else {
            new Notice('Could not retrieve roll update.');
            setIcon(buttonEl, 'refresh-cw');
        }
    }

    private renderHistory() {
        if (!this.historyContainer) return;
        this.historyContainer.empty();
        this.rolls.forEach((roll) => {
            const entryEl = this.historyContainer.createDiv({ cls: 'dh-history-entry' });

            const currentUserUuid = dddice.getCurrentUserUuid();
            const isOwnRoll = !!(currentUserUuid && roll.userUUID && currentUserUuid === roll.userUUID);
            const hasHiddenComponents =
                (roll.hiddenRolls && roll.hiddenRolls.some((h) => h)) || !!roll.isModifierHidden;
            const shouldObscure = !isOwnRoll && hasHiddenComponents;

            const header = entryEl.createDiv({ cls: 'dh-history-header' });

            const contextSpan = header.createSpan({ cls: 'dh-history-context' });
            if (roll.rollerName) {
                contextSpan.createEl('strong', { text: `${roll.rollerName}` });
                contextSpan.appendText(`: ${roll.context}`);
            } else {
                contextSpan.setText(roll.context);
            }

            const controlsContainer = header.createSpan({ cls: 'dh-history-controls' });
            if (hasHiddenComponents && roll.rollId) {
                if (isOwnRoll && roll.diceUUIDs) {
                    // Own roll, show REVEAL button
                    const revealDiv = controlsContainer.createEl('div', { cls: 'dh-reveal-button' });
                    setIcon(revealDiv, 'eye');
                    revealDiv.title = 'Reveal roll to all players';
                    revealDiv.addEventListener('click', () => {
                        revealDiv.style.display = 'none'; // Hide button immediately
                        dddice.revealRoll(roll.rollId!, roll.diceUUIDs!);
                    });
                } else if (!isOwnRoll) {
                    // External roll, show REFRESH button
                    const refreshDiv = controlsContainer.createEl('div', { cls: 'dh-reveal-button' });
                    setIcon(refreshDiv, 'refresh-cw');
                    refreshDiv.title = 'Check if roll has been revealed';
                    refreshDiv.addEventListener('click', () => {
                        this.checkForRollUpdate(roll.rollId!, refreshDiv);
                    });
                }
            }
            controlsContainer.createSpan({ text: roll.timestamp, cls: 'dh-history-timestamp' });

            const body = entryEl.createDiv({ cls: 'dh-history-body' });

            if (roll.structuredResult && roll.structuredResult.length > 0) {
                const equationContainer = body.createDiv({ cls: 'dh-history-equation' });
                roll.structuredResult.forEach((component, index) => {
                    if (index > 0) {
                        const operator = component.value < 0 ? '−' : '+';
                        equationContainer.createSpan({ cls: 'dh-roll-operator', text: operator });
                    }
                    if (index === 0 && component.value < 0) {
                        equationContainer.createSpan({ cls: 'dh-roll-operator', text: '−' });
                    }

                    equationContainer.createSpan({
                        cls: `dh-roll-value ${component.type}`,
                        text: shouldObscure ? '?' : String(Math.abs(component.value)),
                        attr: { title: component.label },
                    });
                });

                const totalContainer = body.createDiv({ cls: 'dh-history-total-container' });
                totalContainer.createSpan({ cls: 'dh-history-equals', text: '=' });
                totalContainer.createSpan({
                    text: shouldObscure ? '?' : roll.total,
                    cls: 'dh-history-total',
                });

                if (roll.outcome && !shouldObscure) {
                    const outcomeClass = roll.outcome.toLowerCase().replace(/\s/g, '-').replace('!', '');
                    totalContainer.createSpan({
                        text: roll.outcome,
                        cls: `dh-history-outcome ${outcomeClass}`,
                    });
                }
            } else {
                if (shouldObscure) {
                    body.createSpan({
                        cls: 'dh-history-result',
                    }).innerHTML = `<span>Hidden Roll</span> = <strong class="dh-history-total">?</strong>`;
                } else {
                    const resultHtml = `<span>${roll.result || ''}</span> = <strong class="dh-history-total">${roll.total || ''}</strong>`;
                    body.createSpan({ cls: 'dh-history-result' }).innerHTML = resultHtml;
                }
            }
        });
    }

    public setFormula(formula: string, context: string, modifier?: number) {
        if (!this.formulaInput || !this.modifierInput) return;
        this.formulaInput.value = formula;
        this.modifierInput.value = String(modifier ?? 0);
        this.formulaContext = context;
        this.show();
        this.formulaInput.focus();
    }

    private removeFormulaPart(dieToRemove: string) {
        if (!this.formulaInput) return;

        let formula = this.formulaInput.value.trim();
        if (!formula) return;

        const matchResult = dieToRemove.match(/d(\d+)/);
        if (!matchResult) return;
        const dieFace = matchResult[1];

        const searchRegex = new RegExp(`(\\d*)d${dieFace}\\b`, 'g');
        const matches = [...formula.matchAll(searchRegex)];

        if (matches.length === 0) return;

        const lastMatch = matches[matches.length - 1];
        const termString = lastMatch[0];
        const termIndex = lastMatch.index ?? 0;
        const count = lastMatch[1] ? parseInt(lastMatch[1], 10) : 1;

        if (count > 1) {
            const newTerm = `${count - 1}d${dieFace}`;
            formula = formula.substring(0, termIndex) + newTerm + formula.substring(termIndex + termString.length);
        } else {
            let startIndex = termIndex;
            let operatorSearchIndex = termIndex - 1;
            while (operatorSearchIndex >= 0 && /\s/.test(formula.charAt(operatorSearchIndex))) {
                operatorSearchIndex--;
            }
            if (
                operatorSearchIndex >= 0 &&
                (formula.charAt(operatorSearchIndex) === '+' || formula.charAt(operatorSearchIndex) === '-')
            ) {
                startIndex = operatorSearchIndex;
                while (startIndex > 0 && /\s/.test(formula.charAt(startIndex - 1))) {
                    startIndex--;
                }
            }
            formula = formula.substring(0, startIndex) + formula.substring(termIndex + termString.length);
        }

        this.formulaInput.value = formula.trim();
        this.formulaInput.focus();
    }

    private addFormulaPart(formulaPart: string) {
        if (!this.formulaInput) return;

        const existing = this.formulaInput.value.trim();

        if (formulaPart.startsWith('+') || formulaPart.startsWith('-')) {
            this.formulaInput.value = `${existing} ${formulaPart}`.trim();
            this.show();
            this.formulaInput.focus();
            return;
        }

        if (existing === '') {
            this.formulaInput.value = formulaPart;
            this.show();
            this.formulaInput.focus();
            return;
        }

        const terms = existing.split(/\s*[+-]\s*/);
        const lastTerm = terms[terms.length - 1];
        const dieMatch = lastTerm.match(/^(\d*)d(\d+)$/);
        const newDieMatch = formulaPart.match(/^(\d*)d(\d+)$/);

        if (dieMatch && newDieMatch && dieMatch[2] === newDieMatch[2]) {
            const currentCount = dieMatch[1] ? parseInt(dieMatch[1], 10) : 1;
            const newCount = currentCount + 1;
            const newLastTerm = `${newCount}d${dieMatch[2]}`;

            const newFormula = existing.substring(0, existing.lastIndexOf(lastTerm)) + newLastTerm;
            this.formulaInput.value = newFormula;
        } else {
            this.formulaInput.value = /[+-]$/.test(existing.slice(-1))
                ? `${existing} ${formulaPart}`
                : `${existing} + ${formulaPart}`;
        }

        this.show();
        this.formulaInput.focus();
    }

    public addModifier(value: number) {
        if (!this.modifierInput) return;

        const currentModifier = parseInt(this.modifierInput.value, 10) || 0;
        const newModifier = currentModifier + value;
        this.modifierInput.value = String(newModifier);

        this.show();
        this.modifierInput.focus();
    }

    public toggle() {
        if (!this.trayContainer || !this.trayButton || !this.formulaInput) return;

        if (this.isOpen && this.manuallyOpened) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show() {
        if (!this.trayContainer || !this.trayButton || !this.formulaInput) return;

        if (this.autoHideTimer) {
            clearTimeout(this.autoHideTimer);
            this.autoHideTimer = null;
        }

        this.isOpen = true;
        this.manuallyOpened = true;

        this.trayContainer.removeClass('is-history-only');
        this.trayContainer.style.display = 'flex';
        this.trayButton.addClass('is-active');
        this.formulaInput.focus();
    }

    public hide() {
        if (!this.trayContainer || !this.trayButton) return;

        if (this.autoHideTimer) {
            clearTimeout(this.autoHideTimer);
            this.autoHideTimer = null;
        }

        this.isOpen = false;
        this.manuallyOpened = false;

        this.trayContainer.style.display = 'none';
        this.trayButton.removeClass('is-active');
    }

    public unload() {
        this.trayButton?.remove();
        this.trayContainer?.remove();
        this.plugin.app.workspace.off(
            'daggerheart-roll-completed',
            this.handleNewRoll as (...data: unknown[]) => unknown,
        );
    }
}
