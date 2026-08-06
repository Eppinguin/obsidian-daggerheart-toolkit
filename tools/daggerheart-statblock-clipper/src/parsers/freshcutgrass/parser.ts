/** FreshCutGrass MAIN-world app-state parsing.
 *
 * Ported verbatim from the former `freshcutgrass-parser.js`.
 */
import type { RawStatblock } from '../../types';

const clean = (value: any) =>
    String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
function quality(item: any) {
    return (
        (item?.name && item.name !== 'Untitled Statblock' ? 5 : 0) +
        (item?.tier != null ? 2 : 0) +
        (item?.difficulty != null ? 2 : 0) +
        (item?.hp != null || item?.impulses || item?.adversaries ? 2 : 0) +
        (item?.features?.length ? 2 : 0) +
        (item?.weapon || item?.type ? 1 : 0)
    );
}

const normalizedKey = (value: any) =>
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

function directValue(object: any, aliases: any) {
    if (!object || typeof object !== 'object') return undefined;
    const wanted = new Set(aliases.map(normalizedKey));
    for (const [key, value] of Object.entries(object)) {
        if (wanted.has(normalizedKey(key)) && value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function numberFrom(value: any) {
    if (value == null || value === '' || value === '—' || value === '-') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value).match(/[+−-]?\d+/);
    return match ? Number(match[0].replace('−', '-')) : undefined;
}

function textFrom(value: any): string {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return clean(value);
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join(', ');
    if (typeof value === 'object') {
        const name = directValue(value, ['name', 'title', 'label']);
        const modifier = directValue(value, ['value', 'modifier', 'bonus', 'score']);
        if (name != null && modifier != null && String(name) !== String(modifier)) {
            const parsed = numberFrom(modifier);
            return clean(
                `${textFrom(name)}${parsed != null ? ` ${parsed >= 0 ? '+' : ''}${parsed}` : ` ${textFrom(modifier)}`}`,
            );
        }
        const known = directValue(value, ['text', 'description', 'desc', 'value', 'name', 'title']);
        if (known != null) return textFrom(known);
        const entries = Object.entries(value).filter(
            ([, entry]) => entry != null && (typeof entry === 'string' || typeof entry === 'number'),
        );
        if (entries.length && entries.length <= 20) {
            return entries
                .map(([key, entry]) => {
                    const parsed = numberFrom(entry);
                    return parsed != null && String(entry).trim() === String(parsed)
                        ? `${key} ${parsed >= 0 ? '+' : ''}${parsed}`
                        : textFrom(entry);
                })
                .filter(Boolean)
                .join(', ');
        }
        return '';
    }
    return '';
}

function objectStatScore(object: any, targetId = '', targetContext = false) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return -100;
    let score = targetContext ? 10 : 0;
    const id = directValue(object, ['id', 'uid', 'uuid', 'documentId', 'homebrewId', 'adversaryId', 'environmentId']);
    if (targetId && String(id || '') === targetId) score += 80;
    if (textFrom(directValue(object, ['name', 'title']))) score += 8;
    if (directValue(object, ['tier']) != null) score += 3;
    if (directValue(object, ['difficulty']) != null) score += 4;
    if (directValue(object, ['hp', 'hitPoints', 'hit_points']) != null) score += 3;
    if (directValue(object, ['stress']) != null) score += 3;
    if (directValue(object, ['features', 'feats', 'abilities', 'actions', 'featureGroups']) != null) score += 7;
    if (directValue(object, ['attack', 'standardAttack', 'attackName', 'weapon']) != null) score += 4;
    if (directValue(object, ['motivesAndTactics', 'motives_and_tactics', 'motives']) != null) score += 2;
    if (directValue(object, ['thresholds', 'damageThresholds', 'majorThreshold', 'severeThreshold']) != null)
        score += 2;
    return score;
}

function enumerateStateObjects(input: any, targetId = '') {
    const output: any[] = [];
    const seen = new WeakSet();
    const roots = Array.isArray(input?.candidates)
        ? input.candidates.map((entry: any) => entry?.value ?? entry)
        : Array.isArray(input)
          ? input
          : [input];

    function containsTargetShallow(object: any) {
        if (!targetId || !object || typeof object !== 'object') return false;
        return Object.values(object).some(
            (value) => (typeof value === 'string' || typeof value === 'number') && String(value) === targetId,
        );
    }

    function visit(value: any, depth = 0, targetContext = false, path = 'root') {
        if (!value || typeof value !== 'object' || seen.has(value) || depth > 12) return;
        seen.add(value);
        const localTarget = targetContext || containsTargetShallow(value);
        if (!Array.isArray(value))
            output.push({
                object: value,
                score: objectStatScore(value, targetId, localTarget),
                targetContext: localTarget,
                path,
            });
        if (Array.isArray(value)) {
            value.slice(0, 200).forEach((entry, index) => visit(entry, depth + 1, localTarget, `${path}[${index}]`));
        } else {
            Object.entries(value)
                .slice(0, 200)
                .forEach(([key, entry]) => {
                    if (entry && typeof entry === 'object') visit(entry, depth + 1, localTarget, `${path}.${key}`);
                });
        }
    }
    roots.forEach((root: any, index: any) => visit(root, 0, false, `candidate[${index}]`));
    return output.sort((a, b) => b.score - a.score);
}

function normalizeStateCost(feature: any) {
    const directCost = directValue(feature, ['parsedCost', 'cost', 'resourceCost']);
    if (directCost && typeof directCost === 'object') {
        const resource = textFrom(directValue(directCost, ['type', 'resource', 'name', 'kind']));
        const amount = numberFrom(directValue(directCost, ['amount', 'value', 'count', 'cost']));
        if (/^(fear|stress|hope)$/i.test(resource) && amount) {
            return `${resource[0].toUpperCase()}${resource.slice(1).toLowerCase()} ${amount}`;
        }
    }
    const direct = textFrom(directCost);
    if (direct) {
        const parsed = direct.match(/(Fear|Stress|Hope)\s*:?\s*(\d+)/i);
        if (parsed) return `${parsed[1][0].toUpperCase()}${parsed[1].slice(1).toLowerCase()} ${parsed[2]}`;
    }
    for (const resource of ['fear', 'stress', 'hope']) {
        const value = numberFrom(directValue(feature, [resource, `${resource}Cost`, `cost${resource}`]));
        if (value) return `${resource[0].toUpperCase()}${resource.slice(1)} ${value}`;
    }
    return '';
}

function normalizeStateFeature(feature: any, forcedType = '') {
    if (!feature) return null;
    if (typeof feature === 'string') {
        const inline = feature.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)\s*:\s*(.+)$/i);
        return inline ? { name: clean(inline[1]), type: inline[2], desc: clean(inline[3]) } : null;
    }
    if (typeof feature !== 'object') return null;
    let name = textFrom(directValue(feature, ['name', 'title', 'label', 'featureName', 'featName']));
    let type =
        textFrom(directValue(feature, ['type', 'featureType', 'actionType', 'category'])) || forcedType || 'Feature';
    let desc = textFrom(directValue(feature, ['description', 'desc', 'text', 'body', 'effect', 'details', 'featText']));
    const inline = name.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)$/i);
    if (inline) {
        name = clean(inline[1]);
        type = inline[2];
    }
    if (!name && desc) {
        const split = desc.match(/^([^:]{2,100})\s*:\s*(.+)$/);
        if (split) {
            name = clean(split[1]);
            desc = clean(split[2]);
        }
    }
    if (!name || !desc) return null;
    const parsedCost = normalizeStateCost(feature);
    return {
        name,
        type: /passive/i.test(type)
            ? 'Passive'
            : /reaction/i.test(type)
              ? 'Reaction'
              : /action/i.test(type)
                ? 'Action'
                : clean(type),
        ...(parsedCost ? { parsedCost } : {}),
        desc,
    };
}

