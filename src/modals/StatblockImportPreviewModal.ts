import { App, ButtonComponent, DropdownComponent, Modal, Notice, Setting } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { AllCompendiumData, StatblockData } from '../types';
import { ContentType, ExportedData, parseImportJson } from '../services/export-import';
import { validateStatblockData } from '../services/statblock-format';
import { saveStatblockBatch } from '../services/statblock-import-batch';
import { ContentSource, createUserJsonSource } from '../services/content-source';
import { addImportedToEncounter, getActiveEncounterName } from '../services/encounter-import';

type ConflictAction = 'rename' | 'update' | 'skip';

interface ImportCandidate {
    entry: ExportedData<AllCompendiumData>;
    data: StatblockData;
    errors: string[];
    warnings: string[];
    /** Hard: an entry of this name already exists in the destination source. */
    conflict: boolean;
    /** Soft: this will win over a same-named entry in a different source. */
    shadows: string | null;
    action: ConflictAction;
}

export interface StatblockImportPreviewOptions {
    /** Pre-selected destination source. */
    targetSourceId?: string;
    /** A source to register only if the import is confirmed. */
    pendingSource?: ContentSource | null;
    /** Called after entries are saved, so the opener can refresh. */
    onImported?: () => void;
    /** Pre-tick "also add to the open encounter". The browser extension asks
     * for this via `target=encounter`; it is still ignored when no encounter
     * is open, since only the plugin can know that. */
    addToEncounter?: boolean;
}

export class StatblockImportPreviewModal extends Modal {
    private readonly plugin: DaggerheartStatblockPlugin;
    private readonly sourceLabel: string;
    private readonly candidates: ImportCandidate[];
    private importButton: HTMLButtonElement | null = null;
    /** Which content source the reviewed entries are saved into. */
    private targetSourceId: string;
    /**
     * A source that will be created on confirm. Held rather than registered so
     * that cancelling the review does not leave an empty source behind.
     */
    private pendingSource: ContentSource | null = null;
    /** Off by default: adding to the encounter is a side effect beyond what the
     * user asked for, so it should be opted into. */
    private addToEncounter = false;
    /** Notifies the opener once entries have actually been saved. */
    private readonly onImported?: () => void;

    constructor(
        app: App,
        plugin: DaggerheartStatblockPlugin,
        entries: ExportedData<AllCompendiumData>[],
        sourceLabel = 'JSON',
        options: StatblockImportPreviewOptions = {},
    ) {
        super(app);
        this.plugin = plugin;
        this.sourceLabel = sourceLabel;
        // A caller that already chose a destination (for example the manager's
        // import flow) keeps it; everything else starts at the default.
        this.targetSourceId = options.targetSourceId ?? plugin.getDefaultWriteSourceId();
        this.pendingSource = options.pendingSource ?? null;
        this.onImported = options.onImported;
        this.addToEncounter = options.addToEncounter ?? false;
        this.candidates = entries
            .filter((entry) => entry.type === ContentType.ADVERSARY || entry.type === ContentType.ENVIRONMENT)
            .map((entry) => {
                const validation = validateStatblockData({ ...(entry.data as any), category: entry.type });
                const data = validation.data as StatblockData | null;
                if (!data) return null;
                return {
                    entry,
                    data,
                    errors: validation.errors,
                    warnings: validation.warnings,
                    conflict: false,
                    shadows: null,
                    action: validation.valid ? 'update' : 'skip',
                } as ImportCandidate;
            })
            .filter((candidate): candidate is ImportCandidate => candidate !== null);
        this.refreshConflicts();
        this.modalEl.addClass('dh-statblock-import-preview-modal');
        this.contentEl.addClass('dh-statblock-import-preview-content');
    }

