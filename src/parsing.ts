import { App, TFile, TFolder, Notice } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, StatblockHpStress, StatblockFeature, StatblockExperience, CreatureInstance } from '../types';
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
    const creaturesMap = new Map<string, StatblockData>();

    // 1. Load SRD Adversaries
    if (plugin.settings.useSrdAdversaries) {
        try {
            const srdFilePath = `${plugin.manifest.dir}/${SRD_ADVERSARIES_FILE}`;
            if (await plugin.app.vault.adapter.exists(srdFilePath)) {
                const srdFileContent = await plugin.app.vault.adapter.read(srdFilePath);
                const cleanedSrdContent = srdFileContent.charCodeAt(0) === 0xFEFF ? srdFileContent.substring(1) : srdFileContent;
                const srdRawCreatures = JSON.parse(cleanedSrdContent) as any[];
                srdRawCreatures.forEach(rawAdv => {
                    const transformed = parseSrdAdversaryData(rawAdv);
                    if (transformed) creaturesMap.set(transformed.name.toLowerCase(), transformed);
                });
            } else { new Notice(`SRD file (${SRD_ADVERSARIES_FILE}) not found.`); }
        } catch (e: any) { console.error("Error loading SRD:", e); new Notice("Error loading SRD."); }
    }

    // 2. Load User Compendium (JSON)
    if (plugin.settings.userCompendiumFile) {
        const userCompendiumPath = `${plugin.manifest.dir}/${plugin.settings.userCompendiumFile}`;
        if (await plugin.app.vault.adapter.exists(userCompendiumPath)) {
            try {
                const userFileContent = await plugin.app.vault.adapter.read(userCompendiumPath);
                const userCreatures = JSON.parse(userFileContent) as StatblockData[];
                userCreatures.forEach(creature => {
                    creature.isCustom = true;
                    creature.sourceFile = userCompendiumPath;
                    creaturesMap.set(creature.name.toLowerCase(), creature);
                });
            } catch (e: any) {
                console.error(`Error loading user compendium file \"${userCompendiumPath}\":`, e);
                new Notice(`Error loading user compendium: ${userCompendiumPath}`);
            }
        }
    }

    // 3. Load Markdown File/Folder Compendium (overwrites others)
    const folderPath = plugin.settings.compendiumFolder;
    if (folderPath) {
        const abstractFileOrFolder = plugin.app.vault.getAbstractFileByPath(folderPath);
        const mdCreatures: StatblockData[] = [];
        if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            extractStatblocksFromFile(await plugin.app.vault.cachedRead(abstractFileOrFolder), abstractFileOrFolder.path, mdCreatures);
        } else if (abstractFileOrFolder instanceof TFolder) {
            for (const file of abstractFileOrFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')) {
                extractStatblocksFromFile(await plugin.app.vault.cachedRead(file), file.path, mdCreatures);
            }
        }
        mdCreatures.forEach(creature => creaturesMap.set(creature.name.toLowerCase(), creature));
    }

    return Array.from(creaturesMap.values());
}


export async function saveCreatureToUserCompendium(plugin: DaggerheartStatblockPlugin, creatureData: StatblockData): Promise<void> {
    const userCompendiumFileName = plugin.settings.userCompendiumFile;
    if (!userCompendiumFileName) {
        new Notice("User compendium file path is not set in settings.");
        return;
    }
    const filePath = `${plugin.manifest.dir}/${userCompendiumFileName}`;

    let compendium: StatblockData[] = [];
    try {
        if (await plugin.app.vault.adapter.exists(filePath)) {
            const fileContent = await plugin.app.vault.adapter.read(filePath);
            if (fileContent) {
                compendium = JSON.parse(fileContent);
                if (!Array.isArray(compendium)) throw new Error("Compendium is not an array.");
            }
        }
    } catch (e: any) {
        new Notice(`Error reading user compendium file. Check console for details. Overwriting.`);
        console.error("Error reading user compendium, will overwrite:", e);
        compendium = [];
    }

    // Clean the creature data before saving
    const creatureToSave: Partial<CreatureInstance> = { ...creatureData };
    delete creatureToSave.id;
    delete creatureToSave.groupId;
    delete creatureToSave.currentHp;
    delete creatureToSave.currentStress;
    delete creatureToSave.displayName;
    delete creatureToSave.conditions;
    creatureToSave.isCustom = true;
    creatureToSave.sourceFile = filePath;


    const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === (creatureToSave as StatblockData).name.toLowerCase());
    if (existingIndex !== -1) {
        compendium[existingIndex] = creatureToSave as StatblockData;
    } else {
        compendium.push(creatureToSave as StatblockData);
    }

    try {
        await plugin.app.vault.adapter.write(filePath, JSON.stringify(compendium, null, 2));
        new Notice(`"${creatureToSave.name}" saved to your compendium.`);
    } catch (e: any) {
        new Notice("Failed to save to user compendium. See console for details.");
        console.error("Error saving to user compendium:", e);
    }
}
