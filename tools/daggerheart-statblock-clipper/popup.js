(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  let current = null;
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

  function render(data) {
    current = data;
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
    if (data.extractionWarning) setStatus(data.extractionWarning, true);
    else setStatus(data.features?.length ? `Ready. ${data.features.length} feature(s) found.` : 'Ready. Review the copied result for missing features.');
  }

  async function inject(tabId) {
    await api.scripting.executeScript({ target: { tabId }, files: ['parser.js', 'content-script.js'] });
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

      const saved = await api.storage.local.get(['lastExtraction', 'lastExtractionUrl', 'lastExtractionManual']);
      const useManual = saved.lastExtractionManual && saved.lastExtractionUrl === tab.url && saved.lastExtraction?.name;
      const chosen = useManual ? saved.lastExtraction : response.data;
      if (useManual) await api.storage.local.remove('lastExtractionManual');
      render(chosen);
    } catch (error) {
      current = null;
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

  async function sendToObsidian() {
    if (!current) return;
    await saveSettings();
    const markdown = globalThis.DHStatblockParser.toToolkitMarkdown(current);
    await navigator.clipboard.writeText(markdown);

    const vault = $('vault').value.trim();
    const folder = $('folder').value.trim().replace(/^\/+|\/+$/g, '');
    const filename = sanitizeFilename(current.name);
    const file = folder ? `${folder}/${filename}` : filename;
    const params = new URLSearchParams();
    if (vault) params.set('vault', vault);
    params.set('file', file);
    params.set('clipboard', '');
    if ($('overwrite').checked) params.set('overwrite', '');
    const uri = `obsidian://new?${params.toString().replace(/=$/g, '')}`;

    setStatus('Toolkit statblock copied; opening Obsidian…');
    try {
      await api.tabs.create({ url: uri });
    } catch (_error) {
      window.location.href = uri;
    }
  }

  $('refresh').addEventListener('click', extract);
  $('copyMarkdown').addEventListener('click', () => copy(globalThis.DHStatblockParser.toToolkitMarkdown(current), 'Toolkit Markdown'));
  $('copyJson').addEventListener('click', () => copy(globalThis.DHStatblockParser.toToolkitJson(current), 'Toolkit JSON'));
  $('sendObsidian').addEventListener('click', sendToObsidian);
  $('saveSettings').addEventListener('click', saveSettings);
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
