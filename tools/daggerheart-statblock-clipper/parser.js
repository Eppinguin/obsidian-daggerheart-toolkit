(() => {
  'use strict';

  const ROLES = ['Bruiser', 'Horde', 'Leader', 'Minion', 'Ranged', 'Skulk', 'Social', 'Solo', 'Standard', 'Support', 'Traversal', 'Event', 'Exploration'];
  const ENVIRONMENT_ROLES = new Set(['Traversal', 'Event', 'Exploration']);

  const clean = (value) => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

  const linesOf = (text) => String(text ?? '').replace(/\r/g, '').split('\n').map(clean).filter(Boolean);

  function firstMatch(text, patterns, group = 1) {
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (match?.[group] != null) return clean(match[group]);
    }
    return '';
  }

  function numberValue(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return firstMatch(text, [new RegExp(`(?:^|\\n|\\|)\\s*${escaped}\\s*:?\\s*([+−-]?\\d+)`, 'i')]);
  }

  function sectionRaw(text, starts, ends) {
    const lines = linesOf(text);
    const lower = lines.map((line) => line.toLowerCase());
    const startNames = starts.map((name) => name.toLowerCase());
    const endNames = ends.map((name) => name.toLowerCase());
    const headingIndex = lower.findIndex((line) => startNames.some((name) => line === name || line.startsWith(`${name}:`)));
    if (headingIndex < 0) return '';
    let end = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      if (endNames.some((name) => lower[index] === name || lower[index].startsWith(`${name}:`))) {
        end = index;
        break;
      }
    }
    return lines.slice(headingIndex + 1, end).join('\n');
  }

  function valueAfterLabel(text, labels, stops = []) {
    const lines = linesOf(text);
    const normalized = labels.map((label) => label.toLowerCase());
    const stopNames = stops.map((label) => label.toLowerCase());
    for (let index = 0; index < lines.length; index += 1) {
      const lower = lines[index].toLowerCase();
      if (stopNames.includes(lower)) break;
      for (const label of normalized) {
        if (lower === label && lines[index + 1]) return lines[index + 1];
        if (lower.startsWith(`${label}:`)) return clean(lines[index].slice(label.length + 1));
      }
    }
    return '';
  }

  function inferName(text, metadata) {
    if (metadata.name) return clean(metadata.name);
    const banned = /^(community homebrew|community adversaries|stat block|adversary overview|environment overview|features|homebrew vault)$/i;
    return linesOf(text).find((line) => line.length < 100 && !banned.test(line) && !/^tier\b/i.test(line)) || 'Untitled Statblock';
  }

  function parseThresholds(text) {
    const explicit = String(text).match(/Thresholds?\s*:?\s*([—\d]+)\s*\/\s*([—\d]+)/i);
    if (explicit) return `${explicit[1]}/${explicit[2]}`;
    const block = sectionRaw(text, ['Damage thresholds', 'Thresholds'], ['Standard attack', 'Features', 'Motives & tactics']);
    const values = (block.match(/\b\d+\b/g) || []).filter((value) => !['1', '2', '3'].includes(value));
    return values.length >= 2 ? `${values[0]}/${values[1]}` : '';
  }

  function parseAttack(text) {
    const result = { weapon: '', range: '', damage: '', attack: '' };
    const compact = String(text).match(/ATK\s*:\s*([+−-]?\d+)\s*\|\s*([^|\n:]+)\s*:\s*([^|\n]+)\s*\|\s*([^\n]+)/i);
    if (compact) {
      result.attack = clean(compact[1]).replace('−', '-');
      result.weapon = clean(compact[2]);
      result.range = clean(compact[3]);
      result.damage = clean(compact[4]).replace(/\bPhysical\b/i, 'phy').replace(/\bMagical?\b/i, 'mag');
      return result;
    }

    const block = sectionRaw(text, ['Standard attack'], ['Features', 'Motives & tactics', 'Experiences']);
    if (!block) return result;
    result.weapon = linesOf(block).find((line) => !/^(Range|Damage|Attack Mod|Damage Type)\s*:/i.test(line)) || '';
    result.range = firstMatch(block, [/Range\s*:\s*([^|]+?)(?=\s+Damage\s*:|$)/i]);
    const dice = firstMatch(block, [/Damage\s*:\s*([^|]+?)(?=\s+Attack Mod\s*:|$)/i]);
    const type = firstMatch(block, [/Damage Type\s*:\s*(Physical|Magical?)/i]);
    result.damage = clean(`${dice}${type ? ` ${type}` : ''}`).replace(/\bPhysical\b/i, 'phy').replace(/\bMagical?\b/i, 'mag');
    result.attack = firstMatch(block, [/Attack Mod\s*:\s*([+−-]?\d+)/i]).replace('−', '-');
    return result;
  }

  function parseFeaturesFromText(text) {
    const block = sectionRaw(text, ['Features'], ['Motives & tactics', 'Experiences', 'Scale Adversary', 'Report this Homebrew']);
    const features = [];
    let current = null;
    for (const line of linesOf(block)) {
      const match = line.match(/^(.+?)\s*[–—-]\s*(Passive|Action|Reaction)\s*:\s*(.+)$/i);
      if (match) {
        current = { name: clean(match[1]), type: clean(match[2]), desc: clean(match[3]) };
        features.push(current);
      } else if (current && !/^(Passives?|Actions?|Reactions?)$/i.test(line)) {
        current.desc = clean(`${current.desc} ${line}`);
      }
    }
    return features;
  }

  function parseFeaturesFromDom(root) {
    const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const start = headings.find((heading) => clean(heading.textContent).toLowerCase() === 'features');
    if (!start) return [];
    const startLevel = Number(start.tagName.slice(1));
    const features = [];
    let type = '';
    let node = start.nextElementSibling;
    while (node) {
      if (/^H[1-6]$/.test(node.tagName)) {
        const level = Number(node.tagName.slice(1));
        if (level <= startLevel) break;
        const heading = clean(node.textContent).toLowerCase();
        if (/^passives?$/.test(heading)) type = 'Passive';
        if (/^actions?$/.test(heading)) type = 'Action';
        if (/^reactions?$/.test(heading)) type = 'Reaction';
      }
      const items = node.matches?.('li') ? [node] : Array.from(node.querySelectorAll?.('li') || []);
      for (const item of items) {
        const itemLines = linesOf(item.innerText);
        if (!itemLines.length || /^(passives?|actions?|reactions?)$/i.test(itemLines[0])) continue;
        const cost = itemLines[1] && /^(fear|stress|hope)\s+\d+/i.test(itemLines[1]) ? itemLines[1] : '';
        features.push({
          name: clean(`${itemLines[0]}${cost ? ` (${cost})` : ''}`),
          type: type || 'Feature',
          desc: clean(itemLines.slice(cost ? 2 : 1).join(' '))
        });
      }
      node = node.nextElementSibling;
    }
    const seen = new Set();
    return features.filter((feature) => {
      const key = `${feature.name}|${feature.type}|${feature.desc}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseDescription(text, name) {
    const overview = sectionRaw(text, ['Adversary overview', 'Environment overview'], ['Stat block']);
    if (overview) {
      const lines = linesOf(overview);
      return lines.length > 1 && lines[0].length < 90 ? clean(lines.slice(1).join(' ')) : clean(overview);
    }
    const lines = linesOf(text);
    const start = lines.indexOf(name);
    const candidates = start >= 0 ? lines.slice(start + 1) : lines;
    return candidates.find((line) => line.length > 20 && line.length < 500 &&
      !/^(Adversaries|Environments|Designed by|Tier\b|Type\b|Difficulty\b|HP\b|Stress\b|Attack mod\b|Motives & tactics\b|Tone & feel\b)/i.test(line)) || '';
  }

  function parseText(text, metadata = {}) {
    const normalized = String(text ?? '').replace(/\r/g, '');
    const name = inferName(normalized, metadata);
    const type = valueAfterLabel(normalized, ['Type', 'Role']) || ROLES.find((role) => new RegExp(`\\b${role}\\b`, 'i').test(normalized)) || '';
    const isEnvironment = ENVIRONMENT_ROLES.has(type) || /\b(tone\s*&\s*feel|potential adversaries|impulses)\b/i.test(normalized);
    const attack = parseAttack(normalized);
    const result = {
      name,
      tier: Number(numberValue(normalized, 'Tier') || firstMatch(normalized, [/\bTier\s+(\d)\b/i])) || undefined,
      type,
      desc: parseDescription(normalized, name),
      difficulty: Number(numberValue(normalized, 'Difficulty')) || undefined,
      features: metadata.features?.length ? metadata.features : parseFeaturesFromText(normalized),
      source: metadata.source || '',
      sourceSite: metadata.sourceSite || '',
      author: metadata.author || '',
      extractedAt: new Date().toISOString(),
      rawText: normalized.trim()
    };

    if (isEnvironment) {
      result.tone = valueAfterLabel(normalized, ['Tone & feel', 'Tone and feel'], ['Potential adversaries', 'Features']);
      result.adversaries = valueAfterLabel(normalized, ['Potential adversaries'], ['Features', 'Experiences']);
      result.impulses = valueAfterLabel(normalized, ['Impulses'], ['Tone & feel', 'Potential adversaries', 'Features']);
    } else {
      result.weapon = attack.weapon;
      result.range = attack.range;
      result.damage = attack.damage;
      result.hp = Number(numberValue(normalized, 'HP')) || undefined;
      result.stress = Number(numberValue(normalized, 'Stress')) || undefined;
      result.thresholds = parseThresholds(normalized);
      result.attack = attack.attack || numberValue(normalized, 'Attack mod');
      result.xp = valueAfterLabel(normalized, ['Experience', 'Experiences'], ['Features']) || firstMatch(normalized, [/Experience\s*:\s*([^\n]+)/i]);
      result.motives = valueAfterLabel(normalized, ['Motives & tactics', 'Motives and tactics'], ['Experiences', 'Features']);
    }

    for (const key of Object.keys(result)) {
      if (result[key] === '' || result[key] === undefined || (Array.isArray(result[key]) && !result[key].length)) delete result[key];
    }
    return result;
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 200 && rect.height > 120;
  }

  function scoreCandidate(element) {
    if (!visible(element)) return -1;
    const text = clean(element.innerText);
    if (text.length < 120) return -1;
    let score = 0;
    for (const token of ['Tier', 'Difficulty', 'HP', 'Stress', 'Features', 'Motives & tactics', 'Tone & feel', 'Standard attack']) {
      if (text.toLowerCase().includes(token.toLowerCase())) score += 3;
    }
    if (element.matches('[role="dialog"],dialog,.modal,[class*="modal"],[class*="drawer"]')) score += 8;
    if (element.matches('article,main')) score += 3;
    return score - Math.min(text.length / 10000, 5);
  }

  function bestRoot(doc) {
    const selectors = ['[role="dialog"]', 'dialog[open]', '.modal', '[class*="modal"]', '[class*="drawer"]', 'article', 'main', '[class*="statblock"]', '[class*="stat-block"]'];
    const candidates = selectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)));
    candidates.push(doc.body);
    return candidates.map((element) => ({ element, score: scoreCandidate(element) })).sort((a, b) => b.score - a.score)[0]?.element || doc.body;
  }

  function parseFromDocument(doc, loc, selectedRoot = null) {
    const root = selectedRoot || bestRoot(doc);
    const heading = Array.from(root.querySelectorAll('h1,h2,h3')).find((element) => {
      const text = clean(element.textContent);
      return text && !/^(Community Homebrew|Community Adversaries|Homebrew Vault|Stat block)$/i.test(text);
    });
    const text = root.innerText || doc.body.innerText;
    const metadata = {
      name: heading ? clean(heading.textContent) : '',
      source: loc?.href || '',
      sourceSite: loc?.hostname || '',
      author: firstMatch(text, [/Designed by\s+([^\n•]+)/i, /Created by\s+([^\n•]+)/i, /Author\s*:\s*([^\n]+)/i, /by\s+([^\n]+)\s+Created:/i]),
      features: parseFeaturesFromDom(root)
    };
    const result = parseText(text, metadata);
    if ((root === doc.body || root.matches?.('main')) && text.length > 5000 && !metadata.features.length) {
      result.extractionWarning = 'This looks like a listing page. Open a statblock or use Pick block on page.';
    }
    return result;
  }

  const thresholdValue = (value) => {
    if (value == null || value === '' || value === '—' || value === '-') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function featureCost(feature) {
    if (feature.parsedCost) return clean(feature.parsedCost);
    const match = clean(feature.name).match(/\((Fear|Stress|Hope)\s*(\d+)\)\s*$/i);
    return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}` : undefined;
  }

  function toToolkitStatblock(statblock) {
    if (!statblock || typeof statblock !== 'object') throw new Error('No statblock is available.');
    const category = statblock.impulses || statblock.adversaries || statblock.tone || ENVIRONMENT_ROLES.has(statblock.type) ? 'environment' : 'adversary';
    const [major, severe] = String(statblock.thresholds || '').split('/').map((part) => thresholdValue(part.trim()));
    const result = {
      name: clean(statblock.name || 'Untitled Statblock'),
      category,
      tier: statblock.tier,
      type: clean(statblock.type),
      description: clean(statblock.desc || statblock.description),
      difficulty: statblock.difficulty,
      hp_stress: { hp: Number(statblock.hp) || 0, stress: Number(statblock.stress) || 0, major_hp: major, severe_hp: severe },
      features: Array.isArray(statblock.features) ? statblock.features.map((feature) => {
        const cost = featureCost(feature);
        const name = clean(feature.name || 'Feature').replace(/\s*\((Fear|Stress|Hope)\s*\d+\)\s*$/i, '');
        return { name, type: clean(feature.type || 'Feature'), ...(cost ? { parsedCost: cost } : {}), description: clean(feature.description || feature.desc) };
      }).filter((feature) => feature.name && feature.description) : [],
      source: { site: clean(statblock.sourceSite), url: clean(statblock.source), author: clean(statblock.author), importedAt: clean(statblock.extractedAt || new Date().toISOString()) },
      isCustom: true
    };

    if (category === 'adversary') {
      result.attack = { name: clean(statblock.weapon || 'Attack'), range: clean(statblock.range), damage: clean(statblock.damage), modifier: clean(statblock.attack || '0') };
      result.experience = clean(statblock.xp);
      result.motives_tactics = clean(statblock.motives);
    } else {
      result.impulses = clean(statblock.impulses);
      result.potential_adversaries = clean(statblock.adversaries);
      result.tone = clean(statblock.tone);
    }

    const removeEmpty = (object) => Object.keys(object).forEach((key) => {
      const value = object[key];
      if (value === '' || value === undefined || (Array.isArray(value) && !value.length)) delete object[key];
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        removeEmpty(value);
        if (!Object.keys(value).length) delete object[key];
      }
    });
    removeEmpty(result);
    return result;
  }

  const toToolkitExport = (statblock) => {
    const data = toToolkitStatblock(statblock);
    return { type: data.category, version: '1.1.0', exportDate: new Date().toISOString(), data };
  };

  const yamlString = (value) => JSON.stringify(String(value));
  function pushYaml(lines, key, value, indent = '') {
    if (value == null || value === '') return;
    lines.push(`${indent}${key}: ${typeof value === 'number' || typeof value === 'boolean' ? value : yamlString(value)}`);
  }

  function toToolkitYaml(statblock) {
    const data = toToolkitStatblock(statblock);
    const lines = [];
    ['name', 'category', 'tier', 'type', 'description', 'difficulty'].forEach((key) => pushYaml(lines, key, data[key]));
    if (data.attack) {
      lines.push('attack:');
      ['name', 'range', 'damage', 'modifier'].forEach((key) => pushYaml(lines, key, data.attack[key], '  '));
    }
    ['experience', 'motives_tactics', 'impulses', 'potential_adversaries', 'tone'].forEach((key) => pushYaml(lines, key, data[key]));
    lines.push('hp_stress:');
    ['hp', 'stress', 'major_hp', 'severe_hp'].forEach((key) => pushYaml(lines, key, data.hp_stress?.[key], '  '));
    if (data.features?.length) {
      lines.push('features:');
      for (const feature of data.features) {
        lines.push(`  - name: ${yamlString(feature.name)}`);
        ['type', 'parsedCost', 'countdown', 'description'].forEach((key) => pushYaml(lines, key, feature[key], '    '));
      }
    }
    if (data.source && Object.keys(data.source).length) {
      lines.push('source:');
      ['site', 'url', 'author', 'importedAt'].forEach((key) => pushYaml(lines, key, data.source[key], '  '));
    }
    pushYaml(lines, 'isCustom', true);
    return lines.join('\n');
  }

  const toToolkitMarkdown = (statblock) => `\`\`\`daggerheart-statblock\n${toToolkitYaml(statblock)}\n\`\`\``;
  const toToolkitJson = (statblock) => JSON.stringify(toToolkitExport(statblock), null, 2);
  const toRawJson = (statblock) => JSON.stringify(statblock, null, 2);

  globalThis.DHStatblockParser = { parseText, parseFromDocument, toToolkitStatblock, toToolkitExport, toToolkitYaml, toToolkitMarkdown, toToolkitJson, toRawJson, bestRoot };
})();
