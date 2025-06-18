import { App, Modal, ButtonComponent, setIcon } from 'obsidian';
import { EncounterBuilderView } from '../views/EncounterBuilderView';

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
                const buttonsEl = entryEl.createDiv({ cls: "dh-manage-item-buttons" });
                new ButtonComponent(buttonsEl).setIcon("pencil").setTooltip("Rename Encounter").setClass("dh-icon-button").onClick(() => { this.close(); this.view.handleRenameEncounter(savedEncounter.id); });
                const deleteButton = new ButtonComponent(buttonsEl).setIcon("trash").setTooltip("Delete Encounter").setClass("dh-icon-button").setClass("dh-delete-btn-confirmable").onClick(async () => {
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
        const closeButtonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons', attr: { 'style': 'justify-content: center; margin-top: var(--size-4-4);' } });
        new ButtonComponent(closeButtonContainer).setButtonText("Close").onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
