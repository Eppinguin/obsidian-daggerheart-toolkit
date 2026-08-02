import { App, ButtonComponent, DropdownComponent, Modal, Notice } from 'obsidian';
import DaggerheartStatblockPlugin from '../main';
import { AllCompendiumData, StatblockData } from '../types';
import { ContentType, ExportedData, parseImportJson } from '../services/export-import';
import { validateStatblockData } from '../services/statblock-format';
import { saveStatblockBatch } from '../services/statblock-import-batch';

type ConflictAction = 'rename' | 'update' | 'skip';

interface ImportCandidate {
    entry: ExportedData<AllCompendiumData>;
    data: StatblockData;
    errors: string[];
    warnings: string[];
    conflict: boolean;
    action: ConflictAction;
}

export class StatblockImportPreviewModal extends Modal {
    private readonly plugin: DaggerheartStatblockPlugin;
    private readonly sourceLabel: string;
    private readonly candidates: ImportCandidate[];
    private importButton: HTMLButtonElement | null = null;

    constructor(app: App, plugin: DaggerheartStatblockPlugin, entries: ExportedData<AllCompendiumData>[], sourceLabel = 'JSON') {
        super(app);
        this.plugin = plugin;
        this.sourceLabel = sourceLabel;
        const existingNames = new Set(plugin.compendium.getStatblocks().map(item => item.name.toLowerCase()));
        this.candidates = entries
            .filter(entry => entry.type === ContentType.ADVERSARY || entry.type === ContentType.ENVIRONMENT)
            .map(entry => {
                const validation = validateStatblockData({ ...(entry.data as any), category: entry.type });
                const data = validation.data as StatblockData | null;
                if (!data) return null;
                const conflict = existingNames.has(data.name.toLowerCase());
                return {
                    entry,
                    data,
                    errors: validation.errors,
                    warnings: validation.warnings,
                    conflict,
                    action: validation.valid ? (conflict ? 'rename' : 'update') : 'skip'
                } as ImportCandidate;
            })
            .filter((candidate): candidate is ImportCandidate => candidate !== null);
        this.modalEl.addClass('dh-statblock-import-preview-modal');
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
            cls: 'dh-import-preview-intro'
        });

        const validCount = this.candidates.filter(candidate => candidate.errors.length === 0 && candidate.action !== 'skip').length;
        const conflictCount = this.candidates.filter(candidate => candidate.conflict).length;
        const warningCount = this.candidates.reduce((total, candidate) => total + candidate.warnings.length, 0);
        const summary = contentEl.createDiv('dh-import-preview-summary');
        summary.createSpan({ text: `${validCount} ready` });
        summary.createSpan({ text: `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` });
        summary.createSpan({ text: `${warningCount} warning${warningCount === 1 ? '' : 's'}` });

        const list = contentEl.createDiv('dh-import-preview-list');
        for (const candidate of this.candidates) this.renderCandidate(list, candidate);

        const footer = contentEl.createDiv('dh-modal-buttons');
        new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
        this.importButton = new ButtonComponent(footer)
            .setButtonText('Import reviewed statblocks')
            .setCta()
            .onClick(() => this.confirmImport())
            .buttonEl;
        this.updateImportButton();
    }

    private renderCandidate(parent: HTMLElement, candidate: ImportCandidate): void {
        const card = parent.createDiv('dh-import-preview-item');
        const header = card.createDiv('dh-import-preview-item-header');
        const title = header.createDiv();
        title.createEl('strong', { text: candidate.data.name });
        title.createEl('small', { text: `${candidate.data.category} · Tier ${candidate.data.tier ?? '—'} · ${candidate.data.type || 'Unknown role'}` });

        const actionControl = new DropdownComponent(header);
        actionControl.addOption('rename', 'Import as copy');
        actionControl.addOption('update', candidate.conflict ? 'Replace existing' : 'Import');
        actionControl.addOption('skip', 'Skip');
        actionControl.setValue(candidate.action);
        actionControl.onChange(value => {
            candidate.action = value as ConflictAction;
            this.updateImportButton();
        });
        if (!candidate.conflict) actionControl.selectEl.querySelector('option[value="rename"]')?.remove();

        if (candidate.errors.length) {
            const errors = card.createEl('ul', { cls: 'dh-import-preview-errors' });
            candidate.errors.forEach(error => errors.createEl('li', { text: error }));
        }
        if (candidate.warnings.length) {
            const warnings = card.createEl('ul', { cls: 'dh-import-preview-warnings' });
            candidate.warnings.forEach(warning => warnings.createEl('li', { text: warning }));
        }
        if (candidate.conflict) card.createEl('p', { text: 'A compendium entry with this name already exists.', cls: 'dh-import-preview-conflict' });
    }

    private updateImportButton(): void {
        if (!this.importButton) return;
        const count = this.candidates.filter(candidate => candidate.action !== 'skip' && candidate.errors.length === 0).length;
        this.importButton.disabled = count === 0;
        this.importButton.textContent = count ? `Import ${count} statblock${count === 1 ? '' : 's'}` : 'Nothing selected';
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
            const reserved = new Set(this.plugin.compendium.getStatblocks().map(item => item.name.toLowerCase()));
            const selected = this.candidates
                .filter(candidate => candidate.action !== 'skip' && candidate.errors.length === 0)
                .map(candidate => {
                    const data = structuredClone(candidate.data) as StatblockData;
                    if (candidate.action === 'rename') data.name = this.uniqueImportedName(data.name, reserved);
                    else reserved.add(data.name.toLowerCase());
                    data.isCustom = true;
                    return data;
                });
            if (!selected.length) return;
            await saveStatblockBatch(this.plugin, selected);
            new Notice(`Imported ${selected.length} statblock${selected.length === 1 ? '' : 's'}.`);
            this.close();
        } catch (error) {
            console.error('Daggerheart | Batch statblock import failed:', error);
            new Notice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
            this.importButton.disabled = false;
        }
    }
}

export function openStatblockImportPreviewFromJson(app: App, plugin: DaggerheartStatblockPlugin, json: string, sourceLabel = 'clipboard'): boolean {
    const entries = parseImportJson<AllCompendiumData>(json);
    const statblocks = entries.filter(entry => entry.type === ContentType.ADVERSARY || entry.type === ContentType.ENVIRONMENT);
    if (!statblocks.length) return false;
    new StatblockImportPreviewModal(app, plugin, statblocks, sourceLabel).open();
    return true;
}
