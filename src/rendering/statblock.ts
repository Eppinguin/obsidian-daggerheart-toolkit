import { setIcon } from 'obsidian';
import { StatblockData, AdversaryInstance, StatblockFeature } from '../types';
import DaggerheartStatblockPlugin from '../main';
import { normalizeFeatureType, normalizeRoleFamily } from './statblock-type';
import {
    canRollDice,
    createInteractiveTrack,
    onActivateKey,
    renderRollableContent,
    renderMarkdown,
} from './ui-helpers';
import { renderConditionTags, renderConditionButton } from './conditions';
import { renderInstanceName } from './instance-name';
import { renderSummonControls } from './summon';

/**
 * The card's role line: a coloured chip naming the role, plus the tier.
 *
 * The chip carries the published type verbatim ("Horde (3/HP)") so nothing is
 * lost, while its colour comes from the sanitized family. This replaces a plain
 * grey text line and costs no extra vertical space.
 */
function renderRoleLine(data: StatblockData | AdversaryInstance, parentEl: HTMLElement) {
    const roleText = (data.type || '').trim();
    const tierText = data.tier ? `Tier ${data.tier}` : '';
    if (!roleText && !tierText) return;

    const roleLine = parentEl.createDiv({ cls: 'dh-card-role-text' });
    if (roleText) {
        const chip = roleLine.createSpan({ cls: 'dh-role-chip', text: roleText });
        chip.dataset.roleFamily = normalizeRoleFamily(roleText);
    }
    if (tierText) roleLine.createSpan({ cls: 'dh-card-tier-text', text: tierText });
}

/**
 * The attack, as a label line and the dice under it.
 *
 * The two rolls are the only part of this a GM clicks, and they used to sit
 * mid-sentence in "Claws: Very Close – 1d12+2 phy (ATK +3)", which reads as prose
 * and scans as nothing. Splitting the descriptive half (what the attack is, how
 * far it reaches) from the actionable half (to-hit, damage) costs one extra row
 * and makes both targets findable at a glance.
 *
 * The to-hit chip is labelled with the die it rolls rather than "ATK", because
 * "d20+3" is what the GM is about to do; the bonus alone was ambiguous about
 * which die it attached to.
 */
function renderAttackBlock(
    plugin: DaggerheartStatblockPlugin,
    attack: NonNullable<StatblockData['attack']>,
    parentEl: HTMLElement,
) {
    const attackName = attack.name || 'Attack';
    const block = parentEl.createDiv({ cls: 'dh-attack-block' });

    // Range is often absent on environments and homebrew, so the separator is
    // conditional rather than always printed with an empty side.
    const label = block.createDiv({ cls: 'dh-attack-label' });
    label.createSpan({ cls: 'dh-attack-name', text: attackName });
    const range = (attack.range || '').trim();
    if (range) label.createSpan({ cls: 'dh-attack-range', text: range });

    const rolls = block.createDiv({ cls: 'dh-attack-rolls' });

    const modValue = String(attack.modifier ?? '0').trim();
    const isNumericMod = /^[+-]?\d+$/.test(modValue);
    // Only a plain integer can be turned into "1d20+N". Anything else (a dash, a
    // homebrew note) is shown verbatim rather than dropped or mis-rolled.
    const modLabel = isNumericMod
        ? `${modValue === '0' ? '' : modValue.startsWith('+') || modValue.startsWith('-') ? modValue : `+${modValue}`}`
        : modValue;
    if (modLabel) {
        const toHit = rolls.createSpan({
            cls: 'dh-roll-chip dh-roll-chip-tohit',
            attr: { title: 'Attack roll' },
        });
        toHit.createSpan({ cls: 'dh-roll-chip-label', text: 'ATK' });
        if (isNumericMod && canRollDice(plugin)) {
            const diceString = `1d20${modValue === '0' ? '' : modValue.startsWith('+') || modValue.startsWith('-') ? modValue : `+${modValue}`}`;
            const rollSpan = toHit.createSpan({
                text: modLabel,
                cls: 'dh-rollable-dice',
                attr: { title: `Click to roll ${diceString} for ${attackName}` },
            });
            rollSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                plugin.rollDice(diceString, attackName);
            });
        } else {
            toHit.appendText(modLabel);
        }
    }

    // Damage keeps going through renderRollableContent: it may be a die string
    // ("1d12+2"), a flat number ("1", as on Minions), or prose, and that helper
    // already makes exactly the rollable parts clickable.
    const damage = (attack.damage || '').trim();
    if (damage) {
        const damageChip = rolls.createSpan({
            cls: 'dh-roll-chip dh-roll-chip-damage',
            attr: { title: 'Damage' },
        });
        damageChip.createSpan({ cls: 'dh-roll-chip-label', text: 'DMG' });
        renderRollableContent(plugin, damage, damageChip, attackName);
    }

    rolls.querySelectorAll<HTMLElement>('.dh-roll-chip').forEach(promoteChipToRollTarget);
}

