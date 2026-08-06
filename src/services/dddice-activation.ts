import { Modal, Setting, Notice } from 'obsidian';
import { ThreeDDiceAPI } from 'dddice-js';
import DaggerheartStatblockPlugin from '../main';
import * as dddice from './dddice-service';

export class DddiceActivationModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private activationCode: string = '';
    private expiresAt: Date = new Date();
    private pollingInterval: ReturnType<typeof setInterval> | null = null;
    private secret: string = '';
    private codeDisplayEl: HTMLElement | null = null;
    private timerEl: HTMLElement | null = null;
    private isLoading: boolean = true;

    constructor(plugin: DaggerheartStatblockPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dddice-activation-modal');

        contentEl.createEl('h2', { text: 'Connect to dddice' });

        // Section 1: Activate with code
        const instructionsEl = contentEl.createEl('div', { cls: 'dddice-instructions' });
        instructionsEl.createEl('p', { text: 'Click this link to connect your account:' });
        const linkEl = instructionsEl.createEl('a', {
            text: 'dddice.com/activate',
            href: 'https://dddice.com/activate',
            attr: { target: '_blank' },
        });
        linkEl.addClass('dddice-link');

        instructionsEl.createEl('p', { text: 'The code will be pre-filled for you:' });

        this.codeDisplayEl = instructionsEl.createEl('div', { cls: 'dddice-code-container' });
        this.renderLoadingCode();

        this.timerEl = instructionsEl.createEl('div', { cls: 'dddice-timer' });

        // Separator
        const separatorEl = contentEl.createEl('div', { cls: 'dddice-separator' });
        separatorEl.createEl('span', { text: 'OR' });

        // Section 2: Continue as Guest
        const guestButtonEl = contentEl.createEl('div', { cls: 'dddice-guest-button-container' });
        new Setting(guestButtonEl).addButton((button) =>
            button.setButtonText('Continue as Guest').onClick(async () => {
                await this.continueAsGuest();
            }),
        );

        // Initialize the activation process for the code flow
        this.startActivation();
    }

    private async startActivation() {
        try {
            const activationData = await this.generateActivationCode();
            this.activationCode = activationData.code;
            this.secret = activationData.secret;
            this.expiresAt = new Date(activationData.expires_at);

            // Update the link with the activation code
            const linkEl = this.contentEl.querySelector('.dddice-link') as HTMLAnchorElement;
            if (linkEl) {
                linkEl.href = `https://dddice.com/activate?code=${this.activationCode}`;
                linkEl.textContent = 'dddice.com/activate';
            }

            this.isLoading = false;
            this.renderCode();

            // Start polling for token
            this.startPolling();

            // Start timer update
            this.updateTimer();
        } catch (error) {
            console.error('Failed to generate activation code:', error);
            new Notice('Failed to connect to dddice. Please try again later.');
            this.close();
        }
    }

    private renderLoadingCode() {
        if (!this.codeDisplayEl) return;

        this.codeDisplayEl.empty();
        for (let i = 0; i < 6; i++) {
            const codeBox = this.codeDisplayEl.createEl('span', { cls: 'dddice-code-box' });
            codeBox.createEl('span', { text: ' ' });
        }
    }

    private renderCode() {
        if (!this.codeDisplayEl) return;

        this.codeDisplayEl.empty();
        for (const letter of this.activationCode) {
            const codeBox = this.codeDisplayEl.createEl('span', { cls: 'dddice-code-box' });
            codeBox.createEl('span', { text: letter });
        }
    }

    private updateTimer() {
        if (!this.timerEl) return;

        const now = new Date();
        const timeDiff = this.expiresAt.getTime() - now.getTime();

        if (timeDiff <= 0) {
            this.timerEl.textContent = 'Code expired';
            return;
        }

        const minutes = Math.floor(timeDiff / 60000);
        const seconds = Math.floor((timeDiff % 60000) / 1000);

        this.timerEl.textContent = `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;

        setTimeout(() => this.updateTimer(), 1000);
    }

    private async generateActivationCode(): Promise<{
        code: string;
        secret: string;
        expires_at: string;
    }> {
        const response = await fetch('https://dddice.com/api/1.0/activate', {
            method: 'POST',
        });

        if (!response.ok) {
            throw new Error('Failed to generate activation code');
        }

        const data = await response.json();
        return data.data;
    }

    private startPolling() {
        this.pollingInterval = setInterval(() => this.pollForToken(), 5000);
    }

    private async pollForToken() {
        if (!this.activationCode || !this.secret) return;

        try {
            if (this.timerEl) {
                const timerText = this.timerEl.textContent || '';
                if (!timerText.includes('Checking for activation')) {
                    this.timerEl.textContent = `${timerText} - Checking for activation...`;
                }
            }

            const response = await fetch(`https://dddice.com/api/1.0/activate/${this.activationCode}`, {
                headers: {
                    Authorization: `Secret ${this.secret}`,
                },
            });

            if (!response.ok) {
                return; // Continue polling
            }

            const data = await response.json();

            if (data.data && data.data.token) {
                this.stopPolling();
                await this.handleActivationSuccess(data.data.token);
            }
        } catch (error) {
            console.error('Error polling for token:', error);
        }
    }

    private stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    private async handleActivationSuccess(apiKey: string) {
        const previousProvider = this.plugin.settings.diceProvider;
        const previousApiKey = this.plugin.settings.dddice.apiKey;
        const previousRoom = this.plugin.settings.dddice.room;
        try {
            const loadingEl = this.contentEl.createEl('div', {
                cls: 'dddice-loading',
                text: 'Setting up dddice...',
            });
            loadingEl.style.textAlign = 'center';
            loadingEl.style.marginTop = '20px';
            loadingEl.style.fontWeight = 'bold';

            this.plugin.settings.dddice.apiKey = apiKey;
            this.plugin.settings.diceProvider = 'dddice';

            const dddiceApi = dddice.initializeDddiceApi(apiKey);

            const currentRoomSlug = this.plugin.settings.dddice.room;
            let roomIsValid = false;

            if (currentRoomSlug) {
                try {
                    await dddiceApi.room.get(currentRoomSlug);
                    roomIsValid = true;
                } catch (e: any) {
                    const status = e?.response?.status;
                    // Any 4xx here means the saved room is unusable for this
                    // account; recover by creating a fresh one. Only network or
                    // 5xx failures should abort activation.
                    if (status >= 400 && status < 500) {
                        console.warn(
                            `dddice: Saved room '${currentRoomSlug}' is not usable (status ${status}). A new room will be created.`,
                        );
                        this.plugin.settings.dddice.room = null;
                        roomIsValid = false;
                    } else {
                        new Notice('Could not verify your dddice room. Please try again.');
                        throw e;
                    }
                }
            }

            if (!roomIsValid) {
                // Free/guest accounts are capped at one room, so creating one
                // unconditionally fails with 402 for anybody who already has
                // one. Adopt an existing room first and only create when the
                // account genuinely has none.
                const existingRooms = (await dddiceApi.room.list())?.data ?? [];

                if (existingRooms.length > 0) {
                    this.plugin.settings.dddice.room = existingRooms[0].slug;
                    console.log(`dddice: Reusing existing room '${existingRooms[0].slug}'.`);
                } else {
                    const newRoom = (await dddiceApi.room.create())?.data;
                    if (newRoom && newRoom.slug) {
                        this.plugin.settings.dddice.room = newRoom.slug;
                        console.log(`dddice: Created and selected new room '${newRoom.slug}'.`);
                    } else {
                        throw new Error('Failed to create a new dddice room.');
                    }
                }
            }

            // Only the first page of themes is needed here: the cached list feeds
            // the settings dropdowns (and is stripped by saveSettings anyway),
            // while rolling only ever needs the selected theme *id*. Crawling
            // every page blocked activation for seconds on accounts with many
            // themes, so the rest is loaded lazily by the settings tab.
            const [rooms, firstThemePage] = await Promise.all([
                dddice.fetchDddiceRooms(dddiceApi),
                dddice.fetchDddiceThemesPage(dddiceApi, true),
            ]);

            const themes = firstThemePage.themes;
            this.plugin.settings.dddice.rooms = rooms.map((r) => ({ slug: r.slug, name: r.name }));
            this.plugin.settings.dddice.themes = themes;

            if (themes.length > 0) {
                if (!this.plugin.settings.dddice.theme) this.plugin.settings.dddice.theme = themes[0].id;
                if (!this.plugin.settings.dddice.hopeTheme) this.plugin.settings.dddice.hopeTheme = themes[0].id;
                if (!this.plugin.settings.dddice.fearTheme) this.plugin.settings.dddice.fearTheme = themes[0].id;
            }

            await this.plugin.saveSettings();
            this.plugin.initializeDddiceIfNeeded();

            if (this.plugin.settingsTab) {
                // Rooms are complete, so keep that cache warm. The theme cache is
                // deliberately left cold: the settings tab fills in the remaining
                // pages in the background, after this modal has already closed.
                this.plugin.settingsTab.dddiceRoomsCacheTimestamp = Date.now();
                this.plugin.settingsTab.display();
            }

            new Notice('Successfully connected to dddice!');
            this.close();
        } catch (error: any) {
            // Surface the server's own message; a bare "please try again" made
            // these failures impossible to diagnose from the UI.
            const status = error?.response?.status;
            const serverMsg = error?.response?.data?.data?.message ?? error?.response?.data?.message;
            const detail = [status && `HTTP ${status}`, serverMsg ?? error?.message].filter(Boolean).join(' — ');
            console.error('Error handling activation success:', status, error?.response?.data ?? error, error);
            new Notice(`Error setting up dddice${detail ? `: ${detail}` : '.'}`, 10000);
            // Restore the whole previous connection, not just the key. The room
            // is cleared mid-flight during validation, so persisting a partial
            // failure left the next attempt with no room to fall back on.
            this.plugin.settings.dddice.apiKey = previousApiKey;
            this.plugin.settings.dddice.room = previousRoom;
            this.plugin.settings.diceProvider = previousProvider;
            await this.plugin.saveSettings();
        }
    }

    private async continueAsGuest() {
        try {
            const guestButtonEl = this.contentEl.querySelector(
                '.dddice-guest-button-container .setting-item-control button',
            );
            if (guestButtonEl) {
                guestButtonEl.textContent = 'Connecting...';
                guestButtonEl.setAttribute('disabled', 'true');
            }

            // ThreeDDiceAPI writes the Authorization header into axios' *global*
            // defaults and only ever sets it when a key is truthy, so constructing
            // with `undefined` leaves any previously-set Bearer token in place.
            // Guest creation would then be attributed to the stale account instead
            // of minting a new one, so clear the key explicitly.
            const api = new ThreeDDiceAPI(undefined, 'Daggerheart-Obsidian-Plugin');
            // The `apiKey` setter is public at runtime but typed `private` in the
            // shipped .d.ts, so this cast is required to reach it.
            (api as unknown as { apiKey: string | undefined }).apiKey = undefined;
            const guestData = await api.user.guest();

            if (guestData && guestData.data) {
                await this.handleActivationSuccess(guestData.data);
            } else {
                throw new Error('Failed to create guest account');
            }
        } catch (error) {
            console.error('Error creating guest account:', error);
            new Notice('Failed to create guest account. Please try again.');
        }
    }

    onClose() {
        const { contentEl } = this;
        this.stopPolling();
        contentEl.empty();
    }
}
