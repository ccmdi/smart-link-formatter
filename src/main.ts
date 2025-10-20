import { Plugin, Editor, Notice, requestUrl, MarkdownView, TFile } from "obsidian";
import {
  LinkFormatterSettings,
  DEFAULT_SETTINGS,
  LinkFormatterSettingTab,
} from "./settings";
import { CLIENTS } from "clients";

/**
 * Generates a unique placeholder token.
 * @returns The unique placeholder token.
 */
function generateUniqueToken(): string {
  const id = `link-placeholder-${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  return `<span class="link-loading" id="${id}">Loading...</span>`; 
}
export default class SmartLinkFormatterPlugin extends Plugin {
  settings: LinkFormatterSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new LinkFormatterSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on(
        "editor-paste",
        (evt: ClipboardEvent, editor: Editor) => {
          this.handlePaste(evt, editor);
        }
      )
    );
  }


  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async handlePaste(evt: ClipboardEvent, editor: Editor) {
    if (!this.settings.autoLink) return;
    if (!evt.clipboardData) return;

    const clipboardText = evt.clipboardData.getData("text/plain");
    if (!clipboardText.match(/^https?:\/\//)) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    // Context check
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    
    // Check if pasting inside the parentheses of a markdown link: [...](|)
    // Matches if the text immediately before cursor is "](" and char after is ")"
    // Also check if there is a selection - if so, allow pasting over it
    if (!editor.somethingSelected()) {
        const potentialLinkMatch = line.substring(0, cursor.ch).match(/\[.*?\]\($/);
        if (potentialLinkMatch && line[cursor.ch] === ')') {
            evt.preventDefault();
            editor.replaceSelection(clipboardText);
            return;
        }

        // Check if pasting adjacent to inline code backticks: `|` or `|`
        const charBefore = cursor.ch > 0 ? line[cursor.ch - 1] : '';
        const charAfter = cursor.ch < line.length ? line[cursor.ch] : '';
        if (charBefore === '`' || charAfter === '`') {
            evt.preventDefault();
            editor.replaceSelection(clipboardText);
            return;
        }
    }

    evt.preventDefault();
    const placeholder = generateUniqueToken();
    const selectionStartCursor = editor.getCursor('from');
    const startOffset = editor.posToOffset(selectionStartCursor); 
    editor.replaceSelection(placeholder); 
    const placeholderStartPos = editor.offsetToPos(startOffset);
    const placeholderEndPos = editor.offsetToPos(startOffset + placeholder.length);
    editor.setCursor(placeholderEndPos);

    // Blacklist check
    try {
      const url = new URL(clipboardText);
      const blacklist = this.settings.blacklistedDomains
        .split(",")
        .map((domain) => domain.trim())
        .filter((domain) => domain.length > 0);
      if (blacklist.some((domain) => url.hostname.includes(domain))) {
        editor.replaceRange(clipboardText, placeholderStartPos, placeholderEndPos);
        return;
      }
    } catch (e) {
      console.error("Failed to parse URL for blacklist check:", e);
       editor.replaceRange(clipboardText, placeholderStartPos, placeholderEndPos);
      return;
    }

    try {
      const client = CLIENTS.find(client => client.matches(clipboardText));
      if (client) {
        const metadata = await client.fetchMetadata(clipboardText);
        const formattedText = client.format(metadata, clipboardText, this);
        
        this.replacePlaceholder(activeFile, placeholder, formattedText, editor);
      } else {
        throw new Error("No client found for link");
      }
    } catch (error) {
      console.error("Failed to format link:", error);
      new Notice("Failed to format link");
      const errorFormattedText = `[Failed to fetch title](${clipboardText})`;
      this.replacePlaceholder(activeFile, placeholder, errorFormattedText, editor);
    }
  }

   /** 
   * Replaces the placeholder with the final text.
   * @param file - The file to replace the placeholder in.
   * @param placeholder - The placeholder to replace.
   * @param newText - The new text to replace the placeholder with.
   * @param editor - The editor to replace the placeholder in.
   */
  private async replacePlaceholder(
    file: TFile,
    placeholder: string,
    newText: string,
    editor: Editor
  ) {
    try {
        const editorContent = editor.getValue();
        
        // Prefer editor content for replacement if it contains the placeholder, 
        // as it's likely the most up-to-date. Otherwise, use vault content.
        if (editorContent.includes(placeholder)) {
            const startPos = editor.offsetToPos(editorContent.indexOf(placeholder));
            const endPos = editor.offsetToPos(editorContent.indexOf(placeholder) + placeholder.length);
            editor.replaceRange(newText, startPos, endPos);
        } else {
             console.warn("Smart Link Formatter: Placeholder not found in editor or vault content.");
        }
    } catch (error) {
        console.error("Smart Link Formatter: Failed to replace placeholder.", error);
        new Notice("Error updating link in file.");
    }
  }
}