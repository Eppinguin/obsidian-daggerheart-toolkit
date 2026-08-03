(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  if (api?.tabs?.create && api?.runtime?.sendMessage && !globalThis.__DH_OBSIDIAN_LAUNCH_BRIDGE__) {
    const createTab = api.tabs.create.bind(api.tabs);
    try {
      api.tabs.create = async (properties) => {
        const uri = String(properties?.url || '');
        if (!/^obsidian:\/\//i.test(uri)) return createTab(properties);

        const [sourceTab] = await api.tabs.query({ active: true, currentWindow: true });
        const response = await api.runtime.sendMessage({
          type: 'DH_OPEN_EXTERNAL_URI',
          uri,
          sourceTabId: sourceTab?.id,
          sourceWindowId: sourceTab?.windowId
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not open Obsidian.');
        return { id: response.launchTabId, active: true, windowId: sourceTab?.windowId };
      };
      globalThis.__DH_OBSIDIAN_LAUNCH_BRIDGE__ = true;
    } catch (_error) {
      // Some browser API implementations may expose non-writable methods.
      // The popup retains its direct tabs.create fallback in that case.
    }
  }

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
