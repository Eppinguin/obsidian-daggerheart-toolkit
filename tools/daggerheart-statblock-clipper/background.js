(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const PENDING_KEY = 'dhPendingObsidianLaunch';
  const MAX_AGE_MS = 10 * 60 * 1000;
  const storage = api.storage.session || api.storage.local;

  async function getPending() {
    const result = await storage.get(PENDING_KEY);
    const pending = result?.[PENDING_KEY] || null;
    if (!pending) return null;
    if (Date.now() - Number(pending.createdAt || 0) > MAX_AGE_MS) {
      await storage.remove(PENDING_KEY);
      return null;
    }
    return pending;
  }

  async function setPending(pending) {
    await storage.set({ [PENDING_KEY]: pending });
  }

  async function clearPending() {
    await storage.remove(PENDING_KEY);
  }

  async function restoreSourceTab(pending, closeLaunchTab = true) {
    if (!pending) return;
    await clearPending();

    try {
      await api.tabs.update(pending.sourceTabId, { active: true });
      if (Number.isInteger(pending.sourceWindowId)) {
        await api.windows.update(pending.sourceWindowId, { focused: true });
      }
    } catch (_error) {
      // The source tab or window may have been closed while Obsidian was active.
    }

    if (closeLaunchTab && Number.isInteger(pending.launchTabId) && pending.launchTabId !== pending.sourceTabId) {
      try { await api.tabs.remove(pending.launchTabId); } catch (_error) { /* already closed */ }
    }
  }

  async function launchExternalUri(message) {
    const sourceTabId = Number(message.sourceTabId);
    const sourceWindowId = Number(message.sourceWindowId);
    if (!Number.isInteger(sourceTabId)) throw new Error('The source browser tab is unavailable.');

    const launchTab = await api.tabs.create({
      url: String(message.uri),
      active: true,
      ...(Number.isInteger(sourceWindowId) ? { windowId: sourceWindowId } : {})
    });

    await setPending({
      sourceTabId,
      sourceWindowId: Number.isInteger(sourceWindowId) ? sourceWindowId : launchTab.windowId,
      launchTabId: launchTab.id,
      sawBrowserBlur: false,
      createdAt: Date.now()
    });

    return launchTab;
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DH_OPEN_EXTERNAL_URI') return false;
    launchExternalUri(message)
      .then(tab => sendResponse({ ok: true, launchTabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });

  api.windows.onFocusChanged.addListener(async windowId => {
    const pending = await getPending();
    if (!pending) return;

    if (windowId === api.windows.WINDOW_ID_NONE) {
      if (!pending.sawBrowserBlur) await setPending({ ...pending, sawBrowserBlur: true });
      return;
    }

    if (pending.sawBrowserBlur) await restoreSourceTab(pending, true);
  });

  api.tabs.onRemoved.addListener(async tabId => {
    const pending = await getPending();
    if (!pending || tabId !== pending.launchTabId) return;
    await restoreSourceTab(pending, false);
  });
})();
