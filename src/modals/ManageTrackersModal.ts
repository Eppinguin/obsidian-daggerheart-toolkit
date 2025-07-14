import { App, Modal, Setting, Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import DaggerheartStatblockPlugin from '../main';
import { Character, TokenTrackerState, InherentFeature, DomainCard } from '../types';

export class ManageTrackersModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    feature: InherentFeature | DomainCard;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, feature: InherentFeature | DomainCard) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.feature = feature;
    }

    onOpen() {
        this.modalEl.addClass('dh-manage-trackers-modal');
        this.titleEl.setText(`Manage Trackers for "${this.feature.name}"`);
        this.draw();
    }

    onClose() {
        this.contentEl.empty();
    }

    draw() {
        this.contentEl.empty();
        const { contentEl } = this;
        const allTrackers = this.character.trackers?.[this.feature.id] || [];

        const nativeTracker = allTrackers.find(t => t.id === 'native');
        const customTrackers = allTrackers.filter(t => t.id !== 'native');

        if (nativeTracker) {
            new Setting(contentEl)
                .setName("Native Tracker")
                .setDesc("This tracker is part of the card's rules and cannot be deleted.")
                .setClass('dh-native-tracker-setting');
        }

        contentEl.createEl('h4', { text: 'Custom Trackers' });
        if (customTrackers.length > 0) {
            customTrackers.forEach(tracker => {
                new Setting(contentEl)
                    .setName(tracker.name || 'Unnamed Tracker')
                    .setDesc(`Max: ${tracker.max}`)
                    .addButton(btn => btn
                        .setIcon('trash-2')
                        .setTooltip('Delete Tracker')
                        .setClass('mod-warning')
                        .onClick(() => this.deleteTracker(tracker.id)));
            });
        } else {
            contentEl.createEl('p', { text: 'No custom trackers yet.', cls: 'dh-empty-text' });
        }

        contentEl.createEl('hr');
        let nameInput: HTMLInputElement;
        let maxInput: HTMLInputElement;

        new Setting(contentEl)
            .setName('Tracker Name')
            .addText(text => { nameInput = text.setPlaceholder('e.g., Rage').inputEl; });

        new Setting(contentEl)
            .setName('Max Value')
            .addText(text => { maxInput = text.setPlaceholder('e.g., 5').inputEl; maxInput.type = 'number'; });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Add Tracker')
                .setCta()
                .onClick(() => {
                    const name = nameInput.value.trim();
                    const max = parseInt(maxInput.value, 10);
                    if (!name) { new Notice('Tracker name cannot be empty.'); return; }
                    if (isNaN(max) || max < 0) { new Notice('Max value must be a non-negative number.'); return; }
                    this.addTracker(name, max);
                }));
    }

    addTracker(name: string, max: number) {
        if (!this.character.trackers) this.character.trackers = {};
        if (!this.character.trackers[this.feature.id]) this.character.trackers[this.feature.id] = [];

        const newTracker: TokenTrackerState = { id: uuidv4(), name, tokens: 0, max };
        this.character.trackers[this.feature.id].push(newTracker);
        this.plugin.updateCharacter(this.character);
        this.draw();
    }

    deleteTracker(trackerId: string) {
        // This guard clause fixes the "possibly 'undefined'" errors
        if (!this.character.trackers?.[this.feature.id]) return;

        this.character.trackers[this.feature.id] = this.character.trackers[this.feature.id].filter(t => t.id !== trackerId);

        if (this.character.trackers[this.feature.id].length === 0) {
            delete this.character.trackers[this.feature.id];
        }

        if (Object.keys(this.character.trackers).length === 0) {
            delete this.character.trackers;
        }

        this.plugin.updateCharacter(this.character);
        this.draw();
    }
}