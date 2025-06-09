import { App, Notice } from 'obsidian';
import { StatblockData, CreatureInstance } from '../types';
import DaggerheartStatblockPlugin from '../main';
import { ENCOUNTER_BUILDER_VIEW_TYPE, EncounterBuilderView } from './view';

async function rollDice(plugin: DaggerheartStatblockPlugin, diceString: string) {
    const diceRollerPlugin = (plugin.app as any).plugins.getPlugin("obsidian-dice-roller");
    if (!diceRollerPlugin) {
        new Notice("Dice Roller plugin is not enabled. Please install or enable it to roll dice.");
        return;
    }

    const DiceRollerAPI = diceRollerPlugin.api;
    if (!DiceRollerAPI || typeof DiceRollerAPI.getRoller !== 'function') {
        new Notice("Dice Roller plugin API not available. Please ensure Dice Roller is up to date.");
        console.error("Daggerheart: Dice Roller plugin is active, but its API is not available or is missing getRoller.");
        return;
    }

    try {
        console.log(plugin.settings.useGraphicalDice, "useGraphicalDice setting");
        const roller = await DiceRollerAPI.getRoller(diceString);
        if (plugin.settings.useGraphicalDice) {

            await roller.roll({
                showDice: plugin.settings.useGraphicalDice,
                throw: plugin.settings.useGraphicalDice
            });
        }
        else {
            await roller.roll();
            const result = roller.result;
            new Notice(`Rolled ${diceString}: ${result}`, 5000);
        }

    } catch (e) {
        console.error("Daggerheart: Error rolling dice:", e);
        new Notice(`Error rolling dice for "${diceString}". See console for details.`);
    }
}

function renderRollableContent(plugin: DaggerheartStatblockPlugin, text: string, containerEl: HTMLElement) {
    if (!plugin.isDiceRollerEnabled) {
        containerEl.appendText(text);
        return;
    }

    const regex = /(\b\d+d\d+(\s*[+-]\s*\d+)*\b)/gi;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            containerEl.appendText(text.substring(lastIndex, match.index));
        }

        const diceString = match[0].replace(/\s/g, '');
        const rollableSpan = containerEl.createSpan({
            text: match[0],
            cls: 'dh-rollable-dice',
            title: `Click to roll ${diceString}`
        });
        rollableSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            rollDice(plugin, diceString)
        });

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        containerEl.appendText(text.substring(lastIndex));
    }
}

export function createInteractiveTrack(
    parentEl: HTMLElement, label: string, maxValue: number, trackIdPrefix: string,
    currentValue: number, updateCallback: (newValue: number) => void
) {
    const trackDiv = parentEl.createDiv({ cls: `dh-interactive-track dh-${label.toLowerCase()}-track` });
    trackDiv.createSpan({ text: label.toUpperCase(), cls: 'dh-track-label' });
    const controlsDiv = trackDiv.createDiv({ cls: 'dh-track-controls' });
    const decrementButton = controlsDiv.createEl('button', { text: '−', cls: 'dh-track-btn dh-track-btn-decrement' });
    const pipsContainer = controlsDiv.createDiv({ cls: 'dh-pips-container' });
    const pips: HTMLDivElement[] = [];

    const updatePipsAndState = (newVal: number) => {
        let actualNewValue = Math.max(0, Math.min(newVal, maxValue));
        pips.forEach((p, idx) => p.classList.toggle('dh-pip-marked', idx < actualNewValue));
        updateCallback(actualNewValue);
    };

    for (let i = 0; i < maxValue; i++) {
        const pip = pipsContainer.createDiv({ cls: 'dh-pip' });
        pip.dataset.index = i.toString();
        if (i < currentValue) pip.classList.add('dh-pip-marked');
        pip.addEventListener('click', () => {
            const clickedIndex = parseInt(pip.dataset.index!);
            const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
            updatePipsAndState(pip.classList.contains('dh-pip-marked') && clickedIndex === currentMarkedCount - 1 ? clickedIndex : clickedIndex + 1);
        });
        pips.push(pip);
    }

    const incButton = controlsDiv.createEl('button', { text: '+', cls: 'dh-track-btn dh-track-btn-increment' });
    decrementButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount > 0) updatePipsAndState(currentMarkedCount - 1);
    });
    incButton.addEventListener('click', () => {
        const currentMarkedCount = pips.filter(p => p.classList.contains('dh-pip-marked')).length;
        if (currentMarkedCount < maxValue) updatePipsAndState(currentMarkedCount + 1);
    });
}

