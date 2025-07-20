import { App, Modal, Setting } from 'obsidian';

// A modal for setting a numeric value for a temporary resource (like HP or Armor)
export class TemporaryResourceModal extends Modal {
    private value: string;
    private onSubmit: (value: string) => void;
    private titleText: string;
    private placeholderText: string;

    constructor(app: App, title: string, placeholder: string, initialValue: string | null, onSubmit: (value: string) => void) {
        super(app);
        this.titleText = title;
        this.placeholderText = placeholder;
        this.onSubmit = onSubmit;
        this.value = initialValue || '0';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.titleText });

        const setting = new Setting(contentEl).setName("Amount");
        const stepperContainer = setting.controlEl.createDiv({ cls: 'dh-stepper-container' });

        const downBtn = stepperContainer.createEl('button', { text: '−' });
        const inputEl = stepperContainer.createEl('input', { type: 'number', value: this.value });
        const upBtn = stepperContainer.createEl('button', { text: '+' });

        const updateValue = (newValue: number) => {
            const val = Math.max(0, isNaN(newValue) ? 0 : newValue);
            inputEl.value = String(val);
            this.value = String(val);
        };

        downBtn.addEventListener('click', () => updateValue(parseInt(inputEl.value) - 1));
        upBtn.addEventListener('click', () => updateValue(parseInt(inputEl.value) + 1));
        inputEl.addEventListener('change', () => updateValue(parseInt(inputEl.value)));
        inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            }
        });


        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Update")
                    .setCta()
                    .onClick(() => {
                        this.submit();
                    }));
    }

    private submit() {
        if (parseInt(this.value) >= 0) {
            this.onSubmit(this.value);
        }
        this.close();
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}