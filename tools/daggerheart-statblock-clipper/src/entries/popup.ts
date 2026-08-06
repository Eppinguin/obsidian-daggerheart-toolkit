/** Popup: extracts from the active tab, previews the result, and hands off to
 * Obsidian.
 *
 * Diagnostics come from the content script's extraction pass, the
 * manual-selection record expires rather than shadowing fresh extractions, and
 * the Obsidian handoff calls `openObsidianUri` explicitly instead of relying on
 * a patched `tabs.create`.
 */
import { toToolkitJsonMany, toToolkitMarkdownMany, toToolkitStatblock } from '../format/adapter';
import { api } from '../lib/browser';
import { openObsidianUri } from '../lib/obsidian-launch';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, takeManualSelection } from '../lib/storage';
import { collectFreshCutGrassState, parseFreshCutGrassState, repairFreshCutGrassDomItem } from '../parsers/index';
import type { ExtractResponse, ExtractionPath, RawStatblock, ToolkitStatblock } from '../types';

type StatusKind = 'loading' | 'success' | 'error' | 'neutral';

/** Both supported sites expose one statblock at a time: FreshCutGrass expands a
 * single card out of its listing grid, and Heart of Daggers renders one card
 * per page. The array survives because root selection needs it — it is how the
 * ~100 FreshCutGrass preview cards get rejected — but the popup no longer
 * offers a chooser, since automatic extraction never yields more than one.
 *
 * The manual picker can still capture a container holding several blocks, so
 * everything captured is imported rather than silently truncated. */
let currentItems: RawStatblock[] = [];
let currentTab: chrome.tabs.Tab | null = null;
let currentDiagnostics: Record<string, unknown> = {};

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

const ACTION_BUTTON_IDS = ['copyMarkdown', 'copyJson', 'sendObsidian', 'createNote', 'copyDiagnostics'];

/** Icon path data per status. Built with DOM calls rather than assigned as an
 * innerHTML string: the values are static, but `web-ext lint` flags any
 * innerHTML write, and building the nodes keeps the store report clean. */
