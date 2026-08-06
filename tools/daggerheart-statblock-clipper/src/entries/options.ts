/** Options page: where imported Markdown notes are written.
 *
 * Ported from the former `options.js`; settings access now goes through
 * `lib/storage.ts` so the popup and this page cannot drift on defaults.
 */
import { loadSettings, saveSettings } from '../lib/storage';

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

async function load(): Promise<void> {
    const settings = await loadSettings();
    input('vault').value = settings.vault;
    input('folder').value = settings.folder;
    input('overwrite').checked = settings.overwrite;
}

async function save(): Promise<void> {
    const button = document.getElementById('save') as HTMLButtonElement;
    const status = document.getElementById('status') as HTMLElement;
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
        await saveSettings({
            vault: input('vault').value.trim(),
            folder: input('folder')
                .value.trim()
                .replace(/^\/+|\/+$/g, ''),
            overwrite: input('overwrite').checked,
        });
        status.textContent = 'Settings saved.';
        window.setTimeout(() => {
            status.textContent = '';
        }, 2200);
    } finally {
        button.disabled = false;
    }
}

document.getElementById('save')?.addEventListener('click', save);
void load();
