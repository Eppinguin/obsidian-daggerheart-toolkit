// src/views/components/AvatarEditor.ts

import { Setting, App, TFile } from "obsidian";
import { AvatarTransform } from "types";

/**
 * Resolves an internal or external link to a usable image URL.
 * Handles:
 * - Full URLs (http, https)
 * - Obsidian wikilinks like ![[image.png]] or [[image.png]]
 * @param app The Obsidian App instance.
 * @param url The raw URL or link text from the character data.
 * @returns A usable image src, or null if the link cannot be resolved.
 */
function resolveImageUrl(app: App, url: string | null | undefined): string | null {
    if (!url) {
        return null;
    }

    // It's already a full URL
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return url;
    }

    let fileName = url;
    // Check for Obsidian wikilink embed format ![[...]] or [[...]] and strip out aliases
    const match = url.match(/^!?\[\[(.*?)(?:\|.*)?\]\]/);
    if (match) {
        fileName = match[1];
    }

    // Use getFirstLinkpathDest to resolve wikilinks (with or without extension) to a file
    const file = app.metadataCache.getFirstLinkpathDest(fileName, '');
    if (file instanceof TFile) {
        // getResourcePath provides a usable URL for the vault file
        return app.vault.getResourcePath(file);
    }

    // If not found, return null to indicate we couldn't resolve it.
    return null;
}


export function createAvatarEditor(
    app: App, // Pass the app instance
    parent: HTMLElement,
    initialUrl: string,
    initialTransform: AvatarTransform | undefined,
    onUrlChange: (newUrl: string) => void,
    onTransformChange: (newTransform: AvatarTransform) => void
) {
    let scale = initialTransform?.scale ?? 1;
    let offsetX = initialTransform?.x ?? 0;
    let offsetY = initialTransform?.y ?? 0;

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    let naturalWidth = 0;
    let naturalHeight = 0;

    // Create a top-level wrapper for the entire editor (preview + controls)
    const editorWrapper = parent.createDiv({ cls: 'dh-avatar-editor-wrapper' });
    const previewContainer = editorWrapper.createDiv({ cls: 'dh-preview-container' });
    const controlsContainer = editorWrapper.createDiv({ cls: 'dh-avatar-controls-container' });

    const fireTransformChange = () => {
        onTransformChange({ scale, x: offsetX, y: offsetY });
    };

    const updateBackgroundStyles = (resolvedUrl: string) => {
        if (!naturalWidth || !naturalHeight || !resolvedUrl) return;
        const EDITOR_SIZE = 150;

        const ratio = naturalWidth / naturalHeight;
        let baseWidth, baseHeight;
        if (ratio > 1) { // Landscape
            baseHeight = EDITOR_SIZE;
            baseWidth = EDITOR_SIZE * ratio;
        } else { // Portrait or square
            baseWidth = EDITOR_SIZE;
            baseHeight = EDITOR_SIZE / ratio;
        }

        const bgWidth = baseWidth * scale;
        const bgHeight = baseHeight * scale;
        const bgPosX = `calc(50% + ${offsetX}px)`;
        const bgPosY = `calc(50% + ${offsetY}px)`;

        previewContainer.style.backgroundImage = `url("${resolvedUrl}")`;
        previewContainer.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
        previewContainer.style.backgroundPosition = `${bgPosX} ${bgPosY}`;
        previewContainer.style.backgroundRepeat = 'no-repeat';
    };

    const loadImage = (url: string) => {
        controlsContainer.empty();
        previewContainer.style.backgroundImage = 'none';
        previewContainer.setText('');

        if (!url) return;

        const resolvedUrl = resolveImageUrl(app, url);
        if (!resolvedUrl) {
            previewContainer.setText('Invalid Link');
            return;
        }

        const img = new Image();
        img.src = resolvedUrl;
        img.onload = () => {
            naturalWidth = img.naturalWidth;
            naturalHeight = img.naturalHeight;

            const isNew = !initialTransform;
            scale = initialTransform?.scale ?? 1;
            offsetX = initialTransform?.x ?? 0;
            offsetY = initialTransform?.y ?? 0;

            if (isNew) {
                fireTransformChange();
            }

            updateBackgroundStyles(resolvedUrl);
            createControls();
        };
        img.onerror = () => {
            previewContainer.setText('Invalid Image');
        };
    };

    const createControls = () => {
        controlsContainer.empty();

        // --- Size Slider ---
        const scaleControl = controlsContainer.createDiv({ cls: 'dh-avatar-scale-control' });
        scaleControl.createEl('label', { text: 'Size:' });
        const scaleSlider = scaleControl.createEl('input', {
            attr: { type: 'range', min: '0.5', max: '5', step: '0.05', value: String(scale) }
        });
        scaleSlider.oninput = () => {
            scale = parseFloat(scaleSlider.value);
            updateBackgroundStyles(resolveImageUrl(app, initialUrl)!);
        };
        scaleSlider.onchange = fireTransformChange;

        // --- Hint Text ---
        controlsContainer.createEl('p', { text: 'Drag image to position', cls: 'dh-avatar-position-hint' });

        // --- Reset Button ---
        const resetBtn = controlsContainer.createEl('button', { text: 'Reset', cls: 'dh-avatar-reset-btn' });
        resetBtn.onclick = () => {
            scale = 1;
            offsetX = 0;
            offsetY = 0;
            scaleSlider.value = '1';
            updateBackgroundStyles(resolveImageUrl(app, initialUrl)!);
            fireTransformChange();
        };
    };

    previewContainer.onmousedown = (e) => {
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
        previewContainer.addClass('is-dragging');
    };
    document.onmousemove = (e) => {
        if (!isDragging) return;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        updateBackgroundStyles(resolveImageUrl(app, initialUrl)!);
    };
    document.onmouseup = () => {
        if (!isDragging) return;
        isDragging = false;
        previewContainer.removeClass('is-dragging');
        fireTransformChange();
    };

    new Setting(parent)
        .setName("Avatar Image URL or Link")
        .setDesc("URL or Obsidian link (e.g., ![[portrait.jpg]]) for your character's portrait.")
        .addText(text => text
            .setPlaceholder("https://... or ![[portrait.jpg]]")
            .setValue(initialUrl)
            .onChange(value => {
                initialUrl = value;
                initialTransform = undefined;
                onUrlChange(value);
                loadImage(value);
            }));

    loadImage(initialUrl);
}
