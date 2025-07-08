// src/rendering/import-export-ui.ts
import { setIcon } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { ContentType, CONTENT_TYPE_INFO } from '../services/export-import';
import { ImportExportModal } from '../modals/ImportExportModal';

/**
 * Add floating import/export buttons to a view
 * @param container The HTML element to add the buttons to
 * @param plugin The plugin instance
 * @param contentType The type of content in this view
 * @param getActiveContentId Optional function to get the ID of the active content
 */
export function addImportExportButtons(
    container: HTMLElement,
    plugin: DaggerheartStatblockPlugin,
    contentType: ContentType,
    getActiveContentId?: () => string | null
) {
    const floatingContainer = container.createDiv({ cls: 'dh-floating-import-export' });

    // Import button
    const importBtn = floatingContainer.createEl('button', {
        cls: 'dh-import-export-btn',
        attr: { 'aria-label': `Import ${CONTENT_TYPE_INFO[contentType].displayName}` }
    });
    setIcon(importBtn, 'download');
    importBtn.addEventListener('click', () => {
        new ImportExportModal(plugin.app, plugin, 'import', contentType).open();
    });

    // Export button (only shown if we have content to export)
    const exportBtn = floatingContainer.createEl('button', {
        cls: 'dh-import-export-btn',
        attr: { 'aria-label': `Export ${CONTENT_TYPE_INFO[contentType].displayName}` }
    });
    setIcon(exportBtn, 'upload');
    exportBtn.addEventListener('click', () => {
        const contentId = getActiveContentId ? getActiveContentId() : null;
        new ImportExportModal(plugin.app, plugin, 'export', contentType, contentId).open();
    });

    return floatingContainer;
}

/**
 * Create a menu button for import/export
 * @param container The HTML element to add the button to
 * @param icon The icon to use (download or upload)
 * @param tooltip The tooltip text
 * @param onClick Click handler
 */
export function createImportExportButton(container: HTMLElement, icon: string, tooltip: string, onClick: () => void) {
    const button = container.createEl('button', {
        cls: 'dh-import-export-btn',
        attr: { 'aria-label': tooltip }
    });
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    return button;
}
