/** The writable folder shipped plugin assets deliberately do not contain. */
export const USER_DATA_FOLDER = 'user_data';

/** The subset of Obsidian's vault adapter needed by user-data writers. */
export interface UserDataAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
}

export function userDataFolderPath(pluginDir: string | undefined): string {
    if (!pluginDir) throw new Error('Plugin directory is unavailable; cannot persist user data.');
    return `${pluginDir}/${USER_DATA_FOLDER}`;
}

/**
 * Establish the parent directory before any feature writes into it.
 *
 * A development checkout usually already has this gitignored directory, while
 * a release install only contains the packaged assets. Keeping creation at the
 * shared storage boundary prevents clean installs from failing their first
 * encounter or custom-content save.
 */
export async function ensureUserDataFolder(adapter: UserDataAdapter, pluginDir: string | undefined): Promise<string> {
    const folder = userDataFolderPath(pluginDir);
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
    return folder;
}

export async function writeUserDataJson(
    adapter: UserDataAdapter,
    pluginDir: string | undefined,
    fileName: string,
    value: unknown,
): Promise<void> {
    const folder = await ensureUserDataFolder(adapter, pluginDir);
    await adapter.write(`${folder}/${fileName}`, JSON.stringify(value, null, 2));
}
