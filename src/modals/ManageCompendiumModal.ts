import { App, Modal, setIcon } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { EntriesTab } from './compendium/EntriesTab';
import { SourcesTab } from './compendium/SourcesTab';

type TabId = 'entries' | 'sources';

const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'entries', label: 'Entries', icon: 'library' },
    { id: 'sources', label: 'Sources', icon: 'folder-tree' },
];

/**
 * The compendium manager.
 *
 * Two surfaces that were previously stacked in one scroll: browsing and editing
 * statblocks, and configuring where they come from. Each tab keeps its own
 * state across re-renders so a refresh does not reset filters or selections.
 */
export class ManageCompendiumModal extends Modal {
    private activeTab: TabId = 'entries';
    private entriesTab: EntriesTab;
    private sourcesTab: SourcesTab;

    constructor(
        app: App,
        private plugin: DaggerheartStatblockPlugin,
        initialTab: TabId = 'entries',
    ) {
        super(app);
        this.activeTab = initialTab;
        const close = () => this.close();
        const refresh = () => this.render();
        this.entriesTab = new EntriesTab(app, plugin, close, refresh);
        this.sourcesTab = new SourcesTab(app, plugin, close, refresh);
    }

    onOpen(): void {
        this.modalEl.addClass('dh-manage-compendium-modal-root');
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dh-manage-compendium-modal');

        const header = contentEl.createDiv({ cls: 'dh-manage-header' });
        header.createEl('h2', { text: 'Compendium' });
        header.createSpan({ text: this.summary(), cls: 'dh-manage-header-summary' });

        this.renderTabBar(contentEl);

        if (this.activeTab === 'entries') this.entriesTab.render(contentEl);
        else this.sourcesTab.render(contentEl);
    }

    /** One line of orientation: how much content, from how many places. */
    private summary(): string {
        const total = this.plugin.compendium.getStatblocks().length;
        const active = this.plugin.getContentSources().filter((source) => source.enabled).length;
        return `${total} ${total === 1 ? 'statblock' : 'statblocks'} from ${active} ${active === 1 ? 'source' : 'sources'}`;
    }

    private renderTabBar(parent: HTMLElement): void {
        const bar = parent.createDiv({ cls: 'dh-manage-tabs', attr: { role: 'tablist' } });
        for (const tab of TABS) {
            const isActive = tab.id === this.activeTab;
            const button = bar.createEl('button', {
                cls: `dh-manage-tab${isActive ? ' is-active' : ''}`,
                attr: { role: 'tab', 'aria-selected': String(isActive) },
            });
            const icon = button.createSpan({ cls: 'dh-manage-tab-icon' });
            setIcon(icon, tab.icon);
            button.createSpan({ text: tab.label });
            button.addEventListener('click', () => {
                if (this.activeTab === tab.id) return;
                this.activeTab = tab.id;
                this.render();
            });
        }
    }
}