    /**
     * Recompute conflicts against the chosen destination.
     *
     * A name clash inside the destination is a real conflict needing a
     * decision. A clash with a different source only means this entry will take
     * precedence, which is worth mentioning but needs no action.
     */
    /** The destination, which may be a source that does not exist yet. */
    private destinationSource(): ContentSource | undefined {
        if (this.pendingSource?.id === this.targetSourceId) return this.pendingSource;
        return this.plugin.getSource(this.targetSourceId);
    }

    private refreshConflicts(): void {
        // A source being created by this import is empty, so nothing in it can
        // conflict yet.
        const existingInTarget = new Set(
            this.plugin.compendium.getEntriesForSource(this.targetSourceId).map((item) => item.name.toLowerCase()),
        );

        for (const candidate of this.candidates) {
            const key = candidate.data.name.toLowerCase();
            candidate.conflict = existingInTarget.has(key);

            const elsewhere = this.plugin.compendium
                .getStatblocks()
                .find((item) => item.name.toLowerCase() === key && item.sourceId !== this.targetSourceId);
            candidate.shadows =
                candidate.conflict || !elsewhere ? null : (this.plugin.getSource(elsewhere.sourceId)?.label ?? null);

            if (candidate.action === 'skip' && candidate.errors.length) continue;
            candidate.action = candidate.conflict ? 'rename' : 'update';
        }
    }

    onOpen(): void {
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Review statblock import' });
        contentEl.createEl('p', {
            text: `${this.candidates.length} statblock${this.candidates.length === 1 ? '' : 's'} from ${this.sourceLabel}. Nothing is saved until you confirm.`,
            cls: 'dh-import-preview-intro',
        });

        const validCount = this.candidates.filter(
            (candidate) => candidate.errors.length === 0 && candidate.action !== 'skip',
        ).length;
        const conflictCount = this.candidates.filter((candidate) => candidate.conflict).length;
        const warningCount = this.candidates.reduce((total, candidate) => total + candidate.warnings.length, 0);
        const summary = contentEl.createDiv('dh-import-preview-summary');
        summary.createSpan({ text: `${validCount} ready` });
        summary.createSpan({ text: `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` });
        summary.createSpan({ text: `${warningCount} warning${warningCount === 1 ? '' : 's'}` });

        this.renderDestination(contentEl);
        this.renderEncounterOption(contentEl);

        const list = contentEl.createDiv('dh-import-preview-list');
        for (const candidate of this.candidates) this.renderCandidate(list, candidate);

        const footer = contentEl.createDiv('dh-modal-buttons');
        new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
        this.importButton = new ButtonComponent(footer)
            .setButtonText('Import reviewed statblocks')
            .setCta()
            .onClick(() => this.confirmImport()).buttonEl;
        this.updateImportButton();
    }

    /**
     * Offer to drop the imported adversaries straight into the open encounter,
     * so a statblock clipped from the browser does not have to be hunted down
     * in the compendium afterwards.
     *
     * Only shown when an encounter is actually open — the extension cannot know
     * that, so the decision belongs here. Entries are always saved to the
     * compendium as well; an encounter instance referencing a statblock that
     * exists nowhere else would be a dangling reference.
     */
    private renderEncounterOption(parent: HTMLElement): void {
        const encounterName = getActiveEncounterName(this.plugin);

        if (!encounterName) {
            // The extension can ask for this without knowing whether an
            // encounter is open. Clear the request rather than leaving it set
            // with no toggle on screen and nowhere for the entries to go.
            if (this.addToEncounter) {
                this.addToEncounter = false;
                new Notice('No encounter is open, so the import will only be added to the compendium.');
            }
            return;
        }

        new Setting(parent)
            .setName('Also add to the open encounter')
            .setDesc(`Adds the imported statblocks to “${encounterName}” after saving.`)
            .addToggle((toggle) =>
                toggle.setValue(this.addToEncounter).onChange((value) => {
                    this.addToEncounter = value;
                }),
            );
    }

