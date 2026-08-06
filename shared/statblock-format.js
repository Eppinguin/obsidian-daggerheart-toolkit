/* Canonical Daggerheart statblock normalization and serialization runtime.
 * This file is intentionally framework-free so the Obsidian plugin and browser
 * extension use the same field mappings, validation rules, and export format.
 */
(function installDaggerheartStatblockFormat(root) {
    'use strict';

    const FORMAT_VERSION = '1.2.0';
    const ENVIRONMENT_ROLES = new Set([
        'traversal',
        'event',
        'exploration',
        'environmenttraversal',
        'environmentevent',
        'environmentexploration',
        'environmentsocial',
    ]);

    const clean = (value) =>
        String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s*\n\s*/g, ' ')
            .trim();

    function numberOrNull(value) {
        if (value === null || value === undefined || value === '' || value === '—' || value === '-') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function numberOrZero(value) {
        return numberOrNull(value) ?? 0;
    }

    /**
     * Flatten an experience/motives value to a display string.
     *
     * Sources supply these as a plain string, an array of strings, or an array
     * of `{ name, modifier }` objects (FreshCutGrass app state does the last).
     * Without this, an array of objects reached the YAML emitter and serialized
     * as "[object Object]".
     */
    function normalizeTextList(value) {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.map(normalizeTextList).filter(Boolean).join(', ');
        if (typeof value === 'object') {
            const name = clean(value.name ?? value.title ?? value.label ?? value.text ?? value.description);
            const modifier = value.modifier ?? value.value ?? value.bonus ?? value.score;
            const parsed = numberOrNull(modifier);
            if (name && parsed !== null) return `${name} ${parsed >= 0 ? '+' : ''}${parsed}`;
            if (name) return name;
            return '';
        }
        return clean(value);
    }

    function normalizeCost(value) {
        const text = clean(value);
        const match = text.match(/^(fear|stress|hope|hp)\s*:?\s*(\d+)$/i);
        if (!match) return text;
        const resource =
            match[1].toLowerCase() === 'hp' ? 'HP' : `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
        return `${resource} ${match[2]}`;
    }

    const COST_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3 };

    /**
     * Read the resource a feature costs out of the start of its description.
     *
     * Most SRD feats state their price as a leading imperative — "Mark a Stress
     * to have the Burrower burst out of the ground." The same words appear
     * mid-sentence as a *consequence* the players pay ("Each target knocked back
     * must mark a Stress"), which is not a cost and must not be labelled as one.
     * Anchoring to the start of the text is what separates the two: an imperative
     * has no subject, so only the GM can be the one paying.
     */
    function costFromDescription(description) {
        const match = clean(description).match(/^(?:spend|mark)\s+(a|an|one|two|three|\d+)?\s*(fear|stress|hp)\b/i);
        if (!match) return '';
        const count = (match[1] || 'a').toLowerCase();
        const amount = COST_WORDS[count] ?? (/^\d+$/.test(count) ? Number(count) : 1);
        return normalizeCost(`${match[2]} ${amount}`);
    }

    function normalizeFeature(feature) {
        if (!feature || typeof feature !== 'object') return null;
        let name = clean(feature.name) || 'Feature';
        let type = clean(feature.type);
        // SRD feats carry their type as a name suffix ("Earth Eruption - Action")
        // rather than a field. A handful also append a countdown after a colon
        // ("... - Reaction: Countdown (Loop 1d6)"), which has to survive the strip.
        const suffix = name.match(/\s*[-–—]\s*(Passive|Action|Reaction)(?::\s*(.+))?\s*$/i);
        let countdown = clean(feature.countdown);
        if (suffix) {
            if (!type) type = suffix[1];
            if (!countdown && suffix[2]) countdown = clean(suffix[2]);
            name = name.slice(0, suffix.index).trim();
        }

        const costMatch = name.match(/\s*\((Fear|Stress|Hope)\s*(\d+)\)\s*$/i);
        const declaredCost = normalizeCost(
            feature.parsedCost || feature.cost || (costMatch ? `${costMatch[1]} ${costMatch[2]}` : ''),
        );
        if (costMatch) name = name.slice(0, costMatch.index).trim();

        const description = clean(feature.description || feature.desc || feature.text);
        if (!name || !description) return null;

        // An explicitly declared cost wins; the description is only consulted when
        // the content did not state one, which is the case for all SRD feats.
        const parsedCost = declaredCost || costFromDescription(description);
        return {
            name,
            type: type || 'Feature',
            ...(parsedCost ? { parsedCost } : {}),
            ...(countdown ? { countdown } : {}),
            description,
        };
    }

    function categoryOf(input, declaredType) {
        const declared = clean(declaredType || input?.category || input?._type).toLowerCase();
        if (declared === 'environment') return 'environment';
        if (declared === 'adversary') return 'adversary';
        if (input?.impulses || input?.potential_adversaries || input?.adversaries || input?.tone) return 'environment';
        return ENVIRONMENT_ROLES.has(clean(input?.type).toLowerCase()) ? 'environment' : 'adversary';
    }

    function thresholdsOf(input) {
        if (input?.hp_stress && typeof input.hp_stress === 'object') {
            return {
                major: numberOrNull(input.hp_stress.major_hp),
                severe: numberOrNull(input.hp_stress.severe_hp),
            };
        }
        const [major, severe] = clean(input?.thresholds || input?.damage_thresholds).split('/');
        return { major: numberOrNull(major), severe: numberOrNull(severe) };
    }

    function normalizeStatblock(input, declaredType) {
        if (!input || typeof input !== 'object' || !clean(input.name)) return null;
        const category = categoryOf(input, declaredType);
        const thresholds = thresholdsOf(input);
        const sourceInput = input.source && typeof input.source === 'object' ? input.source : {};
        const source = {
            site: clean(sourceInput.site || input.sourceSite),
            url: clean(sourceInput.url || (typeof input.source === 'string' ? input.source : '')),
            author: clean(sourceInput.author || input.author),
            importedAt: clean(sourceInput.importedAt || input.extractedAt) || new Date().toISOString(),
        };
        Object.keys(source).forEach((key) => {
            if (!source[key]) delete source[key];
        });

        const features = (
            Array.isArray(input.features) ? input.features : Array.isArray(input.feats) ? input.feats : []
        )
            .map(normalizeFeature)
            .filter(Boolean);

        const result = {
            name: clean(input.name),
            category,
            ...(clean(input.image) ? { image: clean(input.image) } : {}),
            ...(input.tier !== undefined && input.tier !== ''
                ? { tier: numberOrNull(input.tier) ?? clean(input.tier) }
                : {}),
            ...(clean(input.type) ? { type: clean(input.type) } : {}),
            ...(clean(input.description || input.desc) ? { description: clean(input.description || input.desc) } : {}),
            ...(input.difficulty !== undefined && input.difficulty !== ''
                ? { difficulty: numberOrNull(input.difficulty) ?? clean(input.difficulty) }
                : {}),
            hp_stress: {
                hp: numberOrZero(input.hp_stress?.hp ?? input.hp),
                stress: numberOrZero(input.hp_stress?.stress ?? input.stress),
                ...(thresholds.major !== null ? { major_hp: thresholds.major } : {}),
                ...(thresholds.severe !== null ? { severe_hp: thresholds.severe } : {}),
            },
            ...(features.length ? { features } : {}),
            ...(Object.keys(source).length ? { source } : {}),
            isCustom: input.isCustom !== false,
        };

        if (category === 'adversary') {
            const attackObject = input.attack && typeof input.attack === 'object' ? input.attack : null;
            const legacyAttackModifier = input.weapon ? input.attack : undefined;
            const attack = {
                name: clean(
                    attackObject?.name ||
                        input.weapon ||
                        (!attackObject && typeof input.attack === 'string' && !/^[+−-]?\d+$/.test(clean(input.attack))
                            ? input.attack
                            : '') ||
                        'Attack',
                ),
                range: clean(attackObject?.range || input.range),
                damage: clean(attackObject?.damage || input.damage),
                modifier: attackObject?.modifier ?? input.atk ?? input.attack_modifier ?? legacyAttackModifier ?? '0',
            };
            result.attack = attack;
            // Both fields arrive as a string, an array of strings, or an array
            // of { name, modifier } objects depending on the source site.
            const experience = normalizeTextList(input.experience ?? input.xp);
            if (experience) result.experience = experience;
            const motives = input.motives_tactics ?? input.motives_and_tactics ?? input.motives;
            if (normalizeTextList(motives)) {
                result.motives_tactics = Array.isArray(motives)
                    ? motives.map(normalizeTextList).filter(Boolean)
                    : normalizeTextList(motives);
            }
        } else {
            const impulses = clean(input.impulses);
            const adversaries = clean(input.potential_adversaries || input.adversaries);
            const tone = clean(input.tone);
            if (impulses) result.impulses = impulses;
            if (adversaries) result.potential_adversaries = adversaries;
            if (tone) result.tone = tone;
        }

        return result;
    }

    function validateStatblock(input) {
        const data = normalizeStatblock(input, input?.category);
        const errors = [];
        const warnings = [];
        if (!data) return { valid: false, data: null, errors: ['A statblock name is required.'], warnings };
        if (!data.type) warnings.push('Role/type is missing.');
        if (data.tier === undefined) warnings.push('Tier is missing.');
        if (data.difficulty === undefined) warnings.push('Difficulty is missing.');
        if (data.category === 'adversary') {
            if (!data.attack?.name || data.attack.name === 'Attack') warnings.push('Standard attack name is missing.');
            if (!data.attack?.damage) warnings.push('Standard attack damage is missing.');
            if (!data.hp_stress.hp) warnings.push('HP is zero or missing.');
        }
        if (!data.features?.length) warnings.push('No features were detected.');
        return { valid: errors.length === 0, data, errors, warnings };
    }

    function detectContentType(input) {
        if (!input || typeof input !== 'object') return 'unknown';
        const explicit = clean(input.category || input._type).toLowerCase();
        if (explicit === 'adversary' || explicit === 'environment') return explicit;
        if (Array.isArray(input.adversaries) && Array.isArray(input.adversaryGroupOrder)) return 'encounter';
        if (input.impulses || input.potential_adversaries || input.tone) return 'environment';
        if (
            input.hp_stress ||
            input.hp !== undefined ||
            input.stress !== undefined ||
            input.weapon ||
            input.motives ||
            input.motives_tactics
        )
            return 'adversary';
        return 'unknown';
    }

    function createEnvelope(data) {
        const items = Array.isArray(data) ? data : [data];
        const normalized = items.map((item) => normalizeStatblock(item, item?.category)).filter(Boolean);
        const types = new Set(normalized.map((item) => item.category));
        return {
            type: normalized.length === 1 ? normalized[0].category : types.size === 1 ? [...types][0] : 'statblocks',
            version: FORMAT_VERSION,
            exportDate: new Date().toISOString(),
            data: normalized.length === 1 ? normalized[0] : normalized,
        };
    }

    function normalizePayload(payload) {
        const parsed = typeof payload === 'string' ? JSON.parse(payload.trim()) : payload;
        const entries = [];
        if (parsed?.type && parsed?.data !== undefined) {
            const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
            for (const item of items) {
                const type = parsed.type === 'statblocks' ? detectContentType(item) : parsed.type;
                if (type === 'adversary' || type === 'environment') {
                    const validation = validateStatblock({ ...item, category: type });
                    if (validation.data)
                        entries.push({
                            type,
                            version: parsed.version || FORMAT_VERSION,
                            exportDate: parsed.exportDate || new Date().toISOString(),
                            data: validation.data,
                            validation,
                        });
                } else {
                    entries.push({
                        type,
                        version: parsed.version || FORMAT_VERSION,
                        exportDate: parsed.exportDate || new Date().toISOString(),
                        data: item,
                        validation: { valid: true, errors: [], warnings: [] },
                    });
                }
            }
            return entries;
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
            const type = detectContentType(item);
            if (type === 'adversary' || type === 'environment') {
                const validation = validateStatblock({ ...item, category: type });
                if (validation.data)
                    entries.push({
                        type,
                        version: FORMAT_VERSION,
                        exportDate: new Date().toISOString(),
                        data: validation.data,
                        validation,
                    });
            } else if (type !== 'unknown') {
                entries.push({
                    type,
                    version: FORMAT_VERSION,
                    exportDate: new Date().toISOString(),
                    data: item,
                    validation: { valid: true, errors: [], warnings: [] },
                });
            }
        }
        return entries;
    }

    const quote = (value) => JSON.stringify(String(value));
    function pushYaml(lines, key, value, indent = '') {
        if (value === undefined || value === null || value === '') return;
        if (typeof value === 'number' || typeof value === 'boolean') lines.push(`${indent}${key}: ${value}`);
        else if (Array.isArray(value)) lines.push(`${indent}${key}: ${quote(value.join(', '))}`);
        else if (typeof value === 'object') lines.push(`${indent}${key}: ${quote(JSON.stringify(value))}`);
        else lines.push(`${indent}${key}: ${quote(value)}`);
    }

    function toYaml(input) {
        const data = normalizeStatblock(input, input?.category);
        if (!data) throw new Error('No valid statblock is available.');
        const lines = [];
        ['name', 'category', 'tier', 'type', 'description', 'difficulty'].forEach((key) =>
            pushYaml(lines, key, data[key]),
        );
        if (data.attack) {
            lines.push('attack:');
            ['name', 'range', 'damage', 'modifier'].forEach((key) => pushYaml(lines, key, data.attack[key], '  '));
        }
        ['experience', 'motives_tactics', 'impulses', 'potential_adversaries', 'tone'].forEach((key) =>
            pushYaml(lines, key, data[key]),
        );
        lines.push('hp_stress:');
        ['hp', 'stress', 'major_hp', 'severe_hp'].forEach((key) => pushYaml(lines, key, data.hp_stress?.[key], '  '));
        if (data.features?.length) {
            lines.push('features:');
            for (const feature of data.features) {
                lines.push(`  - name: ${quote(feature.name)}`);
                ['type', 'parsedCost', 'countdown', 'description'].forEach((key) =>
                    pushYaml(lines, key, feature[key], '    '),
                );
            }
        }
        if (data.source && Object.keys(data.source).length) {
            lines.push('source:');
            ['site', 'url', 'author', 'importedAt'].forEach((key) => pushYaml(lines, key, data.source[key], '  '));
        }
        pushYaml(lines, 'isCustom', true);
        return lines.join('\n');
    }

    function toMarkdown(input) {
        const items = Array.isArray(input) ? input : [input];
        return items.map((item) => `\`\`\`daggerheart-statblock\n${toYaml(item)}\n\`\`\``).join('\n\n');
    }

    function toJson(input) {
        return JSON.stringify(createEnvelope(input), null, 2);
    }

    const api = {
        FORMAT_VERSION,
        clean,
        normalizeFeature,
        normalizeStatblock,
        validateStatblock,
        detectContentType,
        createEnvelope,
        normalizePayload,
        toYaml,
        toMarkdown,
        toJson,
    };
    root.DHStatblockFormat = api;
    if (typeof module === 'object' && module?.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