/**
 * Make the whole chip the click target when it holds exactly one roll.
 *
 * Only the dice text used to be clickable: on "ATK +3" that was a ~14px-wide
 * span inside a chip that lit up on hover across its full width, so a click on
 * the label or the padding looked like it should roll and did nothing. The GM
 * reaches for these every turn, often mid-conversation, and should not have to
 * aim.
 *
 * A chip with several rollable parts (prose damage like "1d6 or 2d4") keeps
 * per-span targets, since there is no single roll the chip could mean. Clicks
 * are forwarded to the existing span so the roll logic stays in one place.
 */
function promoteChipToRollTarget(chip: HTMLElement) {
    const targets = chip.querySelectorAll<HTMLElement>('.dh-rollable-dice');
    if (targets.length !== 1) return;
    const target = targets[0];

    chip.addClass('is-rollable');
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    const tooltip = target.title || chip.title;
    chip.title = tooltip;
    // A screen reader already announces "button"; "Click to" would be noise.
    chip.setAttribute('aria-label', tooltip.replace(/^Click to r/, 'R'));
    // The span's own tooltip would otherwise flicker in as the cursor crosses it.
    target.removeAttribute('title');

    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        // A click on the span itself has already rolled and stopped propagating;
        // anything reaching here landed on the label or padding.
        target.click();
    });
    chip.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        target.click();
    });
}

/**
 * Mark an instance block as defeated once its HP track is full.
 *
 * In Daggerheart the HP track fills as damage lands, so "all pips marked" is
 * dead — the opposite of the depleting bar the shape suggests. On a card with
 * four Minions, which of them are still standing is the question a GM asks most
 * often and the one the stack of identical blocks answered least well.
 *
 * Applied as an attribute rather than a class so it reads as state, and set on
 * every HP change rather than only on redraw: the tracks update in place, and a
 * block that only dimmed on the next full render would lag the damage that
 * killed it.
 */
export function syncDefeatedState(rowEl: HTMLElement, currentHp: number, hpMax: number) {
    // A zero-HP track (environments, malformed imports) is not a creature that
    // can be defeated; without this guard every one of them would render dimmed.
    if (hpMax <= 0) {
        delete rowEl.dataset.defeated;
        return;
    }
    if (currentHp >= hpMax) rowEl.dataset.defeated = 'true';
    else delete rowEl.dataset.defeated;
}

/**
 * Difficulty and the attack, as one row.
 *
 * Rendered twice per card: once inside the scrolling statblock, and once as the
 * combat strip that survives collapsing. Sharing the construction keeps the two
 * from drifting — a chip added to one is a chip the other gets for free.
 */
