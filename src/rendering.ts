import { App, Notice, setIcon } from 'obsidian';
import { StatblockData, CreatureInstance } from '../types';
import DaggerheartStatblockPlugin from '../main';
import { ENCOUNTER_BUILDER_VIEW_TYPE, EncounterBuilderView } from './view';
import { group } from 'console';

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
    (statblockContentDiv as HTMLElement).style.userSelect = 'text';

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
    displayName: string,
    hpUpdateCallback?: (newHp: number) => void,
    stressUpdateCallback?: (newStress: number) => void,
    groupSize: number = 1
) {
    let statblockContentDiv = containerEl.querySelector('.dh-instance-card-content') ||
        containerEl.createDiv({ cls: 'dh-instance-card-content' });
    statblockContentDiv.empty();
    (statblockContentDiv as HTMLElement).style.userSelect = 'text';

    // Handle image
    if (data.image) {
        const parentCard = containerEl.closest('.dh-creature-instance-card') || containerEl;
        const imgContainer = parentCard.querySelector('.dh-card-image-container') ||
            parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
        imgContainer.empty();
        imgContainer.createEl('img', { attr: { src: data.image, alt: data.name }, cls: 'dh-card-image' });
    }

    // Header and basic info
    const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
    // Always use the base name without numbering for the header
    if (data.name) headerDiv.createSpan({ cls: 'dh-name', text: data.name.toUpperCase() });

    const roleTagText = `${data.tier ? `Tier ${data.tier} ` : ''}${data.type || ''}`.trim();
    if (roleTagText) {
        statblockContentDiv.createDiv({ text: roleTagText, cls: 'dh-card-role-text' });
    }

    // Optional sections
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

    // Core stats
    const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
    if (data.difficulty !== undefined) {
        coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
    }

    // Attack section
    if (data.attack) {
        const attackSpan = coreStatsLine.createSpan({ cls: 'dh-attack-details-span' });
        attackSpan.createEl('strong', { text: `${data.attack.name || 'Attack'}:` });
        attackSpan.appendText(` ${data.attack.range || ''} – `);

        const damageSpan = attackSpan.createSpan();
        renderRollableContent(plugin, data.attack.damage || '', damageSpan);

        attackSpan.appendText(' (ATK ');
        const modValue = String(data.attack.modifier ?? '0').trim();
        if (/^[+-]?\d+$/.test(modValue) && plugin.isDiceRollerEnabled) {
            const diceString = `1d20${modValue === '0' ? '' : modValue.startsWith('+') ? modValue : `+${modValue}`}`;
            const rollSpan = attackSpan.createSpan({ text: modValue, cls: 'dh-rollable-dice', attr: { title: `Click to roll ${diceString}` } });
            rollSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                rollDice(plugin, diceString);
            });
        } else {
            attackSpan.appendText(modValue);
        }
        attackSpan.appendText(')');
    }

    // Features section
    if (data.features?.length) {
        const featuresDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
        featuresDiv.createDiv({ text: 'FEATURES', cls: 'dh-instance-features-title' });
        const featuresList = featuresDiv.createEl('ul', { cls: 'dh-features-list' });

        data.features.forEach(feature => {
            if (!feature?.name) return;
            const li = featuresList.createEl('li');
            const header = li.createDiv({ cls: 'dh-feature-header-container' });

            const nameSpan = header.createSpan({ cls: 'dh-feature-name' });
            nameSpan.innerHTML = `<strong>${feature.name}</strong>${feature.cost ? ` (${feature.cost})` : ''}${feature.type ? ` - ${feature.type}` : ''}`;

            if (feature.description) {
                const toggle = header.createSpan({
                    cls: 'dh-feature-toggle',
                    text: plugin.settings.showFeatureDetailsOnCards ? ' [-]' : ' [+]'
                });
                const descDiv = li.createDiv({
                    cls: `dh-feature-description${plugin.settings.showFeatureDetailsOnCards ? '' : ' dh-feature-description-hidden'}`
                });
                renderRollableContent(plugin, feature.description, descDiv);

                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                    toggle.setText(isHidden ? ' [+]' : ' [-]');
                });
            }
        });
    }

    // HP and Stress tracks
    if (data.hp_stress) {
        const trackContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });
        const row = trackContainer.createDiv({ cls: 'dh-additional-tracker-row' });

        // Instance header with name and controls
        const header = row.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: data.displayName, cls: 'dh-additional-tracker-name' });
        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });
        addConditionButton(controlsWrapper, data.id, containerEl);
        const removeBtn = controlsWrapper.createEl('button', { text: '✕', title: "Remove this instance", cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => containerEl.dispatchEvent(new CustomEvent('dh-remove-instance', {
            bubbles: true,
            detail: { instanceId: data.id }
        })));

        // Conditions
        const conditionsDiv = row.createDiv({ cls: 'dh-conditions-container' });

        data.conditions?.forEach(condition => {
            const tag = conditionsDiv.createDiv({ cls: 'dh-condition-tag', attr: { title: condition.description } });
            tag.createSpan({ text: condition.name });
            const removeBtn = tag.createSpan({ text: '✕', cls: 'dh-condition-remove' });
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                containerEl.dispatchEvent(new CustomEvent('dh-remove-condition', {
                    bubbles: true,
                    detail: { instanceId: data.id, conditionName: condition.name }
                }));
            });
        });

        // Create HP and Stress tracks
        const hpMax = Number(data.hp_stress.hp) || 0;
        const stressMax = Number(data.hp_stress.stress) || 0;
        createInteractiveTrack(row, 'HP', hpMax, `${data.id}-hp-main`, data.currentHp,
            hpUpdateCallback || ((hp) => data.currentHp = hp));
        createInteractiveTrack(row, 'Stress', stressMax, `${data.id}-stress-main`, data.currentStress,
            stressUpdateCallback || ((stress) => data.currentStress = stress));

        trackContainer.createDiv({ cls: 'dh-additional-trackers-container' });
    }
}

function addConditionButton(container: HTMLElement, instanceId: string, containerEl: HTMLElement) {
    const btn = container.createEl('button', {
        title: 'Add Condition',
        cls: 'dh-icon-button dh-add-condition-btn'
    });
    setIcon(btn, 'tag');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        containerEl.dispatchEvent(new CustomEvent('dh-request-condition-menu', {
            bubbles: true,
            detail: { instanceId, anchor: btn }
        }));
    });
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
