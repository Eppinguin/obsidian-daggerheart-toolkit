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

  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  const lines = (value) => String(value ?? '').replace(/\r/g, '').split('\n').map(clean).filter(Boolean);
  const CARD_SECTION = /^(?:motives\s*(?:&|and)\s*tactics|tone\s*(?:&|and)\s*feel|impulses|potential adversaries)\s*:?$/i;
  const CARD_STOP = /^(?:motives\s*(?:&|and)\s*tactics|tone\s*(?:&|and)\s*feel|impulses|potential adversaries|difficulty|standard attack|attack|features|experiences?|hp\s*&\s*stress|comments?)\s*:?$/i;
  const CARD_META = /^(?:tier|type|role)\s*:?$|^(?:tier\s*)?\d+$|^(?:bruiser|horde|leader|minion|ranged|skulk|social|solo|standard|support|traversal|event|exploration|environment(?:exploration|event|social|traversal)?)$/i;
  const CARD_UI = /^(?:manage|preview|edit|delete|community adversaries?\s*&\s*environments?|liked|in library|comments?)\b/i;
  const DATE_PREFIX = /^(?:\d{1,2}[\/.\-]){2}\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i;
  const ATTRIBUTION_TEXT = /\bthis\s+(?:adversary|environment)\s+was\s+made\s+by\b|\byou\s+can\s+find\s+more\s+of\b|\b(?:created|designed|submitted|uploaded)\s+by\b|https?:\/\/|\b(?:ko-fi|patreon)\.com\b/i;

  function validCardDescription(value) {
    const text = clean(value);
    if (text.length < 12 || text.split(/\s+/).length < 4) return false;
    if (/\bno comments? yet\b|\bbe the first to comment\b|\bsign in to comment\b/i.test(text)) return false;
    if (DATE_PREFIX.test(text) || ATTRIBUTION_TEXT.test(text)) return false;
    return true;
  }

  function looksLikeNextCard(linesSource, index) {
    const line = linesSource[index] || '';
    if (!line || line.length > 90 || CARD_STOP.test(line) || CARD_META.test(line) || CARD_UI.test(line)) return false;
    if (!/^[A-Z0-9][A-Z0-9 '\-–—]+$/.test(line) || line.split(/\s+/).length > 8) return false;
    const nearby = linesSource.slice(index + 1, index + 6);
    return nearby.some((entry) => CARD_META.test(entry)) && nearby.some((entry) => /^\d+$/.test(entry));
  }

  function cardDescriptionCandidatesFromText(text, name) {
    const source = lines(text);
    const wanted = clean(name).toLowerCase();
    const output = [];
    for (let start = 0; start < source.length; start += 1) {
      if (clean(source[start]).toLowerCase() !== wanted) continue;
      const parts = [];
      let stoppedBySection = false;
      for (let index = start + 1; index < source.length && index <= start + 16; index += 1) {
        const line = source[index];
        if (clean(line).toLowerCase() === wanted) break;
        if (CARD_STOP.test(line)) {
          stoppedBySection = true;
          break;
        }
        if (DATE_PREFIX.test(line) || ATTRIBUTION_TEXT.test(line)) break;
        if (parts.length && looksLikeNextCard(source, index)) break;
        if (CARD_META.test(line) || CARD_UI.test(line) || /^[+−-]?\d+(?:\s*[♡♥🔖])?$/.test(line)) continue;
        if (line.length < 3 || line.length > 800) continue;
        parts.push(line);
        if (parts.join(' ').length > 650) break;
      }
      const description = clean(parts.join(' '));
      if (!validCardDescription(description)) continue;
      let score = 0;
      if (stoppedBySection) score += 100;
      if (description.length <= 350) score += 20;
      if (/^[A-Z]/.test(description)) score += 5;
      if (/[.!?]$/.test(description)) score += 3;
      score -= Math.min(start / 1000, 2);
      output.push({ description, score, start, stoppedBySection });
    }
    const seen = new Set();
    return output.filter((entry) => {
      const key = entry.description.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => b.score - a.score || a.start - b.start || a.description.length - b.description.length);
  }

  function cardDescriptionFromText(text, name) {
    return cardDescriptionCandidatesFromText(text, name)[0]?.description || '';
  }

  function exactNameNodes(root, name) {
    if (!root?.querySelectorAll || !name) return [];
    const wanted = clean(name).toLowerCase();
    const preferred = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],[data-testid*="name"],[class*="name"],[class*="title"]'));
    const exact = preferred.filter((node) => clean(node.innerText || node.textContent).toLowerCase() === wanted);
    if (exact.length) return exact;
    return Array.from(root.querySelectorAll('*')).filter((node) => !node.children?.length && clean(node.innerText || node.textContent).toLowerCase() === wanted).slice(0, 20);
  }

  function cardContainer(root, nameNode) {
    let node = nameNode?.parentElement || null;
    let fallback = null;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      if (node !== root && root?.contains && !root.contains(node)) break;
      const text = node.innerText || node.textContent || '';
      const textLines = lines(text);
      const length = clean(text).length;
      if (length > 30 && length < 6000) {
        const cardish = node.matches?.('article,li,[role="listitem"],[data-testid*="card"],[class*="card"],[class*="tile"],[class*="preview"]');
        if (cardish && !fallback) fallback = node;
        if (textLines.some((line) => CARD_SECTION.test(line))) return node;
      }
      if (node === root) break;
    }
    return fallback;
  }

  function domCardDescription(root, name) {
    const pageText = root?.innerText || root?.textContent || '';
    const candidates = cardDescriptionCandidatesFromText(pageText, name).map((entry) => ({ ...entry, source: 'page' }));
    for (const nameNode of exactNameNodes(root, name)) {
      const card = cardContainer(root, nameNode);
      if (!card) continue;
      for (const entry of cardDescriptionCandidatesFromText(card.innerText || card.textContent || '', name)) {
        candidates.push({ ...entry, score: entry.score + 25, source: 'container' });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.start - b.start || a.description.length - b.description.length);
    return candidates[0]?.description || '';
  }

  function enrichFreshCutGrassItems(items, doc = document, currentLocation = location) {
    if (!/freshcutgrass\.app$/i.test(currentLocation?.hostname || '')) return items;
    return (Array.isArray(items) ? items : []).map((item) => {
      const description = domCardDescription(doc.body || doc.documentElement || doc, item?.name || '');
      return description ? { ...item, desc: description, __cardDescription: description } : item;
    });
  }

  globalThis.DHFreshCutGrassCardBoundary = {
    cardDescriptionCandidatesFromText,
    cardDescriptionFromText,
    domCardDescription,
    enrichFreshCutGrassItems
  };

  function autoExtract() {
    const items = globalThis.DHStatblockParser.parseManyFromDocument(document, location);
    return enrichFreshCutGrassItems(items);
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