const STATUS_ICONS: Record<StatusKind, { paths: string[]; circle?: boolean; spinner?: boolean }> = {
    loading: { paths: ['M21 12a9 9 0 1 1-2.64-6.36'], spinner: true },
    success: { paths: ['m5 12 4 4L19 6'] },
    error: {
        paths: ['M12 8v5M12 17h.01', 'M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z'],
    },
    neutral: { paths: ['M12 11v5M12 8h.01'], circle: true },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildStatusIcon(type: StatusKind): SVGSVGElement {
    const spec = STATUS_ICONS[type] || STATUS_ICONS.neutral;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (spec.spinner) svg.setAttribute('class', 'spinner');
    if (spec.circle) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '9');
        svg.appendChild(circle);
    }
    for (const d of spec.paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

function setStatus(message: string, type: StatusKind = 'neutral'): void {
    const status = $('status');
    status.className = `notice notice--${type}`;
    (status.querySelector('.notice-icon') as HTMLElement).replaceChildren(buildStatusIcon(type));
    $('statusText').textContent = message;
    // "Pick manually" is the way out of a failed or doubtful extraction, so it
    // rides along with the message reporting the problem instead of sitting at
    // the bottom of the popup as tertiary text. On a clean success there is
    // nothing to recover from, so it stays out of the way.
    $('selectBlock').classList.toggle('hidden', type === 'loading' || type === 'success');
}

function setLoading(loading: boolean): void {
    $('loadingCard').classList.toggle('hidden', !loading);
    $('refresh').classList.toggle('is-spinning', loading);
    (input('refresh') as unknown as HTMLButtonElement).disabled = loading;
    document.body.classList.toggle('is-loading', loading);
    if (loading) {
        $('result').classList.add('hidden');
    }
}

function enableActions(enabled: boolean): void {
    for (const id of ACTION_BUTTON_IDS) {
        (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
    }
    // With nothing extracted, a stack of dimmed import buttons is just noise
    // filling the popup — and it buries the one control that helps, which is
    // picking a block by hand. Hide the stack until there is something to
    // import; the status bar keeps "Pick manually" reachable throughout.
    document.body.classList.toggle('is-empty', !enabled);
}

function sanitizeFilename(value: unknown): string {
    return (
        String(value || 'Untitled Statblock')
            .replace(/[\\/:*?"<>|#^[\]]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120) || 'Untitled Statblock'
    );
}

const clean = (value: unknown): string =>
    String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();

/** The statblock shown in the preview card. */
const current = (): RawStatblock | null => currentItems[0] || null;

/** Everything that will be imported. Normally one item; the manual picker can
 * capture several, and all of them are carried through. */
const selectedItems = (): RawStatblock[] => currentItems;

function toolkitView(data: RawStatblock): ToolkitStatblock | null {
    try {
        return toToolkitStatblock(data);
    } catch (_error) {
        return null;
    }
}

function sourceLabel(data: RawStatblock, toolkit: ToolkitStatblock | null): string {
    const site = clean(data.sourceSite || toolkit?.source?.site)
        .replace(/^www\./i, '')
        .replace(/^heartofdaggers\.com$/i, 'Heart of Daggers')
        .replace(/^freshcutgrass\.app$/i, 'FreshCutGrass');
    const author = clean(data.author || toolkit?.source?.author);
    return author ? `${site || 'Source'} · ${author}` : site;
}

function setSiteContext(url: string): void {
    let hostname = '';
    try {
        hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch (_error) {
        /* ignored */
    }
    if (/freshcutgrass\.app$/i.test(hostname)) {
        document.body.dataset.site = 'freshcutgrass';
        $('site').textContent = 'FreshCutGrass';
    } else if (/heartofdaggers\.com$/i.test(hostname)) {
        document.body.dataset.site = 'heartofdaggers';
        $('site').textContent = 'Heart of Daggers';
    } else {
        document.body.dataset.site = 'other';
        $('site').textContent = hostname || 'Unsupported page';
    }
}

function updateDestinationSummary(): void {
    const vault = input('vault').value.trim();
    const folder = input('folder')
        .value.trim()
        .replace(/^\/+|\/+$/g, '');
    $('destinationSummary').textContent = vault ? `${folder || 'Vault root'} · ${vault}` : folder || 'Vault root';
}

/** Labels stay plural-aware for the manual picker, which can capture a
 * container holding more than one block. */
function updateActionLabels(): void {
    const count = selectedItems().length;
    const many = count > 1;
    $('sendLabel').textContent = many ? `Import ${count} statblocks` : 'Import into toolkit';
    $('markdownLabel').textContent = many ? `Copy ${count} blocks` : 'Copy Markdown';
    $('jsonLabel').textContent = many ? `Copy ${count} items` : 'Copy JSON';
}

function renderCurrent(): void {
    const data = current();
    if (!data) return;
    const toolkit = toolkitView(data) || ({} as ToolkitStatblock);
    const category = toolkit.category || (data.impulses || data.tone ? 'environment' : 'adversary');
    const attack = toolkit.attack || ({} as NonNullable<ToolkitStatblock['attack']>);
    const hpStress = toolkit.hp_stress || {};
    const features = Array.isArray(toolkit.features)
        ? toolkit.features
        : Array.isArray(data.features)
          ? data.features
          : [];
    const description = clean(toolkit.description || data.desc || data.description);

    $('result').classList.remove('hidden');
    $('name').textContent = toolkit.name || data.name || 'Untitled Statblock';
    $('categoryBadge').textContent = category === 'environment' ? 'Environment' : 'Adversary';
    $('categoryBadge').classList.toggle('badge--environment', category === 'environment');
    $('typeBadge').textContent = clean(toolkit.type || data.type) || 'Homebrew';
    $('description').textContent = description;
    $('description').classList.toggle('hidden', !description);
    $('tierValue').textContent = String(toolkit.tier ?? data.tier ?? '—');
    $('difficultyValue').textContent = String(toolkit.difficulty ?? data.difficulty ?? '—');
    $('hpValue').textContent = category === 'adversary' ? String(hpStress.hp ?? data.hp ?? '—') : '—';
    $('stressValue').textContent = category === 'adversary' ? String(hpStress.stress ?? data.stress ?? '—') : '—';

    const attackName = clean(attack.name || data.weapon);
    const attackDetails = [attack.modifier, attack.range, attack.damage].filter((value) => clean(value)).join(' · ');
    const showAttack = category === 'adversary' && Boolean(attackName || attackDetails);
    $('attackSection').classList.toggle('hidden', !showAttack);
    $('attackName').textContent = attackName || 'Standard attack';
    $('attackDetails').textContent = attackDetails;

    const motives = clean(toolkit.motives_tactics || data.motives);
    $('motivesSection').classList.toggle('hidden', category !== 'adversary' || !motives);
    $('motivesValue').textContent = motives;
    $('featureCount').textContent = `${features.length} feature${features.length === 1 ? '' : 's'}`;
    $('source').textContent = sourceLabel(data, toolkit);

    enableActions(true);
    updateActionLabels();
    // The card footer already shows the feature count, so the status line says
    // only what the card cannot: whether the capture is trustworthy.
    if (data.extractionWarning) setStatus(String(data.extractionWarning), 'error');
    else if (currentItems.length > 1)
        setStatus(`${currentItems.length} statblocks captured — all will be imported.`, 'success');
    else if (!features.length) setStatus('Ready, but no features were found.', 'neutral');
    else setStatus('Ready to import.', 'success');
}

function renderItems(items: RawStatblock[]): void {
    currentItems = Array.isArray(items) ? items.filter(Boolean) : [];
    setLoading(false);
    if (!currentItems.length) throw new Error('No statblock found. Open a stat preview or pick a block manually.');
    renderCurrent();
}

/** The content script is a single bundle now; the legacy build injected six
 * files in an order that had to be kept in sync by hand. */
async function inject(tabId: number): Promise<void> {
    await api.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
}

async function findTargetTab(): Promise<chrome.tabs.Tab | undefined> {
    const requestedUrl = new URLSearchParams(location.search).get('targetUrl');
    if (requestedUrl) {
        const tabs = await api.tabs.query({});
        const match = tabs.find((tab) => tab.url === requestedUrl);
        if (match) return match;
    }
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
}

/** True for freshcutgrass.app on any subdomain or port.
 *
 * The previous `^https?://freshcutgrass\.app/` prefix test missed
 * `www.freshcutgrass.app` entirely, and any URL carrying a port. */
function isFreshCutGrassUrl(url: string | undefined): boolean {
    try {
        return /(?:^|\.)freshcutgrass\.app$/i.test(new URL(url || '').hostname);
    } catch {
        return false;
    }
}

async function collectAppState(tab: chrome.tabs.Tab): Promise<unknown> {
    if (!tab?.id || !isFreshCutGrassUrl(tab.url)) return null;
    const targetId = new URL(tab.url as string).searchParams.get('id') || '';
    try {
        const executions = await api.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: collectFreshCutGrassState,
            args: [targetId],
        });
        return executions?.[0]?.result || null;
    } catch (error) {
        console.warn('FreshCutGrass app-state extraction was unavailable; using visible DOM.', error);
        return null;
    }
}

async function extract(): Promise<void> {
    try {
        enableActions(false);
        setLoading(true);
        setStatus('Extracting statblock…', 'loading');
        const tab = await findTargetTab();
        if (!tab?.id || !/^https?:/i.test(tab.url || ''))
            throw new Error('Open a FreshCutGrass or Heart of Daggers page first.');
        currentTab = tab;
        setSiteContext(tab.url as string);
        await inject(tab.id);

        const [response, appState] = await Promise.all([
            api.tabs.sendMessage(tab.id, { type: 'DH_EXTRACT' }) as Promise<ExtractResponse>,
            collectAppState(tab),
        ]);
        if (!response?.ok) throw new Error(response?.error || 'No statblock found.');

        // Match on hostname, not a URL prefix: the prefix form failed on
        // www.freshcutgrass.app and on any non-default port.
        const isFreshCutGrass = isFreshCutGrassUrl(tab.url);
        const domItems = isFreshCutGrass
            ? (response.items || []).map((item) => repairFreshCutGrassDomItem(item, tab.url))
            : response.items || [];
        const stateItems = appState ? parseFreshCutGrassState(appState, tab.url, domItems) : [];
        const automaticItems = stateItems.length ? stateItems : domItems;

        // Expires on its own now, so a stale pick cannot shadow a fresh page.
        const manualItems = await takeManualSelection(tab.url as string);
        const chosen = manualItems ?? automaticItems;

        currentDiagnostics = {
            extensionVersion: api.runtime.getManifest().version,
            browser: navigator.userAgent,
            page: { url: tab.url, title: tab.title || '' },
            extractionPath: (manualItems
                ? 'manual-selection'
                : stateItems.length
                  ? 'freshcutgrass-app-state'
                  : isFreshCutGrass
                    ? 'freshcutgrass-rendered-dom'
                    : 'heartofdaggers-rendered-card') satisfies ExtractionPath,
            // Real counters now: the module that produced these used to ship
            // but was never loaded, so these silently read 0 / [].
            candidateCount: response.diagnostics?.candidateCount ?? (response.items || []).length,
            rejectedCount: response.diagnostics?.rejectedCount ?? 0,
            rejectionReasons: response.diagnostics?.rejectionReasons || [],
            appStateFound: Boolean(appState),
            selectedCount: chosen.length,
        };
        renderItems(chosen);
    } catch (error) {
        currentItems = [];
        currentDiagnostics = {
            error: (error as Error).message,
            extensionVersion: api.runtime.getManifest().version,
            browser: navigator.userAgent,
        };
        setLoading(false);
        $('result').classList.add('hidden');
        enableActions(false);
        (document.getElementById('copyDiagnostics') as HTMLButtonElement).disabled = false;
        setStatus((error as Error).message, 'error');
    }
}

const copiedTimers = new Map<string, number>();

/** Confirms on the button that was clicked. The status bar sits at the top of
 * the popup, far from the copy buttons at the bottom, so a status-only
 * response read as "nothing happened" and invited a second click. */
function flashCopied(buttonId: string): void {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.classList.add('is-copied');
    window.clearTimeout(copiedTimers.get(buttonId));
    copiedTimers.set(
        buttonId,
        window.setTimeout(() => button.classList.remove('is-copied'), 1400),
    );
}

async function copy(text: string, label: string, buttonId?: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied to the clipboard.`, 'success');
    if (buttonId) flashCopied(buttonId);
}

async function applySettings(): Promise<void> {
    const settings = await loadSettings();
    input('vault').value = settings.vault;
    input('folder').value = settings.folder;
    input('overwrite').checked = settings.overwrite;
    updateDestinationSummary();
}

async function persistSettings(announce = true): Promise<void> {
    await saveSettings({
        vault: input('vault').value.trim(),
        folder: input('folder')
            .value.trim()
            .replace(/^\/+|\/+$/g, ''),
        overwrite: input('overwrite').checked,
    });
    updateDestinationSummary();
    // Saving is confirmed inside the settings panel rather than in the status
    // bar: the status bar reports on the extraction, and overwriting it with
    // "Saved" hid whether the statblock was actually ready to import.
    if (announce) flashSaved();
}

let savedTimer = 0;

function flashSaved(): void {
    const label = $('saveSettings');
    label.textContent = 'Saved';
    label.classList.add('is-visible');
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => label.classList.remove('is-visible'), 1600);
}

/** Settings save themselves shortly after the last keystroke. The explicit
 * Save button was easy to miss, and a destination that silently failed to
 * apply looked like the import itself was broken. */
let saveTimer = 0;

function queueSave(): void {
    updateDestinationSummary();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void persistSettings(true), 600);
}

function collectionFilename(items: RawStatblock[]): string {
    return items.length === 1
        ? sanitizeFilename(items[0].name)
        : sanitizeFilename(`${items[0].name || 'Encounter'} and ${items.length - 1} more`);
}

/**
 * Copy the payload and open the plugin's review screen.
 *
 * Adding to the open encounter is decided in that review screen, not here: it
 * renders an "Also add to the open encounter" toggle whenever an encounter is
 * actually open, and the extension has no way to know whether one is. A second
 * button here could only ever pre-tick that toggle, and when no encounter was
 * open it silently degraded into a plain import — so it promised something it
 * could not deliver. One button, one outcome; the review screen offers the
 * encounter when the encounter exists.
 */
async function importIntoToolkit(): Promise<void> {
    const items = selectedItems();
    if (!items.length) return;
    const button = document.getElementById('sendObsidian') as HTMLButtonElement;
    button.disabled = true;
    setStatus('Preparing verified import…', 'loading');
    try {
        await navigator.clipboard.writeText(toToolkitJsonMany(items));
        const params = new URLSearchParams({
            source: String(currentDiagnostics.extractionPath || 'browser-extension'),
            count: String(items.length),
        });
        setStatus(
            `${items.length === 1 ? 'Statblock' : `${items.length} statblocks`} copied. Opening import preview…`,
            'success',
        );
        await openObsidianUri(`obsidian://daggerheart-import?${params.toString()}`);
    } catch (error) {
        setStatus((error as Error).message, 'error');
    } finally {
        button.disabled = false;
    }
}

async function createMarkdownNote(): Promise<void> {
    const items = selectedItems();
    if (!items.length) return;
    await persistSettings(false);
    await navigator.clipboard.writeText(toToolkitMarkdownMany(items));
    const vault = input('vault').value.trim();
    const folder = input('folder')
        .value.trim()
        .replace(/^\/+|\/+$/g, '');
    const filename = collectionFilename(items);
    const params = new URLSearchParams();
    if (vault) params.set('vault', vault);
    params.set('file', folder ? `${folder}/${filename}` : filename);
    params.set('clipboard', '');
    if (input('overwrite').checked) params.set('overwrite', '');
    try {
        setStatus('Markdown copied. Opening Obsidian note…', 'success');
        await openObsidianUri(`obsidian://new?${params.toString().replace(/=$/g, '')}`);
    } catch (error) {
        setStatus((error as Error).message, 'error');
    }
}

function diagnosticPayload(): Record<string, unknown> {
    return {
        ...currentDiagnostics,
        generatedAt: new Date().toISOString(),
        selected: selectedItems().map((item) => {
            const toolkit = toolkitView(item);
            return toolkit
                ? {
                      ...toolkit,
                      source: toolkit.source
                          ? { site: toolkit.source.site, url: toolkit.source.url, author: toolkit.source.author }
                          : undefined,
                  }
                : { name: item.name, category: item.category };
        }),
    };
}

$('refresh').addEventListener('click', extract);
/* Named so the click handlers and the keyboard shortcuts below share one
 * implementation rather than drifting apart. */

function copyMarkdown(): Promise<void> {
    const items = selectedItems();
    return copy(
        toToolkitMarkdownMany(items),
        items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit Markdown',
        'copyMarkdown',
    );
}

function copyJson(): Promise<void> {
    const items = selectedItems();
    return copy(
        toToolkitJsonMany(items),
        items.length > 1 ? `${items.length} toolkit statblocks` : 'Toolkit JSON',
        'copyJson',
    );
}

async function pickBlock(): Promise<void> {
    try {
        if (!currentTab?.id) currentTab = (await findTargetTab()) || null;
        if (!currentTab?.id) throw new Error('No page is available to pick from.');
        await inject(currentTab.id);
        await api.tabs.sendMessage(currentTab.id, { type: 'DH_SELECT' });
        window.close();
    } catch (error) {
        setStatus((error as Error).message, 'error');
    }
}

$('copyMarkdown').addEventListener('click', () => void copyMarkdown());
$('copyJson').addEventListener('click', () => void copyJson());
$('sendObsidian').addEventListener('click', () => void importIntoToolkit());
$('createNote').addEventListener('click', () => void createMarkdownNote());
$('copyDiagnostics').addEventListener(
    'click',
    () => void copy(JSON.stringify(diagnosticPayload(), null, 2), 'Diagnostics', 'copyDiagnostics'),
);
$('openOptions').addEventListener('click', () => api.runtime.openOptionsPage());
$('vault').addEventListener('input', queueSave);
$('folder').addEventListener('input', queueSave);
$('overwrite').addEventListener('change', () => void persistSettings(true));
// Two entry points into the same picker: one in the status bar for when
// extraction failed, one in the card footer for when it succeeded but grabbed
// the wrong block.
$('selectBlock').addEventListener('click', () => void pickBlock());
$('repick').addEventListener('click', () => void pickBlock());

/**
 * Keyboard shortcuts.
 *
 * The toolbar shortcut opens the popup; without these every action after that
 * needs the mouse. Single-letter keys are ignored while a text field has focus,
 * so typing a vault or folder name never triggers one.
 */
function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element.isContentEditable
    );
}

