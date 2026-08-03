(() => {
  'use strict';
  const base = globalThis.DHStatblockParser;
  if (!base || base.__diagnosticsPatch) return;
  const originalMany = base.parseManyFromDocument;

  function parseManyFromDocument(doc, location, selected = null) {
    const isHeart = /^(?:www\.)?heartofdaggers\.com$/i.test(location?.hostname || '');
    const roots = isHeart && typeof base.renderedCardRoots === 'function' ? base.renderedCardRoots(doc, selected) : [];
    const items = typeof originalMany === 'function' ? originalMany(doc, location, selected) : [];
    const rejectedCount = Math.max(0, roots.length - items.length);
    base.lastDiagnostics = {
      candidateCount: roots.length || items.length,
      rejectedCount,
      rejectionReasons: rejectedCount ? ['Candidate did not contain a complete rendered statblock signature or duplicated another card.'] : [],
      siteStrategy: isHeart ? 'rendered-card-signature' : 'structured-dom-candidates'
    };
    return items;
  }

  globalThis.DHStatblockParser = {
    ...base,
    __diagnosticsPatch: true,
    parseManyFromDocument,
    parseFromDocument: (doc, location, selected) => parseManyFromDocument(doc, location, selected)[0]
  };
})();
