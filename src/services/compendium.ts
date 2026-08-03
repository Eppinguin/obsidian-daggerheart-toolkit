import { Notice, TFile, TFolder } from 'obsidian';
import * as YAML from 'js-yaml';
import DaggerheartStatblockPlugin from '../main';
import { StatblockData } from '../types';
import { normalizeCompendiumPath } from './compendium-path';

const DATA_PATH = 'data';
const USER_DATA_PATH = 'user_data';

export class DaggerheartCompendium {
    public statblocks: StatblockData[] = [];

    constructor(private plugin: DaggerheartStatblockPlugin) {}

    async load(): Promise<void> {
        const items = new Map<string, StatblockData>();

        if (this.plugin.settings.useSrdAdversaries) {
            for (const raw of await this.loadSrdFile<any>('adversaries.json')) {
                this.parseAndAddStatblock(raw, 'adversary', items);
            }
        }
        if (this.plugin.settings.useSrdEnvironments) {
            for (const raw of await this.loadSrdFile<any>('environments.json')) {
                this.parseAndAddStatblock(raw, 'environment', items);
            }
        }

        for (const item of await this.loadUserStatblocks()) {
            items.set(item.name.toLowerCase(), item);
        }
        for (const item of await this.loadMarkdownStatblocks()) {
            items.set(item.name.toLowerCase(), item);
        }

        this.statblocks = Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name));
        console.log(`Daggerheart | Compendium loaded ${this.statblocks.length} GM statblocks.`);
    }

    getStatblocks(): StatblockData[] {
        return this.statblocks;
    }

    private async loadUserStatblocks(): Promise<StatblockData[]> {
        const fileName = this.plugin.settings.userCompendiumFile;
        if (!fileName) return [];
        const path = `${this.plugin.manifest.dir}/${USER_DATA_PATH}/${fileName}`;
        if (!(await this.plugin.app.vault.adapter.exists(path))) return [];

        try {
            let data = await this.plugin.app.vault.adapter.read(path);
            if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
            if (!data.trim()) return [];
            const items = JSON.parse(data) as StatblockData[];
            return items.map(item => ({ ...item, isCustom: true }));
        } catch (error) {
            new Notice(`Could not read user file: ${fileName}. Check console for details.`);
            console.error(error);
            return [];
        }
    }

    private async loadSrdFile<T>(fileName: string): Promise<T[]> {
        const path = `${this.plugin.manifest.dir}/${DATA_PATH}/${fileName}`;
        try {
            if (!(await this.plugin.app.vault.adapter.exists(path))) return [];
            let content = await this.plugin.app.vault.adapter.read(path);
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
            return JSON.parse(content) as T[];
        } catch (error) {
            console.error(`Daggerheart | Error loading SRD file ${fileName}:`, error);
            return [];
        }
    }

    private parseAndAddStatblock(raw: any, category: 'adversary' | 'environment', items: Map<string, StatblockData>): void {
        try {
            const thresholds = raw.thresholds?.split('/').map((value: string) => value.trim()).filter(Boolean);
            const statblock: StatblockData = {
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
                features: (raw.feats || []).map((feat: any) => ({
                    name: feat.name,
                    type: feat.type || 'Passive',
                    description: feat.text,
                })),
            };
            items.set(statblock.name.toLowerCase(), statblock);
        } catch (error) {
            console.error(`Daggerheart | Error parsing SRD ${category}:`, raw, error);
        }
    }

    private async loadMarkdownStatblocks(): Promise<StatblockData[]> {
        const folderPath = normalizeCompendiumPath(this.plugin.settings.compendiumFolder);
        if (!folderPath) return [];

        const target = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        const statblocks: StatblockData[] = [];
        if (target instanceof TFile && target.extension === 'md') {
            this.extractStatblocksFromFile(await this.plugin.app.vault.cachedRead(target), target.path, statblocks);
        } else if (target instanceof TFolder) {
            const folderPrefix = `${target.path}/`;
            const files = this.plugin.app.vault.getMarkdownFiles()
                .filter(file => file.path.startsWith(folderPrefix))
                .sort((a, b) => a.path.localeCompare(b.path));
            for (const file of files) {
                this.extractStatblocksFromFile(await this.plugin.app.vault.cachedRead(file), file.path, statblocks);
            }
        } else {
            console.warn(`Daggerheart | Configured compendium path was not found: ${folderPath}`);
        }
        return statblocks;
    }

    private extractStatblocksFromFile(content: string, filePath: string, statblocks: StatblockData[]): void {
        const pattern = /```daggerheart-statblock\s*([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            try {
                const statblock = YAML.load(match[1]) as StatblockData;
                if (statblock?.name && (statblock.category === 'adversary' || statblock.category === 'environment')) {
                    statblocks.push({ ...statblock, isCustom: true, sourceFile: filePath });
                }
            } catch (error) {
                console.warn(`Daggerheart | Failed to parse statblock YAML in ${filePath}:`, error);
            }
        }
    }
}