export function renderCoreStats(
    plugin: DaggerheartStatblockPlugin,
    data: StatblockData,
    parentEl: HTMLElement,
    cls: string = 'dh-core-stats-line',
): HTMLElement | null {
    const attack = hasAttack(data) ? data.attack : undefined;
    // An empty row is worse than no row, and homebrew environments routinely
    // carry neither number.
    if (data.difficulty === undefined && !attack) return null;

    const line = parentEl.createDiv({ cls });
    if (data.difficulty !== undefined) {
        const diff = line.createSpan({ cls: 'dh-difficulty' });
        diff.createEl('strong', { text: 'Difficulty:' });
        diff.appendText(` ${data.difficulty}`);
    }
    if (attack) renderAttackBlock(plugin, attack, line);
    return line;
}

/**
 * Whether an attack is worth drawing.
 *
 * Imports and the editor leave behind a placeholder shaped
 * `{name: 'Attack', range: '', damage: '', modifier: '0'}` — an object that is
 * truthy but says nothing. Environments carry one routinely, and rendering it
 * gave them a bare "ATK d20" chip for an attack they do not have. An attack
 * needs at least a roll or a damage value to be real; a name alone is the
 * placeholder's default and does not count.
 */
function hasAttack(data: StatblockData): data is StatblockData & { attack: NonNullable<StatblockData['attack']> } {
    const attack = data.attack;
    if (!attack) return false;
    const damage = String(attack.damage ?? '').trim();
    const modifier = String(attack.modifier ?? '').trim();
    const hasModifier = modifier !== '' && modifier !== '0';
    return damage !== '' || hasModifier;
}

/**
 * What a feature costs to use, as an icon and a count.
 *
 * Only about a quarter of feats cost anything, so the chip's absence is itself
 * information: no chip means the GM can use it for free. Icons rather than
 * words because this sits at the end of a row inside a 300px column, and the
 * resource is a thing the GM already tracks by its symbol.
 */
const COST_ICONS: Record<string, { icon: string; cls: string; label: string }> = {
    Fear: { icon: 'skull', cls: 'dh-feature-tag-fear', label: 'Fear' },
    Stress: { icon: 'zap', cls: 'dh-feature-tag-stress', label: 'Stress' },
    HP: { icon: 'heart', cls: 'dh-feature-tag-hp', label: 'HP' },
};

function renderFeatureCost(parsedCost: string | undefined, parentEl: HTMLElement) {
    if (!parsedCost) return;

    const match = parsedCost.match(/^(Fear|Stress|HP|Hope)\s*(\d+)$/i);
    if (!match) {
        // An unrecognised shape still tells the GM something, so show it verbatim
        // rather than dropping it.
        parentEl.createSpan({ text: parsedCost, cls: 'dh-feature-tag dh-feature-tag-cost' });
        return;
    }

    const resource = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const key = resource === 'Hp' ? 'HP' : resource;
    const amount = Number(match[2]);
    const spec = COST_ICONS[key];
    if (!spec) {
        parentEl.createSpan({ text: parsedCost, cls: 'dh-feature-tag dh-feature-tag-cost' });
        return;
    }

    const costTag = parentEl.createSpan({
        cls: `dh-feature-tag dh-feature-tag-cost ${spec.cls}`,
        attr: { 'aria-label': `Costs ${amount} ${spec.label}`, title: `Costs ${amount} ${spec.label}` },
    });
    // Count first, matching how the cost reads aloud and in the rules text:
    // "spend 2 Fear", not "Fear 2".
    if (amount > 1) costTag.createSpan({ text: String(amount), cls: 'dh-feature-cost-count' });
    const iconEl = costTag.createSpan({ cls: 'dh-feature-cost-icon' });
    setIcon(iconEl, spec.icon);
}

/**
 * How a card decides which features start expanded, and what to do when the GM
 * toggles one. Passed down rather than reaching for the view, so this module
 * stays view-agnostic (same reasoning as the HP/Stress callbacks).
 */
export interface FeatureExpansionOptions {
    isExpanded?: (feature: StatblockFeature) => boolean;
    onToggle?: (feature: StatblockFeature, expanded: boolean) => void;
}

