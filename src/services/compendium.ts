import { Notice, TFile, TFolder } from 'obsidian';
import * as YAML from 'js-yaml';
import DaggerheartStatblockPlugin from '../main';
import { StatblockData, StatblockFeature } from '../types';
import { normalizeStatblockFeature } from './statblock-format';
import { normalizeCompendiumPath } from './compendium-path';
import { ContentSource, sortSourcesForMerge } from './content-source';
import { findStatblockBlocks } from './markdown-statblock';

const DATA_PATH = 'data';
const USER_DATA_PATH = 'user_data';

export class DaggerheartCompendium {
    /** The merged, deduplicated view every consumer reads. */
    public statblocks: StatblockData[] = [];
    /**
     * Every entry keyed by source, including ones shadowed in the merge and
     * ones from disabled sources. The manager UI reads this so it can show and
     * edit content that is currently hidden.
     */
    public entriesBySource = new Map<string, StatblockData[]>();
    /** Lowercase name -> ids of the sources that lost the merge for that name. */
    public shadowed = new Map<string, string[]>();

    constructor(private plugin: DaggerheartStatblockPlugin) {}

    async load(): Promise<void> {
        const sources = sortSourcesForMerge(this.plugin.getContentSources());
        const items = new Map<string, StatblockData>();
        this.entriesBySource.clear();
        this.shadowed.clear();

        for (const source of sources) {
            const entries = await this.loadSource(source);
            this.entriesBySource.set(source.id, entries);
            if (!source.enabled) continue;

            for (const entry of entries) {
                const key = entry.name.toLowerCase();
                const previous = items.get(key);
                if (previous?.sourceId) {
                    const losers = this.shadowed.get(key) ?? [];
                    losers.push(previous.sourceId);
                    this.shadowed.set(key, losers);
                }
                items.set(key, entry);
            }
        }

        this.statblocks = Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name));
        const breakdown = sources
            .map(
                (source) =>
                    `${source.id}:${this.entriesBySource.get(source.id)?.length ?? 0}${source.enabled ? '' : ' (off)'}`,
            )
            .join(', ');
        console.log(`Daggerheart | Compendium loaded ${this.statblocks.length} GM statblocks [${breakdown}]`);
    }

    getStatblocks(): StatblockData[] {
        return this.statblocks;
    }

    /** Entries belonging to one source, whether or not it is enabled. */
    getEntriesForSource(sourceId: string): StatblockData[] {
        return this.entriesBySource.get(sourceId) ?? [];
    }

    /** Whether this entry is currently hidden by a higher-priority source. */
    isShadowed(entry: StatblockData): boolean {
        const winner = this.statblocks.find((item) => item.name.toLowerCase() === entry.name.toLowerCase());
        return !!winner && winner.sourceId !== entry.sourceId;
    }

    private async loadSource(source: ContentSource): Promise<StatblockData[]> {
        switch (source.kind) {
            case 'builtin-srd':
                return this.loadSrdSource(source);
            case 'user-json':
                return this.loadUserJsonSource(source);
            case 'markdown':
                // Walking every Markdown file in the vault is the one load that
                // is genuinely expensive, so a disabled folder is skipped
                // outright rather than read for the manager's benefit.
                return source.enabled ? this.loadMarkdownSource(source) : [];
            default:
                return [];
        }
    }

    private async loadSrdSource(source: ContentSource): Promise<StatblockData[]> {
        const category = source.forcedCategory ?? 'adversary';
        const raws = await this.loadSrdFile<any>(source.path);
        const entries: StatblockData[] = [];
        for (const raw of raws) {
            const parsed = this.parseSrdStatblock(raw, category);
            if (parsed) entries.push({ ...parsed, sourceId: source.id });
        }
        return entries;
    }

    private async loadUserJsonSource(source: ContentSource): Promise<StatblockData[]> {
        if (!source.path) return [];
        const path = `${this.plugin.manifest.dir}/${USER_DATA_PATH}/${source.path}`;
        if (!(await this.plugin.app.vault.adapter.exists(path))) return [];

        try {
            let data = await this.plugin.app.vault.adapter.read(path);
            if (data.charCodeAt(0) === 0xfeff) data = data.slice(1);
            if (!data.trim()) return [];
            const items = JSON.parse(data) as StatblockData[];
            if (!Array.isArray(items)) return [];
            return items.filter((item) => item?.name).map((item) => ({ ...item, isCustom: true, sourceId: source.id }));
        } catch (error) {
            new Notice(`Could not read source "${source.label}" (${source.path}). Check console for details.`);
            console.error(error);
            return [];
        }
    }

    private async loadSrdFile<T>(fileName: string): Promise<T[]> {
        const path = `${this.plugin.manifest.dir}/${DATA_PATH}/${fileName}`;
        try {
            if (!(await this.plugin.app.vault.adapter.exists(path))) return [];
            let content = await this.plugin.app.vault.adapter.read(path);
            if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
            return JSON.parse(content) as T[];
        } catch (error) {
            console.error(`Daggerheart | Error loading SRD file ${fileName}:`, error);
            return [];
        }
    }

    /** Convert one flat SRD wire-format record into a StatblockData. */
    private parseSrdStatblock(raw: any, category: 'adversary' | 'environment'): StatblockData | null {
        try {
            const thresholds = raw.thresholds
                ?.split('/')
                .map((value: string) => value.trim())
                .filter(Boolean);
            return {
                name: raw.name,
                category,
                tier: raw.tier,
                type: raw.type,
                description: raw.description,
                motives_tactics: raw.motives_and_tactics || raw.motives_tactics,
                impulses: raw.impulses,
                potential_adversaries: raw.potential_adversaries,
                difficulty: raw.difficulty,
                hp_stress: {
                    hp: Number(raw.hp) || 0,
                    stress: Number(raw.stress) || 0,
                    major_hp: thresholds?.[0] ? Number(thresholds[0]) : null,
                    severe_hp: thresholds?.[1] ? Number(thresholds[1]) : null,
                },
                attack: {
                    name: raw.attack || 'Attack',
                    range: raw.range || '',
                    damage: raw.damage || '',
                    modifier: raw.atk || '0',
                },
                features: (raw.feats || [])
                    .map((feat: any) => normalizeStatblockFeature(feat))
                    .filter((feat: StatblockFeature | null): feat is StatblockFeature => feat !== null),
            };
        } catch (error) {
            console.error(`Daggerheart | Error parsing SRD ${category}:`, raw, error);
            return null;
        }
    }

    private async loadMarkdownSource(source: ContentSource): Promise<StatblockData[]> {
        const folderPath = normalizeCompendiumPath(source.path);
        if (!folderPath) return [];

        const target = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        const statblocks: StatblockData[] = [];
        if (target instanceof TFile && target.extension === 'md') {
            this.extractStatblocksFromFile(
                await this.plugin.app.vault.cachedRead(target),
                target.path,
                source.id,
                statblocks,
            );
        } else if (target instanceof TFolder) {
            const folderPrefix = `${target.path}/`;
            const files = this.plugin.app.vault
                .getMarkdownFiles()
                .filter((file) => file.path.startsWith(folderPrefix))
                .sort((a, b) => a.path.localeCompare(b.path));
            for (const file of files) {
                this.extractStatblocksFromFile(
                    await this.plugin.app.vault.cachedRead(file),
                    file.path,
                    source.id,
                    statblocks,
                );
            }
        } else {
            console.warn(`Daggerheart | Configured compendium path was not found: ${folderPath}`);
        }
        return statblocks;
    }

    private extractStatblocksFromFile(
        content: string,
        filePath: string,
        sourceId: string,
        statblocks: StatblockData[],
    ): void {
        // Indices come from the shared scanner so an in-place edit rewrites the
        // same block this entry was read from.
        for (const block of findStatblockBlocks(content)) {
            try {
                const statblock = YAML.load(block.body) as StatblockData;
                if (statblock?.name && (statblock.category === 'adversary' || statblock.category === 'environment')) {
                    statblocks.push({
                        ...statblock,
                        isCustom: true,
                        sourceFile: filePath,
                        sourceBlockIndex: block.index,
                        sourceId,
                    });
                }
            } catch (error) {
                console.warn(`Daggerheart | Failed to parse statblock YAML in ${filePath}:`, error);
            }
        }
    }
}
