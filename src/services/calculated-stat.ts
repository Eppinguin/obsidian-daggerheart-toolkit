import { Character, ICalculatedStat, IModifier } from '../types';

// Utility from the original effects-engine.ts, still useful here.
function getProperty(obj: any, path: string): any {
    return path.split('.').reduce((o, key) => (o && o[key] !== 'undefined' ? o[key] : undefined), obj);
}

// The production-ready implementation of a smart stat.
export class CalculatedStat implements ICalculatedStat {
    public base: number;
    public overrideValue: number | null = null;
    public locked?: boolean = false;

    private _modifiers: IModifier[] = [];

    constructor(baseValue: number = 0) {
        this.base = baseValue;
    }

    public addModifier(modifier: IModifier): void {
        this._modifiers.push(modifier);
    }

    public removeModifiersBySource(sourceId: string): void {
        this._modifiers = this._modifiers.filter(m => m.sourceId !== sourceId);
    }

    private _isConditionMet(modifier: IModifier, characterContext: Character): boolean {
        if (!modifier.condition) {
            return true;
        }
        const { target, operator, value } = modifier.condition;
        // Important: getProperty is now used on the characterContext passed to the function.
        const characterValue = getProperty(characterContext, target);

        if (characterValue === undefined) {
            return false;
        }

        // This logic is borrowed from the original checkCondition function.
        switch (operator) {
            case 'equals': return characterValue === value;
            case 'notEquals': return characterValue !== value;
            case 'greaterThan': return characterValue > value;
            case 'lessThan': return characterValue < value;
            case 'greaterThanOrEqual': return characterValue >= value;
            case 'lessThanOrEqual': return characterValue <= value;
            case 'hasCondition':
                return Array.isArray(characterValue) ? characterValue.some(c => c.name === value) : false;
            default: return false;
        }
    }

    public getValue(characterContext: Character): number {
        if (this.overrideValue !== null) {
            return this.overrideValue;
        }

        let finalValue = this.base;
        let effectOverride: number | null = null;

        for (const modifier of this._modifiers) {
            if (!this._isConditionMet(modifier, characterContext)) {
                continue;
            }

            switch (modifier.type) {
                case 'bonus':
                case '+':
                    finalValue += modifier.value;
                    break;
                case 'penalty':
                case '-':
                    finalValue -= modifier.value;
                    break;
                case 'override':
                case '=':
                    effectOverride = modifier.value;
                    break;
            }
        }

        return effectOverride !== null ? effectOverride : finalValue;
    }

    public getBreakdown(characterContext: Character): { base: number; final: number; activeModifiers: IModifier[]; } {
        const activeModifiers = this._modifiers.filter(m => this._isConditionMet(m, characterContext));

        let finalValue = this.base;
        let overrideValue: number | null = null;

        for (const modifier of activeModifiers) {
            // --- FIX STARTS HERE ---
            switch (modifier.type) {
                case 'bonus':
                case '+': // Handle symbol
                    finalValue += modifier.value;
                    break;
                case 'penalty':
                case '-': // Handle symbol
                    finalValue -= modifier.value;
                    break;
                case 'override':
                case '=': // Handle symbol
                    overrideValue = modifier.value;
                    break;
            }
            // --- FIX ENDS HERE ---
        }

        return {
            base: this.base,
            final: overrideValue !== null ? overrideValue : finalValue,
            activeModifiers: activeModifiers
        };
    }
}