function renderEditorStatblock(plugin: DaggerheartStatblockPlugin, data: StatblockData, containerEl: HTMLElement) {
    containerEl.empty();
    const statblockContentDiv = containerEl.createDiv({ cls: 'dh-editor-statblock' });
    statblockContentDiv.style.userSelect = 'text';

    if (data.name) statblockContentDiv.createDiv({ cls: 'dh-name', text: data.name.toUpperCase() });

    if (data.tier || data.type) {
        let tierTypeString = "";
        if (data.tier) tierTypeString += `Tier ${data.tier}`;
        if (data.type) tierTypeString += ` ${data.type}`;
        statblockContentDiv.createDiv({ cls: 'dh-tier-type', text: tierTypeString.trim() });
    }

    if (data.description) statblockContentDiv.createDiv({ cls: 'dh-description', text: data.description });

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
        if (motivesText) {
            const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
            motivesDiv.appendText(motivesText);
        }
    }

    const statsGrid = statblockContentDiv.createDiv({ cls: 'dh-stats-grid' });
    const statElements: HTMLElement[] = [];

    if (data.difficulty !== undefined) {
        const span = document.createElement('span');
        span.createEl('strong', { text: 'Difficulty: ' });
        span.appendText(String(data.difficulty));
        statElements.push(span);
    }

    if (data.hp_stress) {
        const thresholds = [];
        if (data.hp_stress.major_hp != null) thresholds.push(data.hp_stress.major_hp);
        if (data.hp_stress.severe_hp != null) thresholds.push(data.hp_stress.severe_hp);
        if (thresholds.length > 0) {
            const span = document.createElement('span');
            span.createEl('strong', { text: 'Thresholds: ' });
            span.appendText(thresholds.join('/'));
            statElements.push(span);
        }
        const hpSpan = document.createElement('span');
        hpSpan.createEl('strong', { text: 'HP: ' });
        hpSpan.appendText(String(data.hp_stress.hp));
        statElements.push(hpSpan);

        const stressSpan = document.createElement('span');
        stressSpan.createEl('strong', { text: 'Stress: ' });
        stressSpan.appendText(String(data.hp_stress.stress));
        statElements.push(stressSpan);
    }

    if (data.attack) {
        const atkSpan = document.createElement('span');
        atkSpan.createEl('strong', { text: 'ATK: ' });

        const modifierValue = String(data.attack.modifier ?? '0').trim();
        if (/^[+-]?\d+$/.test(modifierValue) && plugin.isDiceRollerEnabled) {
            let normalizedModifier = modifierValue;
            if (!normalizedModifier.startsWith('+') && !normalizedModifier.startsWith('-') && normalizedModifier !== '0') {
                normalizedModifier = `+${modifierValue}`;
            }
            const diceString = `1d20${(normalizedModifier === '+0' || normalizedModifier === '0') ? '' : normalizedModifier}`;
            const atkRollable = atkSpan.createSpan({ text: modifierValue, cls: 'dh-rollable-dice' });
            atkRollable.title = `Click to roll ${diceString}`;
            atkRollable.addEventListener('click', (e) => { e.stopPropagation(); rollDice(plugin, diceString); });
        } else {
            atkSpan.appendText(modifierValue);
        }
        statElements.push(atkSpan);

        const attackDetailsSpan = document.createElement('span');
        attackDetailsSpan.createEl('strong', { text: `${data.attack.name || 'Attack'}: ` });
        attackDetailsSpan.appendText(`${data.attack.range || ''} `);
        renderRollableContent(plugin, data.attack.damage || '', attackDetailsSpan);
        statElements.push(attackDetailsSpan);
    }

    statElements.forEach((el, index) => {
        statsGrid.appendChild(el);
        if (index < statElements.length - 1) {
            statsGrid.createSpan({ text: '|', cls: 'dh-stat-separator' });
        }
    });

    if (data.features && data.features.length > 0) {
        statblockContentDiv.createDiv({ text: 'FEATURES', cls: 'dh-features-title' });

        const featuresListUl = statblockContentDiv.createEl('ul', { cls: 'dh-features-list' });
        data.features.forEach(feature => {
            if (typeof feature !== 'object' || !feature.name) return;
            const featureLi = featuresListUl.createEl('li');
            const p = featureLi.createEl('p');

            let title = `${feature.name}`;
            if (feature.type) title += ` - ${feature.type}`;
            p.createEl('strong', { text: `${title}: ` });

            let description = feature.description || '';

            const descSpan = p.createSpan({ cls: 'dh-feature-description' });
            renderRollableContent(plugin, description, descSpan);
        });
    }
}