function normalizeStateFeatures(value: any) {
    const output: any[] = [];
    if (Array.isArray(value)) {
        for (const feature of value) {
            const normalized = normalizeStateFeature(feature);
            if (normalized) output.push(normalized);
        }
    } else if (value && typeof value === 'object') {
        for (const [key, entries] of Object.entries(value)) {
            const forcedType = /passive/i.test(key)
                ? 'Passive'
                : /reaction/i.test(key)
                  ? 'Reaction'
                  : /action/i.test(key)
                    ? 'Action'
                    : '';
            if (Array.isArray(entries)) {
                for (const feature of entries) {
                    const normalized = normalizeStateFeature(feature, forcedType);
                    if (normalized) output.push(normalized);
                }
            } else {
                const normalized = normalizeStateFeature(entries, forcedType);
                if (normalized) output.push(normalized);
            }
        }
    }
    const seen = new Set();
    return output.filter((feature) => {
        const key = `${feature.name.toLowerCase()}|${feature.type}|${feature.desc}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function stateThresholds(object: any) {
    const raw = directValue(object, ['thresholds', 'damageThresholds', 'damage_thresholds']);
    if (typeof raw === 'string') {
        const match = raw.match(/([—\d]+)\s*\/\s*([—\d]+)/);
        if (match) return `${match[1]}/${match[2]}`;
    }
    if (Array.isArray(raw) && raw.length >= 2) return `${numberFrom(raw[0]) ?? '—'}/${numberFrom(raw[1]) ?? '—'}`;
    const thresholdObject = raw && typeof raw === 'object' ? raw : object;
    const major = numberFrom(directValue(thresholdObject, ['major', 'majorHp', 'majorThreshold', 'major_hp', 'first']));
    const severe = numberFrom(
        directValue(thresholdObject, ['severe', 'severeHp', 'severeThreshold', 'severe_hp', 'second']),
    );
    return major != null || severe != null ? `${major ?? '—'}/${severe ?? '—'}` : '';
}

function stateAttack(object: any) {
    const nested = directValue(object, ['standardAttack', 'attackData', 'primaryAttack']);
    const attackObject =
        nested && typeof nested === 'object'
            ? nested
            : directValue(object, ['attack']) && typeof directValue(object, ['attack']) === 'object'
              ? directValue(object, ['attack'])
              : {};
    const rootAttack = directValue(object, ['attack']);
    const weapon =
        textFrom(directValue(attackObject, ['name', 'title', 'weapon', 'attackName'])) ||
        textFrom(directValue(object, ['attackName', 'weapon', 'standardAttackName'])) ||
        (typeof rootAttack === 'string' && !/^[+−-]?\d+$/.test(rootAttack) ? clean(rootAttack) : '');
    const range =
        textFrom(directValue(attackObject, ['range', 'attackRange'])) ||
        textFrom(directValue(object, ['range', 'attackRange']));
    let damage =
        textFrom(directValue(attackObject, ['damage', 'damageDice', 'damageRoll'])) ||
        textFrom(directValue(object, ['damage', 'damageDice', 'damageRoll']));
    const damageType =
        textFrom(directValue(attackObject, ['damageType', 'type'])) ||
        textFrom(directValue(object, ['damageType', 'physicalOrMagical']));
    if (damageType && damage && !new RegExp(`\\b${damageType}\\b`, 'i').test(String(damage)))
        damage = clean(`${damage} ${damageType}`);
    const modifierValue =
        directValue(attackObject, ['modifier', 'attackModifier', 'attackMod', 'atk']) ??
        directValue(object, ['attackModifier', 'attackMod', 'atk']);
    const modifierNumber = numberFrom(modifierValue ?? (typeof rootAttack !== 'object' ? rootAttack : undefined));
    const modifier =
        modifierNumber != null ? `${modifierNumber >= 0 ? '+' : ''}${modifierNumber}` : textFrom(modifierValue);
    return { weapon, range, damage, attack: modifier };
}

function normalizeStateObject(object: any, sourceUrl: any, targetId = '', targetContext = false) {
    if (!object || typeof object !== 'object') return null;
    const name = textFrom(directValue(object, ['name', 'title', 'adversaryName', 'environmentName']));
    const tier = numberFrom(directValue(object, ['tier']));
    const type = textFrom(directValue(object, ['type', 'role', 'adversaryType', 'environmentType', 'adversaryRole']));
    const difficulty = numberFrom(directValue(object, ['difficulty', 'dc']));
    const features = normalizeStateFeatures(
        directValue(object, ['features', 'feats', 'abilities', 'actions', 'featureGroups']),
    );
    if (!name || (tier == null && difficulty == null && !features.length)) return null;

    const location = (() => {
        try {
            return new URL(sourceUrl);
        } catch (_error) {
            return null;
        }
    })();
    const result: RawStatblock = {
        name,
        tier,
        type,
        desc: textFrom(directValue(object, ['description', 'desc', 'summary', 'flavorText', 'flavourText'])),
        difficulty,
        features,
        source: sourceUrl || '',
        sourceSite: location?.hostname || 'freshcutgrass.app',
        author: textFrom(
            directValue(object, ['author', 'authorName', 'creator', 'creatorName', 'username', 'ownerName']),
        ),
        extractedAt: new Date().toISOString(),
        extractionMethod: 'freshcutgrass-app-state',
    };

    const isEnvironment =
        /environment/i.test(textFrom(directValue(object, ['category', 'kind', '_type']))) ||
        /^(Traversal|Event|Exploration)$/i.test(type) ||
        directValue(object, ['impulses', 'potentialAdversaries', 'toneAndFeel']) != null;
    if (isEnvironment) {
        result.tone = textFrom(directValue(object, ['toneAndFeel', 'tone_and_feel', 'tone', 'feel']));
        result.adversaries = textFrom(
            directValue(object, ['potentialAdversaries', 'potential_adversaries', 'adversaries']),
        );
        result.impulses = textFrom(directValue(object, ['impulses']));
    } else {
        const attack = stateAttack(object);
        Object.assign(result, attack);
        result.hp = numberFrom(directValue(object, ['hp', 'hitPoints', 'hit_points', 'hitPoint', 'hit_point']));
        result.stress = numberFrom(directValue(object, ['stress', 'stressPoints']));
        result.thresholds = stateThresholds(object);
        result.xp = textFrom(directValue(object, ['experience', 'experiences', 'xp']));
        result.motives = textFrom(
            directValue(object, ['motivesAndTactics', 'motives_and_tactics', 'motivesTactics', 'motives']),
        );
    }
    result.__stateScore = objectStatScore(object, targetId, targetContext);
    result.__targetContext = targetContext;
    for (const key of Object.keys(result)) {
        if (result[key] === '' || result[key] === undefined || (Array.isArray(result[key]) && !result[key].length))
            delete result[key];
    }
    return result;
}

function mergeStatblocks(primary: any, fallback: any) {
    if (!fallback) return primary;
    const result = { ...fallback, ...primary };
    for (const key of [
        'desc',
        'type',
        'weapon',
        'range',
        'damage',
        'attack',
        'thresholds',
        'xp',
        'motives',
        'tone',
        'adversaries',
        'impulses',
        'author',
    ]) {
        if (!primary[key] && fallback[key]) result[key] = fallback[key];
    }
    for (const key of ['tier', 'difficulty', 'hp', 'stress']) {
        if (primary[key] == null && fallback[key] != null) result[key] = fallback[key];
    }
    if ((!primary.features || primary.features.length < (fallback.features?.length || 0)) && fallback.features?.length)
        result.features = fallback.features;
    result.rawText = fallback.rawText;
    delete result.__stateScore;
    delete result.__targetContext;
    return result;
}

export function parseFreshCutGrassState(input: any, sourceUrl = '', domItems: any[] = []) {
    const targetId = (() => {
        try {
            return new URL(sourceUrl).searchParams.get('id') || input?.targetId || '';
        } catch (_error) {
            return input?.targetId || '';
        }
    })();
    const objects = enumerateStateObjects(input, targetId);
    const parsed = [];
    const seen = new Set();
    for (const entry of objects) {
        if (entry.score < 10) continue;
        const item = normalizeStateObject(entry.object, sourceUrl, targetId, entry.targetContext);
        if (!item || quality(item) < 7) continue;
        const key = `${item.name.toLowerCase()}|${item.tier || ''}|${item.difficulty || ''}|${item.type || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fallback =
            domItems.find((candidate) => clean(candidate.name).toLowerCase() === clean(item.name).toLowerCase()) ||
            (domItems.length === 1 ? domItems[0] : null);
        parsed.push({
            item,
            fallback,
            score: item.__stateScore || entry.score,
            target: Boolean(item.__targetContext),
        });
    }
    const selected = targetId && parsed.some((entry) => entry.target) ? parsed.filter((entry) => entry.target) : parsed;
    return selected.sort((a, b) => b.score - a.score).map((entry) => mergeStatblocks(entry.item, entry.fallback));
}
