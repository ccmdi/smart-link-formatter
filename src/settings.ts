import { App, PluginSettingTab, Setting } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { CLIENTS, ClientName } from "clients";
import { FailureMode } from "types/failure-mode";

export interface TitleReplacement {
    pattern: string;      // Regex pattern to find
    replacement: string;  // String to replace with (empty for removal)
    enabled: boolean;     // Toggle to enable/disable without deleting
}

export interface LinkFormatterSettings {
    autoLink: boolean;
    pasteIntoSelection: boolean;
    failureMode: FailureMode;
    timeoutSeconds: number;
    blacklistedDomains: string;
    titleReplacements: TitleReplacement[];
    clientFormats: Partial<Record<ClientName, string>>; // Maps ClientName -> format template
}

export const DEFAULT_SETTINGS: LinkFormatterSettings = {
    autoLink: true,
    pasteIntoSelection: false,
    failureMode: FailureMode.Revert,
    timeoutSeconds: 10,
    blacklistedDomains: '',
    titleReplacements: [],
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

        //todo: consider 'formats'
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

        new Setting(containerEl)
            .setName('Fetch timeout')
            .setDesc('Maximum time (in seconds) to wait for page metadata. (3-60s)')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '3';
                text.inputEl.max = '60';
                text.inputEl.step = '1';

                text
                    .setPlaceholder('10')
                    .setValue(String(this.plugin.settings.timeoutSeconds))
                    .onChange(async (value) => {
                        const numValue = parseInt(value);
                        if (!isNaN(numValue) && numValue >= 3 && numValue <= 60) {
                            this.plugin.settings.timeoutSeconds = numValue;
                            await this.plugin.saveSettings();
                            text.inputEl.removeAttribute('aria-label');
                        } else {
                            text.inputEl.addClass('smart-link-formatter-invalid');
                        }
                    });
            });

        // Title replacements section
        containerEl.createEl('h3', { text: 'Replacements' });
        containerEl.createEl('p', {
            text: 'Apply regex find/replace transformations to links. Patterns are applied in order.',
            cls: 'setting-item-description'
        });

        // Display existing replacements
        this.plugin.settings.titleReplacements.forEach((replacement, index) => {
            const setting = new Setting(containerEl)
                .setClass('smart-link-formatter-replacement-setting');

            setting.addText(text => text
                .setPlaceholder('Regex pattern')
                .setValue(replacement.pattern)
                .onChange(async (value) => {
                    this.plugin.settings.titleReplacements[index].pattern = value;
                    await this.plugin.saveSettings();
                }));

            setting.controlEl.createSpan({ text: ' → ', cls: 'smart-link-formatter-arrow' });

            setting.addText(text => text
                .setPlaceholder('Replacement')
                .setValue(replacement.replacement)
                .onChange(async (value) => {
                    this.plugin.settings.titleReplacements[index].replacement = value;
                    await this.plugin.saveSettings();
                }));

            setting.addToggle(toggle => toggle
                .setValue(replacement.enabled)
                .setTooltip('Enable/disable this replacement')
                .onChange(async (value) => {
                    this.plugin.settings.titleReplacements[index].enabled = value;
                    await this.plugin.saveSettings();
                }));

            setting.addButton(button => button
                .setIcon('arrow-up')
                .setTooltip('Move up')
                .setDisabled(index === 0)
                .onClick(async () => {
                    const temp = this.plugin.settings.titleReplacements[index];
                    this.plugin.settings.titleReplacements[index] = this.plugin.settings.titleReplacements[index - 1];
                    this.plugin.settings.titleReplacements[index - 1] = temp;
                    await this.plugin.saveSettings();
                    this.display();
                }));

            setting.addButton(button => button
                .setIcon('arrow-down')
                .setTooltip('Move down')
                .setDisabled(index === this.plugin.settings.titleReplacements.length - 1)
                .onClick(async () => {
                    const temp = this.plugin.settings.titleReplacements[index];
                    this.plugin.settings.titleReplacements[index] = this.plugin.settings.titleReplacements[index + 1];
                    this.plugin.settings.titleReplacements[index + 1] = temp;
                    await this.plugin.saveSettings();
                    this.display();
                }));

            setting.addButton(button => button
                .setIcon('trash')
                .setTooltip('Delete replacement')
                .onClick(async () => {
                    this.plugin.settings.titleReplacements.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                }));
        });

        // Add new replacement button
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add replacement rule')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.titleReplacements.push({
                        pattern: '',
                        replacement: '',
                        enabled: true
                    });
                    await this.plugin.saveSettings();
                    this.display();
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
            .setDesc('Allows pasting a URL over selected text, which will allow other plugins or default behavior to handle it instead of auto-formatting.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pasteIntoSelection)
                .onChange(async (value) => {
                    this.plugin.settings.pasteIntoSelection = value;
                    await this.plugin.saveSettings();
                }));
    }
}