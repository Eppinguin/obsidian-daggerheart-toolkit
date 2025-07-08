import { App, Modal, Setting, TextAreaComponent, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { JsonAncestry, JsonClass, JsonSubclass, JsonFeat, JsonCommunity } from '../../types';
import { SaveChoiceModal } from './SaveChoiceModal';

type CompendiumType = 'Class' | 'Subclass' | 'Ancestry' | 'Community';

class FeatureEditModal extends Modal {
    constructor(
        app: App,
        private feature: JsonFeat,
        private onSave: (feature: JsonFeat) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Edit Feature' });

        new Setting(contentEl)
            .setName('Feature Name')
            .addText(text => text
                .setValue(this.feature.name)
                .onChange(value => this.feature.name = value));

        new Setting(contentEl)
            .setName('Feature Text')
            .addTextArea(text => {
                text.setValue(this.feature.text)
                    .onChange(value => this.feature.text = value);
                text.inputEl.rows = 6;
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    if (!this.feature.name || !this.feature.text) {
                        new Notice('Feature name and text cannot be empty.');
                        return;
                    }
                    this.onSave(this.feature);
                    this.close();
                }));
    }
}
export class CompendiumCreatorModal extends Modal {
    private data: Partial<JsonClass & JsonSubclass & JsonAncestry & JsonCommunity> = {};
    private features: JsonFeat[] = [];
    private featureListEl: HTMLElement;
    private originalName: string;
    private isOriginalCustom: boolean;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        private type: CompendiumType,
        private itemToEdit?: Partial<JsonClass & JsonSubclass & JsonAncestry & JsonCommunity>
    ) {
        super(app);
        this.data = this.itemToEdit ? JSON.parse(JSON.stringify(this.itemToEdit)) : {};
        this.originalName = this.itemToEdit?.name || '';
        this.isOriginalCustom = !!this.itemToEdit?.isCustom;

        if (this.itemToEdit && this.data) {
            if ('feats' in this.data && this.data.feats) this.features = this.data.feats;
            else if ('class_feats' in this.data && this.data.class_feats) this.features = this.data.class_feats;
            else if ('foundations' in this.data && this.data.foundations) this.features = this.data.foundations;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        const isEditing = !!this.itemToEdit;
        contentEl.createEl('h2', { text: isEditing ? `Edit ${this.type}` : `Create New ${this.type}` });

        new Setting(contentEl)
            .setName('Name')
            .addText(text => text
                .setValue(this.data.name || '')
                .onChange(value => {
                    this.data.name = value
                }));


        new Setting(contentEl)
            .setName('Description')
            .addTextArea(text => {
                text.setValue(this.data.description || '')
                    .onChange(value => this.data.description = value);
                text.inputEl.rows = 4;
            });

        // Type-specific fields
        if (this.type === 'Class') {
            this.renderClassFields(contentEl);
        } else if (this.type === 'Subclass') {
            this.renderSubclassFields(contentEl);
        }

        // Feature list for types that have them
        if (this.type === 'Ancestry' || this.type === 'Class' || this.type === 'Subclass' || this.type === 'Community') {
            this.renderFeatureEditor(contentEl);
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => this.handleSave()));
    }

    private renderClassFields(parentEl: HTMLElement) {
        const d = this.data as Partial<JsonClass>;
        new Setting(parentEl).setName('Domain 1').addText(text => text.setValue(d.domain_1 || '').onChange(v => d.domain_1 = v));
        new Setting(parentEl).setName('Domain 2').addText(text => text.setValue(d.domain_2 || '').onChange(v => d.domain_2 = v));
        new Setting(parentEl).setName('Evasion').addText(text => text.setValue(d.evasion || '').onChange(v => d.evasion = v));
        new Setting(parentEl).setName('HP').addText(text => text.setValue(d.hp || '').onChange(v => d.hp = v));
        new Setting(parentEl).setName('Starting Items').setDesc('Comma-separated list of items.').addText(text => text.setValue(d.items || '').onChange(v => d.items = v));
        new Setting(parentEl).setName('Hope Feat Name').addText(text => text.setValue(d.hope_feat_name || '').onChange(v => d.hope_feat_name = v));
        new Setting(parentEl).setName('Hope Feat Text').addTextArea(text => text.setValue(d.hope_feat_text || '').onChange(v => d.hope_feat_text = v));
        new Setting(parentEl).setName('Subclass 1 Name').addText(text => text.setValue(d.subclass_1 || '').onChange(v => d.subclass_1 = v));
        new Setting(parentEl).setName('Subclass 2 Name').addText(text => text.setValue(d.subclass_2 || '').onChange(v => d.subclass_2 = v));

        // Add new fields for suggestions
        parentEl.createEl('h4', { text: 'Suggestions (Optional)' });
        new Setting(parentEl).setName('Suggested Traits').setDesc('Comma-separated values, e.g., +2, +1, +1, 0, 0, -1').addText(text => text.setValue(d.suggested_traits || '').onChange(v => d.suggested_traits = v));
        new Setting(parentEl).setName('Suggested Primary Weapon').addText(text => text.setValue(d.suggested_primary || '').onChange(v => d.suggested_primary = v));
        new Setting(parentEl).setName('Suggested Secondary Weapon').addText(text => text.setValue(d.suggested_secondary || '').onChange(v => d.suggested_secondary = v));
        new Setting(parentEl).setName('Suggested Armor').addText(text => text.setValue(d.suggested_armor || '').onChange(v => d.suggested_armor = v));
    }

    private renderSubclassFields(parentEl: HTMLElement) {
        const d = this.data as Partial<JsonSubclass>;
        new Setting(parentEl).setName('Spellcasting Trait (Optional)').addText(text => text.setValue(d.spellcast_trait || '').onChange(v => d.spellcast_trait = v));
    }

    private renderFeatureEditor(parentEl: HTMLElement) {
        let featureType = 'Features';
        if (this.type === 'Subclass') featureType = 'Foundations';
        if (this.type === 'Ancestry' || this.type === 'Community') featureType = 'Feats';
        if (this.type === 'Class') featureType = 'Class Feats';

        parentEl.createEl('h3', { text: featureType });
        this.featureListEl = parentEl.createDiv('dh-feature-list');
        this.redrawFeatureList();

        new Setting(parentEl)
            .addButton(btn => btn
                .setButtonText(`Add ${featureType.slice(0, -1)}`)
                .onClick(() => {
                    const newFeature: JsonFeat = { name: '', text: '' };
                    new FeatureEditModal(this.app, newFeature, (savedFeature) => {
                        this.features.push(savedFeature);
                        this.redrawFeatureList();
                    }).open();
                }));
    }

    private redrawFeatureList() {
        this.featureListEl.empty();
        this.features.forEach((feat, index) => {
            const itemEl = this.featureListEl.createDiv('dh-feature-list-item');
            itemEl.createSpan({ text: feat.name });
            const controls = itemEl.createDiv('dh-feature-list-item-controls');
            controls.createEl('button', { text: 'Edit' }).addEventListener('click', () => {
                new FeatureEditModal(this.app, { ...feat }, (savedFeature) => {
                    this.features[index] = savedFeature;
                    this.redrawFeatureList();
                }).open();
            });
            controls.createEl('button', { text: 'Remove' }).addEventListener('click', () => {
                this.features.splice(index, 1);
                this.redrawFeatureList();
            });
        });
    }

    private async handleSave() {
        const finalName = this.data.name?.trim();
        if (!finalName) {
            new Notice(`${this.type} name is required.`);
            return;
        }

        // Assign features to the correct property on the data object
        if (this.type === 'Ancestry' || this.type === 'Community') {
            (this.data as JsonAncestry).feats = this.features;
        } else if (this.type === 'Class') {
            (this.data as JsonClass).class_feats = this.features;
            if (!this.itemToEdit) {
                (this.data as JsonClass).backgrounds = [];
                (this.data as JsonClass).connections = [];
            }
        } else if (this.type === 'Subclass') {
            (this.data as JsonSubclass).foundations = this.features;
            if (!this.itemToEdit) {
                (this.data as JsonSubclass).specializations = [];
                (this.data as JsonSubclass).masteries = [];
            }
        }

        const nameHasChanged = finalName !== this.originalName;
        const fileName = this.getCompendiumFileName();
        const dataToSave = { ...this.data, isCustom: true };

        const saveAsNew = async () => {
            await this.plugin.saveCustomCompendiumData(fileName, dataToSave);
            this.close();
        };

        const renameOriginal = async () => {
            await this.plugin.renameCustomCompendiumEntry(fileName, this.originalName, dataToSave);
            this.close();
        };

        if (nameHasChanged && this.isOriginalCustom) {
            new SaveChoiceModal(this.app, finalName, saveAsNew, renameOriginal).open();
        } else {
            await this.plugin.saveCustomCompendiumData(fileName, dataToSave);
            this.close();
        }
    }

    private getCompendiumFileName(): string {
        switch (this.type) {
            case 'Class': return 'user-classes.json';
            case 'Subclass': return 'user-subclasses.json';
            case 'Ancestry': return 'user-ancestries.json';
            case 'Community': return 'user-communities.json';
            default: throw new Error(`Unknown compendium type: ${this.type}`);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
