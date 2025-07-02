import { App, Modal, Setting, Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../../main';
import { Character, DomainCard } from '../../types';
import { createAvatarEditor } from '../views/components/AvatarEditor';
import { TRAIT_NAMES } from '../constants';

export class CharacterManagerModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;

    private tempCharacter: Character;
    private selectedCurrentFeatureId: string | null = null;
    private selectedNewFeatureId: string | null = null;
    private replaceBtn: HTMLButtonElement;
    private featureListsContainer: HTMLElement;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.tempCharacter = JSON.parse(JSON.stringify(character));
        this.onSave = onSave;
        this.modalEl.addClass('dh-character-manager-modal');
    }

    onOpen() {
        this.contentEl.empty();
        const { contentEl } = this;

        // By wrapping the content creation in requestAnimationFrame, we ensure that the modal's
        // initial layout and CSS have been calculated by the browser before we add our components.
        // This solves the race condition where the avatar container had no dimensions when the image transform was applied.
        requestAnimationFrame(() => {
            contentEl.createEl("h1", { text: `Manage ${this.character.name}` });

            this.drawCoreDetails(contentEl.createDiv());
            this.drawHeritageAndClass(contentEl.createDiv());
            this.drawVitalsEditor(contentEl.createDiv());
            this.drawTraitsEditor(contentEl.createDiv());
            this.drawExperiencesEditor(contentEl.createDiv());
            this.drawFeatureReplacement(contentEl.createDiv());

            const footer = contentEl.createDiv({ cls: 'dh-modal-footer' });
            footer.createEl('button', { text: 'Save & Close', cls: 'mod-cta' }).addEventListener('click', () => {
                this.onSave(this.tempCharacter);
                this.close();
            });
        });
    }

    private drawCoreDetails(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Core Details' });
        new Setting(container)
            .setName('Character Name')
            .addText(text => text
                .setValue(this.tempCharacter.name)
                .onChange(value => this.tempCharacter.name = value));

        new Setting(container)
            .setName('Level')
            .addText(text => text
                .setValue(String(this.tempCharacter.level))
                .onChange(value => {
                    const level = parseInt(value);
                    if (!isNaN(level)) {
                        this.tempCharacter.level = level;
                    }
                }));

        createAvatarEditor(
            container,
            this.tempCharacter.avatarUrl || '',
            this.tempCharacter.avatarTransform,
            (newUrl) => {
                // The editor now handles transform resets, so we only need to update the URL.
                this.tempCharacter.avatarUrl = newUrl || null;
            },
            (newTransform) => {
                this.tempCharacter.avatarTransform = newTransform;
            }
        );
    }

    private drawHeritageAndClass(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section is-grid' });

        new Setting(container)
            .setName('Ancestry')
            .addDropdown(dd => {
                this.plugin.compendium.ancestries.forEach(a => dd.addOption(a.name, a.name));
                dd.setValue(this.tempCharacter.ancestryId)
                    .onChange(value => this.tempCharacter.ancestryId = value);
            });

        new Setting(container)
            .setName('Community')
            .addDropdown(dd => {
                this.plugin.compendium.communities.forEach(c => dd.addOption(c.name, c.name));
                dd.setValue(this.tempCharacter.communityId)
                    .onChange(value => this.tempCharacter.communityId = value);
            });

        new Setting(container)
            .setName('Class')
            .addDropdown(dd => {
                this.plugin.compendium.classes.forEach(c => dd.addOption(c.name, c.name));
                dd.setValue(this.tempCharacter.classId)
                    .onChange(value => this.tempCharacter.classId = value);
            });

        new Setting(container)
            .setName('Subclass')
            .addDropdown(dd => {
                const charClass = this.plugin.compendium.getClass(this.tempCharacter.classId);
                if (charClass) {
                    const subclasses = [this.plugin.compendium.getSubclass(charClass.subclass_1), this.plugin.compendium.getSubclass(charClass.subclass_2)].filter(s => s);
                    subclasses.forEach(subclass => {
                        if (subclass) dd.addOption(subclass.name, subclass.name);
                    });
                }
                dd.setValue(this.tempCharacter.subclassId)
                    .onChange(value => this.tempCharacter.subclassId = value);
            });
    }

    private drawVitalsEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section is-grid' });

        new Setting(container).setName("Max HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.max)).onChange(v => this.tempCharacter.hitPoints.max = parseInt(v) || 0));
        new Setting(container).setName("Current HP").addText(text => text.setValue(String(this.tempCharacter.hitPoints.current)).onChange(v => this.tempCharacter.hitPoints.current = parseInt(v) || 0));
        new Setting(container).setName("Max Stress").addText(text => text.setValue(String(this.tempCharacter.stress.max)).onChange(v => this.tempCharacter.stress.max = parseInt(v) || 0));
        new Setting(container).setName("Current Stress").addText(text => text.setValue(String(this.tempCharacter.stress.current)).onChange(v => this.tempCharacter.stress.current = parseInt(v) || 0));
        new Setting(container).setName("Max Hope").addText(text => text.setValue(String(this.tempCharacter.hope.max)).onChange(v => this.tempCharacter.hope.max = parseInt(v) || 0));
        new Setting(container).setName("Current Hope").addText(text => text.setValue(String(this.tempCharacter.hope.current)).onChange(v => this.tempCharacter.hope.current = parseInt(v) || 0));
        new Setting(container).setName("Evasion").addText(text => text.setValue(String(this.tempCharacter.evasion)).onChange(v => this.tempCharacter.evasion = parseInt(v) || 0));
    }

    private drawTraitsEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Traits' });
        const grid = container.createDiv({ cls: 'is-grid' });
        TRAIT_NAMES.forEach(traitName => {
            new Setting(grid)
                .setName(traitName)
                .addText(text => text
                    .setValue(String(this.tempCharacter.traits[traitName].value))
                    .onChange(value => this.tempCharacter.traits[traitName].value = parseInt(value) || 0)
                );
        });
    }

    private drawExperiencesEditor(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Experiences' });
        const experiencesContainer = container.createDiv();

        const redrawExperiences = () => {
            experiencesContainer.empty();
            this.tempCharacter.experiences.forEach((exp, index) => {
                new Setting(experiencesContainer)
                    .setName(`Experience ${index + 1}`)
                    .addText(text => text
                        .setPlaceholder('Name')
                        .setValue(exp.name)
                        .onChange(value => exp.name = value))
                    .addText(text => text
                        .setPlaceholder('Value')
                        .setValue(String(exp.value))
                        .onChange(value => exp.value = parseInt(value) || 0))
                    .addExtraButton(btn => btn
                        .setIcon('trash')
                        .setTooltip('Remove Experience')
                        .onClick(() => {
                            this.tempCharacter.experiences.splice(index, 1);
                            redrawExperiences();
                        }));
            });
        };

        new Setting(container).addButton(btn => btn.setButtonText("Add Experience").onClick(() => {
            this.tempCharacter.experiences.push({ _type: 'experience', id: uuidv4(), name: '', description: '', value: 0 });
            redrawExperiences();
        }));

        redrawExperiences();
    }


    private drawFeatureReplacement(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-manager-section' });
        container.createEl('h2', { text: 'Replace Domain Feature' });
        container.createEl("p", { text: "Select one of your current domain features to replace, and then select an available feature from your class domains to learn." });

        this.featureListsContainer = container.createDiv({ cls: 'dh-replace-feature-container' });
        this.redrawFeatureLists();

        const buttonContainer = container.createDiv({ cls: 'dh-modal-footer-bar' });
        this.replaceBtn = buttonContainer.createEl('button', { text: 'Replace Selected Feature' });
        this.replaceBtn.disabled = true;
        this.replaceBtn.addEventListener('click', () => this.handleReplace());
    }

    private redrawFeatureLists() {
        this.featureListsContainer.empty();
        this.drawCurrentFeatures(this.featureListsContainer.createDiv());
        this.drawAvailableFeatures(this.featureListsContainer.createDiv());
    }

    private drawCurrentFeatures(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Your Current Features' });
        const listEl = parent.createDiv({ cls: 'dh-feature-list' });
        const currentDomainFeatures = this.tempCharacter.features;

        currentDomainFeatures.forEach(feature => {
            const itemEl = listEl.createDiv({ cls: 'dh-feature-list-item' });
            itemEl.createDiv({ cls: 'dh-feature-list-item-name', text: feature.name });
            const metadata = this.getFeatureMetadata(feature);
            if (metadata.domain) {
                itemEl.createDiv({ cls: 'dh-feature-list-item-sub', text: `Domain: ${metadata.domain}` });
            }
            itemEl.dataset.featureId = feature.id;

            if (this.selectedCurrentFeatureId === feature.id) {
                itemEl.addClass('is-selected');
            }

            itemEl.addEventListener('click', () => {
                this.selectedCurrentFeatureId = feature.id;
                listEl.querySelectorAll('.dh-feature-list-item').forEach(el => el.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.updateButtonState();
            });
        });
    }

    private drawAvailableFeatures(parent: HTMLElement) {
        parent.createEl('h3', { text: 'Available Replacements' });
        const listEl = parent.createDiv({ cls: 'dh-feature-list' });

        const charClass = this.plugin.compendium.getClass(this.tempCharacter.classId);
        if (!charClass) return;

        const classDomains = [charClass.domain_1, charClass.domain_2];
        const currentFeatureIds = this.tempCharacter.features.map(f => f.id);

        const availableFeatures = this.plugin.compendium.abilities.filter(f => {
            const isDomainCard = classDomains.some(d => d.toLowerCase() === f.domain?.toLowerCase());
            const isNotOwned = !currentFeatureIds.includes(f.name);
            return isDomainCard && isNotOwned && (parseInt(f.level) ?? 1) <= this.tempCharacter.level;
        });

        if (availableFeatures.length === 0) {
            listEl.createDiv({ cls: 'dh-empty-text', text: 'No available features to learn at this time.' });
        }

        availableFeatures.forEach(feature => {
            const itemEl = listEl.createDiv({ cls: 'dh-feature-list-item' });
            itemEl.createDiv({ cls: 'dh-feature-list-item-name', text: feature.name });
            if (feature.domain) {
                itemEl.createDiv({ cls: 'dh-feature-list-item-sub', text: `Domain: ${feature.domain}` });
            }
            itemEl.dataset.featureId = feature.name;

            if (this.selectedNewFeatureId === feature.name) {
                itemEl.addClass('is-selected');
            }

            itemEl.addEventListener('click', () => {
                this.selectedNewFeatureId = feature.name;
                listEl.querySelectorAll('.dh-feature-list-item').forEach(el => el.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.updateButtonState();
            });
        });
    }

    private updateButtonState() {
        if (this.selectedCurrentFeatureId && this.selectedNewFeatureId) {
            this.replaceBtn.disabled = false;
        } else {
            this.replaceBtn.disabled = true;
        }
    }

    private handleReplace() {
        if (!this.selectedCurrentFeatureId || !this.selectedNewFeatureId) return;

        const newAbility = this.plugin.compendium.abilities.find(a => a.name === this.selectedNewFeatureId);
        if (!newAbility) {
            new Notice("Error: Could not find the selected feature to learn.");
            return;
        }

        const featureIndex = this.tempCharacter.features.findIndex(f => f.id === this.selectedCurrentFeatureId);
        if (featureIndex === -1) {
            new Notice("Error: Could not find the feature to replace.");
            return;
        }

        const newFeature: DomainCard = {
            _type: 'domainCard',
            id: newAbility.name,
            name: newAbility.name,
            description: newAbility.text,
            level: parseInt(newAbility.level),
            domain: newAbility.domain,
            type: newAbility.type,
            recall: parseInt(newAbility.recall) || 0
        };

        this.tempCharacter.features[featureIndex] = newFeature;

        new Notice(`Replaced feature with ${newFeature.name}. Save to apply changes.`);

        this.selectedCurrentFeatureId = null;
        this.selectedNewFeatureId = null;
        this.redrawFeatureLists();
        this.updateButtonState();
    }

    private getFeatureMetadata(feature: DomainCard): { level?: number; domain?: string; type?: string; } {
        const metadata: { level?: number; domain?: string; type?: string; } = {};
        if (feature && feature._type === 'domainCard') {
            metadata.level = feature.level;
            metadata.domain = feature.domain;
            metadata.type = feature.type;
        }
        return metadata;
    }

    onClose() {
        this.contentEl.empty();
    }
}