/** Runs an action unless its button is disabled, so shortcuts cannot reach
 * actions the UI is currently refusing. */
function activate(id: string, run: () => void): void {
    if ((document.getElementById(id) as HTMLButtonElement | null)?.disabled) return;
    run();
}

document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        window.close();
        return;
    }

    if (event.key === 'Enter') {
        // Enter commits a settings field immediately instead of waiting out the
        // auto-save debounce, and never triggers the import from there.
        if (isTypingTarget(event.target)) {
            if (event.target === input('vault') || event.target === input('folder')) {
                event.preventDefault();
                window.clearTimeout(saveTimer);
                void persistSettings(true);
            }
            return;
        }
        event.preventDefault();
        activate('sendObsidian', () => void importIntoToolkit());
        return;
    }

    if (isTypingTarget(event.target)) return;

    switch (event.key.toLowerCase()) {
        case 'm':
            event.preventDefault();
            activate('copyMarkdown', () => void copyMarkdown());
            break;
        case 'j':
            event.preventDefault();
            activate('copyJson', () => void copyJson());
            break;
        case 'r':
            event.preventDefault();
            activate('refresh', () => void extract());
            break;
        case 'p':
            event.preventDefault();
            activate('selectBlock', () => void pickBlock());
            break;
        default:
            break;
    }
});

void applySettings().then(extract);

export { DEFAULT_SETTINGS };