    private renderDestination(parent: HTMLElement): void {
        const row = parent.createDiv('dh-import-preview-destination');
        row.createSpan({ text: 'Save to' });

        const dropdown = new DropdownComponent(row);
        if (this.pendingSource) {
            dropdown.addOption(this.pendingSource.id, `${this.pendingSource.label} (new)`);
        }
        for (const source of this.plugin.getWritableSources()) {
            dropdown.addOption(source.id, source.label);
        }
        dropdown.setValue(this.targetSourceId);
        dropdown.onChange((value) => {
            this.targetSourceId = value;
            // Switching away from the not-yet-created source abandons it.
            if (this.pendingSource && value !== this.pendingSource.id) this.pendingSource = null;
            this.refreshConflicts();
            this.render();
        });

        new ButtonComponent(row)
            .setButtonText('New source…')
            .setTooltip('Create a new content source for these statblocks')
            .onClick(() => this.promptNewSource());

        if (this.destinationSource()?.doNotDistribute) {
            parent.createDiv({
                cls: 'dh-import-preview-locked-banner',
                text: 'Entries imported here are marked as personal content and will be excluded from export and sharing.',
            });
        }
    }

    private promptNewSource(): void {
        new NewImportSourceModal(this.app, async (label, doNotDistribute) => {
            // Held until the import is confirmed, matching the manager's flow.
            this.pendingSource = createUserJsonSource(label, this.plugin.getContentSources(), {
                doNotDistribute,
            });
            this.targetSourceId = this.pendingSource.id;
            this.refreshConflicts();
            this.render();
        }).open();
    }

    private renderCandidate(parent: HTMLElement, candidate: ImportCandidate): void {
        const card = parent.createDiv('dh-import-preview-item');
        const header = card.createDiv('dh-import-preview-item-header');
        const title = header.createDiv('dh-import-preview-item-title');
        title.createEl('strong', { text: candidate.data.name });
        title.createEl('small', {
            text: `${candidate.data.category} · Tier ${candidate.data.tier ?? '—'} · ${candidate.data.type || 'Unknown role'}`,
        });

        const action = header.createDiv('dh-import-preview-action');
        action.createSpan({
            text: candidate.conflict ? 'Existing entry' : 'Import action',
            cls: 'dh-import-preview-action-label',
        });
        const actionControl = new DropdownComponent(action);
        actionControl.addOption('rename', 'Import as copy');
        actionControl.addOption('update', candidate.conflict ? 'Replace existing' : 'Import');
        actionControl.addOption('skip', 'Skip');
        actionControl.setValue(candidate.action);
        actionControl.onChange((value) => {
            candidate.action = value as ConflictAction;
            this.updateImportButton();
        });
        if (!candidate.conflict) actionControl.selectEl.querySelector('option[value="rename"]')?.remove();

        if (candidate.errors.length) {
            const errors = card.createEl('ul', { cls: 'dh-import-preview-errors' });
            candidate.errors.forEach((error) => errors.createEl('li', { text: error }));
        }
        if (candidate.warnings.length) {
            const warnings = card.createEl('ul', { cls: 'dh-import-preview-warnings' });
            candidate.warnings.forEach((warning) => warnings.createEl('li', { text: warning }));
        }
        if (candidate.conflict) {
            const label = this.destinationSource()?.label ?? 'this source';
            card.createEl('p', {
                text: `An entry with this name already exists in ${label}.`,
                cls: 'dh-import-preview-conflict',
            });
        } else if (candidate.shadows) {
            card.createEl('p', {
                text: `This will take precedence over the entry of the same name in ${candidate.shadows}.`,
                cls: 'dh-import-preview-shadow',
            });
        }
    }

    private updateImportButton(): void {
        if (!this.importButton) return;
        const count = this.candidates.filter(
            (candidate) => candidate.action !== 'skip' && candidate.errors.length === 0,
        ).length;
        this.importButton.disabled = count === 0;
        this.importButton.textContent = count
            ? `Import ${count} statblock${count === 1 ? '' : 's'}`
            : 'Nothing selected';
    }

