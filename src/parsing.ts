import { App, TFile, TFolder, Notice } from 'obsidian';
import * as YAML from 'js-yaml';
import { StatblockData, StatblockHpStress, StatblockFeature, StatblockExperience, AdversaryInstance } from '../types';
import DaggerheartStatblockPlugin from '../main';

const SRD_ADVERSARIES_FILE = "adversaries.json";

function parseFeatureCost(description: string): string | undefined {
    if (!description) return undefined;
    const desc = description.toLowerCase();

    const stressMatch = desc.match(/(?:mark|suffer)\s+(a|\d+)\s+stress/);
    if (stressMatch) {
        const amount = stressMatch[1];
        return amount === 'a' ? 'S' : `${amount}S`;
    }

    const fearMatch = desc.match(/spend\s+(a|\d+)\s+fear/);
    if (fearMatch) {
        const amount = fearMatch[1];
        return amount === 'a' ? 'F' : `${amount}F`;
    }

    return undefined;
}

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
                    let featNameFull = feat.name;
                    let type = "Passive";
                    let nameOnly = featNameFull;

                    const typeMatch = featNameFull.match(/-\s*(Passive|Action|Reaction(?:[:\s].*)?)$/i);
                    if (typeMatch) {
                        type = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase().replace(/:.*/, '').trim();
                        nameOnly = featNameFull.substring(0, typeMatch.index).trim();
                    }

                    const description = feat.text;
                    const parsedCost = parseFeatureCost(description);

                    features.push({ name: nameOnly.trim(), type, description, parsedCost });
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

function extractStatblocksFromFile(content: string, filePath: string, adversariesArray: StatblockData[]) {
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

                if (statblock.features && Array.isArray(statblock.features)) {
                    statblock.features.forEach(feature => {
                        if (feature.description) {
                            feature.parsedCost = parseFeatureCost(feature.description);
                        }
                        // Remove old cost property if it exists from YAML
                        if ((feature as any).cost !== undefined) {
                            delete (feature as any).cost;
                        }
                    });
                }

                adversariesArray.push(statblock);
            }
        } catch (e: any) { console.warn(`Failed to parse YAML in ${filePath}: ${e.message}.`); }
    }
}

export async function getCompendiumAdversaries(plugin: DaggerheartStatblockPlugin): Promise<StatblockData[]> {
    const adversariesMap = new Map<string, StatblockData>();

    // 1. Load SRD Adversaries
    if (plugin.settings.useSrdAdversaries) {
        try {
            const srdFilePath = `${plugin.manifest.dir}/${SRD_ADVERSARIES_FILE}`;
            if (await plugin.app.vault.adapter.exists(srdFilePath)) {
                const srdFileContent = await plugin.app.vault.adapter.read(srdFilePath);
                const cleanedSrdContent = srdFileContent.charCodeAt(0) === 0xFEFF ? srdFileContent.substring(1) : srdFileContent;
                const srdRawAdversaries = JSON.parse(cleanedSrdContent) as any[];
                srdRawAdversaries.forEach(rawAdv => {
                    const transformed = parseSrdAdversaryData(rawAdv);
                    if (transformed) adversariesMap.set(transformed.name.toLowerCase(), transformed);
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
                const userAdversaries = JSON.parse(userFileContent) as StatblockData[];
                userAdversaries.forEach(adversary => {
                    adversary.isCustom = true;
                    adversary.sourceFile = userCompendiumPath;
                    adversariesMap.set(adversary.name.toLowerCase(), adversary);
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
        const mdAdversaries: StatblockData[] = [];
        if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            extractStatblocksFromFile(await plugin.app.vault.cachedRead(abstractFileOrFolder), abstractFileOrFolder.path, mdAdversaries);
        } else if (abstractFileOrFolder instanceof TFolder) {
            for (const file of abstractFileOrFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')) {
                extractStatblocksFromFile(await plugin.app.vault.cachedRead(file), file.path, mdAdversaries);
            }
        }
        mdAdversaries.forEach(adversary => adversariesMap.set(adversary.name.toLowerCase(), adversary));
    }

    return Array.from(adversariesMap.values());
}


export async function saveAdversaryToUserCompendium(plugin: DaggerheartStatblockPlugin, adversaryData: StatblockData): Promise<void> {
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

    // Clean the adversary data before saving
    const adversaryToSave: Partial<AdversaryInstance> = { ...adversaryData };
    delete adversaryToSave.id;
    delete adversaryToSave.groupId;
    delete adversaryToSave.currentHp;
    delete adversaryToSave.currentStress;
    delete adversaryToSave.displayName;
    delete adversaryToSave.conditions;
    adversaryToSave.isCustom = true;
    adversaryToSave.sourceFile = filePath;


    const existingIndex = compendium.findIndex(c => c.name.toLowerCase() === (adversaryToSave as StatblockData).name.toLowerCase());
    if (existingIndex !== -1) {
        compendium[existingIndex] = adversaryToSave as StatblockData;
    } else {
        compendium.push(adversaryToSave as StatblockData);
    }

    try {
        await plugin.app.vault.adapter.write(filePath, JSON.stringify(compendium, null, 2));
        new Notice(`"${adversaryToSave.name}" saved to your compendium.`);
    } catch (e: any) {
        new Notice("Failed to save to user compendium. See console for details.");
        console.error("Error saving to user compendium:", e);
    }
}