function renderInstanceStatblock(
    plugin: DaggerheartStatblockPlugin,
    data: CreatureInstance,
    containerEl: HTMLElement,
    displayName: string, // This will be the un-numbered name for the header
    hpUpdateCallback: ((newHp: number) => void) | undefined,
    stressUpdateCallback: ((newStress: number) => void) | undefined,
    groupSize: number = 1
) {
    let statblockContentDiv = containerEl.querySelector('.dh-instance-card-content') as HTMLElement;
    if (statblockContentDiv) {
        statblockContentDiv.empty();
    } else {
        statblockContentDiv = containerEl.createDiv({ cls: 'dh-instance-card-content' });
    }

    statblockContentDiv.style.userSelect = 'text';

    if (data.image) {
        const parentCard = containerEl.closest('.dh-creature-instance-card') || containerEl;
        let imgContainer = parentCard.querySelector('.dh-card-image-container') as HTMLElement;
        if (!imgContainer) imgContainer = parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
        imgContainer.empty();
        imgContainer.createEl('img', { attr: { src: data.image, alt: data.name }, cls: 'dh-card-image' });
    }

    const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
    // Use the passed displayName (which should be the original name) for the main header
    if (displayName) headerDiv.createSpan({ cls: 'dh-name', text: displayName.toUpperCase() });

    let roleTagText = "";
    if (data.tier) roleTagText += `Tier ${data.tier} `;
    if (data.type) roleTagText += data.type.toUpperCase();
    if (roleTagText.trim()) {
        const roleTagDiv = statblockContentDiv.createDiv({ text: roleTagText.trim(), cls: 'dh-card-role-text' });
        headerDiv.insertAdjacentElement('afterend', roleTagDiv);
    }

    if (data.description && plugin.settings.showDescriptionOnCards) {
        statblockContentDiv.createDiv({ text: data.description, cls: 'dh-description' });
    }

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
        if (motivesText) {
            const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
            motivesDiv.appendText(motivesText);
        }
    }

    if (data.experience) {
        let expStringContent = "";
        if (typeof data.experience === 'string') expStringContent = data.experience;
        else if (typeof data.experience === 'object' && Object.keys(data.experience).length > 0) {
            expStringContent = Object.entries(data.experience)
                .map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)} ${value}`)
                .join(', ');
        }
        if (expStringContent) {
            const expDiv = statblockContentDiv.createDiv({ cls: 'dh-experience' });
            expDiv.createEl('strong', { text: 'Experience: ' });
            expDiv.appendText(expStringContent);
        }
    }

    const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
    if (data.difficulty !== undefined) coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
    if (data.attack) {
        const attackDisplaySpan = coreStatsLine.createSpan({ cls: 'dh-attack-details-span' });
        let modifierText = String(data.attack.modifier ?? '0').trim();

        const renderModifier = (container: HTMLElement) => {
            const modifierValue = modifierText;
            if (/^[+-]?\d+$/.test(modifierValue)) {
                if (plugin.isDiceRollerEnabled) {
                    let normalizedModifier = modifierValue;
                    if (!normalizedModifier.startsWith('+') && !normalizedModifier.startsWith('-') && normalizedModifier !== '0') {
                        normalizedModifier = `+${modifierValue}`;
                    }
                    const diceString = `1d20${(normalizedModifier === '+0' || normalizedModifier === '0') ? '' : normalizedModifier}`;

                    const atkRollable = container.createSpan({ text: modifierValue, cls: 'dh-rollable-dice' });
                    atkRollable.title = `Click to roll ${diceString}`;
                    atkRollable.addEventListener('click', (e) => {
                        e.stopPropagation();
                        rollDice(plugin, diceString);
                    });
                } else {
                    container.appendText(modifierValue);
                }
            } else {
                container.appendText(modifierValue);
            }
        };

        attackDisplaySpan.createEl('strong', { text: `${data.attack.name || 'Attack'}:` });
        attackDisplaySpan.appendText(` ${data.attack.range || ''} – `);
        renderRollableContent(plugin, data.attack.damage || '', attackDisplaySpan.createSpan());
        attackDisplaySpan.appendText(' (ATK ');
        renderModifier(attackDisplaySpan);
        attackDisplaySpan.appendText(')');
    }

    if (data.features && Array.isArray(data.features) && data.features.length > 0) {
        const featuresSectionDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
        featuresSectionDiv.createDiv({ text: 'FEATURES', cls: 'dh-instance-features-title' });
        const featuresListUl = featuresSectionDiv.createEl('ul', { cls: 'dh-features-list' });
        data.features.forEach(feature => {
            if (typeof feature !== 'object' || !feature.name) return;
            const featureLi = featuresListUl.createEl('li');
            const headerContainer = featureLi.createDiv({ cls: 'dh-feature-header-container' });
            let featureHeaderString = `<strong>${feature.name}</strong>`;
            if (feature.cost !== undefined && feature.cost !== null) featureHeaderString += ` (${feature.cost})`;
            if (feature.type) featureHeaderString += ` - ${feature.type}`;

            const nameSpan = headerContainer.createSpan({ cls: 'dh-feature-name' });
            nameSpan.innerHTML = featureHeaderString;

            let fullDescriptionText = "";
            if (feature.countdown) {
                const countdownStr = `Countdown (${feature.countdown}).`;
                if (!String(feature.description || "").toLowerCase().trim().includes(`countdown (${String(feature.countdown).toLowerCase().trim()})`)) {
                    fullDescriptionText += `${countdownStr} `;
                }
            }
            if (feature.description) fullDescriptionText += feature.description;

            if (fullDescriptionText.trim()) {
                const toggle = headerContainer.createSpan({ cls: 'dh-feature-toggle', text: plugin.settings.showFeatureDetailsOnCards ? ' [-]' : ' [+]' });
                toggle.setAttrs({ 'aria-expanded': String(plugin.settings.showFeatureDetailsOnCards), role: 'button' });
                const descDiv = featureLi.createDiv({ cls: `dh-feature-description${plugin.settings.showFeatureDetailsOnCards ? '' : ' dh-feature-description-hidden'}` });
                renderRollableContent(plugin, fullDescriptionText.trim(), descDiv);
                toggle.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                    toggle.setText(isHidden ? ' [+]' : ' [-]');
                    toggle.setAttr('aria-expanded', String(!isHidden));
                });
            }
        });
    }

    if (data.hp_stress) {
        const hpStressContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });

        const primaryTrackerRow = hpStressContainer.createDiv({
            cls: 'dh-additional-tracker-row'
        });

        if (groupSize > 1) {
            const header = primaryTrackerRow.createDiv({ cls: 'dh-additional-tracker-header' });
            // Here we use the instance-specific, numbered `displayName` from the data object
            header.createSpan({ text: data.displayName, cls: 'dh-additional-tracker-name' });
        }

        const hpMax = Number(data.hp_stress.hp) || 0;
        const stressMax = Number(data.hp_stress.stress) || 0;

        const creatureInstance = data as CreatureInstance;
        const hpCb = hpUpdateCallback || ((newHp) => creatureInstance.currentHp = newHp);
        const stressCb = stressUpdateCallback || ((newStress) => creatureInstance.currentStress = newStress);

        createInteractiveTrack(primaryTrackerRow, 'HP', hpMax, `${creatureInstance.id}-hp-main`, creatureInstance.currentHp, hpCb);
        createInteractiveTrack(primaryTrackerRow, 'Stress', stressMax, `${creatureInstance.id}-stress-main`, creatureInstance.currentStress, stressCb);

        hpStressContainer.createDiv({ cls: 'dh-additional-trackers-container' });
    }
}

export function renderStatblockCard(
    plugin: DaggerheartStatblockPlugin,
    data: StatblockData | CreatureInstance,
    containerEl: HTMLElement,
    isInstance: boolean = false,
    displayName?: string,
    hpUpdateCallback?: (newHp: number) => void,
    stressUpdateCallback?: (newStress: number) => void,
    groupSize?: number
) {
    if (isInstance) {
        renderInstanceStatblock(plugin, data as CreatureInstance, containerEl, displayName || data.name, hpUpdateCallback, stressUpdateCallback, groupSize);
    } else {
        renderEditorStatblock(plugin, data, containerEl);
    }
}
