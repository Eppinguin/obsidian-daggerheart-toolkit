(() => {
  'use strict';

  const base = globalThis.DHStatblockParser;
  if (!base || base.__heartOfDaggersFilter) return;

  const clean = (value) => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const textLines = (value) => String(value ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map(clean)
    .filter(Boolean);

  const ROLES = '(?:Bruiser|Horde|Leader|Minion|Ranged|Skulk|Social|Solo|Standard|Support|Traversal|Event|Exploration)';
  const COMPACT_TIER = new RegExp(`^Tier\\s+\\d+\\s+${ROLES}\\b`, 'i');
  const ATTRIBUTION_TITLE = new RegExp(
    '^(?:' +
      'this\\s+is\\s+(?:an?\\s+)?(?:conversion|adaptation|port|rework)\\b|' +
      'this\\s+(?:adversary|environment|statblock|homebrew)\\s+(?:is|was|has)\\b|' +
      '(?:a\\s+)?(?:conversion|adaptation|port|rework)\\s+of\\b|' +
      '(?:image|art|artwork|illustration|credit|credits|license|source)\\s+(?:is|by|from|credit|credits)?\\b|' +
      '(?:cc|creative\\s+commons)[-\\s]?(?:by|by-sa|zero|0)?\\b|' +
      '(?:based|adapted|converted|ported)\\s+(?:on|from)\\b|' +
      '(?:original(?:ly)?|created|written|designed)\\s+by\\b|' +
      'u\\/|r\\/|https?:\\/\\/' +
    ')',
    'i'
  );
  const ATTRIBUTION_CONTENT = /\b(?:from\s+reddit|on\s+reddit|image\s+is\s+cc|cc[-\s]?by(?:-sa)?(?:-\d(?:\.\d)?)?|creative\s+commons|attribution\s+license|licensed\s+under)\b/i;

  function attributionTitle(value) {
    const title = clean(value);
    if (!title) return true;
    if (ATTRIBUTION_TITLE.test(title) || ATTRIBUTION_CONTENT.test(title)) return true;
    return title.split(/\s+/).length > 20 && /[.!?]/.test(title);
  }

  function completeHeartOfDaggersItem(item) {
    if (!item || typeof item !== 'object') return false;
    const name = clean(item.name);
    const type = clean(item.type);
    if (!name || name.length > 140 || attributionTitle(name)) return false;
    if (item.tier == null || item.difficulty == null || !type) return false;

    const adversaryCore = item.hp != null && item.stress != null;
    const environmentCore = Boolean(clean(item.impulses) || clean(item.adversaries) || clean(item.tone));
    return adversaryCore || environmentCore;
  }

  function isHeartOfDaggers(location) {
    return /^(?:www\.)?heartofdaggers\.com$/i.test(location?.hostname || '');
  }

  function visible(element) {
    if (!element) return false;
    if (typeof getComputedStyle !== 'function' || !element.getBoundingClientRect) return true;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 160 && rect.height > 100;
  }

  function renderedCardSignature(value) {
    const lines = textLines(value);
    if (!lines.some((line) => COMPACT_TIER.test(line))) return false;
    if (!lines.some((line) => /^Features$/i.test(line))) return false;

    const adversaryStats = lines.some((line) =>
      /\bDifficulty\s*:\s*\d+/i.test(line) &&
      /\bHP\s*:\s*\d+/i.test(line) &&
      /\bStress\s*:\s*\d+/i.test(line)
    );
    const adversaryAttack = lines.some((line) => /^ATK\s*:\s*[+−-]?\d+\s*\|/i.test(line));
    const environmentStats = lines.some((line) => /^Difficulty\s*:\s*\d+\b/i.test(line)) &&
      lines.some((line) => /^(?:Impulses|Potential Adversaries)\s*:/i.test(line));

    return (adversaryStats && adversaryAttack) || environmentStats;
  }

  function documentOrder(a, b) {
    if (a === b || typeof Node === 'undefined' || !a?.compareDocumentPosition) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function renderedCardRoots(doc, selected = null) {
    const scope = selected || doc?.body || doc?.documentElement || doc;
    if (!scope) return [];
    const all = [scope, ...Array.from(scope.querySelectorAll?.('*') || [])];
    const candidates = all.filter((element) => visible(element) && renderedCardSignature(element.innerText || element.textContent || ''));

    const smallest = candidates.filter((candidate) =>
      !candidates.some((other) => other !== candidate && candidate.contains?.(other))
    );
    return smallest.sort(documentOrder);
  }

  function filterHeartOfDaggersItems(items, location) {
    const input = Array.isArray(items) ? items : [];
    if (!isHeartOfDaggers(location)) return input;
    const seen = new Set();
    return input.filter(completeHeartOfDaggersItem).filter((item) => {
      const key = `${clean(item.name).toLowerCase()}|${item.tier ?? ''}|${clean(item.type).toLowerCase()}|${item.difficulty ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const originalMany = base.parseManyFromDocument;
  function parseManyFromDocument(doc, location, selected = null) {
    if (!isHeartOfDaggers(location)) {
      return typeof originalMany === 'function' ? originalMany(doc, location, selected) : [];
    }

    const roots = renderedCardRoots(doc, selected);
    const parsed = roots.length && typeof originalMany === 'function'
      ? roots.flatMap((root) => originalMany(doc, location, root))
      : (typeof originalMany === 'function' ? originalMany(doc, location, selected) : []);
    return filterHeartOfDaggersItems(parsed, location);
  }

  globalThis.DHStatblockParser = {
    ...base,
    __heartOfDaggersFilter: true,
    attributionTitle,
    completeHeartOfDaggersItem,
    renderedCardSignature,
    renderedCardRoots,
    filterHeartOfDaggersItems,
    parseManyFromDocument,
    parseFromDocument: (doc, location, selected) => parseManyFromDocument(doc, location, selected)[0]
  };
})();
