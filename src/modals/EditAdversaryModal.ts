import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { AdversaryInstance, StatblockData } from '../../types';
import { SaveChoiceModal } from './SaveChoiceModal';

export class EditAdversaryModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    adversary: AdversaryInstance;
    onSubmit: (updatedAdversary: AdversaryInstance) => void;
    originalName: string;
    isOriginalCustom: boolean;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, adversary: AdversaryInstance, onSubmit: (updatedAdversary: AdversaryInstance) => void) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
        this.adversary = JSON.parse(JSON.stringify(adversary));
        this.originalName = adversary.name;
        this.isOriginalCustom = !!adversary.isCustom;
    }

    onOpen() {
        this.modalEl.addClass('dh-edit-adversary-modal-root');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-edit-adversary-modal');

        const headerEl = contentEl.createDiv({ cls: 'modal-header' });
        headerEl.createEl("h2", { text: `Edit ${this.originalName}` });

        const contentBodyEl = contentEl.createDiv({ cls: 'modal-body' });

        if (this.adversary.category === 'environment') {
            this.renderEnvironmentEditor(contentBodyEl);
        } else {
            this.renderAdversaryEditor(contentBodyEl);
        }

        const footerEl = contentEl.createDiv({ cls: 'modal-footer' });
        const buttonContainer = footerEl.createDiv({ cls: 'dh-modal-buttons' });

        new ButtonComponent(buttonContainer)
            .setButtonText("Apply to Instance Only")
            .setTooltip("Applies changes to this instance without saving to the compendium")
            .onClick(() => {
                this.onSubmit(this.adversary);
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Save to Compendium & Apply")
            .setCta()
            .setTooltip("Saves changes to the compendium and applies them to this instance")
            .onClick(() => this.handleSave());
    }

    private handleSave() {
        const finalName = this.adversary.name?.trim();
        if (!finalName) {
            new Notice("Name cannot be empty.");
            return;
        }

        const nameHasChanged = finalName !== this.originalName;
        const fileName = this.adversary.category === 'environment' ? 'user-environments.json' : 'user-adversaries.json';

        // Clean instance-specific data before saving to compendium
        const dataToSave: StatblockData = { ...this.adversary };
        delete (dataToSave as any).id;
        delete (dataToSave as any).groupId;
        delete (dataToSave as any).currentHp;
        delete (dataToSave as any).currentStress;
        delete (dataToSave as any).displayName;
        delete (dataToSave as any).conditions;

        // When an item is saved to the compendium, it becomes a custom item.
        // We need to mark the instance being returned as custom so that subsequent
        // edits will have the correct options (e.g., "Rename").
        this.adversary.isCustom = true;

        const saveAsNew = async () => {
            await this.plugin.saveCustomCompendiumData(fileName, dataToSave);
            this.onSubmit(this.adversary);
            this.close();
        };

        const renameOriginal = async () => {
            await this.plugin.renameCustomCompendiumEntry(fileName, this.originalName, dataToSave);
            this.onSubmit(this.adversary);
            this.close();
        };

        if (nameHasChanged) {
            new SaveChoiceModal(
                this.app,
                finalName,
                saveAsNew,
                this.isOriginalCustom ? renameOriginal : undefined
            ).open();
        } else {
            this.plugin.saveCustomCompendiumData(fileName, dataToSave);
            this.onSubmit(this.adversary);
            this.close();
        }
    }

    renderAdversaryEditor(container: HTMLElement) {
        const basicInfoSection = container.createDiv({ cls: 'dh-modal-section' });
        basicInfoSection.createEl('h3', { text: "Basic Information" });
        const infoGrid = basicInfoSection.createDiv({ cls: 'dh-modal-field-grid' });

        const nameSetting = new Setting(infoGrid)
            .setName("Name")
            .setDesc("The base name of this creature type.")
            .addText(text => text
                .setValue(this.adversary.name)
                .onChange(val => this.adversary.name = val));
        nameSetting.settingEl.addClass('dh-grid-span-all');

        const imageSetting = new Setting(infoGrid).setName("Image URL").addText(text => text.setValue(this.adversary.image || '').onChange(val => this.adversary.image = val));
        imageSetting.settingEl.addClass('dh-grid-span-all');

        new Setting(infoGrid).setName("Tier").addText(text => text.setValue(String(this.adversary.tier || '')).onChange(val => this.adversary.tier = val));
        new Setting(infoGrid).setName("Type").addText(text => text.setValue(this.adversary.type || '').onChange(val => this.adversary.type = val));
        const descSetting = new Setting(infoGrid).setName("Description").addTextArea(text => text.setValue(this.adversary.description || '').onChange(val => this.adversary.description = val));
        descSetting.settingEl.addClass('dh-grid-span-all');
        let motives = Array.isArray(this.adversary.motives_tactics) ? this.adversary.motives_tactics.join(', ') : this.adversary.motives_tactics || '';
        const motivesSetting = new Setting(infoGrid).setName("Motives & Tactics").setDesc("Comma-separated").addTextArea(text => text.setValue(motives).onChange(val => this.adversary.motives_tactics = val.split(',').map(s => s.trim())));
        motivesSetting.settingEl.addClass('dh-grid-span-all');

        // ... The rest of the render methods (stats, attack, features) are unchanged
        const statsSection = container.createDiv({ cls: 'dh-modal-section' });
        statsSection.createEl('h3', { text: "Statistics" });
        const statsGrid = statsSection.createDiv({ cls: 'dh-modal-field-grid' });
        new Setting(statsGrid).setName("Difficulty").addText(text => text.setValue(String(this.adversary.difficulty || '')).onChange(val => this.adversary.difficulty = val));
        if (this.adversary.hp_stress) {
            new Setting(statsGrid).setName("Max HP").addText(text => text.setValue(String(this.adversary.hp_stress.hp)).onChange(val => { if (this.adversary.hp_stress) this.adversary.hp_stress.hp = Number(val) || 0; }));
            new Setting(statsGrid).setName("Max Stress").addText(text => text.setValue(String(this.adversary.hp_stress.stress)).onChange(val => { if (this.adversary.hp_stress) this.adversary.hp_stress.stress = Number(val) || 0; }));
            new Setting(statsGrid).setName("Major HP Threshold").addText(text => text.setValue(String(this.adversary.hp_stress.major_hp || '')).onChange(val => { if (this.adversary.hp_stress) this.adversary.hp_stress.major_hp = Number(val) || null; }));
            new Setting(statsGrid).setName("Severe HP Threshold").addText(text => text.setValue(String(this.adversary.hp_stress.severe_hp || '')).onChange(val => { if (this.adversary.hp_stress) this.adversary.hp_stress.severe_hp = Number(val) || null; }));
        }
        if (statsGrid.childElementCount % 2 !== 0) statsGrid.createDiv();

        const attackSection = container.createDiv({ cls: 'dh-modal-section' });
        attackSection.createEl('h3', { text: "Attack" });
        if (!this.adversary.attack) this.adversary.attack = { name: 'Attack', range: '', damage: '', modifier: '0' };
        const attackGrid = attackSection.createDiv({ cls: 'dh-modal-field-grid' });
        new Setting(attackGrid).setName("Attack Name").addText(text => text.setValue(this.adversary.attack?.name || '').onChange(val => { if (this.adversary.attack) this.adversary.attack.name = val; }));
        new Setting(attackGrid).setName("Range").addText(text => text.setValue(this.adversary.attack?.range || '').onChange(val => { if (this.adversary.attack) this.adversary.attack.range = val; }));
        new Setting(attackGrid).setName("Damage").addText(text => text.setValue(this.adversary.attack?.damage || '').onChange(val => { if (this.adversary.attack) this.adversary.attack.damage = val; }));
        new Setting(attackGrid).setName("Modifier").addText(text => text.setValue(String(this.adversary.attack?.modifier || '0')).onChange(val => { if (this.adversary.attack) this.adversary.attack.modifier = val; }));

        const featuresSection = container.createDiv({ cls: 'dh-modal-section' });
        featuresSection.createEl('h3', { text: "Features" });
        const featuresContainer = featuresSection.createDiv({ cls: 'dh-features-editor' });
        this.renderFeaturesEditor(featuresContainer);
    }

    renderEnvironmentEditor(container: HTMLElement) {
        const basicInfoSection = container.createDiv({ cls: 'dh-modal-section' });
        basicInfoSection.createEl('h3', { text: "Basic Information" });
        const infoGrid = basicInfoSection.createDiv({ cls: 'dh-modal-field-grid' });

        const nameSetting = new Setting(infoGrid)
            .setName("Name")
            .setDesc("The name of this environment.")
            .addText(text => text
                .setValue(this.adversary.name)
                .onChange(val => this.adversary.name = val));
        nameSetting.settingEl.addClass('dh-grid-span-all');

        new Setting(infoGrid).setName("Tier").addText(text => text.setValue(String(this.adversary.tier || '')).onChange(val => this.adversary.tier = val));
        new Setting(infoGrid).setName("Type").addText(text => text.setValue(this.adversary.type || '').onChange(val => this.adversary.type = val));
        const descSetting = new Setting(infoGrid).setName("Description").addTextArea(text => text.setValue(this.adversary.description || '').onChange(val => this.adversary.description = val));
        descSetting.settingEl.addClass('dh-grid-span-all');

        // ... The rest of this method is unchanged
        const envDetailsSection = container.createDiv({ cls: 'dh-modal-section' });
        envDetailsSection.createEl('h3', { text: "Environment Details" });
        const detailsGrid = envDetailsSection.createDiv({ cls: 'dh-modal-field-grid' });
        new Setting(detailsGrid).setName("Difficulty").addText(text => text.setValue(String(this.adversary.difficulty || '')).onChange(val => this.adversary.difficulty = val));

        const impulsesSetting = new Setting(detailsGrid)
            .setName("Impulses")
            .addTextArea(text => text.setValue(this.adversary.impulses || '').onChange(val => this.adversary.impulses = val));
        impulsesSetting.settingEl.addClass('dh-grid-span-all');

        const paSetting = new Setting(detailsGrid)
            .setName("Potential Adversaries")
            .addTextArea(text => text.setValue(this.adversary.potential_adversaries || '').onChange(val => this.adversary.potential_adversaries = val));
        paSetting.settingEl.addClass('dh-grid-span-all');

        const featuresSection = container.createDiv({ cls: 'dh-modal-section' });
        featuresSection.createEl('h3', { text: "Feats" });
        const featuresContainer = featuresSection.createDiv({ cls: 'dh-features-editor' });
        this.renderFeaturesEditor(featuresContainer);
    }

    renderFeaturesEditor(container: HTMLElement) {
        container.empty();
        if (!this.adversary.features) this.adversary.features = [];
        this.adversary.features.forEach((feature, index) => {
            const featureEl = container.createDiv({ cls: 'dh-feature-editor-item' });
            new Setting(featureEl).setName(`Feature #${index + 1}`).addText(text => text.setPlaceholder("Name").setValue(feature.name).onChange(val => feature.name = val)).addText(text => text.setPlaceholder("Type (e.g. Action)").setValue(feature.type).onChange(val => feature.type = val));
            const featureDescSetting = new Setting(featureEl).addTextArea(text => text.setPlaceholder("Description").setValue(feature.description).onChange(val => feature.description = val));
            featureDescSetting.controlEl.addClass('dh-feature-desc-input');
            featureDescSetting.nameEl.addClass('visually-hidden');
            const featureControls = featureEl.createDiv({ cls: 'dh-feature-controls' });
            new ButtonComponent(featureControls).setIcon("trash").setTooltip("Remove Feature").setClass('dh-feature-remove-btn').onClick(() => { if (this.adversary.features) { this.adversary.features.splice(index, 1); this.renderFeaturesEditor(container); } });
        });
        new ButtonComponent(container).setButtonText("Add Feature").setClass('dh-add-feature-btn').onClick(() => { if (!this.adversary.features) this.adversary.features = []; this.adversary.features.push({ name: 'New Feature', type: 'Passive', description: '' }); this.renderFeaturesEditor(container); });
    }

    onClose() {
        this.modalEl.removeClass('dh-edit-adversary-modal-root');
        this.contentEl.empty();
    }
}
