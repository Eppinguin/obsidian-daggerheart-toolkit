/** Background launch handoff.
 *
 * Replaces the legacy `background-launch.test.js`, which ran `background.js`
 * through `node:vm`. The ported module is imported directly instead, with the
 * WebExtension API mocked on globalThis before import so the top-level listener
 * registration picks it up.
 *
 * Listener registration must stay top-level: under Firefox's non-persistent
 * MV3 event page the worker can be unloaded at any time, and only top-level
 * registration survives that.
 */
import { beforeEach, expect, test, vi } from 'vitest';

type Listener = (...args: any[]) => any;

interface Harness {
    calls: {
        create: any[];
        update: Array<{ tabId: number; properties: unknown }>;
    };
    message: Listener;
}

async function loadBackground(): Promise<Harness> {
    const calls: Harness['calls'] = { create: [], update: [] };
    let message!: Listener;

    (globalThis as Record<string, unknown>).chrome = undefined;
    (globalThis as Record<string, unknown>).browser = {
        runtime: { onMessage: { addListener: (l: Listener) => (message = l) } },
        tabs: {
            create: async (properties: any) => {
                calls.create.push(JSON.parse(JSON.stringify(properties)));
                return { id: 91, windowId: properties.windowId };
            },
            update: async (tabId: number, properties: unknown) => {
                calls.update.push({ tabId, properties: JSON.parse(JSON.stringify(properties)) });
            },
        },
    };

    vi.resetModules();
    await import('../src/entries/background');
    return { calls, message };
}

let harness: Harness;

beforeEach(async () => {
    harness = await loadBackground();
});

test('registers the message listener at the top level', () => {
    expect(typeof harness.message).toBe('function');
});

async function launch(): Promise<any> {
    return new Promise((resolve) => {
        const keepOpen = harness.message(
            {
                type: 'DH_OPEN_EXTERNAL_URI',
                uri: 'obsidian://daggerheart-import?source=test',
                sourceTabId: 17,
            },
            null,
            resolve,
        );
        expect(keepOpen).toBe(true);
    });
}

/** The protocol URI goes to the source tab. An external scheme is handed to the
 * OS without committing a navigation, so the tab keeps its page — verified
 * against a real browser: tab count and the source tab's URL both unchanged. */
test('navigates the source tab to the protocol URI without opening a tab', async () => {
    const response = await launch();
    expect(response).toEqual({ ok: true });
    expect(harness.calls.update).toEqual([
        { tabId: 17, properties: { url: 'obsidian://daggerheart-import?source=test' } },
    ]);
    expect(harness.calls.create).toEqual([]);
});

test('rejects a launch with no usable source tab', async () => {
    const response = await new Promise<any>((resolve) => {
        harness.message({ type: 'DH_OPEN_EXTERNAL_URI', uri: 'obsidian://x' }, null, resolve);
    });
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/source browser tab/i);
});

test('reports a failed navigation back to the popup', async () => {
    (globalThis as any).browser.tabs.update = async () => {
        throw new Error('Tab was closed.');
    };
    const response = await new Promise<any>((resolve) => {
        harness.message({ type: 'DH_OPEN_EXTERNAL_URI', uri: 'obsidian://x', sourceTabId: 17 }, null, resolve);
    });
    expect(response).toEqual({ ok: false, error: 'Tab was closed.' });
});

test('ignores unrelated messages', () => {
    expect(harness.message({ type: 'SOMETHING_ELSE' }, null, () => {})).toBe(false);
});
