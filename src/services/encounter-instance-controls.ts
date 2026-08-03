import { setIcon } from 'obsidian';
import type { AdversaryInstance } from '../types';

const PATCH_FLAG = '__dhAdditionalInstanceConditionControls';

/**
 * Additional members of an adversary group are rendered by EncounterBuilderView
 * rather than the shared statblock renderer. Enhance that renderer once so every
 * instance receives the same condition menu button as the first group member.
 */
void import('../views/EncounterBuilderView').then(({ EncounterBuilderView }) => {
    type EncounterBuilderInstance = InstanceType<typeof EncounterBuilderView>;
    const prototype = EncounterBuilderView.prototype as EncounterBuilderInstance & Record<string, unknown>;
    if (prototype[PATCH_FLAG]) return;

    const originalRender = prototype.renderAdditionalTrackerRow;
    prototype.renderAdditionalTrackerRow = function (
        this: EncounterBuilderInstance,
        instance: AdversaryInstance,
        parentEl: HTMLElement
    ): void {
        originalRender.call(this, instance, parentEl);

        const trackerRow = parentEl.lastElementChild as HTMLElement | null;
        if (!trackerRow?.classList.contains('dh-additional-tracker-row')) return;

        const controls = trackerRow.querySelector<HTMLElement>('.dh-additional-tracker-controls');
        if (!controls || controls.querySelector('.dh-add-condition-btn')) return;

        const conditionButton = document.createElement('button');
        conditionButton.type = 'button';
        conditionButton.className = 'dh-icon-button dh-add-condition-btn';
        conditionButton.title = `Add condition to ${instance.displayName || instance.name}`;
        conditionButton.setAttribute('aria-label', conditionButton.title);
        setIcon(conditionButton, 'tag');
        conditionButton.addEventListener('click', event => {
            event.stopPropagation();
            trackerRow.dispatchEvent(new CustomEvent('dh-request-condition-menu', {
                bubbles: true,
                detail: { instanceId: instance.id, anchor: conditionButton }
            }));
        });

        controls.prepend(conditionButton);
    };

    prototype[PATCH_FLAG] = true;
});
