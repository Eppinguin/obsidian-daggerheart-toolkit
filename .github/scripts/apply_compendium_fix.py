from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f'Expected block not found: {label}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Expected one match for {label}, found {count}')
    return updated


main_path = Path('src/main.ts')
main = main_path.read_text()
main = replace_once(
    main,
    "import { ContentType } from './services/export-import';\n",
    "import { ContentType } from './services/export-import';\nimport { normalizeCompendiumPath, isPathInsideCompendium } from './services/compendium-path';\n",
    'path helper import'
)
main = replace_once(
    main,
    "    public settingsTab: DaggerheartSettingTab | null = null;\n",
    "    public settingsTab: DaggerheartSettingTab | null = null;\n    private compendiumReloadTimer: number | null = null;\n",
    'plugin reload timer field'
)
main = replace_once(
    main,
    "        this.settingsTab = new DaggerheartSettingTab(this.app, this);\n        this.addSettingTab(this.settingsTab);\n    }\n",
    "        this.settingsTab = new DaggerheartSettingTab(this.app, this);\n        this.addSettingTab(this.settingsTab);\n\n        this.registerEvent(this.app.vault.on('create', (file) => {\n            if (file instanceof TFile) this.scheduleMarkdownCompendiumReload(file.path);\n        }));\n        this.registerEvent(this.app.vault.on('modify', (file) => {\n            if (file instanceof TFile) this.scheduleMarkdownCompendiumReload(file.path);\n        }));\n        this.registerEvent(this.app.vault.on('delete', (file) => {\n            if (file instanceof TFile) this.scheduleMarkdownCompendiumReload(file.path);\n        }));\n        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {\n            if (file instanceof TFile) this.scheduleMarkdownCompendiumReload(file.path);\n            this.scheduleMarkdownCompendiumReload(oldPath);\n        }));\n    }\n",
    'vault listeners'
)
main = replace_once(
    main,
    "    private async ensureUserCompendiumFolderExists() {\n",
    "    private scheduleMarkdownCompendiumReload(path: string) {\n        const configuredPath = normalizeCompendiumPath(this.settings.compendiumFolder);\n        if (!isPathInsideCompendium(path, configuredPath)) return;\n\n        if (this.compendiumReloadTimer !== null) {\n            window.clearTimeout(this.compendiumReloadTimer);\n        }\n        this.compendiumReloadTimer = window.setTimeout(() => {\n            this.compendiumReloadTimer = null;\n            this.triggerCompendiumUpdate().catch(error => {\n                console.error('Daggerheart | Failed to reload Markdown compendium:', error);\n            });\n        }, 250);\n    }\n\n    private async ensureUserCompendiumFolderExists() {\n",
    'vault reload scheduler'
)
main = regex_once(
    main,
    r"(\s*await this\.saveData\(settingsToSave\);)\s*if \(this\.settingsTab\) \{\s*this\.settingsTab\.display\(\);\s*\}",
    r"\1",
    'saveSettings redraw removal'
)
main = replace_once(
    main,
    "    onunload() {\n        dddice.destroyDddiceRenderer();\n",
    "    onunload() {\n        if (this.compendiumReloadTimer !== null) {\n            window.clearTimeout(this.compendiumReloadTimer);\n            this.compendiumReloadTimer = null;\n        }\n        dddice.destroyDddiceRenderer();\n",
    'timer cleanup'
)
main = replace_once(
    main,
    "    private _dddiceObserverInterval: number | null = null;\n",
    "    private _dddiceObserverInterval: number | null = null;\n    private compendiumFolderSaveTimer: number | null = null;\n",
    'settings debounce field'
)
main = replace_once(
    main,
    "    renderCompendiumSettings(containerEl: HTMLElement) {\n",
    "    private scheduleCompendiumFolderUpdate(value: string) {\n        this.plugin.settings.compendiumFolder = normalizeCompendiumPath(value);\n        if (this.compendiumFolderSaveTimer !== null) {\n            window.clearTimeout(this.compendiumFolderSaveTimer);\n        }\n        this.compendiumFolderSaveTimer = window.setTimeout(async () => {\n            this.compendiumFolderSaveTimer = null;\n            try {\n                await this.plugin.saveSettings();\n                await this.plugin.triggerCompendiumUpdate();\n            } catch (error) {\n                console.error('Daggerheart | Failed to update compendium folder:', error);\n                new Notice('Could not reload the configured compendium folder. Check the developer console.');\n            }\n        }, 400);\n    }\n\n    renderCompendiumSettings(containerEl: HTMLElement) {\n",
    'folder update scheduler'
)
main = replace_once(
    main,
    "                    .onChange(async (value) => {\n                        this.plugin.settings.compendiumFolder = value.trim();\n                        await this.plugin.saveSettings();\n                        this.plugin.app.workspace.trigger('daggerheart-compendium-update');\n                    });\n",
    "                    .onChange((value) => {\n                        this.scheduleCompendiumFolderUpdate(value);\n                    });\n",
    'folder text change handler'
)
main_path.write_text(main)

compendium_path = Path('src/services/compendium.ts')
compendium = compendium_path.read_text()
compendium = replace_once(
    compendium,
    "import DaggerheartStatblockPlugin from '../main';\n",
    "import DaggerheartStatblockPlugin from '../main';\nimport { normalizeCompendiumPath } from './compendium-path';\n",
    'compendium path import'
)
compendium = regex_once(
    compendium,
    r"    private async loadMarkdownStatblocks\(\): Promise<StatblockData\[]> \{.*?\n    \}\n\n    private extractStatblocksFromFile",
    """    private async loadMarkdownStatblocks(): Promise<StatblockData[]> {
        const folderPath = normalizeCompendiumPath(this.plugin.settings.compendiumFolder);
        if (!folderPath) return [];

        const abstractFileOrFolder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        const mdStatblocks: StatblockData[] = [];
        if (abstractFileOrFolder instanceof TFile && abstractFileOrFolder.extension === 'md') {
            const content = await this.plugin.app.vault.cachedRead(abstractFileOrFolder);
            this.extractStatblocksFromFile(content, abstractFileOrFolder.path, mdStatblocks);
        } else if (abstractFileOrFolder instanceof TFolder) {
            const folderPrefix = `${abstractFileOrFolder.path}/`;
            const markdownFiles = this.plugin.app.vault.getMarkdownFiles()
                .filter(file => file.path.startsWith(folderPrefix))
                .sort((a, b) => a.path.localeCompare(b.path));
            for (const file of markdownFiles) {
                const content = await this.plugin.app.vault.cachedRead(file);
                this.extractStatblocksFromFile(content, file.path, mdStatblocks);
            }
        } else {
            console.warn(`Daggerheart | Configured compendium path was not found: ${folderPath}`);
        }
        return mdStatblocks;
    }

    private extractStatblocksFromFile""",
    'recursive markdown loader'
)
compendium_path.write_text(compendium)
