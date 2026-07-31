(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  let currentItems = [];
  let currentIndex = 0;
  let currentTab = null;

  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const buttons = ['copyMarkdown', 'copyJson', 'sendObsidian'].map($);

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function enableActions(enabled) {
    buttons.forEach((button) => { button.disabled = !enabled; });
  }

  function sanitizeFilename(value) {
    return String(value || 'Untitled Statblock')
      .replace(/[\\/:*?"<>|#^[\]]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Untitled Statblock';
  }

  function current() {
    return currentItems[currentIndex] || null;
  }

  function selectedItems() {
    return $('exportAll').checked && currentItems.length > 1 ? currentItems : (current() ? [current()] : []);
  }

  function updateActionLabels() {
    const count = selectedItems().length;
    $('copyMarkdown').textContent = count > 1 ? `Copy ${count} as Markdown` : 'Copy Toolkit Markdown';
    $('copyJson').textContent = count > 1 ? `Copy ${count} as JSON` : 'Copy Toolkit JSON';
    $('sendObsidian').textContent = count > 1 ? `Add ${count} to Obsidian` : 'Add to Obsidian';
  }

  function renderCurrent() {
    const data = current();
    if (!data) return;
    $('result').classList.remove('hidden');
    $('name').textContent = data.name || 'Untitled Statblock';
    const parts = [];
    if (data.tier != null) parts.push(`Tier ${data.tier}`);
    if (data.type) parts.push(data.type);
    if (data.difficulty != null) parts.push(`Difficulty ${data.difficulty}`);
    if (data.hp != null) parts.push(`HP ${data.hp}`);
    $('summary').textContent = parts.join(' · ') || 'Parsed statblock';
    $('source').textContent = data.author ? `${data.sourceSite || 'Source'} · ${data.author}` : (data.sourceSite || data.source || '');
    enableActions(true);
    updateActionLabels();
    if (data.extractionWarning) setStatus(data.extractionWarning, true);
    else if (currentItems.length > 1) setStatus(`${currentItems.length} statblocks found. Select one or export all.`);
    else setStatus(data.features?.length ? `Ready. ${data.features.length} feature(s) found.` : 'Ready. No features were detected.');
  }

  function renderItems(items) {
    currentItems = Array.isArray(items) ? items.filter(Boolean) : [];
    currentIndex = 0;
    if (!currentItems.length) throw new Error('No statblock found. Open a stat preview or use Pick block(s) on page.');

    const select = $('itemSelect');
    select.replaceChildren();
    currentItems.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.name || `Statblock ${index + 1}`;
      select.appendChild(option);
    });
    $('collection').classList.toggle('hidden', currentItems.length <= 1);
    $('exportAllLabel').classList.toggle('hidden', currentItems.length <= 1);
    $('exportAll').checked = currentItems.length > 1;
    $('exportAllText').textContent = `Export all ${currentItems.length} detected statblocks`;
    renderCurrent();
  }

  async function inject(tabId) {
    await api.scripting.executeScript({ target: { tabId }, files: ['parser.js', 'parser-patch.js', 'content-script.js'] });
  }

  async function extract() {
    try {
      enableActions(false);
      setStatus('Extracting…');
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open a FreshCutGrass or Heart of Daggers page first.');
      currentTab = tab;
      $('site').textContent = new URL(tab.url).hostname;
      await inject(tab.id);
      const response = await api.tabs.sendMessage(tab.id, { type: 'DH_EXTRACT' });
      if (!response?.ok) throw new Error(response?.error || 'No statblock found.');

      const saved = await api.storage.local.get(['lastExtractions', 'lastExtractionUrl', 'lastExtractionManual']);
      const useManual = saved.lastExtractionManual && saved.lastExtractionUrl === tab.url && Array.isArray(saved.lastExtractions) && saved.lastExtractions.length;
      const chosen = useManual ? saved.lastExtractions : response.items;
      if (useManual) await api.storage.local.remove('lastExtractionManual');
      renderItems(chosen);
    } catch (error) {
      currentItems = [];
      $('collection').classList.add('hidden');
      $('result').classList.add('hidden');
      enableActions(false);
      setStatus(error.message, true);
    }
  }

  async function copy(text, label) {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied.`);
  }

  async function loadSettings() {
    const settings = await api.storage.sync.get({ vault: '', folder: 'Daggerheart/Homebrew', overwrite: false });
    $('vault').value = settings.vault;
    $('folder').value = settings.folder;
    $('overwrite').checked = settings.overwrite;
  }

  async function saveSettings() {
    await api.storage.sync.set({
      vault: $('vault').value.trim(),
      folder: $('folder').value.trim().replace(/^\/+|\/+$/g, ''),
      overwrite: $('overwrite').checked
    });
    setStatus('Settings saved.');
  }

  function collectionFilename(items) {
    if (items.length === 1) return sanitizeFilename(items[0].name);
    return sanitizeFilename(`${items[0].name || 'Encounter'} and ${items.length - 1} more`);
  }

  async function sendToObsidian() {
    const items = selectedItems();
    if (!items.length) return;
    await saveSettings();
    const markdown = globalThis.DHStatblockParser.toToolkitMarkdownMany(items);
    await navigator.clipboard.writeText(markdown);

    const vault = $('vault').value.trim();
    const folder = $('folder').value.trim().replace(/^\/+|\/+$/g, '');
    const filename = collectionFilename(items);
    const file = folder ? `${folder}/${filename}` : filename;
    const params = new URLSearchParams();
    if (vault) params.set('vault', vault);
    params.set('file', file);
    params.set('clipboard', '');
    if ($('overwrite').checked) params.set('overwrite', '');
    const uri = `obsidian://new?${params.toString().replace(/=$/g, '')}`;

    setStatus(`${items.length === 1 ? 'Statblock' : `${items.length} statblocks`} copied; opening Obsidian…`);
    try {
      await api.tabs.create({ url: uri });
    } catch (_error) {
      window.location.href = uri;
    }
  }

  $('refresh').addEventListener('click', extract);
  $('copyMarkdown').addEventListener('click', () => {
    const items = selectedItems();
    return copy(globalThis.DHStatblockParser.toToolkitMarkdownMany(items), items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit Markdown');
  });
  $('copyJson').addEventListener('click', () => {
    const items = selectedItems();
    return copy(globalThis.DHStatblockParser.toToolkitJsonMany(items), items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit JSON');
  });
  $('sendObsidian').addEventListener('click', sendToObsidian);
  $('saveSettings').addEventListener('click', saveSettings);
  $('itemSelect').addEventListener('change', (event) => {
    currentIndex = Number(event.target.value) || 0;
    renderCurrent();
  });
  $('exportAll').addEventListener('change', updateActionLabels);
  $('selectBlock').addEventListener('click', async () => {
    try {
      if (!currentTab?.id) {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        currentTab = tab;
      }
      await inject(currentTab.id);
      await api.tabs.sendMessage(currentTab.id, { type: 'DH_SELECT' });
      window.close();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  loadSettings().then(extract);
})();
