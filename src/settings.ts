import { App, PluginSettingTab, Setting } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { CLIENTS, ClientName } from "clients";

export interface LinkFormatterSettings {
    autoLink: boolean;
    blacklistedDomains: string;
    clientFormats: Partial<Record<ClientName, string>>; // Maps ClientName -> format template
}

export const DEFAULT_SETTINGS: LinkFormatterSettings = {
    autoLink: true,
    blacklistedDomains: '',
    clientFormats: {}
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
}