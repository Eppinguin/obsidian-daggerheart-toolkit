(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  async function load() {
    const settings = await api.storage.sync.get({ vault: '', folder: 'Daggerheart/Homebrew', overwrite: false });
    $('vault').value = settings.vault;
    $('folder').value = settings.folder;
    $('overwrite').checked = settings.overwrite;
  }

  async function save() {
    const button = $('save');
    button.disabled = true;
    $('status').textContent = 'Saving…';
    try {
      await api.storage.sync.set({
        vault: $('vault').value.trim(),
        folder: $('folder').value.trim().replace(/^\/+|\/+$/g, ''),
        overwrite: $('overwrite').checked
      });
      $('status').textContent = 'Settings saved.';
      window.setTimeout(() => { $('status').textContent = ''; }, 2200);
    } finally {
      button.disabled = false;
    }
  }

  $('save').addEventListener('click', save);
  load();
})();
