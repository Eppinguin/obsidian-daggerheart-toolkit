import { App, Modal, Setting, Notice } from 'obsidian';
import { Character } from '../types';
import DaggerheartStatblockPlugin from '../main';
import { getTier } from 'src/constants';

type RestType = 'short' | 'long';
type DowntimeMove = {
    id: 'tend-wounds' | 'clear-stress' | 'repair-armor' | 'prepare' | 'tend-all-wounds' | 'clear-all-stress' | 'repair-all-armor' | 'work-on-project';
    name: string;
    description: string;
};

export class DowntimeModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private character: Character;
    private onSave: (character: Character) => void;
    private selectedMoves: { [key: string]: number } = {};
    private restType: RestType = 'short';
    private readonly movesAllowed: number = 2;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.onSave = onSave;
        this.modalEl.addClass('dh-downtime-modal');
    }


    onOpen() {
        this.contentEl.empty();
        this.titleEl.setText('Take a Rest');
        this.draw();
    }

    private draw() {
        this.contentEl.empty();

        new Setting(this.contentEl)
            .setName('Rest Type')
            .setDesc(this.restType === 'short' ? 'A short rest takes about an hour.' : 'A long rest takes several hours.')
            .addDropdown(dd => dd
                .addOption('short', 'Short Rest')
                .addOption('long', 'Long Rest')
                .setValue(this.restType)
                .onChange((value: RestType) => {
                    this.restType = value;
                    this.selectedMoves = {};
                    this.draw();
                }));

        this.contentEl.createEl('h3', { text: 'Downtime Moves' });
        const moveContainer = this.contentEl.createDiv({ cls: 'dh-downtime-moves' });
        const movesSelectedCount = Object.values(this.selectedMoves).reduce((a, b) => a + b, 0);
        moveContainer.createEl('p', { text: `Choose ${this.movesAllowed - movesSelectedCount} more moves.` });

        const availableMoves = this.getAvailableMoves();
        const totalSelected = Object.values(this.selectedMoves).reduce((a, b) => a + b, 0);

        availableMoves.forEach(move => {
            const moveSetting = new Setting(moveContainer)
                .setName(move.name)
                .setDesc(move.description);

            const timesSelected = this.selectedMoves[move.id] || 0;

            if (timesSelected > 0) {
                moveSetting.controlEl.createSpan({ text: `Selected ${timesSelected}x`, cls: 'dh-move-selected-count' });

                // Add the MINUS button first when an item is selected
                moveSetting.addButton(btn => btn
                    .setIcon('minus-circle')
                    .setTooltip('Remove this move')
                    .onClick(() => {
                        this.selectedMoves[move.id]--;
                        if (this.selectedMoves[move.id] === 0) {
                            delete this.selectedMoves[move.id];
                        }
                        this.draw();
                    }));
            }

            moveSetting.addButton(btn => {
                btn
                    .setIcon('plus-circle')
                    .setTooltip('Add this move')
                    .onClick(() => {
                        const currentTotalSelected = Object.values(this.selectedMoves).reduce((a, b) => a + b, 0);
                        if (currentTotalSelected < this.movesAllowed) {
                            this.selectedMoves[move.id] = (this.selectedMoves[move.id] || 0) + 1;
                            this.draw();
                        }
                    });
                // Disable the plus button if max moves are selected
                if (totalSelected >= this.movesAllowed) {
                    btn.setDisabled(true);
                }
            });
        });

        const footer = this.contentEl.createDiv({ cls: 'modal-button-container' });
        footer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const confirmBtn = footer.createEl('button', { text: 'Confirm Rest', cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => this.handleConfirm());

        if (movesSelectedCount !== this.movesAllowed) {
            confirmBtn.disabled = true;
        }
    }

    private getAvailableMoves(): DowntimeMove[] {
        const level = this.character.level;
        let tier = 1;
        if (level >= 8) tier = 4;
        else if (level >= 5) tier = 3;
        else if (level >= 2) tier = 2;

        if (this.restType === 'long') {
            return [
                { id: 'tend-all-wounds', name: 'Tend to All Wounds', description: 'Clear all marked Hit Points.' },
                { id: 'clear-all-stress', name: 'Clear All Stress', description: 'Clear all marked Stress.' },
                { id: 'repair-all-armor', name: 'Repair All Armor', description: 'Clear all marked Armor Slots.' },
                { id: 'prepare', name: 'Prepare', description: 'Gain 1 Hope (or 2 if with others).' },
                { id: 'work-on-project', name: 'Work on a Project', description: 'Make progress on a long-term project.' }
            ];
        } else { // Short rest
            return [
                { id: 'tend-wounds', name: 'Tend to Wounds', description: `Clear 1d4 + Tier (${tier}) Hit Points.` },
                { id: 'clear-stress', name: 'Clear Stress', description: `Clear 1d4 + Tier (${tier}) Stress.` },
                { id: 'repair-armor', name: 'Repair Armor', description: `Clear 1d4 + Tier (${tier}) Armor Slots.` },
                { id: 'prepare', name: 'Prepare', description: 'Gain 1 Hope (or 2 if with others).' },
            ];
        }
    }

    private async handleConfirm() {
        this.modalEl.addClass('is-loading');

        for (const moveId in this.selectedMoves) {
            const count = this.selectedMoves[moveId];
            for (let i = 0; i < count; i++) {
                await this.applyMove(moveId as DowntimeMove['id']);
            }
        }

        this.onSave(this.character);
        this.close();
    }

    private async applyMove(moveId: DowntimeMove['id']) {
        const level = this.character.level;
        const tier = getTier(level);

        switch (moveId) {
            case 'tend-wounds': {
                const cleared = await this.plugin.rollDice(`1d4+${tier}`, 'HP Cleared');
                if (cleared !== null) {
                    this.character.hitPoints.current = Math.max(0, this.character.hitPoints.current - cleared);
                }
                break;
            }
            case 'clear-stress': {
                const cleared = await this.plugin.rollDice(`1d4+${tier}`, 'Stress Cleared');
                if (cleared !== null) {
                    this.character.stress.current = Math.max(0, this.character.stress.current - cleared);
                }
                break;
            }
            case 'repair-armor': {
                const cleared = await this.plugin.rollDice(`1d4+${tier}`, 'Armor Slots Cleared');
                if (cleared !== null) {
                    this.character.armorSlots.current = Math.max(0, this.character.armorSlots.current - cleared);
                }
                break;
            }
            case 'prepare':
                const maxHope = this.character.hope.max.getValue(this.character);
                this.character.hope.current = Math.min(maxHope, this.character.hope.current + 2);
                new Notice(`${this.character.name} gained 2 Hope.`);
                break;
            case 'tend-all-wounds':
                this.character.hitPoints.current = 0;
                new Notice(`${this.character.name} cleared all HP.`);
                break;
            case 'clear-all-stress':
                this.character.stress.current = 0;
                new Notice(`${this.character.name} cleared all Stress.`);
                break;
            case 'repair-all-armor':
                this.character.armorSlots.current = 0;
                new Notice(`${this.character.name} repaired all Armor Slots.`);
                break;
            case 'work-on-project':
                new Notice(`${this.character.name} works on a project... (GM to adjudicate).`);
                break;
        }
    }
}