(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  let currentItems = [];
  let currentIndex = 0;
  let currentTab = null;
  let currentDiagnostics = {};

  const $ = (id) => document.getElementById(id);
  const actionButtons = ['copyMarkdown', 'copyJson', 'sendObsidian', 'createNote', 'copyDiagnostics'].map($);
  const statusIcons = {
    loading: '<svg class="spinner" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg>',
    success: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    error: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/></svg>',
    neutral: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
  };

  function setStatus(message, type = 'neutral') {
    const status = $('status');
    status.className = `notice notice--${type}`;
    status.querySelector('.notice-icon').innerHTML = statusIcons[type] || statusIcons.neutral;
    $('statusText').textContent = message;
  }

  function setLoading(loading) {
    $('loadingCard').classList.toggle('hidden', !loading);
    $('refresh').classList.toggle('is-spinning', loading);
    $('refresh').disabled = loading;
    if (loading) {
      $('result').classList.add('hidden');
      $('collection').classList.add('hidden');
    }
  }

  function enableActions(enabled) {
    actionButtons.forEach((button) => { button.disabled = !enabled; });
  }

  function sanitizeFilename(value) {
    return String(value || 'Untitled Statblock').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled Statblock';
  }

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const current = () => currentItems[currentIndex] || null;
  const selectedItems = () => $('exportAll').checked && currentItems.length > 1 ? currentItems : (current() ? [current()] : []);

  function toolkitView(data) {
    try { return globalThis.DHStatblockParser.toToolkitStatblock(data); } catch (_error) { return null; }
  }

  function sourceLabel(data, toolkit) {
    const site = clean(data.sourceSite || toolkit?.source?.site).replace(/^www\./i, '').replace(/^heartofdaggers\.com$/i, 'Heart of Daggers').replace(/^freshcutgrass\.app$/i, 'FreshCutGrass');
    const author = clean(data.author || toolkit?.source?.author);
    return author ? `${site || 'Source'} · ${author}` : site;
  }

  function setSiteContext(url) {
    let hostname = '';
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch (_error) { /* ignored */ }
    if (/freshcutgrass\.app$/i.test(hostname)) {
      document.body.dataset.site = 'freshcutgrass';
      $('site').textContent = 'FreshCutGrass';
    } else if (/heartofdaggers\.com$/i.test(hostname)) {
      document.body.dataset.site = 'heartofdaggers';
      $('site').textContent = 'Heart of Daggers';
    } else {
      document.body.dataset.site = 'other';
      $('site').textContent = hostname || 'Unsupported page';
    }
  }

  function updateDestinationSummary() {
    const vault = $('vault').value.trim();
    const folder = $('folder').value.trim().replace(/^\/+|\/+$/g, '');
    $('destinationSummary').textContent = vault ? `${folder || 'Vault root'} · ${vault}` : (folder || 'Vault root');
  }

  function updateActionLabels() {
    const count = selectedItems().length;
    const many = count > 1;
    $('sendLabel').textContent = many ? `Import ${count} statblocks` : 'Import into toolkit';
    $('sendHint').textContent = many ? 'Review conflicts and add the complete set' : 'Review and add to the compendium';
    $('markdownLabel').textContent = many ? `Copy ${count} blocks` : 'Copy Markdown';
    $('jsonLabel').textContent = many ? `Copy ${count} items` : 'Copy JSON';
    $('currentPosition').textContent = `${Math.min(currentIndex + 1, currentItems.length)} of ${currentItems.length || 1}`;
  }

  function renderCurrent() {
    const data = current();
    if (!data) return;
    const toolkit = toolkitView(data) || {};
    const category = toolkit.category || (data.impulses || data.tone ? 'environment' : 'adversary');
    const attack = toolkit.attack || {};
    const hpStress = toolkit.hp_stress || {};
    const features = Array.isArray(toolkit.features) ? toolkit.features : (Array.isArray(data.features) ? data.features : []);
    const description = clean(toolkit.description || data.desc || data.description);

    $('result').classList.remove('hidden');
    $('name').textContent = toolkit.name || data.name || 'Untitled Statblock';
    $('categoryBadge').textContent = category === 'environment' ? 'Environment' : 'Adversary';
    $('categoryBadge').classList.toggle('badge--environment', category === 'environment');
    $('typeBadge').textContent = clean(toolkit.type || data.type) || 'Homebrew';
    $('description').textContent = description;
    $('description').classList.toggle('hidden', !description);
    $('tierValue').textContent = toolkit.tier ?? data.tier ?? '—';
    $('difficultyValue').textContent = toolkit.difficulty ?? data.difficulty ?? '—';
    $('hpValue').textContent = category === 'adversary' ? (hpStress.hp ?? data.hp ?? '—') : '—';
    $('stressValue').textContent = category === 'adversary' ? (hpStress.stress ?? data.stress ?? '—') : '—';

    const attackName = clean(attack.name || data.weapon);
    const attackDetails = [attack.modifier, attack.range, attack.damage].filter((value) => clean(value)).join(' · ');
    const showAttack = category === 'adversary' && Boolean(attackName || attackDetails);
    $('attackSection').classList.toggle('hidden', !showAttack);
    $('attackName').textContent = attackName || 'Standard attack';
    $('attackDetails').textContent = attackDetails;

    const motives = clean(toolkit.motives_tactics || data.motives);
    $('motivesSection').classList.toggle('hidden', category !== 'adversary' || !motives);
    $('motivesValue').textContent = motives;
    $('featureCount').textContent = `${features.length} feature${features.length === 1 ? '' : 's'}`;
    $('source').textContent = sourceLabel(data, toolkit);

    enableActions(true);
    updateActionLabels();
    if (data.extractionWarning) setStatus(data.extractionWarning, 'error');
    else if (currentItems.length > 1) setStatus(`${currentItems.length} statblocks detected. Choose one or import the complete set.`, 'success');
    else setStatus(features.length ? `Ready to import · ${features.length} feature${features.length === 1 ? '' : 's'} detected.` : 'Ready to import. No features were detected.', 'success');
  }

  function renderItems(items) {
    currentItems = Array.isArray(items) ? items.filter(Boolean) : [];
    currentIndex = 0;
    setLoading(false);
    if (!currentItems.length) throw new Error('No statblock found. Open a stat preview or pick a block manually.');
    const select = $('itemSelect');
    select.replaceChildren();
    currentItems.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.name || `Statblock ${index + 1}`;
      select.appendChild(option);
    });
    const multiple = currentItems.length > 1;
    $('collection').classList.toggle('hidden', !multiple);
    $('exportAllLabel').classList.toggle('hidden', !multiple);
    $('exportAll').checked = multiple;
    $('resultCount').textContent = String(currentItems.length);
    $('exportAllText').textContent = `Import all ${currentItems.length} statblocks`;
    renderCurrent();
  }

  async function inject(tabId) {
    await api.scripting.executeScript({ target: { tabId }, files: ['statblock-format.js', 'parser.js', 'parser-patch.js', 'statblock-format-adapter.js', 'heartofdaggers-filter.js', 'content-script.js'] });
  }

  async function findTargetTab() {
    const requestedUrl = new URLSearchParams(location.search).get('targetUrl');
    if (requestedUrl) {
      const tabs = await api.tabs.query({});
      const match = tabs.find((tab) => tab.url === requestedUrl);
      if (match) return match;
    }
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function collectFreshCutGrassState(tab) {
    if (!tab?.id || !/^https?:\/\/freshcutgrass\.app\//i.test(tab.url || '')) return null;
    const targetId = new URL(tab.url).searchParams.get('id') || '';
    try {
      const executions = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: globalThis.DHFreshCutGrassCollector, args: [targetId] });
      return executions?.[0]?.result || null;
    } catch (error) {
      console.warn('FreshCutGrass app-state extraction was unavailable; using visible DOM.', error);
      return null;
    }
  }

  async function extract() {
    try {
      enableActions(false);
      setLoading(true);
      setStatus('Extracting statblock…', 'loading');
      const tab = await findTargetTab();
      if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a FreshCutGrass or Heart of Daggers page first.');
      currentTab = tab;
      setSiteContext(tab.url);
      await inject(tab.id);
      const [response, appState] = await Promise.all([api.tabs.sendMessage(tab.id, { type: 'DH_EXTRACT' }), collectFreshCutGrassState(tab)]);
      if (!response?.ok) throw new Error(response?.error || 'No statblock found.');

      const isFreshCutGrass = /^https?:\/\/freshcutgrass\.app\//i.test(tab.url || '');
      const domItems = isFreshCutGrass ? (response.items || []).map((item) => globalThis.DHStatblockParser.repairFreshCutGrassDomItem(item, tab.url)) : (response.items || []);
      const stateItems = appState ? globalThis.DHStatblockParser.parseFreshCutGrassState(appState, tab.url, domItems) : [];
      const automaticItems = stateItems.length ? stateItems : domItems;
      const saved = await api.storage.local.get(['lastExtractions', 'lastExtractionUrl', 'lastExtractionManual']);
      const useManual = saved.lastExtractionManual && saved.lastExtractionUrl === tab.url && Array.isArray(saved.lastExtractions) && saved.lastExtractions.length;
      const chosen = useManual ? saved.lastExtractions : automaticItems;
      if (useManual) await api.storage.local.remove('lastExtractionManual');

      currentDiagnostics = {
        extensionVersion: api.runtime.getManifest().version,
        browser: navigator.userAgent,
        page: { url: tab.url, title: tab.title || '' },
        extractionPath: useManual ? 'manual-selection' : stateItems.length ? 'freshcutgrass-app-state' : isFreshCutGrass ? 'freshcutgrass-rendered-dom' : 'heartofdaggers-rendered-card',
        candidateCount: response.diagnostics?.candidateCount ?? (response.items || []).length,
        rejectedCount: response.diagnostics?.rejectedCount ?? 0,
        rejectionReasons: response.diagnostics?.rejectionReasons || [],
        appStateFound: Boolean(appState),
        selectedCount: chosen.length
      };
      renderItems(chosen);
    } catch (error) {
      currentItems = [];
      currentDiagnostics = { error: error.message, extensionVersion: api.runtime.getManifest().version, browser: navigator.userAgent };
      setLoading(false);
      $('collection').classList.add('hidden');
      $('result').classList.add('hidden');
      enableActions(false);
      $('copyDiagnostics').disabled = false;
      setStatus(error.message, 'error');
    }
  }

  async function copy(text, label) {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied to the clipboard.`, 'success');
  }

  async function loadSettings() {
    const settings = await api.storage.sync.get({ vault: '', folder: 'Daggerheart/Homebrew', overwrite: false });
    $('vault').value = settings.vault;
    $('folder').value = settings.folder;
    $('overwrite').checked = settings.overwrite;
    updateDestinationSummary();
  }

  async function saveSettings(announce = true) {
    await api.storage.sync.set({ vault: $('vault').value.trim(), folder: $('folder').value.trim().replace(/^\/+|\/+$/g, ''), overwrite: $('overwrite').checked });
    updateDestinationSummary();
    if (announce) setStatus('Obsidian destination saved.', 'success');
  }

  function collectionFilename(items) {
    return items.length === 1 ? sanitizeFilename(items[0].name) : sanitizeFilename(`${items[0].name || 'Encounter'} and ${items.length - 1} more`);
  }

  async function openObsidianUri(uri) {
    try {
      await api.tabs.create({ url: uri, active: false });
    } catch (_error) {
      window.location.href = uri;
    }
  }

  async function importIntoToolkit() {
    const items = selectedItems();
    if (!items.length) return;
    $('sendObsidian').disabled = true;
    setStatus('Preparing verified import…', 'loading');
    try {
      const json = globalThis.DHStatblockParser.toToolkitJsonMany(items);
      await navigator.clipboard.writeText(json);
      const params = new URLSearchParams({ source: currentDiagnostics.extractionPath || 'browser-extension', count: String(items.length) });
      setStatus(`${items.length === 1 ? 'Statblock' : `${items.length} statblocks`} copied. Opening import preview…`, 'success');
      await openObsidianUri(`obsidian://daggerheart-import?${params.toString()}`);
    } finally {
      $('sendObsidian').disabled = false;
    }
  }

  async function createMarkdownNote() {
    const items = selectedItems();
    if (!items.length) return;
    await saveSettings(false);
    const markdown = globalThis.DHStatblockParser.toToolkitMarkdownMany(items);
    await navigator.clipboard.writeText(markdown);
    const vault = $('vault').value.trim();
    const folder = $('folder').value.trim().replace(/^\/+|\/+$/g, '');
    const filename = collectionFilename(items);
    const params = new URLSearchParams();
    if (vault) params.set('vault', vault);
    params.set('file', folder ? `${folder}/${filename}` : filename);
    params.set('clipboard', '');
    if ($('overwrite').checked) params.set('overwrite', '');
    setStatus('Markdown copied. Opening Obsidian note…', 'success');
    await openObsidianUri(`obsidian://new?${params.toString().replace(/=$/g, '')}`);
  }

  function diagnosticPayload() {
    return {
      ...currentDiagnostics,
      generatedAt: new Date().toISOString(),
      selected: selectedItems().map((item) => {
        const toolkit = toolkitView(item);
        return toolkit ? { ...toolkit, source: toolkit.source ? { site: toolkit.source.site, url: toolkit.source.url, author: toolkit.source.author } : undefined } : { name: item.name, category: item.category };
      })
    };
  }

  $('refresh').addEventListener('click', extract);
  $('copyMarkdown').addEventListener('click', () => { const items = selectedItems(); return copy(globalThis.DHStatblockParser.toToolkitMarkdownMany(items), items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit Markdown'); });
  $('copyJson').addEventListener('click', () => { const items = selectedItems(); return copy(globalThis.DHStatblockParser.toToolkitJsonMany(items), items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit JSON'); });
  $('sendObsidian').addEventListener('click', importIntoToolkit);
  $('createNote').addEventListener('click', createMarkdownNote);
  $('copyDiagnostics').addEventListener('click', () => copy(JSON.stringify(diagnosticPayload(), null, 2), 'Diagnostics'));
  $('saveSettings').addEventListener('click', () => saveSettings(true));
  $('openOptions').addEventListener('click', () => api.runtime.openOptionsPage());
  $('vault').addEventListener('input', updateDestinationSummary);
  $('folder').addEventListener('input', updateDestinationSummary);
  $('itemSelect').addEventListener('change', (event) => { currentIndex = Number(event.target.value) || 0; renderCurrent(); });
  $('exportAll').addEventListener('change', updateActionLabels);
  $('selectBlock').addEventListener('click', async () => {
    try {
      if (!currentTab?.id) currentTab = await findTargetTab();
      await inject(currentTab.id);
      await api.tabs.sendMessage(currentTab.id, { type: 'DH_SELECT' });
      window.close();
    } catch (error) { setStatus(error.message, 'error'); }
  });

  loadSettings().then(extract);
})();
