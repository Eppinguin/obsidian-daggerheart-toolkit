(() => {
  'use strict';

  const base = globalThis.DHStatblockParser;
  if (!base || base.__heartOfDaggersFilter) return;

  const clean = (value) => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  function filterHeartOfDaggersItems(items, location) {
    const input = Array.isArray(items) ? items : [];
    if (!/^(?:www\.)?heartofdaggers\.com$/i.test(location?.hostname || '')) return input;
    return input.filter(completeHeartOfDaggersItem);
  }

  const originalMany = base.parseManyFromDocument;
  function parseManyFromDocument(doc, location, selected = null) {
    const items = typeof originalMany === 'function'
      ? originalMany(doc, location, selected)
      : [];
    return filterHeartOfDaggersItems(items, location);
  }

  globalThis.DHStatblockParser = {
    ...base,
    __heartOfDaggersFilter: true,
    attributionTitle,
    completeHeartOfDaggersItem,
    filterHeartOfDaggersItems,
    parseManyFromDocument,
    parseFromDocument: (doc, location, selected) => parseManyFromDocument(doc, location, selected)[0]
  };
})();
