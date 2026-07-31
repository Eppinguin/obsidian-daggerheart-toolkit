(() => {
  'use strict';

  const base = globalThis.DHStatblockParser;
  if (!base || base.__freshCutGrassRenderedRepair) return;

  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  const renderedLines = (value) => String(value ?? '').replace(/\r/g, '').split('\n').map(clean).filter(Boolean);
  const DATE_LINE = /^(?:\d{1,2}[\/.\-]){2}\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?$/i;
  const FOOTER_LINE = /^(?:Daggerheart.*Compatible|Terms at Daggerheart|BY\s+\S+|LIKED(?:\s*\(\d+\))?|IN LIBRARY(?:\s*\(\d+\))?|COMMENTS?|refleximage|report|share|download)$/i;
  const COMMENT_LINE = /^(?:no comments? yet(?:[.!]\s*)?(?:be the first to comment[.!]?)?|be the first to comment[.!]?|sign in to comment|log in to comment)$/i;
  const UI_CHROME_LINE = /^(?:community adversaries?\s*&\s*environments?|community homebrew|homebrew vault|manage|preview|edit|delete|add to encounter|back to homebrew)$/i;
  const SECTION_LINE = /^(?:features|passives?|actions?|reactions?|hp\s*&\s*stress|standard attack|motives\s*(?:&|and)\s*tactics|experiences?|minor|major|severe)$/i;

  function numberFrom(value) {
    if (value == null || value === '' || value === '—' || value === '-') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value).match(/[+−-]?\d+/);
    return match ? Number(match[0].replace('−', '-')) : undefined;
  }

  function lineValue(lines, aliases, numberOnly = false) {
    const wanted = aliases.map((alias) => new RegExp(`^${alias}\\s*:?(?:\\s+(.*))?$`, 'i'));
    for (let index = 0; index < lines.length; index += 1) {
      for (const pattern of wanted) {
        const match = lines[index].match(pattern);
        if (!match) continue;
        const value = clean(match[1] || '') || clean(lines[index + 1] || '');
        if (!value) continue;
        if (!numberOnly) return value;
        const parsed = numberFrom(value);
        if (parsed != null) return parsed;
      }
    }
    return numberOnly ? undefined : '';
  }

  function previousNumber(lines, index, distance = 3) {
    for (let cursor = index - 1; cursor >= Math.max(0, index - distance); cursor -= 1) {
      if (/^\d+$/.test(lines[cursor])) return Number(lines[cursor]);
    }
    return undefined;
  }

  function nextNumber(lines, index, distance = 3) {
    for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + distance); cursor += 1) {
      if (/^\d+$/.test(lines[cursor])) return Number(lines[cursor]);
    }
    return undefined;
  }

  function renderedThresholds(lines) {
    const explicit = lines.join('\n').match(/(?:thresholds?|damage thresholds?)\s*:?\s*(\d+)\s*\/\s*(\d+)/i);
    if (explicit) return `${explicit[1]}/${explicit[2]}`;
    const majorIndex = lines.findIndex((line) => /^major$/i.test(line));
    const severeIndex = lines.findIndex((line) => /^severe$/i.test(line));
    const major = majorIndex >= 0 ? (previousNumber(lines, majorIndex) ?? nextNumber(lines, majorIndex)) : undefined;
    const severe = severeIndex >= 0 ? (previousNumber(lines, severeIndex) ?? nextNumber(lines, severeIndex)) : undefined;
    return major != null || severe != null ? `${major ?? '—'}/${severe ?? '—'}` : '';
  }

  function parseInlineAttack(value) {
    const match = clean(value).match(/^(.{1,100}?)\s*:\s*(Melee|Very Close|Close|Far|Very Far)\s*\|\s*(\d+d\d+(?:\s*[+−-]\s*\d+)?(?:\s+(?:Physical|Magical|phy|mag))?)$/i);
    if (!match || UI_CHROME_LINE.test(match[1])) return null;
    return { weapon: clean(match[1]), range: clean(match[2]), damage: clean(match[3]) };
  }

  function renderedAttack(lines, existing = {}) {
    const text = lines.join('\n');
    const compact = text.match(/ATK\s*:?\s*([+−-]?\d+)\s*\|\s*([^|\n:]+)\s*:\s*([^|\n]+)\s*\|\s*([^\n]+)/i);
    if (compact) {
      return { attack: clean(compact[1]).replace('−', '-'), weapon: clean(compact[2]), range: clean(compact[3]), damage: clean(compact[4]) };
    }

    const marker = lines.findIndex((line) => /^(?:standard attack|attack)$/i.test(line));
    const start = marker >= 0 ? marker + 1 : 0;
    let end = lines.length;
    for (let index = start; index < lines.length; index += 1) {
      if (/^(?:features|motives\s*(?:&|and)\s*tactics|experiences?|hp\s*&\s*stress)$/i.test(lines[index])) { end = index; break; }
    }
    const block = lines.slice(start, end);
    const ranges = /^(?:Melee|Very Close|Close|Far|Very Far)$/i;
    const types = /^(?:Physical|Magical?|phy|mag)$/i;
    const labels = /^(?:name|weapon|range|damage|damage type|attack mod(?:ifier)?|modifier|atk)\s*:?$/i;

    const inline = [existing.damage, existing.weapon, ...block, ...lines]
      .map(parseInlineAttack)
      .find(Boolean);

    let weapon = inline?.weapon || lineValue(block, ['(?:name|weapon|attack name)']);
    let range = inline?.range || lineValue(block, ['range']);
    let damage = inline?.damage || lineValue(block, ['damage']);
    let damageType = lineValue(block, ['damage type']);
    let attackValue = lineValue(block, ['(?:attack mod(?:ifier)?|modifier|atk)']);

    if (!range) range = block.find((line) => ranges.test(line)) || '';
    if (!damage) damage = block.find((line) => /\b\d+d\d+(?:\s*[+−-]\s*\d+)?\b/i.test(line)) || '';
    if (!damageType) {
      const damageIndex = block.findIndex((line) => line === damage || parseInlineAttack(line));
      const adjacent = damageIndex >= 0 ? block[damageIndex + 1] : '';
      damageType = (adjacent && types.test(adjacent) ? adjacent : '') || block.find((line) => types.test(line)) || '';
    }
    if (!attackValue) {
      const modifiers = block.filter((line) => /^[+−-]?\d+$/.test(line));
      attackValue = modifiers.find((line) => /^[+−-]/.test(line)) || modifiers.at(-1) || existing.attack || '';
    }
    if (!weapon) {
      weapon = block.find((line) => !labels.test(line) && !ranges.test(line) && !types.test(line) && !UI_CHROME_LINE.test(line) &&
        !/^\d+d\d+/i.test(line) && !/^[+−-]?\d+$/.test(line) && !SECTION_LINE.test(line) && !FOOTER_LINE.test(line)) || '';
    }
    if (UI_CHROME_LINE.test(weapon)) weapon = '';
    if (damage && damageType && !new RegExp(`\\b${damageType}\\b`, 'i').test(damage)) damage = clean(`${damage} ${damageType}`);
    const parsedModifier = numberFrom(attackValue);
    return {
      ...(weapon ? { weapon } : {}), ...(range ? { range } : {}), ...(damage ? { damage } : {}),
      ...(parsedModifier != null ? { attack: `${parsedModifier >= 0 ? '+' : ''}${parsedModifier}` } : {})
    };
  }

  function invalidDescription(line) {
    const value = clean(line);
    if (!value || DATE_LINE.test(value) || FOOTER_LINE.test(value) || COMMENT_LINE.test(value) || UI_CHROME_LINE.test(value)) return true;
    if (/\bno comments? yet\b|\bbe the first to comment\b/i.test(value)) return true;
    if (/^(?:this adversary was made by|this environment was made by|created by|designed by|author\b|https?:\/\/)/i.test(value)) return true;
    return false;
  }

  function renderedDescription(lines, name) {
    const nameIndex = lines.findIndex((line) => clean(line).toLowerCase() === clean(name).toLowerCase());
    const start = nameIndex >= 0 ? nameIndex + 1 : 0;
    let end = lines.length;
    for (let index = start; index < lines.length; index += 1) {
      if (/^(?:difficulty|standard attack|attack|features|motives\s*(?:&|and)\s*tactics|experiences?|hp\s*&\s*stress)$/i.test(lines[index])) {
        end = index;
        break;
      }
    }
    const scoped = lines.slice(start, end);
    const candidates = scoped.filter((line) => {
      if (line.length < 20 || line.length > 500 || invalidDescription(line) || SECTION_LINE.test(line)) return false;
      if (/^(?:tier|solo|leader|bruiser|horde|minion|ranged|skulk|social|standard|support|traversal|event|exploration|environment(?:exploration|event|social|traversal)?|difficulty|hp|stress|atk|attack|thresholds?)\b/i.test(line)) return false;
      if (/\b(?:HP|Stress|Fear|Hope)\b/i.test(line) && /\b(?:mark|spend|clear|take)\b/i.test(line)) return false;
      return line.split(/\s+/).length >= 5;
    });
    return candidates.find((line) => /^[A-Z]/.test(line) && /[.!?]$/.test(line)) || candidates[0] || '';
  }

  function renderedAuthor(lines, existing = '') {
    const text = lines.join('\n');
    const madeBy = text.match(/this\s+(?:adversary|environment)\s+was\s+made\s+by\s+([^\.\n]+)/i);
    if (madeBy) return clean(madeBy[1]);
    const designed = text.match(/(?:designed|created)\s+by\s+([^\n•]+)/i);
    if (designed) return clean(designed[1]);
    return existing;
  }

  function strictFeatureTitle(line) {
    if (!line || line.length > 90 || DATE_LINE.test(line) || FOOTER_LINE.test(line) || SECTION_LINE.test(line)) return false;
    if (/^[+−-]?\d+$/.test(line) || /^(?:\d+\s+HP|HP|STRESS)\s*:?$/i.test(line)) return false;
    if (/^(?:mark|spend|make|when|whenever|if|while|after|before|all|each|the|a|an|targets?|creatures?)\b/i.test(line)) return false;
    if (!/^[A-Z0-9]/.test(line) || /[.!?]$/.test(line)) return false;
    return line.split(/\s+/).length <= 12;
  }

  function inferredFeatureCost(description) {
    const direct = clean(description).match(/^(?:mark|spend)\s+(?:(\d+)\s+)?(?:a\s+)?(Fear|Stress|Hope)\b/i);
    if (!direct) return '';
    const amount = Number(direct[1] || 1);
    return `${direct[2][0].toUpperCase()}${direct[2].slice(1).toLowerCase()} ${amount}`;
  }

  function renderedFeatures(lines) {
    const start = lines.findIndex((line) => /^features$/i.test(line));
    if (start < 0) return [];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^(?:hp\s*&\s*stress|motives\s*(?:&|and)\s*tactics|experiences?|Daggerheart.*Compatible|LIKED|IN LIBRARY|COMMENTS?)\b/i.test(lines[index])) { end = index; break; }
    }
    const source = lines.slice(start + 1, end);
    const output = [];
    let type = 'Feature';
    let current = null;
    const startFeature = (name, explicitType = type, desc = '') => {
      current = { name: clean(name), type: clean(explicitType || 'Feature'), desc: clean(desc) };
      output.push(current);
    };
    for (let index = 0; index < source.length; index += 1) {
      const line = source[index];
      if (/^passives?$/i.test(line)) { type = 'Passive'; current = null; continue; }
      if (/^actions?$/i.test(line)) { type = 'Action'; current = null; continue; }
      if (/^reactions?$/i.test(line)) { type = 'Reaction'; current = null; continue; }
      const inline = line.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)\s*:?\s*(.*)$/i);
      if (inline) { startFeature(inline[1], inline[2], inline[3]); continue; }
      const cost = line.match(/^(Fear|Stress|Hope)\s*:?\s*(\d+)$/i);
      if (cost && current) { current.parsedCost = `${cost[1][0].toUpperCase()}${cost[1].slice(1).toLowerCase()} ${cost[2]}`; continue; }
      const next = source[index + 1] || '';
      if (!current || (current.desc && strictFeatureTitle(line) && (!strictFeatureTitle(next) || /^(Fear|Stress|Hope)\b/i.test(next)))) {
        if (strictFeatureTitle(line)) { startFeature(line); continue; }
      }
      if (current) current.desc = clean(`${current.desc} ${line}`);
    }
    const seen = new Set();
    return output.filter((feature) => {
      if (!feature.name || !feature.desc) return false;
      if (!feature.parsedCost) feature.parsedCost = inferredFeatureCost(feature.desc) || undefined;
      const key = `${feature.name.toLowerCase()}|${feature.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sectionList(lines, headingPattern, stopPattern) {
    const start = lines.findIndex((line) => headingPattern.test(line));
    if (start < 0) return '';
    const values = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (stopPattern.test(line)) break;
      if (!FOOTER_LINE.test(line) && !DATE_LINE.test(line)) values.push(line);
    }
    return values.join(', ');
  }

  function repairFreshCutGrassDomItem(item, sourceUrl = '') {
    if (!item || typeof item !== 'object') return item;
    const lines = renderedLines(item.rawText || '');
    if (!lines.length) return item;
    const result = { ...item, source: sourceUrl || item.source || '', sourceSite: 'freshcutgrass.app' };

    const hp = lineValue(lines, ['hp'], true);
    const stress = lineValue(lines, ['stress'], true);
    if (hp != null) result.hp = hp;
    if (stress != null) result.stress = stress;
    const thresholds = renderedThresholds(lines);
    if (thresholds) result.thresholds = thresholds;
    Object.assign(result, renderedAttack(lines, result));

    const description = renderedDescription(lines, result.name || '');
    if (description) result.desc = description;
    else if (invalidDescription(result.desc || '')) delete result.desc;
    result.author = renderedAuthor(lines, result.author || '');

    const features = renderedFeatures(lines);
    if (features.length) result.features = features;
    const motives = sectionList(lines, /^motives\s*(?:&|and)\s*tactics$/i, /^(?:experiences?|features|standard attack|hp\s*&\s*stress)$/i);
    if (motives) result.motives = motives;
    const xp = sectionList(lines, /^experiences?$/i, /^(?:motives\s*(?:&|and)\s*tactics|features|standard attack|hp\s*&\s*stress)$/i);
    if (xp) result.xp = xp;

    for (const key of Object.keys(result)) {
      if (result[key] === '' || result[key] === undefined || (Array.isArray(result[key]) && !result[key].length)) delete result[key];
    }
    return result;
  }

  const originalStateParser = base.parseFreshCutGrassState;
  function parseFreshCutGrassState(input, sourceUrl = '', domItems = []) {
    const repaired = (Array.isArray(domItems) ? domItems : []).map((item) => repairFreshCutGrassDomItem(item, sourceUrl));
    const stateItems = typeof originalStateParser === 'function' ? originalStateParser(input, sourceUrl, repaired) : [];
    return (Array.isArray(stateItems) ? stateItems : []).map((item) => repairFreshCutGrassDomItem(item, sourceUrl));
  }

  globalThis.DHStatblockParser = {
    ...base,
    __freshCutGrassRenderedRepair: true,
    repairFreshCutGrassDomItem,
    parseFreshCutGrassState
  };
})();
