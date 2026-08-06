import { setIcon } from 'obsidian';
import type { AdversaryInstance, Condition } from '../types';
import { EVENT_REQUEST_CONDITION_MENU, EVENT_REMOVE_CONDITION } from '../constants';

/**
 * Single source of truth for condition UI.
 *
 * Conditions previously had three renderers: one in the statblock renderer for
 * the first group member, one in EncounterBuilderView for members 2..n, and a
 * runtime prototype patch that injected the button into the latter. They had
 * drifted apart (different wrappers, different remove markup, and the second
 * path silently dropped the description tooltip). Every condition affordance
 * now goes through this module.
 */

/** Stable CSS/lookup key for a condition. Derived when not explicitly set. */
export function conditionKey(condition: Condition): string {
    return condition.key ?? condition.name.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Renders the condition chips for an instance into `container`.
 *
 * The container carries `data-instance-id` so it can be located and refreshed
 * on its own, without redrawing the whole adversary group.
 */
export function renderConditionTags(
    instance: AdversaryInstance,
    container: HTMLElement,
    dispatchTarget: HTMLElement,
): void {
    container.empty();
    container.addClass('dh-conditions-container');
    container.dataset.instanceId = instance.id;
    // Tooltips live on <body>, so they outlive the chip that opened them if the
    // card is redrawn mid-hover. Clear any strays before rendering.
    document.body.querySelectorAll('.dh-condition-tooltip').forEach((el) => el.remove());

    instance.conditions?.forEach((condition) => {
        // The chip is the button: click removes the condition. A separate tiny
        // "x" was both ugly and a small target; the whole chip is easier to hit
        // and leaves room for the rules text.
        const tag = container.createEl('button', {
            cls: `dh-condition-tag${condition.color ? ` dh-cond-${condition.color}` : ''}`,
            // No title/aria-label describing the click: Obsidian renders those as
            // a native tooltip that would cover the rules text, which is the far
            // more useful thing to show on hover.
            attr: { type: 'button' },
        });

        const iconEl = tag.createSpan({ cls: 'dh-condition-icon' });
        setIcon(iconEl, condition.icon ?? 'circle-dot');
        // Swapped for an x on hover, so the chip still explains what clicking does.
        const hoverIcon = tag.createSpan({ cls: 'dh-condition-icon dh-condition-icon-remove' });
        setIcon(hoverIcon, 'x');

        tag.createSpan({ cls: 'dh-condition-label', text: condition.name });

        if (condition.description) {
            // Rules text on hover, so a GM can check what a condition does while
            // it is applied rather than only when picking it. Appended to body
            // because every ancestor of the chip clips its overflow.
            let tip: HTMLElement | null = null;
            const hide = () => {
                tip?.remove();
                tip = null;
            };

            tag.addEventListener('mouseenter', () => {
                hide();
                tip = document.body.createDiv({ cls: 'dh-condition-tooltip' });
                tip.createDiv({ cls: 'dh-condition-tooltip-title', text: condition.name });
                tip.createDiv({ cls: 'dh-condition-tooltip-body', text: condition.description });

                const r = tag.getBoundingClientRect();
                const t = tip.getBoundingClientRect();
                tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - t.width - 8))}px`;
                // Prefer above the chip; flip below when there is not room.
                tip.style.top = r.top - t.height - 6 >= 8 ? `${r.top - t.height - 6}px` : `${r.bottom + 6}px`;
            });
            tag.addEventListener('mouseleave', hide);
            tag.addEventListener('click', hide);
        }

        tag.addEventListener('click', (e) => {
            e.stopPropagation();
            dispatchTarget.dispatchEvent(
                new CustomEvent(EVENT_REMOVE_CONDITION, {
                    bubbles: true,
                    detail: { instanceId: instance.id, conditionName: condition.name },
                }),
            );
        });
    });
}

/**
 * Creates the "add condition" button for an instance. Used for every instance,
 * whether it is the first member of a group or an additional one.
 */
export function renderConditionButton(
    instanceId: string,
    label: string,
    container: HTMLElement,
    dispatchTarget: HTMLElement,
): HTMLButtonElement {
    const title = `Add condition to ${label}`;
    const btn = container.createEl('button', {
        cls: 'dh-icon-button dh-add-condition-btn',
        attr: { type: 'button', title, 'aria-label': title },
    });
    setIcon(btn, 'plus-circle');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dispatchTarget.dispatchEvent(
            new CustomEvent(EVENT_REQUEST_CONDITION_MENU, {
                bubbles: true,
                detail: { instanceId, anchor: btn },
            }),
        );
    });
    return btn;
}
