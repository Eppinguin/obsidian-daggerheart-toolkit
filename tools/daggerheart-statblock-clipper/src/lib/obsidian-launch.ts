/** Opens `obsidian://` URIs through the background worker.
 *
 * The legacy build did this by reassigning `api.tabs.create` at load time
 * (`statblock-format-adapter.js`), so every caller was silently rerouted and
 * the behavior was invisible at the call site — and it needed a try/catch for
 * browsers where the method is not writable. Callers now opt in explicitly.
 *
 * The background worker owns the handoff because the popup window is torn down
 * the moment focus leaves it, which can race the navigation that triggers the
 * protocol prompt.
 */
import type { LaunchResponse } from '../types';
import { api } from './browser';

export async function openObsidianUri(uri: string): Promise<void> {
    if (!/^obsidian:\/\//i.test(uri)) throw new Error(`Refusing to launch a non-Obsidian URI: ${uri}`);

    const [sourceTab] = await api.tabs.query({ active: true, currentWindow: true });
    const response = (await api.runtime.sendMessage({
        type: 'DH_OPEN_EXTERNAL_URI',
        uri,
        sourceTabId: sourceTab?.id,
    })) as LaunchResponse | undefined;

    if (!response?.ok) throw new Error(response?.error || 'Could not open Obsidian.');
}