/**
 * The feats list as it appears on an encounter card.
 *
 * Shared by the adversary and environment paths, which rendered byte-identical
 * markup from two copies before this existed. The editor/preview path keeps its
 * own flatter markup (see renderEditorStatblock) because it has different CSS
 * and no expand affordance.
 */
export function renderFeatureList(
    plugin: DaggerheartStatblockPlugin,
    features: StatblockFeature[],
    parentEl: HTMLElement,
    options: FeatureExpansionOptions = {},
) {
    const featuresDiv = parentEl.createDiv({ cls: 'dh-features-section' });
    featuresDiv.createDiv({ text: 'FEATS', cls: 'dh-instance-features-title' });
    const featuresList = featuresDiv.createEl('ul', { cls: 'dh-features-list' });

    features.forEach((feature) => {
        if (!feature?.name) return;
        const featureType = normalizeFeatureType(feature.type);
        const li = featuresList.createEl('li', { cls: 'dh-feature-item' });
        // Drives the per-type colour rule on the header, so a GM can pick out
        // Actions and Reactions without reading the badge.
        li.dataset.featureType = featureType.toLowerCase();

        const isExpanded = options.isExpanded ? options.isExpanded(feature) : plugin.settings.showFeatureDetailsOnCards;

        const header = li.createDiv({
            cls: `dh-feature-header-container${isExpanded ? ' is-expanded' : ''}`,
        });
        const nameSpan = header.createSpan({ cls: 'dh-feature-name' });
        const strongEl = nameSpan.createEl('strong');
        renderRollableContent(plugin, feature.name, strongEl, feature.name);

        // The header row is reserved for what the feat *is* and what it costs.
        // A countdown is neither — it is live scene state that ticks — and its
        // text ("Countdown (Loop 1d6)") is far too long for a chip in a 300px
        // column, so it goes on its own line with the description below.
        const metaContainer = header.createDiv({ cls: 'dh-feature-meta' });
        renderFeatureCost(feature.parsedCost, metaContainer);
        metaContainer.createSpan({
            text: featureType.toUpperCase(),
            cls: `dh-feature-tag dh-feature-tag-${featureType.toLowerCase()}`,
        });

        // A feat with no description has nothing to open, so its header stays a
        // plain row: no button role, and (via CSS) no pointer or hover.
        if (!feature.description) return;

        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', String(isExpanded));

        // One chevron, turned by CSS on .is-expanded, rather than swapping the
        // icon: the swap could not animate and briefly left the row iconless.
        const toggle = metaContainer.createSpan({ cls: 'dh-feature-toggle', attr: { 'aria-hidden': 'true' } });
        setIcon(toggle, 'chevron-right');

        const descDiv = li.createDiv({
            cls: `dh-feature-description ${isExpanded ? '' : 'dh-feature-description-hidden'}`,
        });
        if (feature.countdown) {
            const countdownEl = descDiv.createDiv({ cls: 'dh-feature-countdown' });
            const countdownIcon = countdownEl.createSpan({ cls: 'dh-feature-countdown-icon' });
            setIcon(countdownIcon, 'timer');
            // Rollable so a "(Loop 1d6)" countdown can be rolled where it is read.
            renderRollableContent(plugin, feature.countdown, countdownEl.createSpan(), feature.name);
        }
        renderRollableContent(plugin, feature.description, descDiv, feature.name);
        renderSummonControls(descDiv, feature.description, plugin.compendium.getStatblocks(), feature.name);

        const toggleDescription = (e: Event) => {
            e.stopPropagation();
            const isHidden = descDiv.classList.toggle('dh-feature-description-hidden');
            header.classList.toggle('is-expanded', !isHidden);
            header.setAttribute('aria-expanded', String(!isHidden));
            options.onToggle?.(feature, !isHidden);
        };
        header.addEventListener('click', toggleDescription);
        onActivateKey(header, toggleDescription);
    });
}

