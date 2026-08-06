/** Injected into the page to extract statblocks and drive manual selection.
 *
 * The legacy `content-script.js` carried its own inline copy of the
 * FreshCutGrass card-boundary heuristic (~150 lines duplicating
 * `freshcutgrass-card-boundary.js`) because the injected file list could not
 * load that module. It imports the single implementation now.
 */
import { extractWithDiagnostics } from '../parsers/index';
import { enrichFreshCutGrassItems } from '../parsers/freshcutgrass/card-boundary';
import { api } from '../lib/browser';
import { saveManualSelection } from '../lib/storage';
import type { ExtractResponse } from '../types';

declare global {
    // eslint-disable-next-line no-var
    var __DH_STATBLOCK_CLIPPER_LOADED__: boolean | undefined;
}

if (!globalThis.__DH_STATBLOCK_CLIPPER_LOADED__) {
    globalThis.__DH_STATBLOCK_CLIPPER_LOADED__ = true;

    const toast = (message: string, isError = false): void => {
        document.getElementById('__dh_clipper_toast')?.remove();
        const node = document.createElement('div');
        node.id = '__dh_clipper_toast';
        node.textContent = message;
        Object.assign(node.style, {
            position: 'fixed',
            zIndex: '2147483647',
            right: '18px',
            bottom: '18px',
            maxWidth: '360px',
            padding: '12px 14px',
            borderRadius: '8px',
            background: isError ? '#5b1f1f' : '#1f2937',
            color: '#fff',
            boxShadow: '0 8px 30px rgba(0,0,0,.3)',
            font: '13px/1.4 system-ui, sans-serif',
        });
        document.documentElement.appendChild(node);
        setTimeout(() => node.remove(), 3500);
    };

    function autoExtract(): ExtractResponse {
        const { items, diagnostics } = extractWithDiagnostics(document, location);
        return { ok: true, items: enrichFreshCutGrassItems(items, document, location), diagnostics };
    }

    function startSelection(): void {
        let hovered: HTMLElement | null = null;
        const previous = new Map<HTMLElement, { outline: string; cursor: string }>();

        const restore = (node: HTMLElement | null): void => {
            if (!node) return;
            node.style.outline = previous.get(node)?.outline || '';
            node.style.cursor = previous.get(node)?.cursor || '';
        };

        const onMove = (event: MouseEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
            if (!target || target === hovered || target.id === '__dh_clipper_toast') return;
            restore(hovered);
            hovered = target;
            previous.set(target, { outline: target.style.outline, cursor: target.style.cursor });
            target.style.outline = '3px solid #8b5cf6';
            target.style.cursor = 'crosshair';
        };

        const cleanup = (): void => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            restore(hovered);
        };

        const onClick = async (event: MouseEvent): Promise<void> => {
            event.preventDefault();
            event.stopPropagation();
            const clicked = (hovered || event.target) as HTMLElement;
            const target =
                clicked.closest?.(
                    '[role="dialog"],dialog,article,[class*="modal"],[class*="drawer"],[class*="statblock"],[class*="stat-block"]',
                ) || clicked;
            cleanup();
            try {
                const { items } = extractWithDiagnostics(document, location, target as Element);
                await saveManualSelection(items, location.href);
                toast(
                    items.length === 1
                        ? `Captured: ${items[0].name || 'statblock'}. Reopen the extension.`
                        : `Captured ${items.length} statblocks. Reopen the extension.`,
                );
            } catch (error) {
                toast(`Could not parse selection: ${(error as Error).message}`, true);
            }
        };

        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                cleanup();
                toast('Selection cancelled.');
            }
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
        toast('Click one statblock or a container holding several. Press Esc to cancel.');
    }

    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'DH_EXTRACT') {
            try {
                sendResponse(autoExtract());
            } catch (error) {
                sendResponse({ ok: false, error: (error as Error).message } satisfies ExtractResponse);
            }
            return true;
        }
        if (message?.type === 'DH_SELECT') {
            startSelection();
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
}
