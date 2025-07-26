import { Modification } from "src/types";
// @ts-ignore - This tells TypeScript to ignore the fact that it can't find the .pegjs file,
// as esbuild will handle the conversion during the build process.
import * as parser from './effect-parser.pegjs';

/**
 * Represents the structured output of a successfully parsed effect string.
 * This should align with the EffectBlueprint interface you will create.
 */
export interface ParsedEffect extends Modification {
    // The parser directly outputs objects that match the Modification interface.
    // You can extend this if the parser's output needs to be different.
}

/**
 * Parses a human-readable effect string into an array of structured Effect objects.
 * @param effectString The string to parse, e.g., "Evasion + 1 when HP < 10".
 * @returns An array of ParsedEffect objects.
 * @throws An error if the syntax of the effectString is invalid.
 */
export function parseEffect(effectString: string): ParsedEffect[] {
    if (!effectString || effectString.trim() === '') {
        return [];
    }

    try {
        // The parser.parse function will throw an error on invalid syntax.
        const parsedResult = parser.parse(effectString.trim());
        // The root of our grammar returns an array of modifications.
        return parsedResult as ParsedEffect[];
    } catch (error) {
        console.error("Daggerheart Effect Parser Error:", error.message);
        // You could add more user-friendly error handling here,
        // for example, returning a specific error object or showing a notification.
        throw new Error(`Invalid effect syntax: "${effectString}". Please check the grammar rules.`);
    }
}

/**
 * Example Usage:
 *
 * try {
 * const effects = parseEffect('Weapon "Longsword": Damage + 2 when HP < 10, Armor Score + 1');
 * console.log(effects);
 * // This would output an array with two effect objects.
 * } catch (e) {
 * console.error(e.message);
 * }
 */
