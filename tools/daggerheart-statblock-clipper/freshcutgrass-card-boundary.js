(() => {
  'use strict';

  const base = globalThis.DHStatblockParser;
  if (!base || base.__freshCutGrassCardBoundaryPatch) return;

  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  const INVALID = /^(?:no comments? yet(?:[.!]\s*)?(?:be the first to comment[.!]?)?|be the first to comment[.!]?|sign in to comment|log in to comment)$/i;
  const DATE_PREFIX = /^(?:\d{1,2}[\/.\-]){2}\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i;
  const ATTRIBUTION_TEXT = /\bthis\s+(?:adversary|environment)\s+was\s+made\s+by\b|\byou\s+can\s+find\s+more\s+of\b|\b(?:created|designed|submitted|uploaded)\s+by\b|https?:\/\/|\b(?:ko-fi|patreon)\.com\b/i;

  function validCardDescription(value) {
    const text = clean(value);
    return text.length >= 12 && text.split(/\s+/).length >= 4 && !INVALID.test(text) &&
      !/\bno comments? yet\b|\bbe the first to comment\b/i.test(text) && !DATE_PREFIX.test(text) && !ATTRIBUTION_TEXT.test(text);
  }

  function descriptionMap(items) {
    const map = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const name = clean(item?.name).toLowerCase();
      const description = clean(item?.__cardDescription);
      if (name && validCardDescription(description)) map.set(name, description);
    }
    return map;
  }

  const originalRepair = base.repairFreshCutGrassDomItem;
  function repairFreshCutGrassDomItem(item, sourceUrl = '') {
    const cardDescription = clean(item?.__cardDescription);
    const inputStateDescription = item?.extractionMethod === 'freshcutgrass-app-state' && validCardDescription(item?.desc) ? clean(item.desc) : '';
    const repaired = typeof originalRepair === 'function' ? originalRepair(item, sourceUrl) : { ...(item || {}) };
    if (inputStateDescription) repaired.desc = inputStateDescription;
    else if (validCardDescription(cardDescription)) repaired.desc = cardDescription;
    delete repaired.__cardDescription;
    return repaired;
  }

  const originalStateParser = base.parseFreshCutGrassState;
  function parseFreshCutGrassState(input, sourceUrl = '', domItems = []) {
    const byName = descriptionMap(domItems);
    const parsed = typeof originalStateParser === 'function' ? originalStateParser(input, sourceUrl, domItems) : [];
    return (Array.isArray(parsed) ? parsed : []).map((item) => {
      const description = byName.get(clean(item?.name).toLowerCase()) || clean(item?.__cardDescription);
      const output = { ...item };
      const stateDescription = output.extractionMethod === 'freshcutgrass-app-state' && validCardDescription(output.desc);
      if (validCardDescription(description) && !stateDescription) output.desc = description;
      delete output.__cardDescription;
      return output;
    });
  }

  globalThis.DHStatblockParser = {
    ...base,
    __freshCutGrassCardBoundaryPatch: true,
    repairFreshCutGrassDomItem,
    parseFreshCutGrassState
  };
})();