function renderEditorStatblock(plugin: DaggerheartStatblockPlugin, data: StatblockData, containerEl: HTMLElement) {
    containerEl.empty();
    const statblockContentDiv = containerEl.createDiv({ cls: 'dh-editor-statblock' });

    if (data.name) statblockContentDiv.createDiv({ cls: 'dh-name', text: data.name.toUpperCase() });

    if (data.tier || data.type) {
        let tierTypeString = '';
        if (data.tier) tierTypeString += `Tier ${data.tier}`;
        if (data.type) tierTypeString += ` ${data.type}`;
        statblockContentDiv.createDiv({ cls: 'dh-tier-type', text: tierTypeString.trim() });
    }

    if (data.description) {
        const descDiv = statblockContentDiv.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics)
            ? data.motives_tactics.join(', ')
            : data.motives_tactics;
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
        // A half-written homebrew block may not have these yet; "HP: undefined"
        // is worse than leaving the stat out.
        if (data.hp_stress.hp != null) {
            const hpSpan = document.createElement('span');
            hpSpan.createEl('strong', { text: 'HP: ' });
            hpSpan.appendText(String(data.hp_stress.hp));
            statElements.push(hpSpan);
        }
        if (data.hp_stress.stress != null) {
            const stressSpan = document.createElement('span');
            stressSpan.createEl('strong', { text: 'Stress: ' });
            stressSpan.appendText(String(data.hp_stress.stress));
            statElements.push(stressSpan);
        }
    }

    // Same placeholder test as the encounter card: an environment's empty
    // `{name: 'Attack', modifier: '0'}` would otherwise print "ATK: 0 | Attack:".
    if (hasAttack(data)) {
        const attack = data.attack;
        const attackName = attack.name || 'Attack';
        const atkSpan = document.createElement('span');
        atkSpan.createEl('strong', { text: 'ATK: ' });

        const modifierValue = String(attack.modifier ?? '0').trim();
        const isNumericMod = /^[+-]?\d+$/.test(modifierValue);
        // Printed signed ("+3"), as the published statblocks do; a bare "3" reads
        // as a target number rather than a bonus.
        const signedMod = isNumericMod && !/^[+-]/.test(modifierValue) ? `+${modifierValue}` : modifierValue;
        // canRollDice rather than the Dice Roller flag alone, so the to-hit agrees
        // with the damage beside it on every provider (dddice included).
        if (isNumericMod && canRollDice(plugin)) {
            const diceString = `1d20${Number(modifierValue) === 0 ? '' : signedMod}`;
            const atkRollable = atkSpan.createSpan({ text: signedMod, cls: 'dh-rollable-dice' });
            atkRollable.title = `Click to roll ${diceString} for ${attackName}`;
            atkRollable.addEventListener('click', (e) => {
                e.stopPropagation();
                plugin.rollDice(diceString, attackName);
            });
        } else {
            atkSpan.appendText(signedMod);
        }
        statElements.push(atkSpan);

        const attackDetailsSpan = document.createElement('span');
        const range = (attack.range || '').trim();
        attackDetailsSpan.createEl('strong', { text: `${attackName}: ` });
        if (range) attackDetailsSpan.appendText(`${range} `);
        renderRollableContent(plugin, attack.damage || '', attackDetailsSpan, attackName);
        statElements.push(attackDetailsSpan);
    }

    if (data.experience) {
        const expSpan = document.createElement('span');
        expSpan.createEl('strong', { text: 'Experience: ' });

        if (typeof data.experience === 'string') {
            expSpan.appendText(data.experience);
        } else {
            // Every entry, formatted "Key +Value" and comma-joined as the
            // published statblocks print them.
            expSpan.appendText(
                Object.entries(data.experience)
                    .map(([key, value]) => `${key} ${Number(value) > 0 ? `+${value}` : value}`)
                    .join(', '),
            );
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
        data.features.forEach((feature) => {
            if (typeof feature !== 'object' || !feature.name) return;
            const featureLi = featuresListUl.createEl('li');
            const p = featureLi.createEl('p');

            // The parser strips the " - Action" suffix off the name into the type
            // field, so re-appending it here restores the published wording. The
            // countdown tail rides along with it for the few feats that have one.
            let title = `${feature.name}`;
            if (feature.type) title += ` - ${feature.type}`;
            if (feature.countdown) title += `: ${feature.countdown}`;
            const strongEl = p.createEl('strong', { cls: 'dh-feature-title' });
            renderRollableContent(plugin, `${title}: `, strongEl, feature.name);

            const description = feature.description || '';

            const descSpan = p.createSpan({ cls: 'dh-feature-description' });
            // renderRollableContent splits the text into fragments, which costs a
            // multi-line description its list structure, so it is reserved for
            // text that actually holds something it would mark up. The test
            // mirrors that helper's pattern: any die size, and the costs and
            // countdowns in their published wording.
            if (
                /\d+d\d+|Mark\s+(?:a|\d+)\s+stress|Spend\s+(?:a|\d+)\s+(?:hope|fear)|Countdown\s*\(/i.test(description)
            ) {
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
    featureExpansion: FeatureExpansionOptions = {},
) {
    let statblockContentDiv =
        containerEl.querySelector('.dh-instance-card-content') ||
        containerEl.createDiv({ cls: 'dh-instance-card-content' });
    statblockContentDiv.empty();

    // Environments carry no live state, but use the same scroll region as
    // adversaries so both card types behave identically.
    const staticRegion = statblockContentDiv.createDiv({ cls: 'dh-card-static-region' });

    const headerDiv = staticRegion.createDiv({ cls: 'dh-header' });
    if (data.name) headerDiv.createSpan({ cls: 'dh-name', text: data.name.toUpperCase() });

    renderRoleLine(data, staticRegion);

    if (data.description) {
        const descDiv = staticRegion.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.impulses) {
        const impulsesDiv = staticRegion.createDiv({ cls: 'dh-motives' });
        impulsesDiv.createEl('strong', { text: 'Impulses: ' });
        const impulsesContentDiv = impulsesDiv.createSpan();
        renderMarkdown(plugin, data.impulses, impulsesContentDiv);
    }

    if (data.experience) {
        const experienceDiv = staticRegion.createDiv({ cls: 'dh-motives' });
        experienceDiv.createEl('strong', { text: 'Experience: ' });
        const experienceContentDiv = experienceDiv.createSpan();

        if (typeof data.experience === 'string') {
            renderMarkdown(plugin, data.experience, experienceContentDiv);
        } else {
            // Handle StatblockExperience object format
            const experienceEntries = Object.entries(data.experience);
            if (experienceEntries.length > 0) {
                const formattedExperience = experienceEntries.map(([key, value]) => `${key}: ${value}`).join(', ');
                renderMarkdown(plugin, formattedExperience, experienceContentDiv);
            }
        }
    }

    renderCoreStats(plugin, data, staticRegion);

    if (data.potential_adversaries) {
        const paDiv = staticRegion.createDiv({ cls: 'dh-motives' });
        paDiv.createEl('strong', { text: 'Potential Adversaries: ' });
        const paContentDiv = paDiv.createSpan();
        renderMarkdown(plugin, data.potential_adversaries, paContentDiv);
    }

    if (data.features?.length) {
        renderFeatureList(plugin, data.features, staticRegion, featureExpansion);
    }

    // Outside the static region, so collapsing the card leaves it standing.
    // Environments have no HP block at all, so without this a collapsed
    // environment card is a bare title bar — Difficulty is the one number it
    // contributes to a scene, and it should be the thing that survives.
    renderCoreStats(plugin, data, statblockContentDiv as HTMLElement, 'dh-card-combat-strip');
}

function renderAdversaryInstance(
    plugin: DaggerheartStatblockPlugin,
    data: AdversaryInstance,
    containerEl: HTMLElement,
    displayName: string,
    hpUpdateCallback?: (newHp: number) => void,
    stressUpdateCallback?: (newStress: number) => void,
    groupSize: number = 1,
    featureExpansion: FeatureExpansionOptions = {},
) {
    let statblockContentDiv =
        containerEl.querySelector('.dh-instance-card-content') ||
        containerEl.createDiv({ cls: 'dh-instance-card-content' });
    statblockContentDiv.empty();

    if (data.image) {
        const parentCard = containerEl.closest('.dh-adversary-instance-card') || containerEl;
        const imgContainer =
            parentCard.querySelector('.dh-card-image-container') ||
            parentCard.createDiv({ cls: 'dh-card-image-container', prepend: true });
        imgContainer.empty();
        imgContainer.createEl('img', {
            attr: { src: data.image, alt: data.name },
            cls: 'dh-card-image',
        });
    }

    // Static reference material scrolls inside this region so that the live
    // state block below it (HP, Stress, conditions) can never be pushed out of
    // view by a long feature list.
    const staticRegion = statblockContentDiv.createDiv({ cls: 'dh-card-static-region' });

    const headerDiv = staticRegion.createDiv({ cls: 'dh-header' });
    if (data.name) headerDiv.createSpan({ cls: 'dh-name', text: data.name.toUpperCase() });

    renderRoleLine(data, staticRegion);

    if (data.description && plugin.settings.showDescriptionOnCards) {
        const descDiv = staticRegion.createDiv({ cls: 'dh-description' });
        renderMarkdown(plugin, data.description, descDiv);
    }

    if (data.motives_tactics) {
        const motivesText = Array.isArray(data.motives_tactics)
            ? data.motives_tactics.join(', ')
            : data.motives_tactics;
        if (motivesText) {
            const motivesDiv = staticRegion.createDiv({ cls: 'dh-motives' });
            motivesDiv.createEl('strong', { text: 'Motives & Tactics: ' });
            const motivesContentDiv = motivesDiv.createSpan();
            renderMarkdown(plugin, motivesText, motivesContentDiv);
        }
    }

    renderCoreStats(plugin, data, staticRegion);

    if (data.experience) {
        const experienceDiv = staticRegion.createDiv({ cls: 'dh-motives' });
        experienceDiv.createEl('strong', { text: 'Experience: ' });
        const experienceContentDiv = experienceDiv.createSpan();

        if (typeof data.experience === 'string') {
            renderMarkdown(plugin, data.experience, experienceContentDiv);
        } else {
            // Handle StatblockExperience object format
            const experienceEntries = Object.entries(data.experience);
            if (experienceEntries.length > 0) {
                const formattedExperience = experienceEntries.map(([key, value]) => `${key}: ${value}`).join(', ');
                renderMarkdown(plugin, formattedExperience, experienceContentDiv);
            }
        }
    }

    if (data.potential_adversaries) {
        const paDiv = staticRegion.createDiv({ cls: 'dh-motives' });
        paDiv.createEl('strong', { text: 'Potential Adversaries: ' });
        const paContentDiv = paDiv.createSpan();
        renderMarkdown(plugin, data.potential_adversaries, paContentDiv);
    }

    if (data.features?.length) {
        renderFeatureList(plugin, data.features, staticRegion, featureExpansion);
    }

    // A second copy of Difficulty/ATK/DMG, outside the region that collapsing
    // hides. These are the numbers a GM reads on every turn, and before this
    // they were the first thing a collapsed card threw away. Rendered
    // unconditionally and revealed by CSS, so cycling density stays a state
    // change rather than a re-render decision.
    renderCoreStats(plugin, data, statblockContentDiv as HTMLElement, 'dh-card-combat-strip');

    if (data.hp_stress) {
        const trackContainer = statblockContentDiv.createDiv({ cls: 'dh-hp-stress-container' });

        // Redesigned Thresholds section
        if (data.hp_stress.major_hp) {
            const thresholdsBar = trackContainer.createDiv({ cls: 'dh-threshold-bar' });

            // First segment (Minor)
            thresholdsBar.createDiv({ cls: 'dh-threshold-segment dh-threshold-minor', text: 'Minor' });

            // First threshold value
            thresholdsBar.createDiv({ cls: 'dh-threshold-value', text: String(data.hp_stress.major_hp) });

            // Middle segment (Major)
            thresholdsBar.createDiv({ cls: 'dh-threshold-segment dh-threshold-major', text: 'Major' });

            if (data.hp_stress.severe_hp) {
                // Second threshold value
                thresholdsBar.createDiv({
                    cls: 'dh-threshold-value',
                    text: String(data.hp_stress.severe_hp),
                });

                // Last segment (Severe)
                thresholdsBar.createDiv({
                    cls: 'dh-threshold-segment dh-threshold-severe',
                    text: 'Severe',
                });
            }
        }
        // END: Redesigned Thresholds section

        const row = trackContainer.createDiv({ cls: 'dh-additional-tracker-row' });
        const header = row.createDiv({ cls: 'dh-additional-tracker-header' });
        renderInstanceName(data, header, containerEl);
        const controlsWrapper = header.createDiv({ cls: 'dh-additional-tracker-controls' });
        renderConditionButton(data.id, data.displayName || data.name, controlsWrapper, containerEl);
        const removeBtn = controlsWrapper.createEl('button', {
            title: 'Remove this instance',
            cls: 'dh-remove-additional-btn',
            attr: { type: 'button', 'aria-label': `Remove ${data.displayName || data.name}` },
        });
        setIcon(removeBtn, 'x');
        removeBtn.addEventListener('click', () =>
            containerEl.dispatchEvent(
                new CustomEvent('dh-remove-instance', { bubbles: true, detail: { instanceId: data.id } }),
            ),
        );
        renderConditionTags(data, row.createDiv(), containerEl);
        const hpMax = Number(data.hp_stress.hp) || 0;
        const stressMax = Number(data.hp_stress.stress) || 0;
        syncDefeatedState(row, data.currentHp, hpMax);
        createInteractiveTrack(row, 'HP', hpMax, `${data.id}-hp-main`, data.currentHp, (hp) => {
            syncDefeatedState(row, hp, hpMax);
            if (hpUpdateCallback) hpUpdateCallback(hp);
            else data.currentHp = hp;
        });
        createInteractiveTrack(
            row,
            'Stress',
            stressMax,
            `${data.id}-stress-main`,
            data.currentStress,
            stressUpdateCallback || ((stress) => (data.currentStress = stress)),
        );
        trackContainer.createDiv({ cls: 'dh-additional-trackers-container' });
    }
}

export function renderStatblockCard(
    plugin: DaggerheartStatblockPlugin,
    data: StatblockData | AdversaryInstance,
    containerEl: HTMLElement,
    isInstance: boolean = false,
    displayName?: string,
    hpUpdateCallback?: (newHp: number) => void,
    stressUpdateCallback?: (newStress: number) => void,
    groupSize?: number,
    featureExpansion: FeatureExpansionOptions = {},
) {
    if (isInstance) {
        const instanceData = data as AdversaryInstance;
        if (instanceData.category === 'environment') {
            renderEnvironmentInstance(plugin, instanceData, containerEl, featureExpansion);
        } else {
            renderAdversaryInstance(
                plugin,
                instanceData,
                containerEl,
                displayName || data.name,
                hpUpdateCallback,
                stressUpdateCallback,
                groupSize,
                featureExpansion,
            );
        }
    } else {
        renderEditorStatblock(plugin, data, containerEl);
    }
}
