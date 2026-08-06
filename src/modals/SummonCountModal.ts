import { App, Modal, Setting, ButtonComponent, TextComponent } from 'obsidian';

/**
 * Ask how many creatures a summon brings in.
 *
 * Only reached when the feature rolls for the count ("summon 1d4 Vampires")
 * and no dice roller is configured, so the number has to come from the GM
 * rolling physical dice.
 */
export class SummonCountModal extends Modal {
    private input!: TextComponent;

    constructor(
        app: App,
        private creatureName: string,
        private diceExpression: string,
        private onSubmit: (count: number) => void,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-name-modal');
        contentEl.createEl('h2', { text: `Summon ${this.creatureName}` });
        contentEl.createEl('p', {
            text: `This feature summons ${this.diceExpression}. Roll it and enter the result.`,
            cls: 'dh-summon-count-hint',
        });

        new Setting(contentEl).setName('How many?').addText((text) => {
            this.input = text;
            text.setPlaceholder('1').setValue('1');
            text.inputEl.type = 'number';
            text.inputEl.min = '1';
            text.inputEl.addClass('dh-modal-input');
            text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.submit();
                }
            });
            this.app.workspace.onLayoutReady(() => {
                text.inputEl.focus();
                text.inputEl.select();
            });
        });

        const buttons = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttons)
            .setButtonText('Summon')
            .setCta()
            .onClick(() => this.submit());
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
    }

    private submit() {
        const parsed = parseInt(this.input.getValue(), 10);
        // A bad value simply keeps the dialog open: cancelling is already one
        // click away, so there is nothing useful to say here.
        if (!Number.isFinite(parsed) || parsed <= 0) {
            this.input.inputEl.focus();
            this.input.inputEl.select();
            return;
        }
        this.onSubmit(parsed);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
