import type { AdversaryInstance } from '../types';
import { EVENT_RENAME_INSTANCE } from '../constants';

/**
 * Renders an instance's name as a click-to-edit field.
 *
 * Renaming happens constantly in play ("the one on the roof", "the wounded
 * one"), so it has to be as cheap as clicking the name — a modal or a settings
 * round-trip is too much friction mid-session. Used for the first group member
 * and for additional ones alike, so both behave the same.
 */
export function renderInstanceName(
    instance: AdversaryInstance,
    parentEl: HTMLElement,
    dispatchTarget: HTMLElement,
): HTMLElement {
    const nameEl = parentEl.createSpan({
        cls: 'dh-additional-tracker-name',
        text: instance.displayName,
        attr: { title: 'Click to rename', tabindex: '0', role: 'button' },
    });

    const beginEdit = () => {
        if (nameEl.querySelector('input')) return;
        const current = instance.displayName;
        nameEl.empty();
        nameEl.addClass('is-editing');

        const input = nameEl.createEl('input', {
            cls: 'dh-instance-name-input',
            attr: { type: 'text', value: current, 'aria-label': 'Instance name' },
        });
        input.value = current;
        input.focus();
        input.select();

        let settled = false;
        const settle = (commit: boolean) => {
            if (settled) return;
            settled = true;
            const next = input.value.trim();
            nameEl.removeClass('is-editing');
            nameEl.empty();
            // Show the old name until the view responds; clearing the field
            // resets to the automatic name, which the view redraws.
            nameEl.setText(current);

            if (commit && next !== current) {
                if (next) nameEl.setText(next);
                dispatchTarget.dispatchEvent(
                    new CustomEvent(EVENT_RENAME_INSTANCE, {
                        bubbles: true,
                        detail: { instanceId: instance.id, name: next },
                    }),
                );
            }
        };

        input.addEventListener('blur', () => settle(true));
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                settle(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                settle(false);
            }
            // Typing in the name field must not reach the card's own handlers.
            e.stopPropagation();
        });
        input.addEventListener('click', (e) => e.stopPropagation());
    };

    nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        beginEdit();
    });
    nameEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            beginEdit();
        }
    });

    return nameEl;
}
