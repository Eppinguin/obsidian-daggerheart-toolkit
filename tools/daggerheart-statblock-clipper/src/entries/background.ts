/** Background worker: hands the Obsidian protocol URI to the OS.
 *
 * Ported from the former `background.js`. The listener stays at the top level:
 * under Firefox's non-persistent MV3 event page the script can be unloaded at
 * any time, and only top-level registration survives that.
 *
 * The handoff navigates the *source tab* to the `obsidian://` URI rather than
 * opening a new one. The browser routes an external protocol to the OS without
 * committing a navigation, so the tab keeps its page and the "Open Obsidian?"
 * prompt appears over the page the user was clipping.
 *
 * This replaces a `tabs.create` handoff that opened a blank launch tab, then
 * tracked a pending-launch record in `storage.session` and watched
 * `windows.onFocusChanged` / `tabs.onRemoved` to close that tab and re-focus
 * the source tab once the user came back. None of that bookkeeping is needed
 * when no tab is created, and it was the part most exposed to the event-page
 * unload described above.
 */
import { api } from '../lib/browser';

async function launchExternalUri(message: { uri: string; sourceTabId?: number }): Promise<void> {
    const sourceTabId = Number(message.sourceTabId);
    if (!Number.isInteger(sourceTabId)) throw new Error('The source browser tab is unavailable.');

    await api.tabs.update(sourceTabId, { url: String(message.uri) });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DH_OPEN_EXTERNAL_URI') return false;
    launchExternalUri(message)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
});
