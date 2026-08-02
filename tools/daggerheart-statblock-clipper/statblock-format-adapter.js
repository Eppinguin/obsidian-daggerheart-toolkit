(() => {
  'use strict';
  const parser = globalThis.DHStatblockParser;
  const format = globalThis.DHStatblockFormat;
  if (!parser || !format || parser.__sharedFormatAdapter) return;

  parser.toToolkitStatblock = (input) => {
    const normalized = format.normalizeStatblock(input, input?.category);
    if (!normalized) throw new Error('No valid statblock is available.');
    return normalized;
  };
  parser.toToolkitExport = (input) => format.createEnvelope(input);
  parser.toToolkitYaml = (input) => format.toYaml(input);
  parser.toToolkitMarkdown = (input) => format.toMarkdown(input);
  parser.toToolkitMarkdownMany = (items) => format.toMarkdown(items);
  parser.toToolkitJson = (input) => format.toJson(input);
  parser.toToolkitJsonMany = (items) => format.toJson(items);
  parser.validateToolkitStatblock = (input) => format.validateStatblock(input);
  parser.__sharedFormatAdapter = true;
})();
