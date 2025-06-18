import { App, Modal, Setting, ButtonComponent, TextComponent, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../../main';

export class NameEncounterModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSubmit: (name: string) => void;
    existingNames: string[];
    currentNameValue?: string | null;
    titleText: string;
    private nameInputComponent!: TextComponent;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, title: string, existingNames: string[], currentNameVal: string | null | undefined, onSubmit: (name: string) => void) {
        super(app);
        this.plugin = plugin;
        this.titleText = title;
        this.onSubmit = onSubmit;
        this.existingNames = existingNames;
        this.currentNameValue = currentNameVal;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-name-modal');
        contentEl.createEl("h2", { text: this.titleText });

        new Setting(contentEl).setName("Encounter Name").addText((text) => {
            this.nameInputComponent = text;
            text.setPlaceholder("Enter encounter name").setValue(this.currentNameValue || "");
            text.inputEl.addClass('dh-modal-input');
            text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.submitName(this.nameInputComponent.getValue()); } });
            this.app.workspace.onLayoutReady(() => text.inputEl.focus());
        });
        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer).setButtonText("Confirm").setCta().onClick(() => { this.submitName(this.nameInputComponent.getValue()); });
        new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => this.close());
    }

    submitName(name: string) {
        const trimmedName = name.trim();
        if (!trimmedName) { new Notice("Encounter name cannot be empty."); return; }
        if (this.existingNames.includes(trimmedName) && trimmedName !== this.currentNameValue) { new Notice(`An encounter named "${trimmedName}" already exists. Choose a different name.`); return; }
        this.onSubmit(trimmedName);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
