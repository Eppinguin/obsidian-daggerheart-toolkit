import { App, TFile, TFolder, Notice } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, StatblockHpStress, StatblockFeature, StatblockExperience } from '../types';
import DaggerheartStatblockPlugin from '../main';

const SRD_ADVERSARIES_FILE = "adversaries.json";

function parseSrdAdversaryData(srd: any): StatblockData | null {
    try {
        if (!srd.name || !srd.hp || !srd.stress) return null;
        const hpStress: StatblockHpStress = { hp: Number(srd.hp) || 0, stress: Number(srd.stress) || 0 };
        if (srd.thresholds && typeof srd.thresholds === 'string') {
            const parts = srd.thresholds.split('/');
            if (parts.length >= 1 && parts[0].trim().toLowerCase() !== "none") hpStress.major_hp = Number(parts[0].trim()) || null;
            if (parts.length >= 2 && parts[1].trim().toLowerCase() !== "none") hpStress.severe_hp = Number(parts[1].trim()) || null;
        }
        const features: StatblockFeature[] = [];
        if (srd.feats && Array.isArray(srd.feats)) {
            srd.feats.forEach((feat: any) => {
                if (feat.name && feat.text) {
                    let featNameFull = feat.name, cost: string | number | undefined, type = "Passive", nameOnly = featNameFull;
                    const typeMatch = featNameFull.match(/-\s*(Passive|Action|Reaction(?:[:\s].*)?)$/i);
                    if (typeMatch) { type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase().replace(/:.*/, '').trim(); nameOnly = featNameFull.substring(0, typeMatch.index).trim(); }
                    const costMatch = nameOnly.match(/\(([^)]+)\)$/);
                    if (costMatch) { const costStr = costMatch[1]; cost = !isNaN(Number(costStr)) ? Number(costStr) : costStr; nameOnly = nameOnly.substring(0, costMatch.index).trim(); }
                    features.push({ name: nameOnly.trim(), type, cost, description: feat.text });
                }
            });
        }
        return {
            name: srd.name, tier: srd.tier ? (isNaN(Number(srd.tier)) ? srd.tier : Number(srd.tier)) : undefined, type: srd.type,
            description: srd.description, motives_tactics: srd.motives_and_tactics,
            difficulty: srd.difficulty ? (isNaN(Number(srd.difficulty)) ? srd.difficulty : Number(srd.difficulty)) : undefined,
            hp_stress: hpStress,
            attack: { name: srd.attack || "Attack", range: srd.range || "", damage: srd.damage || "", modifier: srd.atk || "0" },
            experience: srd.experience, features, sourceFile: SRD_ADVERSARIES_FILE
        };
    } catch (e) { console.error("Error parsing SRD data:", srd, e); return null; }
}

function extractStatblocksFromFile(content: string, filePath: string, creaturesArray: StatblockData[]) {
    const codeBlockRegex = /```daggerheart-statblock\s*([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
        try {
            const yamlContent = match[1].replace(/\u00A0/g, ' ');
            const statblock = YAML.load(yamlContent) as StatblockData;
            if (statblock?.name && statblock.hp_stress) {
                statblock.sourceFile = filePath;
                statblock.hp_stress.hp = Number(statblock.hp_stress.hp);
                statblock.hp_stress.stress = Number(statblock.hp_stress.stress);
                if (statblock.hp_stress.major_hp) statblock.hp_stress.major_hp = Number(statblock.hp_stress.major_hp);
                if (statblock.hp_stress.severe_hp) statblock.hp_stress.severe_hp = Number(statblock.hp_stress.severe_hp);
                if (typeof statblock.experience === 'string') {
                    const expObj: StatblockExperience = {};
                    statblock.experience.split(',').forEach(part => { const sp = part.trim().split(/\s+/); if (sp.length === 2 && !isNaN(Number(sp[1]))) expObj[sp[0]] = Number(sp[1]); });
                    statblock.experience = expObj;
                } else if (!statblock.experience) statblock.experience = {};
                statblock.motives_tactics = typeof statblock.motives_tactics === 'string' ? statblock.motives_tactics.split(',').map(s => s.trim()) : (statblock.motives_tactics || []);
                creaturesArray.push(statblock);
            }
        } catch (e: any) { console.warn(`Failed to parse YAML in ${filePath}: ${e.message}.`); }
    }
}


export async function getCompendiumCreatures(plugin: DaggerheartStatblockPlugin): Promise<StatblockData[]> {
    const creatures: StatblockData[] = [];
    if (plugin.settings.useSrdAdversaries) {
        try {
            const srdFilePath = `${plugin.manifest.dir}/${SRD_ADVERSARIES_FILE}`;
            if (await plugin.app.vault.adapter.exists(srdFilePath)) {
                const srdFileContent = await plugin.app.vault.adapter.read(srdFilePath);
                const cleanedSrdContent = srdFileContent.charCodeAt(0) === 0xFEFF ? srdFileContent.substring(1) : srdFileContent;
                const srdRawCreatures = JSON.parse(cleanedSrdContent) as any[];
                srdRawCreatures.forEach(rawAdv => {
                    const transformed = parseSrdAdversaryData(rawAdv);
                    if (transformed) creatures.push(transformed);
                });
            } else { new Notice(`SRD file (${SRD_ADVERSARIES_FILE}) not found.`); }
        } catch (e: any) { console.error("Error loading SRD:", e); new Notice("Error SRD."); }
    }

    const folderPath = plugin.settings.compendiumFolder;
    if (folderPath) {
        const abstractFileOrFolder = plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!abstractFileOrFolder) { new Notice(`Compendium path "${folderPath}" not found.`); }
        else if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            extractStatblocksFromFile(await plugin.app.vault.cachedRead(abstractFileOrFolder), abstractFileOrFolder.path, creatures);
        } else if (abstractFileOrFolder instanceof TFolder) {
            for (const file of abstractFileOrFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')) {
                extractStatblocksFromFile(await plugin.app.vault.cachedRead(file), file.path, creatures);
            }
        } else { new Notice(`Compendium path "${folderPath}" is not valid.`); }
    }

    const uniqueCreatures: StatblockData[] = [];
    const names = new Set<string>();
    creatures.forEach(c => { if (!names.has(c.name)) { uniqueCreatures.push(c); names.add(c.name); } });
    return uniqueCreatures;
}
