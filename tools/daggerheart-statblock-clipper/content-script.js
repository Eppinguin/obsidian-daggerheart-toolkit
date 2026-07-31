(() => {
  'use strict';
  if (globalThis.__DH_STATBLOCK_CLIPPER_LOADED__) return;
  globalThis.__DH_STATBLOCK_CLIPPER_LOADED__ = true;

  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  const storage = globalThis.browser?.storage || globalThis.chrome?.storage;

  function toast(message, isError = false) {
    const existing = document.getElementById('__dh_clipper_toast');
    existing?.remove();
    const node = document.createElement('div');
    node.id = '__dh_clipper_toast';
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed',
      zIndex: '2147483647',
      right: '18px',
      bottom: '18px',
      maxWidth: '360px',
      padding: '12px 14px',
      borderRadius: '8px',
      background: isError ? '#5b1f1f' : '#1f2937',
      color: '#fff',
      boxShadow: '0 8px 30px rgba(0,0,0,.3)',
      font: '13px/1.4 system-ui, sans-serif'
    });
    document.documentElement.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function autoExtract() {
    return globalThis.DHStatblockParser.parseManyFromDocument(document, location);
  }

  function startSelection() {
    let hovered = null;
    const previous = new Map();

    const onMove = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || target === hovered || target.id === '__dh_clipper_toast') return;
      if (hovered) {
        hovered.style.outline = previous.get(hovered)?.outline || '';
        hovered.style.cursor = previous.get(hovered)?.cursor || '';
      }
      hovered = target;
      previous.set(target, { outline: target.style.outline, cursor: target.style.cursor });
      target.style.outline = '3px solid #8b5cf6';
      target.style.cursor = 'crosshair';
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (hovered) {
        hovered.style.outline = previous.get(hovered)?.outline || '';
        hovered.style.cursor = previous.get(hovered)?.cursor || '';
      }
    };

    const onClick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const clicked = hovered || event.target;
      const target = clicked.closest?.('[role="dialog"],dialog,article,[class*="modal"],[class*="drawer"],[class*="statblock"],[class*="stat-block"]') || clicked;
      cleanup();
      try {
        const items = globalThis.DHStatblockParser.parseManyFromDocument(document, location, target);
        await storage.local.set({ lastExtractions: items, lastExtractionUrl: location.href, lastExtractionManual: true });
        toast(items.length === 1 ? `Captured: ${items[0].name || 'statblock'}. Reopen the extension.` : `Captured ${items.length} statblocks. Reopen the extension.`);
      } catch (error) {
        toast(`Could not parse selection: ${error.message}`, true);
      }
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        cleanup();
        toast('Selection cancelled.');
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    toast('Click one statblock or a container holding several. Press Esc to cancel.');
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'DH_EXTRACT') {
      try {
        sendResponse({ ok: true, items: autoExtract() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }
    if (message?.type === 'DH_SELECT') {
      startSelection();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
