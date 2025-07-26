import { Notice, setIcon } from 'obsidian';
import { StatblockData, AdversaryInstance } from '../types';
import DaggerheartStatblockPlugin from '../main';
import { createInteractiveTrack, renderRollableContent, renderMarkdown } from './ui-helpers';

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

    if (data.description) {
        const descDiv = statblockContentDiv.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
        if (motivesText) {
            const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
            const motivesContentDiv = motivesDiv.createSpan();
            renderMarkdown(plugin, motivesText, motivesContentDiv);
        }
    }
    if (data.impulses) {
        const impulsesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        impulsesDiv.createEl('strong', { text: 'Impulses: ' });
        const impulsesContentDiv = impulsesDiv.createSpan();
        renderMarkdown(plugin, data.impulses, impulsesContentDiv);
    }
    if (data.potential_adversaries) {
        const paDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        paDiv.createEl('strong', { text: 'Potential Adversaries: ' });
        const paContentDiv = paDiv.createSpan();
        renderMarkdown(plugin, data.potential_adversaries, paContentDiv);
    }

    const statsGrid = statblockContentDiv.createDiv({ cls: 'dh-stats-grid' });
    const statElements: HTMLElement[] = [];

    if (data.difficulty !== undefined) {
        const span = document.createElement('span');
        span.createEl('strong', { text: 'Difficulty: ' });
        span.appendText(String(data.difficulty));
        statElements.push(span);
    }

    if (data.hp_stress && data.category === 'adversary') {
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
        if (/^[+-]?\d+$/.test(modifierValue)) {
            let normalizedModifier = modifierValue;
            if (!normalizedModifier.startsWith('+') && !normalizedModifier.startsWith('-') && normalizedModifier !== '0') {
                normalizedModifier = `+${modifierValue}`;
            }
            const diceString = `1d20${(normalizedModifier === '+0' || normalizedModifier === '0') ? '' : normalizedModifier}`;
            const atkRollable = atkSpan.createSpan({ text: modifierValue, cls: 'dh-rollable-dice' });
            atkRollable.title = `Click to roll ${diceString}`;
            atkRollable.addEventListener('click', (e) => {
                e.stopPropagation();
                plugin.rollDice(diceString, data.attack?.name || 'Attack');
            });
        } else {
            atkSpan.appendText(modifierValue);
        }
        statElements.push(atkSpan);

        const attackDetailsSpan = document.createElement('span');
        attackDetailsSpan.createEl('strong', { text: `${data.attack.name || 'Attack'}: ` });
        attackDetailsSpan.appendText(`${data.attack.range || ''} `);
        renderRollableContent(plugin, data.attack.damage || '', attackDetailsSpan, data.attack.name || 'Attack');
        statElements.push(attackDetailsSpan);
    }

    if (data.experience) {
        const expSpan = document.createElement('span');
        expSpan.createEl('strong', { text: 'Experience: ' });

        if (typeof data.experience === 'string') {
            // If experience is just a string, display it directly
            expSpan.appendText(data.experience);
        } else {
            // If experience is a StatblockExperience object, format it like "Key +Value"
            const experienceEntries = Object.entries(data.experience);
            if (experienceEntries.length > 0) {
                const [key, value] = experienceEntries[0]; // Take first entry as shown in screenshot
                const formattedValue = value > 0 ? `+${value}` : value.toString();
                expSpan.appendText(`${key} ${formattedValue}`);
            }
        }
        statElements.push(expSpan);
    }

    statElements.forEach((el, index) => {
        statsGrid.appendChild(el);
        if (index < statElements.length - 1) {
            statsGrid.createSpan({ text: '|', cls: 'dh-stat-separator' });
        }
    });

    if (data.features && data.features.length > 0) {
        const title = 'FEATURES';
        statblockContentDiv.createDiv({ text: title, cls: 'dh-features-title' });

        const featuresListUl = statblockContentDiv.createEl('ul', { cls: 'dh-features-list' });
        data.features.forEach(feature => {
            if (typeof feature !== 'object' || !feature.name) return;
            const featureLi = featuresListUl.createEl('li');
            const p = featureLi.createEl('p');

            let title = `${feature.name}`;
            if (feature.type) title += ` - ${feature.type}`;
            const strongEl = p.createEl('strong');
            strongEl.style.fontStyle = 'italic';
            renderRollableContent(plugin, `${title}: `, strongEl, feature.name);

            let description = feature.description || '';

            const descSpan = p.createSpan({ cls: 'dh-feature-description' });
            // Also check for countdown in the description to ensure it's processed
            if (description.includes('d20') || description.includes('d6') || description.includes('Mark stress') || description.includes('Spend fear') || description.toLowerCase().includes('countdown')) {
                renderRollableContent(plugin, description, descSpan, feature.name);
            } else {
                renderMarkdown(plugin, description, descSpan);
            }
        });
    }
}