    private uniqueImportedName(baseName: string, reserved: Set<string>): string {
        let suffix = 1;
        let candidate = `${baseName} (Imported)`;
        while (reserved.has(candidate.toLowerCase())) {
            suffix += 1;
            candidate = `${baseName} (Imported ${suffix})`;
        }
        reserved.add(candidate.toLowerCase());
        return candidate;
    }

    private async confirmImport(): Promise<void> {
        if (!this.importButton) return;
        this.importButton.disabled = true;
        try {
            // Renaming only has to avoid clashes inside the destination, since
            // that is the only file being written.
            const reserved = new Set(
                this.plugin.compendium.getEntriesForSource(this.targetSourceId).map((item) => item.name.toLowerCase()),
            );
            const selected = this.candidates
                .filter((candidate) => candidate.action !== 'skip' && candidate.errors.length === 0)
                .map((candidate) => {
                    const data = structuredClone(candidate.data) as StatblockData;
                    if (candidate.action === 'rename') data.name = this.uniqueImportedName(data.name, reserved);
                    else reserved.add(data.name.toLowerCase());
                    data.isCustom = true;
                    return data;
                });
            if (!selected.length) return;
            // Register a newly created destination only now, so an abandoned
            // review never leaves an empty source in the list.
            if (this.pendingSource?.id === this.targetSourceId) {
                await this.plugin.addContentSource(this.pendingSource);
                this.pendingSource = null;
            }
            await saveStatblockBatch(this.plugin, selected, this.targetSourceId);
            const destination = this.plugin.getSource(this.targetSourceId)?.label ?? 'the compendium';

            // After the compendium write, so a failure there never leaves
            // instances pointing at statblocks that were not saved.
            let encounterNote = '';
            if (this.addToEncounter) {
                const { added } = addImportedToEncounter(this.plugin, selected);
                if (added) encounterNote = ` Added ${added} to the encounter.`;
            }

            new Notice(
                `Imported ${selected.length} statblock${selected.length === 1 ? '' : 's'} into ${destination}.${encounterNote}`,
            );
            this.close();
            // Only now is there anything for the opener to show.
            this.onImported?.();
        } catch (error) {
            console.error('Daggerheart | Batch statblock import failed:', error);
            new Notice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
            this.importButton.disabled = false;
        }
    }
}

/** Minimal source creator, so an import can be filed away without leaving the review. */
class NewImportSourceModal extends Modal {
    private label = '';
    private doNotDistribute = false;

    constructor(
        app: App,
        private onCreate: (label: string, doNotDistribute: boolean) => Promise<void>,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'New content source' });

        new Setting(contentEl).setName('Name').addText((text) =>
            text.setPlaceholder('Hope & Fear').onChange((value) => {
                this.label = value;
            }),
        );

        new Setting(contentEl)
            .setName('Personal licensed content')
            .setDesc('Excludes this source from every export and sharing option.')
            .addToggle((toggle) =>
                toggle.onChange((value) => {
                    this.doNotDistribute = value;
                }),
            );

        const buttons = contentEl.createDiv('dh-modal-buttons');
        new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
                const label = this.label.trim();
                if (!label) {
                    new Notice('Give the source a name.');
                    return;
                }
                await this.onCreate(label, this.doNotDistribute);
                this.close();
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export function openStatblockImportPreviewFromJson(
    app: App,
    plugin: DaggerheartStatblockPlugin,
    json: string,
    sourceLabel = 'clipboard',
    options: { addToEncounter?: boolean } = {},
): boolean {
    const entries = parseImportJson<AllCompendiumData>(json);
    const statblocks = entries.filter(
        (entry) => entry.type === ContentType.ADVERSARY || entry.type === ContentType.ENVIRONMENT,
    );
    if (!statblocks.length) return false;
    new StatblockImportPreviewModal(app, plugin, statblocks, sourceLabel, {
        addToEncounter: options.addToEncounter,
    }).open();
    return true;
}
