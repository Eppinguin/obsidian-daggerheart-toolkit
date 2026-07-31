(() => {
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  async function load() {
    const settings = await api.storage.sync.get({ vault: '', folder: 'Daggerheart/Homebrew', overwrite: false });
    $('vault').value = settings.vault;
    $('folder').value = settings.folder;
    $('overwrite').checked = settings.overwrite;
  }
  $('save').addEventListener('click', async () => {
    await api.storage.sync.set({
      vault: $('vault').value.trim(),
      folder: $('folder').value.trim().replace(/^\/+|\/+$/g, ''),
      overwrite: $('overwrite').checked
    });
    $('status').textContent = 'Saved.';
  });
  load();
})();
