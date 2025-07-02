import { App, Modal, ButtonComponent, setIcon, Notice } from 'obsidian';
import { EncounterBuilderView } from '../views/EncounterBuilderView';
import { ContentType } from '../services/export-import';
import { ImportExportModal } from '../modals/ImportExportModal';

export class ManageEncountersModal extends Modal {
    view: EncounterBuilderView;

    constructor(app: App, view: EncounterBuilderView) {
        super(app);
        this.view = view;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-manage-encounters-modal');
        contentEl.createEl("h2", { text: "Manage Saved Encounters" });
        const listEl = contentEl.createDiv({ cls: "dh-manage-list" });
        if (this.view.plugin.settings.savedEncounters.length === 0) {
            listEl.createEl("p", { text: "No saved encounters." });
        } else {
            this.view.plugin.settings.savedEncounters.forEach(savedEncounter => {
                const entryEl = listEl.createDiv({ cls: "dh-manage-list-item" });
                const nameContainer = entryEl.createDiv({ cls: "dh-manage-item-name-container" });
                nameContainer.createSpan({ text: savedEncounter.name, cls: "dh-manage-item-name" });

                // Create a button container for each row
                const buttonsEl = entryEl.createDiv({ cls: "dh-manage-item-buttons" });

                // Add load button
                new ButtonComponent(buttonsEl)
                    .setIcon("external-link")
                    .setTooltip("Load Encounter")
                    .setClass("dh-icon-button")
                    .onClick(() => {
                        this.close();
                        this.view.loadEncounter(savedEncounter.id);
                    });

                // Add rename button
                new ButtonComponent(buttonsEl)
                    .setIcon("pencil")
                    .setTooltip("Rename Encounter")
                    .setClass("dh-icon-button")
                    .onClick(() => {
                        this.close();
                        this.view.handleRenameEncounter(savedEncounter.id);
                    });

                // Add export button
                new ButtonComponent(buttonsEl)
                    .setIcon("upload")
                    .setTooltip("Export Encounter")
                    .setClass("dh-icon-button")
                    .onClick(() => {
                        this.close();
                        new ImportExportModal(this.app, this.view.plugin, 'export', ContentType.ENCOUNTER, savedEncounter.id).open();
                    });

                // Add delete button with confirmation
                const deleteButton = new ButtonComponent(buttonsEl)
                    .setIcon("trash")
                    .setTooltip("Delete Encounter")
                    .setClass("dh-icon-button")
                    .setClass("dh-delete-btn-confirmable")
                    .onClick(async () => {
                        if (deleteButton.buttonEl.classList.contains('is-confirming-delete')) {
                            await this.view.handleDeleteEncounter(savedEncounter.id);
                            this.onOpen();
                        } else {
                            deleteButton.buttonEl.classList.add('is-confirming-delete');
                            deleteButton.setTooltip("Confirm Delete?");
                            setIcon(deleteButton.buttonEl, "check-circle");
                            setTimeout(() => {
                                if (deleteButton.buttonEl.classList.contains('is-confirming-delete')) {
                                    deleteButton.buttonEl.classList.remove('is-confirming-delete');
                                    deleteButton.setTooltip("Delete Encounter");
                                    setIcon(deleteButton.buttonEl, "trash");
                                }
                            }, 3000);
                        }
                    });
            });
        }

        // Add import button at the bottom
        const actionsContainer = contentEl.createDiv({ cls: 'dh-modal-actions' });
        new ButtonComponent(actionsContainer)
            .setButtonText("Import Encounter")
            .setIcon("download")
            .setCta()
            .onClick(() => {
                this.close();
                new ImportExportModal(this.app, this.view.plugin, 'import', ContentType.ENCOUNTER).open();
            });

        const closeButtonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons', attr: { 'style': 'justify-content: center; margin-top: var(--size-4-4);' } });
        new ButtonComponent(closeButtonContainer).setButtonText("Close").onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
