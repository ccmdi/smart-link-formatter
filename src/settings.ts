import { App, PluginSettingTab, Setting } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { CLIENTS, ClientName } from "clients";
import { FailureMode } from "types/failure-mode"

export interface LinkFormatterSettings {
    autoLink: boolean;
    pasteIntoSelection: boolean;
    failureMode: FailureMode;
    blacklistedDomains: string;
    clientFormats: Partial<Record<ClientName, string>>; // Maps ClientName -> format template
}

export const DEFAULT_SETTINGS: LinkFormatterSettings = {
    autoLink: true,
    pasteIntoSelection: false,
    failureMode: FailureMode.Revert,
    blacklistedDomains: '',
    clientFormats: {}
};
export class LinkFormatterSettingTab extends PluginSettingTab {
    plugin: SmartLinkFormatterPlugin;
    private activeSection: 'general' | 'clients' | 'overrides' = 'general';

    constructor(app: App, plugin: SmartLinkFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        const navContainer = containerEl.createDiv('smart-link-formatter-nav');

        const generalTab = navContainer.createEl('button', {
            text: 'General',
            cls: this.activeSection === 'general' ? 'smart-link-formatter-tab-active' : ''
        });
        generalTab.onclick = () => {
            this.activeSection = 'general';
            this.display();
        };

        const clientsTab = navContainer.createEl('button', {
            text: 'Clients',
            cls: this.activeSection === 'clients' ? 'smart-link-formatter-tab-active' : ''
        });
        clientsTab.onclick = () => {
            this.activeSection = 'clients';
            this.display();
        };

        const overridesTab = navContainer.createEl('button', {
            text: 'Overrides',
            cls: this.activeSection === 'overrides' ? 'smart-link-formatter-tab-active' : ''
        });
        overridesTab.onclick = () => {
            this.activeSection = 'overrides';
            this.display();
        };

        // Add some spacing
        containerEl.createEl('div', { cls: 'smart-link-formatter-section-divider' });

        // Display content based on active section
        if (this.activeSection === 'general') {
            this.displayGeneralSettings(containerEl);
        } else if (this.activeSection === 'clients') {
            this.displayClientSettings(containerEl);
        } else if (this.activeSection === 'overrides') {
            this.displayOverrideSettings(containerEl);
        }
    }

    private displayGeneralSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Auto-linking')
            .setDesc('Automatically format links when pasting URLs, except when overriden.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoLink)
                .onChange(async (value) => {
                    this.plugin.settings.autoLink = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Failure mode')
            .setDesc('What to do when a link fails to fetch. "Revert" pastes the original URL. "Alert" shows [Failed to fetch title](url).')
            .addDropdown(dropdown => dropdown
                .addOption(FailureMode.Revert, 'Revert to plain URL')
                .addOption(FailureMode.Alert, 'Show failure message')
                .setValue(this.plugin.settings.failureMode)
                .onChange(async (value: FailureMode) => {
                    this.plugin.settings.failureMode = value;
                    await this.plugin.saveSettings();
                }));
    }

    private displayClientSettings(containerEl: HTMLElement): void {
        for (const client of CLIENTS) {
            const setting = new Setting(containerEl)
                .setName(`${client.displayName} link format`)
                .setClass('smart-link-formatter-tall-textarea-setting');

            setting.descEl.appendText('Available variables:');
            const ul = setting.descEl.createEl('ul');
            for (const v of client.getAvailableVariables()) {
                ul.createEl('li').createEl('code', { text: `{${v}}` });
            }
            const defaultTag = setting.descEl.createEl('span', { text: `Default: ` });
            defaultTag.createEl('code', { text: client.defaultFormat });

            setting.addTextArea(text => text
                .setPlaceholder(client.defaultFormat)
                .setValue(this.plugin.settings.clientFormats[client.name] || client.defaultFormat)
                .then(textArea => {
                    textArea.inputEl.rows = 2;
                    textArea.inputEl.addClass('smart-link-formatter-setting-textarea');
                })
                .onChange(async (value) => {
                    this.plugin.settings.clientFormats[client.name] = value;
                    await this.plugin.saveSettings();
                }));
        }
    }

    private displayOverrideSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Blacklisted domains')
            .setDesc('Comma-separated list of domains that should never be auto-formatted. URLs from these domains will be pasted as-is.')
            .addTextArea(text => text
                .setPlaceholder('example.com, test.org')
                .setValue(this.plugin.settings.blacklistedDomains)
                .then(textArea => {
                    textArea.inputEl.rows = 4;
                    textArea.inputEl.addClass('smart-link-formatter-setting-textarea');
                })
                .onChange(async (value) => {
                    this.plugin.settings.blacklistedDomains = value;
                    await this.plugin.saveSettings();
                }));
        

        new Setting(containerEl)
            .setName('Paste URL into selection')
            .setDesc('Allows pasting a URL over selected text will allow other plugins or default behavior to handle it, instead of auto-formatting.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pasteIntoSelection)
                .onChange(async (value) => {
                    this.plugin.settings.pasteIntoSelection = value;
                    await this.plugin.saveSettings();
                }));
    }
}