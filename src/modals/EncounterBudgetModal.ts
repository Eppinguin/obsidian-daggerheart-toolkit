import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { EncounterBudgetConfig } from '../types';

export class EncounterBudgetModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    onSave: () => void;
    config: EncounterBudgetConfig;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        this.config = JSON.parse(JSON.stringify(plugin.settings.encounterBudgetConfig));
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-budget-modal');
        contentEl.createEl("h2", { text: "Encounter Budget Settings" });

        new Setting(contentEl).setName("Player Characters").setDesc("The number of PCs in the combat.").addText(text => text.setPlaceholder('4').setValue(this.config.playerCount.toString()).onChange(value => { const count = parseInt(value); if (!isNaN(count) && count >= 0) this.config.playerCount = count; }));
        contentEl.createEl('h4', { text: 'Battle Point Adjustments' });
        new Setting(contentEl).setName('Easier/Shorter Fight (-1)').setDesc('Reduces total Battle Points for a quicker encounter.').addToggle(toggle => toggle.setValue(this.config.isEasier).onChange(value => { this.config.isEasier = value; if (value) this.config.isHarder = false; this.onOpen(); }));
        new Setting(contentEl).setName('Harder/Longer Fight (+2)').setDesc('Increases total Battle Points for a more challenging encounter.').addToggle(toggle => toggle.setValue(this.config.isHarder).onChange(value => { this.config.isHarder = value; if (value) this.config.isEasier = false; this.onOpen(); }));
        new Setting(contentEl).setName('Boosted Damage (-2)').setDesc('Applies if you add +1d4 (or +2) to all adversary damage rolls.').addToggle(toggle => toggle.setValue(this.config.isDamageBoosted).onChange(value => this.config.isDamageBoosted = value));
        new Setting(contentEl).setName('Lower Tier Adversary (+1)').setDesc('Applies if you choose an adversary from a lower tier than the party.').addToggle(toggle => toggle.setValue(this.config.useLowerTier).onChange(value => this.config.useLowerTier = value));
        const buttonContainer = contentEl.createDiv({ cls: 'dh-modal-buttons' });
        new ButtonComponent(buttonContainer).setButtonText("Save & Close").setCta().onClick(() => { this.plugin.settings.encounterBudgetConfig = this.config; this.plugin.saveSettings(); this.onSave(); this.close(); });
    }

    onClose() {
        this.contentEl.empty();
    }
}
