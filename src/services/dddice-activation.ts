import { Modal, Setting, Notice } from 'obsidian';
import { ThreeDDiceAPI } from 'dddice-js';
import DaggerheartStatblockPlugin from 'main';
import * as dddice from './dddice-service';

export class DddiceActivationModal extends Modal {
    private plugin: DaggerheartStatblockPlugin;
    private activationCode: string = '';
    private expiresAt: Date = new Date();
    private pollingInterval: NodeJS.Timeout | null = null;
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

        const instructionsEl = contentEl.createEl('div', { cls: 'dddice-instructions' });
        instructionsEl.createEl('p', { text: 'Click this link to connect:' });
        const linkEl = instructionsEl.createEl('a', {
            text: 'dddice.com/activate',
            href: 'https://dddice.com/activate',
            attr: { target: '_blank' }
        });
        linkEl.addClass('dddice-link');

        instructionsEl.createEl('p', { text: 'The code will be pre-filled for you:' });

        this.codeDisplayEl = instructionsEl.createEl('div', { cls: 'dddice-code-container' });
        this.renderLoadingCode();

        this.timerEl = instructionsEl.createEl('div', { cls: 'dddice-timer' });

        const separatorEl = contentEl.createEl('div', { cls: 'dddice-separator' });
        separatorEl.createEl('span', { text: 'OR' });

        const guestButtonEl = contentEl.createEl('div', { cls: 'dddice-guest-button-container' });
        const guestButton = new Setting(guestButtonEl)
            .addButton(button => button
                .setButtonText('Continue as Guest')
                .onClick(async () => {
                    await this.continueAsGuest();
                }));

        // Initialize the activation process
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

    private async generateActivationCode(): Promise<{ code: string, secret: string, expires_at: string }> {
        const response = await fetch('https://dddice.com/api/1.0/activate', {
            method: 'POST'
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
            // Update timer element to show polling status
            if (this.timerEl) {
                const timerText = this.timerEl.textContent || '';
                if (!timerText.includes('Checking for activation')) {
                    this.timerEl.textContent = `${timerText} - Checking for activation...`;
                }
            }

            const response = await fetch(`https://dddice.com/api/1.0/activate/${this.activationCode}`, {
                headers: {
                    'Authorization': `Secret ${this.secret}`
                }
            });

            if (!response.ok) {
                return; // Continue polling
            }

            const data = await response.json();

            if (data.data && data.data.token) {
                // We got a token!
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
        try {
            // Show loading state in the modal
            const loadingEl = this.contentEl.createEl('div', {
                cls: 'dddice-loading',
                text: 'Setting up dddice...'
            });
            loadingEl.style.textAlign = 'center';
            loadingEl.style.marginTop = '20px';
            loadingEl.style.fontWeight = 'bold';

            // Save the API key
            this.plugin.settings.dddice.apiKey = apiKey;

            // Fetch rooms and themes
            const dddiceApi = dddice.initializeDddiceApi(apiKey);
            const [rooms, themes] = await Promise.all([
                dddice.fetchDddiceRooms(dddiceApi),
                dddice.fetchDddiceThemes(dddiceApi)
            ]);

            // Cache rooms and themes temporarily in memory for immediate use
            this.plugin.settings.dddice.rooms = rooms.map(r => ({ slug: r.slug, name: r.name }));
            this.plugin.settings.dddice.themes = themes;

            // Verify if the current room selection is still valid
            if (!rooms.some(r => r.slug === this.plugin.settings.dddice.room)) {
                this.plugin.settings.dddice.room = null;
            }

            // Set default values if needed
            if (rooms.length > 0 && !this.plugin.settings.dddice.room) {
                this.plugin.settings.dddice.room = rooms[0].slug;
            }

            if (themes.length > 0) {
                if (!this.plugin.settings.dddice.theme) {
                    this.plugin.settings.dddice.theme = themes[0].id;
                }
                if (!this.plugin.settings.dddice.hopeTheme) {
                    this.plugin.settings.dddice.hopeTheme = themes[0].id;
                }
                if (!this.plugin.settings.dddice.fearTheme) {
                    this.plugin.settings.dddice.fearTheme = themes[0].id;
                }
            }

            // Enable dddice as the dice provider
            this.plugin.settings.diceProvider = 'dddice';            // Save settings and reinitialize dddice
            await this.plugin.saveSettings();

            // Reinitialize the dddice renderer
            this.plugin.initializeDddiceIfNeeded();

            // Refresh the settings tab if available
            if (this.plugin.settingsTab) {
                this.plugin.settingsTab.display();
            }

            new Notice('Successfully connected to dddice!');
            this.close();
        } catch (error) {
            console.error('Error handling activation success:', error);
            new Notice('Error setting up dddice. Please try again.');
        }
    }

    private async continueAsGuest() {
        try {
            const guestButtonEl = this.contentEl.querySelector('.dddice-guest-button-container .setting-item-control button');
            if (guestButtonEl) {
                guestButtonEl.textContent = 'Connecting...';
                guestButtonEl.setAttribute('disabled', 'true');
            }

            const api = new ThreeDDiceAPI(undefined, 'Daggerheart-Obsidian-Plugin');
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
