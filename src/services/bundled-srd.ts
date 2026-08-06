import adversaries from '../../data/adversaries.json';
import environments from '../../data/environments.json';

/**
 * The installer and BRAT only fetch the plugin's generated root artifacts, so
 * SRD JSON must enter the bundle as its array value rather than be read from a
 * data directory at runtime.
 */
const BUNDLED_SRD: Record<string, unknown[]> = {
    'adversaries.json': adversaries,
    'environments.json': environments,
};

export function getBundledSrd<T>(fileName: string): T[] | undefined {
    return BUNDLED_SRD[fileName] as T[] | undefined;
}
