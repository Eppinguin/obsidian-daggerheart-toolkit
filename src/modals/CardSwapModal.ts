import { App, Modal, Setting, Notice, setIcon, Menu } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { Character, DomainCard, JsonAbility } from '../types';
import { renderMarkdown } from '../rendering/ui-helpers';
import { CreateCardModal } from './CreateCardModal';

type ModalTab = 'manage' | 'compendium';

export class CardSwapModal extends Modal {
    plugin: DaggerheartStatblockPlugin;
    character: Character;
    onSave: (character: Character) => void;
    private activeTab: ModalTab = 'manage'; // Default to manage view
    private autoPayCost: boolean = false;

    // Filter state properties
    private searchTerm: string = '';
    private selectedDomains: string[] = [];
    private selectedLevels: number[] = [];

    // Element properties for targeted redraws
    private listContainer: HTMLElement;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, character: Character, onSave: (character: Character) => void) {
        super(app);
        this.plugin = plugin;
        this.character = character;
        this.onSave = onSave;

        if (!this.character.vault) {
            this.character.vault = [];
        }
        if (!this.character.loadout) {
            this.character.loadout = [];
        }

        const charClass = this.plugin.compendium.getClass(this.character.classId);
        if (charClass) {
            this.selectedDomains = [charClass.domain_1, charClass.domain_2].filter(d => d);
        }
        this.selectedLevels = Array.from({ length: this.character.level }, (_, i) => i + 1);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('dh-card-swap-modal');
        contentEl.createEl('h2', { text: 'Manage Cards' });

        this.drawTabs(contentEl);
        this.drawContent(contentEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private drawTabs(parent: HTMLElement) {
        const tabsContainer = parent.createDiv({ cls: 'dh-modal-tabs' });
        const manageTab = tabsContainer.createDiv({ text: 'Loadout & Vault', cls: 'dh-modal-tab' });
        const compendiumTab = tabsContainer.createDiv({ text: 'Add from Compendium', cls: 'dh-modal-tab' });

        if (this.activeTab === 'manage') manageTab.addClass('is-active');
        if (this.activeTab === 'compendium') compendiumTab.addClass('is-active');

        const switchTab = (tab: ModalTab) => {
            if (this.activeTab !== tab) {
                this.activeTab = tab;
                this.onOpen();
            }
        };

        manageTab.addEventListener('click', () => switchTab('manage'));
        compendiumTab.addEventListener('click', () => switchTab('compendium'));
    }

    private drawContent(parent: HTMLElement) {
        const contentContainer = parent.createDiv({ cls: 'dh-modal-content-container' });
        if (this.activeTab === 'manage') {
            this.drawManageView(contentContainer);
        } else {
            this.drawCompendiumFilters(contentContainer);
            this.listContainer = contentContainer.createDiv({ cls: 'dh-compendium-list' });
            this.redrawCompendiumList();
        }
    }

    private drawManageView(parent: HTMLElement) {
        const container = parent.createDiv({ cls: 'dh-card-manage-container' });

        const loadoutContainer = container.createDiv({ cls: 'dh-card-column' });
        loadoutContainer.createEl('h3', { text: `Loadout (${this.character.loadout.length}/5)` });
        const loadoutList = loadoutContainer.createDiv({ cls: 'dh-card-list dh-scrollable-content' });
        if (this.character.loadout.length === 0) {
            loadoutList.createDiv({ text: 'No cards in loadout.', cls: 'dh-empty-text' });
        } else {
            this.character.loadout.forEach(card => this.createCardInList(loadoutList, card, 'loadout'));
        }

        const vaultContainer = container.createDiv({ cls: 'dh-card-column' });
        vaultContainer.createEl('h3', { text: 'Vault' });
        const vaultList = vaultContainer.createDiv({ cls: 'dh-card-list dh-scrollable-content' });
        if (this.character.vault.length === 0) {
            vaultList.createDiv({ text: 'No cards in vault.', cls: 'dh-empty-text' });
        } else {
            this.character.vault.forEach(card => this.createCardInList(vaultList, card, 'vault'));
        }

        const footer = parent.createDiv({ cls: 'dh-modal-footer-bar' });
        new Setting(footer)
            .setName('Automatically pay recall costs')
            .setDesc('Mark Stress when moving a card from the Vault to your Loadout.')
            .addToggle(toggle => toggle
                .setValue(this.autoPayCost)
                .onChange(value => this.autoPayCost = value));
    }

    private createCardInList(parent: HTMLElement, card: DomainCard, location: 'loadout' | 'vault') {
        const cardEl = parent.createDiv({ cls: 'dh-swap-card' });

        const header = cardEl.createDiv({ cls: 'dh-swap-card-header' });
        const info = header.createDiv({ cls: 'dh-swap-card-info' });
        info.createEl('strong', { text: card.name });
        const meta = info.createDiv({ cls: 'dh-swap-card-meta' });
        meta.createSpan({ text: `${card.domain} ${card.level}` });
        meta.createSpan({ text: `Recall: ${card.recall}` });

        const controls = header.createDiv({ cls: 'dh-swap-card-controls' });

        // Find the raw card data from the compendium to allow editing.
        const rawCard = this.plugin.compendium.abilities.find(a => a.name.toLowerCase() === card.id.toLowerCase());
        if (rawCard) {
            const editBtn = controls.createEl('button');
            setIcon(editBtn, 'pencil');
            editBtn.ariaLabel = "Edit Card";
            editBtn.addEventListener('click', () => {
                new CreateCardModal(this.app, this.plugin, (updatedAbility, oldName) => {
                    // This callback now correctly handles updating the character.
                    const updatedDomainCard = this.plugin.compendium.getAbility(updatedAbility.name);
                    if (!updatedDomainCard) return;

                    const nameToFind = oldName || card.name;
                    if (location === 'loadout') {
                        const index = this.character.loadout.findIndex(f => f.name === nameToFind);
                        if (index > -1) this.character.loadout[index] = updatedDomainCard;
                    } else {
                        const index = this.character.vault.findIndex(v => v.name === nameToFind);
                        if (index > -1) this.character.vault[index] = updatedDomainCard;
                    }
                    this.onSave(this.character);
                    this.onOpen(); // Redraw the modal to show changes
                }, rawCard).open();
            });
        }

        if (location === 'loadout') {
            const button = controls.createEl('button');
            setIcon(button, 'arrow-down-circle');
            button.ariaLabel = "Move to Vault";
            button.addEventListener('click', () => this.moveCard(card.id, 'loadout-to-vault'));
        } else {
            const toLoadoutBtn = controls.createEl('button');
            setIcon(toLoadoutBtn, 'arrow-up-circle');
            toLoadoutBtn.ariaLabel = "Move to Loadout";
            toLoadoutBtn.addEventListener('click', () => this.moveCard(card.id, 'vault-to-loadout'));

            const removeBtn = controls.createEl('button', { cls: 'mod-warning' });
            setIcon(removeBtn, 'trash-2');
            removeBtn.ariaLabel = "Remove from Vault";
            removeBtn.addEventListener('click', () => this.removeCardFromVault(card.id));
        }

        const description = cardEl.createDiv({ cls: 'dh-swap-card-desc' });
        renderMarkdown(this.plugin, card.description, description);
    }

    private drawCompendiumFilters(parent: HTMLElement) {
        const filterContainer = parent.createDiv({ cls: 'dh-compendium-filters' });
        const allDomains = this.plugin.compendium.getAllDomains();
        const allLevels = this.plugin.compendium.getAllLevels();

        this.createMultiSelectSetting(filterContainer, 'Domains', allDomains, this.selectedDomains, (domain) => {
            const index = this.selectedDomains.indexOf(domain as string);
            if (index > -1) this.selectedDomains.splice(index, 1);
            else this.selectedDomains.push(domain as string);
            this.redrawCompendiumList();
        });

        this.createMultiSelectSetting(filterContainer, 'Levels', allLevels, this.selectedLevels, (level) => {
            const index = this.selectedLevels.indexOf(level as number);
            if (index > -1) this.selectedLevels.splice(index, 1);
            else this.selectedLevels.push(level as number);
            this.redrawCompendiumList();
        });

        new Setting(filterContainer)
            .setName('Search')
            .addSearch(search => {
                search.setValue(this.searchTerm)
                    .setPlaceholder('Search for a card...')
                    .onChange(value => {
                        this.searchTerm = value.toLowerCase();
                        this.redrawCompendiumList();
                    });
            });

        const actionsContainer = parent.createDiv({ cls: 'dh-compendium-actions' });
        actionsContainer.createEl('button', { text: 'Create Custom Card', cls: 'mod-cta' })
            .addEventListener('click', () => {
                new CreateCardModal(this.app, this.plugin, (newAbility, oldName) => {
                    this.redrawCompendiumList();
                }).open();
            });
    }

    private redrawCompendiumList() {
        this.listContainer.empty();
        const allCards = this.plugin.compendium.abilities;
        const ownedCardIds = [...this.character.loadout.map(f => f.id), ...this.character.vault.map(v => v.id)];

        const availableCards = allCards
            .filter(card => !ownedCardIds.includes(card.name))
            .filter(card => this.selectedDomains.length === 0 || this.selectedDomains.includes(card.domain))
            .filter(card => this.selectedLevels.length === 0 || this.selectedLevels.includes(parseInt(card.level)))
            .filter(card => card.name.toLowerCase().includes(this.searchTerm) || card.text.toLowerCase().includes(this.searchTerm));

        if (availableCards.length === 0) {
            this.listContainer.createDiv({ text: 'No matching cards found.', cls: 'dh-empty-text' });
        } else {
            availableCards.forEach(rawCard => {
                const card = this.plugin.compendium.getAbility(rawCard.name);
                if (card) {
                    this.createCompendiumCard(this.listContainer, card, rawCard);
                }
            });
        }
    }

    private createMultiSelectSetting(
        parent: HTMLElement,
        name: string,
        allOptions: (string | number)[],
        selectedOptions: (string | number)[],
        onToggle: (option: string | number) => void
    ) {
        const setting = new Setting(parent)
            .setName(name)
            .setClass('dh-multiselect-setting');

        const summaryText = selectedOptions.length === allOptions.length ? 'All' : `${selectedOptions.length} of ${allOptions.length}`;
        setting.controlEl.createSpan({ text: summaryText, cls: 'dh-multiselect-summary' });

        setting.addButton(button => {
            button.setButtonText(`Select ${name}`)
                .onClick(evt => {
                    const menu = new Menu();
                    allOptions.forEach(option => {
                        menu.addItem(item => {
                            item.setTitle(String(option))
                                .setChecked(selectedOptions.includes(option))
                                .onClick(() => onToggle(option));
                        });
                    });
                    menu.showAtMouseEvent(evt);
                });
        });
    }

    private createCompendiumCard(parent: HTMLElement, card: DomainCard, rawCard: JsonAbility) {
        const cardEl = parent.createDiv({ cls: 'dh-swap-card' });
        cardEl.createEl('strong', { text: card.name });
        const meta = cardEl.createDiv({ cls: 'dh-swap-card-meta' });
        meta.createSpan({ text: `${card.domain} ${card.level}` });

        const description = cardEl.createDiv({ cls: 'dh-swap-card-desc' });
        renderMarkdown(this.plugin, card.description, description);

        const controls = cardEl.createDiv({ cls: 'dh-swap-card-controls' });

        // Always show the edit button for any card in the compendium list
        const editBtn = controls.createEl('button');
        setIcon(editBtn, 'pencil');
        editBtn.ariaLabel = "Edit Card";
        editBtn.addEventListener('click', () => {
            new CreateCardModal(this.app, this.plugin, (updatedAbility, oldName) => {
                this.redrawCompendiumList();
            }, rawCard).open();
        });

        controls.createEl('button', { text: 'To Loadout' }).addEventListener('click', () => this.addCardFromCompendium(card, 'loadout'));
        controls.createEl('button', { text: 'To Vault' }).addEventListener('click', () => this.addCardFromCompendium(card, 'vault'));
    }

    private addCardFromCompendium(card: DomainCard, destination: 'loadout' | 'vault') {
        if (destination === 'loadout') {
            if (this.character.loadout.length >= 5) {
                new Notice('Loadout is full. Move a card to the vault first.');
                return;
            }
            this.character.loadout.push(card);
        } else {
            if (!this.character.vault) {
                this.character.vault = [];
            }
            this.character.vault.push(card);
        }
        this.onSave(this.character);
        this.redrawCompendiumList();
    }

    private removeCardFromVault(cardId: string) {
        if (!this.character.vault) return;
        this.character.vault = this.character.vault.filter(c => c.id !== cardId);
        this.onSave(this.character);
        this.onOpen();
    }

    private moveCard(cardId: string, direction: 'vault-to-loadout' | 'loadout-to-vault') {
        if (direction === 'vault-to-loadout') {
            if (this.character.loadout.length >= 5) {
                new Notice('Loadout is full. Move a card to the vault first.');
                return;
            }
            const cardIndex = this.character.vault?.findIndex(c => c.id === cardId);
            if (this.character.vault && cardIndex > -1) {
                const [cardToMove] = this.character.vault.splice(cardIndex, 1);

                if (this.autoPayCost && cardToMove.recall > 0) {
                    const cost = cardToMove.recall || 0;
                    const currentStress = this.character.stress.current;
                    const maxStress = this.character.stress.max;
                    if (currentStress + cost > maxStress) {
                        new Notice(`Not enough Stress to pay recall cost of ${cost}. Action cancelled.`);
                        this.character.vault.push(cardToMove);
                        return;
                    }
                    this.character.stress.current += cost;
                    new Notice(`Paid ${cost} Stress to recall ${cardToMove.name}.`);
                }

                this.character.loadout.push(cardToMove);
            }
        } else {
            const cardIndex = this.character.loadout.findIndex(c => c.id === cardId);
            if (cardIndex > -1) {
                const [cardToMove] = this.character.loadout.splice(cardIndex, 1);
                if (!this.character.vault) {
                    this.character.vault = [];
                }
                this.character.vault.push(cardToMove);
            }
        }

        this.onSave(this.character);
        this.onOpen();
    }
}
