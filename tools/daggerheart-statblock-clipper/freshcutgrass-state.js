(() => {
  'use strict';

  /**
   * Runs in the page's MAIN world through chrome.scripting.executeScript.
   * It only returns small JSON-safe candidates that resemble Daggerheart
   * statblocks. No account data, cookies, or arbitrary application state are
   * returned.
   */
  function collectFreshCutGrassState(targetId = '') {
    const MAX_VISITED = 50000;
    const MAX_CANDIDATES = 80;
    const MAX_COPY_DEPTH = 8;
    const seen = new WeakSet();
    const candidates = [];
    let visited = 0;

    const cleanKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const statKeys = new Set([
      'name', 'title', 'tier', 'type', 'role', 'difficulty', 'hp', 'hitpoints', 'stress',
      'thresholds', 'damagethresholds', 'major', 'majorhp', 'majorthreshold', 'severe',
      'severehp', 'severethreshold', 'attack', 'standardattack', 'attackname', 'attackmod',
      'attackmodifier', 'range', 'damage', 'damagetype', 'features', 'feats', 'abilities',
      'motivesandtactics', 'motivesandtactics', 'experience', 'experiences', 'description',
      'impulses', 'potentialadversaries'
    ]);

    function scalar(value) {
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }

    function objectScore(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
      let score = 0;
      let hasTarget = false;
      let keys;
      try { keys = Object.keys(value); } catch (_error) { return 0; }
      for (const key of keys.slice(0, 100)) {
        const normalized = cleanKey(key);
        let entry;
        try { entry = value[key]; } catch (_error) { continue; }
        if (targetId && scalar(entry) && String(entry) === targetId) hasTarget = true;
        if (!statKeys.has(normalized)) continue;
        if (normalized === 'name' || normalized === 'title') score += typeof entry === 'string' && entry.trim() ? 5 : 0;
        else if (normalized === 'features' || normalized === 'feats' || normalized === 'abilities') score += Array.isArray(entry) || (entry && typeof entry === 'object') ? 6 : 0;
        else if (normalized === 'attack' || normalized === 'standardattack') score += entry != null ? 4 : 0;
        else if (normalized === 'difficulty' || normalized === 'tier' || normalized === 'hp' || normalized === 'hitpoints' || normalized === 'stress') score += entry != null ? 2 : 0;
        else score += entry != null ? 1 : 0;
      }
      return score + (hasTarget ? 50 : 0);
    }

    function safeCopy(value, depth = 0, copied = new WeakSet()) {
      if (value == null || scalar(value)) return value;
      if (typeof value === 'bigint') return Number(value);
      if (typeof value !== 'object' || depth > MAX_COPY_DEPTH) return undefined;
      if (copied.has(value)) return undefined;
      if (typeof Node !== 'undefined' && value instanceof Node) return undefined;
      if (value === window || value === document) return undefined;
      copied.add(value);
      if (Array.isArray(value)) {
        return value.slice(0, 100).map((entry) => safeCopy(entry, depth + 1, copied)).filter((entry) => entry !== undefined);
      }
      const output = {};
      let keys;
      try { keys = Object.keys(value); } catch (_error) { return undefined; }
      for (const key of keys.slice(0, 120)) {
        if (/^(ownerDocument|parentNode|parentElement|stateNode|return|child|sibling|alternate)$/i.test(key)) continue;
        let entry;
        try { entry = value[key]; } catch (_error) { continue; }
        const copiedEntry = safeCopy(entry, depth + 1, copied);
        if (copiedEntry !== undefined) output[key] = copiedEntry;
      }
      return output;
    }

    function addCandidate(value, path, score) {
      if (candidates.length >= MAX_CANDIDATES) return;
      const copied = safeCopy(value);
      if (!copied || typeof copied !== 'object') return;
      candidates.push({ path, score, value: copied });
    }

    function walk(value, path = 'root', depth = 0, targetContext = false) {
      if (!value || typeof value !== 'object' || seen.has(value) || visited >= MAX_VISITED || depth > 16) return;
      if (typeof Node !== 'undefined' && value instanceof Node) return;
      if (value === window || value === document) return;
      seen.add(value);
      visited += 1;

      const score = objectScore(value);
      let localTarget = targetContext;
      let keys;
      try { keys = Object.keys(value); } catch (_error) { return; }
      if (targetId) {
        localTarget = localTarget || keys.some((key) => {
          try { return scalar(value[key]) && String(value[key]) === targetId; } catch (_error) { return false; }
        });
      }
      if (score >= 8 || (localTarget && score >= 3)) addCandidate(value, path, score + (localTarget ? 20 : 0));

      const preferred = ['memoizedProps', 'pendingProps', 'memoizedState', 'baseState', 'data', 'item', 'adversary', 'environment', 'homebrew', 'statblock', 'features', 'feats', 'child', 'sibling'];
      const ordered = [...new Set([...preferred.filter((key) => keys.includes(key)), ...keys])];
      for (const key of ordered.slice(0, 150)) {
        if (/^(ownerDocument|parentNode|parentElement|stateNode|return|alternate)$/i.test(key)) continue;
        let entry;
        try { entry = value[key]; } catch (_error) { continue; }
        if (entry && typeof entry === 'object') walk(entry, `${path}.${key}`, depth + 1, localTarget);
      }
    }

    const nodes = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('*')).slice(0, 10000)];
    for (const node of nodes) {
      let props;
      try { props = Object.getOwnPropertyNames(node); } catch (_error) { continue; }
      for (const prop of props) {
        if (/^__(reactProps|reactFiber|vueParentComponent|vue__|svelte)/i.test(prop)) {
          try { walk(node[prop], `dom.${prop}`); } catch (_error) { /* ignore inaccessible framework state */ }
        }
      }
    }

    const globals = ['__NEXT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__REACT_QUERY_STATE__'];
    for (const key of globals) {
      try { if (window[key]) walk(window[key], `window.${key}`); } catch (_error) { /* ignore */ }
    }

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let index = 0; index < Math.min(storage.length, 200); index += 1) {
          const key = storage.key(index);
          const raw = storage.getItem(key);
          if (!raw || raw.length > 2_000_000 || !/^[\[{]/.test(raw.trim())) continue;
          try { walk(JSON.parse(raw), `storage.${key}`); } catch (_error) { /* not JSON */ }
        }
      } catch (_error) { /* storage may be blocked */ }
    }

    candidates.sort((a, b) => b.score - a.score);
    const deduped = [];
    const signatures = new Set();
    for (const candidate of candidates) {
      let signature;
      try { signature = JSON.stringify(candidate.value).slice(0, 5000); } catch (_error) { continue; }
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      deduped.push(candidate);
      if (deduped.length >= 30) break;
    }

    return {
      targetId,
      pageTitle: document.title,
      candidates: deduped,
      resourceUrls: performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => /firebase|firestore|homebrew|adversar/i.test(url)).slice(0, 50)
    };
  }

  globalThis.DHFreshCutGrassCollector = collectFreshCutGrassState;
})();
