import { App, PluginSettingTab, Setting } from "obsidian";
import SmartLinkFormatterPlugin from "main";

export interface LinkFormatterSettings {
    printCommand: string;
    autoLink: boolean;
    blacklistedDomains: string;
    defaultLinkFormat: string;
}

export const DEFAULT_SETTINGS: LinkFormatterSettings = {
    printCommand: '[{title}] by {channel}',
    autoLink: true,
    blacklistedDomains: '',
    defaultLinkFormat: '[{title}]({link})',
};

export class LinkFormatterSettingTab extends PluginSettingTab {
    plugin: SmartLinkFormatterPlugin;

    constructor(app: App, plugin: SmartLinkFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Auto-linking')
            .setDesc('Automatically format links when pasting URLs. Disable this to paste URLs without formatting.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoLink)
                .onChange(async (value) => {
                    this.plugin.settings.autoLink = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Default link format')
            .setDesc('Format for non-YouTube links. Use {title} for page title and {link} for URL. Example: [{title}]')
            .addTextArea(text => text
                .setPlaceholder('[{title}]')
                .setValue(this.plugin.settings.defaultLinkFormat)
                .then(textArea => {
                    textArea.inputEl.rows = 2;
                    textArea.inputEl.addClass('smart-link-formatter-setting-textarea');
                })
                .onChange(async (value) => {
                    this.plugin.settings.defaultLinkFormat = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Blacklisted domains')
            .setDesc('Comma-separated list of domains that should never be auto-formatted. URLs from these domains will be pasted as-is.')
            .addTextArea(text => text
                .setPlaceholder('example.com, test.org')
                .setValue(this.plugin.settings.blacklistedDomains)
                .then(textArea => {
                    textArea.inputEl.rows = 2;
                    textArea.inputEl.addClass('smart-link-formatter-setting-textarea');
                })
                .onChange(async (value) => {
                    this.plugin.settings.blacklistedDomains = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('YouTube link format')
            .setDesc('Customize how YouTube links are formatted. Available variables: {title}, {channel}, {uploader}, {duration}, {views}, {upload_date}, {description}, {url}, {timestamp}. Example: [{title}] by {channel}')
            .addTextArea(text => text
                .setPlaceholder(DEFAULT_SETTINGS.printCommand)
                .setValue(this.plugin.settings.printCommand)
                .then(textArea => {
                    textArea.inputEl.rows = 4;
                    textArea.inputEl.cols = 50;
                    textArea.inputEl.addClass('smart-link-formatter-setting-textarea');
                })
                .onChange(async (value) => {
                    this.plugin.settings.printCommand = value;
                    await this.plugin.saveSettings();
                }));
    }
}