function renderEnvironmentInstance(
    plugin: DaggerheartStatblockPlugin,
    data: AdversaryInstance,
    containerEl: HTMLElement,
) {
    let statblockContentDiv = containerEl.querySelector('.dh-instance-card-content') ||
        containerEl.createDiv({ cls: 'dh-instance-card-content' });
    statblockContentDiv.empty();
    (statblockContentDiv as HTMLElement).style.userSelect = 'text';

    const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
    if (data.name) headerDiv.createSpan({ cls: 'dh-name', text: data.name.toUpperCase() });

    const roleTagText = `${data.tier ? `Tier ${data.tier} ` : ''}${data.type || ''}`.trim();
    if (roleTagText) {
        statblockContentDiv.createDiv({ text: roleTagText, cls: 'dh-card-role-text' });
    }

    if (data.description) {
        const descDiv = statblockContentDiv.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.impulses) {
        const impulsesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        impulsesDiv.createEl('strong', { text: 'Impulses: ' });
        const impulsesContentDiv = impulsesDiv.createSpan();
        renderMarkdown(plugin, data.impulses, impulsesContentDiv);
    }

    if (data.experience) {
        const experienceDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        experienceDiv.createEl('strong', { text: 'Experience: ' });
        const experienceContentDiv = experienceDiv.createSpan();

        if (typeof data.experience === 'string') {
            renderMarkdown(plugin, data.experience, experienceContentDiv);
        } else {
            // Handle StatblockExperience object format
            const experienceEntries = Object.entries(data.experience);
            if (experienceEntries.length > 0) {
                const formattedExperience = experienceEntries
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                renderMarkdown(plugin, formattedExperience, experienceContentDiv);
            }
        }
    }

    const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
    if (data.difficulty !== undefined) {
        coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
    }

    if (data.potential_adversaries) {
        const paDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        paDiv.createEl('strong', { text: 'Potential Adversaries: ' });
        const paContentDiv = paDiv.createSpan();
        renderMarkdown(plugin, data.potential_adversaries, paContentDiv);
    }

    if (data.features?.length) {
        const featuresDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
        featuresDiv.createDiv({ text: 'FEATS', cls: 'dh-instance-features-title' });
        const featuresList = featuresDiv.createEl('ul', { cls: 'dh-features-list' });
        data.features.forEach(feature => {
            if (!feature?.name) return;
            const li = featuresList.createEl('li', { cls: 'dh-feature-item' });
            const isExpanded = plugin.settings.showFeatureDetailsOnCards;
            const header = li.createDiv({ cls: `dh-feature-header-container${isExpanded ? ' is-expanded' : ''}` });
            const nameSpan = header.createSpan({ cls: 'dh-feature-name' });
            const strongEl = nameSpan.createEl('strong');
            renderRollableContent(plugin, feature.name, strongEl, feature.name);
            const metaContainer = header.createDiv({ cls: 'dh-feature-meta' });
            if (feature.parsedCost) {
                const costTag = metaContainer.createSpan({ text: feature.parsedCost, cls: 'dh-feature-tag dh-feature-tag-cost' });
                if (feature.parsedCost.includes('S')) costTag.addClass('dh-feature-tag-stress');
                else if (feature.parsedCost.includes('F')) costTag.addClass('dh-feature-tag-fear');
            }
            if (feature.type) {
                metaContainer.createSpan({ text: feature.type.toUpperCase(), cls: `dh-feature-tag dh-feature-tag-${feature.type.toLowerCase().replace(/\s+/g, '-')}` });
            }
            if (feature.description) {
                const toggle = metaContainer.createSpan({ cls: 'dh-feature-toggle' });
                setIcon(toggle, isExpanded ? 'chevron-down' : 'chevron-right');
            }
            if (feature.description) {
                const descDiv = li.createDiv({ cls: `dh-feature-description ${isExpanded ? '' : 'dh-feature-description-hidden'}` });
                renderRollableContent(plugin, feature.description, descDiv, feature.name);
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                    header.classList.toggle('is-expanded', !isHidden);
                    const toggleIconEl = header.querySelector('.dh-feature-toggle');
                    if (toggleIconEl) setIcon(toggleIconEl as HTMLElement, isHidden ? 'chevron-right' : 'chevron-down');
                });
            }
        });
    }
}

function renderAdversaryInstance(
    plugin: DaggerheartStatblockPlugin,
    data: AdversaryInstance,
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

    if (data.image) {
        const parentCard = containerEl.closest('.dh-adversary-instance-card') || containerEl;
        const imgContainer = parentCard.querySelector('.dh-card-image-container') ||
            parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
        imgContainer.empty();
        imgContainer.createEl('img', { attr: { src: data.image, alt: data.name }, cls: 'dh-card-image' });
    }

    const headerDiv = statblockContentDiv.createDiv({ cls: 'dh-header' });
    if (data.name) headerDiv.createSpan({ cls: 'dh-name', text: data.name.toUpperCase() });

    const roleTagText = `${data.tier ? `Tier ${data.tier} ` : ''}${data.type || ''}`.trim();
    if (roleTagText) {
        statblockContentDiv.createDiv({ text: roleTagText, cls: 'dh-card-role-text' });
    }

    if (data.description && plugin.settings.showDescriptionOnCards) {
        const descDiv = statblockContentDiv.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics) ? data.motives_tactics.join(', ') : data.motives_tactics;
        if (motivesText) {
            const motivesDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
            const motivesContentDiv = motivesDiv.createSpan();
            renderMarkdown(plugin, motivesText, motivesContentDiv);
        }
    }

    const coreStatsLine = statblockContentDiv.createDiv({ cls: 'dh-core-stats-line' });
    if (data.difficulty !== undefined) {
        coreStatsLine.createSpan().innerHTML = `<strong>Difficulty:</strong> ${data.difficulty}`;
    }

    if (data.attack) {
        const attackSpan = coreStatsLine.createSpan({ cls: 'dh-attack-details-span' });
        attackSpan.createEl('strong', { text: `${data.attack.name || 'Attack'}:` });
        attackSpan.appendText(` ${data.attack.range || ''} – `);
        const damageSpan = attackSpan.createSpan();
        renderRollableContent(plugin, data.attack.damage || '', damageSpan, data.attack.name || 'Attack');
        attackSpan.appendText(' (ATK ');
        const modValue = String(data.attack.modifier ?? '0').trim();
        if (/^[+-]?\d+$/.test(modValue)) {
            const diceString = `1d20${modValue === '0' ? '' : modValue.startsWith('+') ? modValue : `+${modValue}`}`;
            const attackName = data.attack?.name || 'Attack';
            const rollSpan = attackSpan.createSpan({
                text: modValue,
                cls: 'dh-rollable-dice',
                attr: { title: `Click to roll ${diceString} for ${attackName}` }
            });
            rollSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                plugin.rollDice(diceString, attackName);
            });
        } else {
            attackSpan.appendText(modValue);
        }
        attackSpan.appendText(')');
    }

    if (data.experience) {
        const experienceDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        experienceDiv.createEl('strong', { text: 'Experience: ' });
        const experienceContentDiv = experienceDiv.createSpan();

        if (typeof data.experience === 'string') {
            renderMarkdown(plugin, data.experience, experienceContentDiv);
        } else {
            // Handle StatblockExperience object format
            const experienceEntries = Object.entries(data.experience);
            if (experienceEntries.length > 0) {
                const formattedExperience = experienceEntries
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                renderMarkdown(plugin, formattedExperience, experienceContentDiv);
            }
        }
    }

    if (data.potential_adversaries) {
        const paDiv = statblockContentDiv.createDiv({ cls: 'dh-motives' });
        paDiv.createEl('strong', { text: 'Potential Adversaries: ' });
        const paContentDiv = paDiv.createSpan();
        renderMarkdown(plugin, data.potential_adversaries, paContentDiv);
    }

    if (data.features?.length) {
        const featuresDiv = statblockContentDiv.createDiv({ cls: 'dh-features-section' });
        featuresDiv.createDiv({ text: 'FEATS', cls: 'dh-instance-features-title' });
        const featuresList = featuresDiv.createEl('ul', { cls: 'dh-features-list' });
        data.features.forEach(feature => {
            if (!feature?.name) return;
            const li = featuresList.createEl('li', { cls: 'dh-feature-item' });
            const isExpanded = plugin.settings.showFeatureDetailsOnCards;
            const header = li.createDiv({ cls: `dh-feature-header-container${isExpanded ? ' is-expanded' : ''}` });
            const nameSpan = header.createSpan({ cls: 'dh-feature-name' });
            const strongEl = nameSpan.createEl('strong');
            renderRollableContent(plugin, feature.name, strongEl, feature.name);
            const metaContainer = header.createDiv({ cls: 'dh-feature-meta' });
            if (feature.parsedCost) {
                const costTag = metaContainer.createSpan({ text: feature.parsedCost, cls: 'dh-feature-tag dh-feature-tag-cost' });
                if (feature.parsedCost.includes('S')) costTag.addClass('dh-feature-tag-stress');
                else if (feature.parsedCost.includes('F')) costTag.addClass('dh-feature-tag-fear');
            }
            if (feature.type) {
                metaContainer.createSpan({ text: feature.type.toUpperCase(), cls: `dh-feature-tag dh-feature-tag-${feature.type.toLowerCase().replace(/\s+/g, '-')}` });
            }
            if (feature.description) {
                const toggle = metaContainer.createSpan({ cls: 'dh-feature-toggle' });
                setIcon(toggle, isExpanded ? 'chevron-down' : 'chevron-right');
            }
            if (feature.description) {
                const descDiv = li.createDiv({ cls: `dh-feature-description ${isExpanded ? '' : 'dh-feature-description-hidden'}` });
                renderRollableContent(plugin, feature.description, descDiv, feature.name);
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
                    header.classList.toggle('is-expanded', !isHidden);
                    const toggleIconEl = header.querySelector('.dh-feature-toggle');
                    if (toggleIconEl) setIcon(toggleIconEl as HTMLElement, isHidden ? 'chevron-right' : 'chevron-down');
                });
            }
        });
    }

    if (data.hp_stress) {
        const trackContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });

        // Redesigned Thresholds section
        if (data.hp_stress.major_hp) {
            const thresholdsBar = trackContainer.createDiv({ cls: 'dh-encounter-threshold-bar' });

            // First segment (Minor)
            thresholdsBar.createDiv({ cls: 'dh-encounter-threshold-segment dh-encounter-threshold-minor', text: 'Minor' });

            // First threshold value
            thresholdsBar.createDiv({ cls: 'dh-encounter-threshold-value', text: String(data.hp_stress.major_hp) });

            // Middle segment (Major)
            thresholdsBar.createDiv({ cls: 'dh-encounter-threshold-segment dh-encounter-threshold-major', text: 'Major' });

            if (data.hp_stress.severe_hp) {
                // Second threshold value
                thresholdsBar.createDiv({ cls: 'dh-encounter-threshold-value', text: String(data.hp_stress.severe_hp) });

                // Last segment (Severe)
                thresholdsBar.createDiv({ cls: 'dh-encounter-threshold-segment dh-encounter-threshold-severe', text: 'Severe' });
            }
        }
        // END: Redesigned Thresholds section

        const row = trackContainer.createDiv({ cls: 'dh-additional-tracker-row' });
        const header = row.createDiv({ cls: 'dh-additional-tracker-header' });
        header.createSpan({ text: data.displayName, cls: 'dh-additional-tracker-name' });
        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });
        addControlButtons(controlsWrapper, data.id, containerEl);
        const removeBtn = controlsWrapper.createEl('button', { text: '✕', title: "Remove this instance", cls: 'dh-remove-additional-btn' });
        removeBtn.addEventListener('click', () => containerEl.dispatchEvent(new CustomEvent('dh-remove-instance', { bubbles: true, detail: { instanceId: data.id } })));
        const conditionsDiv = row.createDiv({ cls: 'dh-conditions-container' });
        data.conditions?.forEach(condition => {
            const tag = conditionsDiv.createDiv({ cls: 'dh-condition-tag', attr: { title: condition.description } });
            tag.createSpan({ text: condition.name });
            const removeBtn = tag.createSpan({ text: '✕', cls: 'dh-condition-remove' });
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                containerEl.dispatchEvent(new CustomEvent('dh-remove-condition', { bubbles: true, detail: { instanceId: data.id, conditionName: condition.name } }));
            });
        });
        const hpMax = Number(data.hp_stress.hp) || 0;
        const stressMax = Number(data.hp_stress.stress) || 0;
        createInteractiveTrack(row, 'HP', hpMax, `${data.id}-hp-main`, data.currentHp, hpUpdateCallback || ((hp) => data.currentHp = hp));
        createInteractiveTrack(row, 'Stress', stressMax, `${data.id}-stress-main`, data.currentStress, stressUpdateCallback || ((stress) => data.currentStress = stress));
        trackContainer.createDiv({ cls: 'dh-additional-trackers-container' });
    }
}


function addControlButtons(container: HTMLElement, instanceId: string, containerEl: HTMLElement) {
    const conditionBtn = container.createEl('button', { title: 'Add Condition', cls: 'dh-icon-button dh-add-condition-btn' });
    setIcon(conditionBtn, 'tag');
    conditionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        containerEl.dispatchEvent(new CustomEvent('dh-request-condition-menu', { bubbles: true, detail: { instanceId, anchor: conditionBtn } }));
    });
}

export function renderStatblockCard(
    plugin: DaggerheartStatblockPlugin,
    data: StatblockData | AdversaryInstance,
    containerEl: HTMLElement,
    isInstance: boolean = false,
    displayName?: string,
    hpUpdateCallback?: (newHp: number) => void,
    stressUpdateCallback?: (newStress: number) => void,
    groupSize?: number
) {
    if (isInstance) {
        const instanceData = data as AdversaryInstance;
        if (instanceData.category === 'environment') {
            renderEnvironmentInstance(plugin, instanceData, containerEl);
        } else {
            renderAdversaryInstance(plugin, instanceData, containerEl, displayName || data.name, hpUpdateCallback, stressUpdateCallback, groupSize);
        }
    } else {
        renderEditorStatblock(plugin, data, containerEl);
    }
}
