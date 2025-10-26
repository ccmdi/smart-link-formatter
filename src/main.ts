import { Plugin, Editor, Notice } from "obsidian";
import {
  LinkFormatterSettings,
  DEFAULT_SETTINGS,
  LinkFormatterSettingTab,
} from "./settings";
import { CLIENTS } from "clients";
import { generateUniqueToken } from "title-utils";
import { isLink, extractUrlAtCursor } from "utils";
import { FailureMode } from "types/failure-mode";
import { MarkdownView } from "obsidian"

const BUFFER = '\u200B';
const generatePlaceholder = (placeholder: string) => { return placeholder + BUFFER }
const placeholderPattern = /<span class="link-loading" id="(link-placeholder-[^"]+)"(?:\s+url="([^"]*)")?>Loading\.\.\.<\/span>(?:\u200B+)?/g; //todo


export default class SmartLinkFormatterPlugin extends Plugin {
  settings: LinkFormatterSettings;
  private activePlaceholders: Set<string> = new Set();

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

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) {
          this.cleanupOrphanedPlaceholders();
        }
      })
    );

    this.addCommand({
      id: 'format-link-at-cursor',
      name: 'Format link at cursor',
      editorCallback: (editor: Editor) => {
        this.formatLinkAtCursor(editor);
      }
    });

    this.cleanupOrphanedPlaceholders();
  }

  private cleanupOrphanedPlaceholders() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.editor) return;

    const editor = activeView.editor;
    const content = editor.getValue();

    const matches = content.matchAll(placeholderPattern);
    const orphanedMatches: Array<{ match: RegExpMatchArray; index: number }> = [];

    for (const match of matches) {
      const fullMatch = match[0];

      if (!this.activePlaceholders.has(fullMatch) && match.index !== undefined) {
        orphanedMatches.push({ match, index: match.index });
      }
    }

    if (orphanedMatches.length === 0) return;

    for (let i = orphanedMatches.length - 1; i >= 0; i--) {
      const { match, index } = orphanedMatches[i];
      const fullMatch = match[0];
      const placeholderId = match[1];
      const url = match[2] || '';

      const inactivePlaceholder = `<span class="link-loading-inactive" id="${placeholderId}" url="${url}">Failed to resolve</span>`;
      const startPos = editor.offsetToPos(index);
      const endPos = editor.offsetToPos(index + fullMatch.length);
      editor.replaceRange(inactivePlaceholder, startPos, endPos);
    }
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
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    if (this.shouldOverride(editor)) return;
    if (!this.shouldReplace(editor, clipboardText)) return;
    if (this.isBlacklisted(clipboardText)) return;
    evt.preventDefault();

    this.handleFormat(clipboardText, editor);
  }

  private async handleFormat(clipboardText: string, editor: Editor) {
    const token = generateUniqueToken(clipboardText);
    const placeholder = generatePlaceholder(token);
    this.activePlaceholders.add(placeholder);

    editor.replaceSelection(placeholder);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), this.settings.timeoutSeconds * 1000)
    );

    let didReplace = false;

    try {
      const client = CLIENTS.find(client => client.matches(clipboardText));
      if (client) {
        const metadata = await Promise.race([
          client.fetchMetadata(clipboardText),
          timeoutPromise
        ]) as Record<string, string | undefined>;
        
        const formattedText = client.format(metadata, clipboardText, this);
        
        didReplace = this.replacePlaceholder(placeholder, formattedText, editor);
      } else {
        throw new Error("No client found for link");
      }
    } catch (error) {
      console.error("Failed to format link:", error);
      new Notice("Failed to format link");

      const failureText = FailureMode.format(this.settings.failureMode, clipboardText);
      didReplace = this.replacePlaceholder(placeholder, failureText, editor);
    }

    if (!didReplace) {
      this.cleanupOrphanedPlaceholders();
    }
  }
  
  private shouldReplace(editor: Editor, text: string): boolean {
    //todo: rules for settings
    if (!isLink(text)) return false;

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    
    if (editor.somethingSelected()) {
        return true;
    }
    
    // Check if pasting inside the parentheses of a markdown link: [...](|)
    const textBeforeCursor = line.substring(0, cursor.ch);
    const charAfterCursor = cursor.ch < line.length ? line[cursor.ch] : '';
    
    const potentialLinkMatch = textBeforeCursor.match(/\[.*?\]\($/);
    if (potentialLinkMatch && charAfterCursor === ')') {
        return false;
    }

    // Check if cursor is inside inline code (between backticks)
    const backticksBefore = (textBeforeCursor.match(/`/g) || []).length;
    if (backticksBefore % 2 === 1) {
        return false;
    }

    // Check if pasting adjacent to inline code backticks
    const charBeforeCursor = cursor.ch > 0 ? line[cursor.ch - 1] : '';
    if (charBeforeCursor === '`' || charAfterCursor === '`') {
        return false;
    }

    // Check if inside a code block
    const allLines = editor.getValue().split('\n');
    let inCodeBlock = false;
    for (let i = 0; i < cursor.line; i++) {
        const trimmedLine = allLines[i].trim();
        if (trimmedLine.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }
    }
    if (inCodeBlock) {
        return false;
    }

    // Check if inside YAML frontmatter
    if (cursor.line === 0 && line.trim() === '---') {
        return false;
    }
    if (cursor.line > 0) {
        let inFrontmatter = false;
        if (allLines[0].trim() === '---') {
            inFrontmatter = true;
            for (let i = 1; i <= cursor.line; i++) {
                if (allLines[i].trim() === '---') {
                    inFrontmatter = false;
                    break;
                }
            }
        }
        if (inFrontmatter) {
            return false;
        }
    }

    // Check if inside HTML comment
    const fullTextBeforeCursor = allLines.slice(0, cursor.line).join('\n') + '\n' + textBeforeCursor;
    const openComments = (fullTextBeforeCursor.match(/<!--/g) || []).length;
    const closeComments = (fullTextBeforeCursor.match(/-->/g) || []).length;
    if (openComments > closeComments) {
        return false;
    }

    return true;
  }

  private shouldOverride(editor: Editor): boolean {
    if (this.settings.pasteIntoSelection && editor.somethingSelected()) {
      return true;
    }
    return false;
  }

  private isBlacklisted(text: string): boolean {
    try {
      const url = new URL(text);
      const blacklist = this.settings.blacklistedDomains
        .split(",")
        .map((domain) => domain.trim())
        .filter((domain) => domain.length > 0);
      if (blacklist.some((domain) => url.hostname.includes(domain))) {
        return true;
      }
    } catch (e) {
      console.error("Failed to parse URL for blacklist check:", e);
      return true;
    }

    return false;
  }

   /** 
   * Replaces the placeholder with the final text.
   * @param file - The file to replace the placeholder in.
   * @param placeholder - The placeholder to replace.
   * @param newText - The new text to replace the placeholder with.
   * @param editor - The editor to replace the placeholder in.
   */
  private replacePlaceholder(
    placeholder: string,
    newText: string,
    editor: Editor
  ): boolean {
    let didReplace = false;

    try {
        const editorContent = editor.getValue();
        
        if (editorContent.includes(placeholder)) {
            const startPos = editor.offsetToPos(editorContent.indexOf(placeholder));
            const endPos = editor.offsetToPos(editorContent.indexOf(placeholder) + placeholder.length);
            editor.replaceRange(newText, startPos, endPos);
            didReplace = true;
        } else {
             console.warn("Smart Link Formatter: Placeholder not found in editor content.");
             didReplace = false;
        }
    } catch (error) {
        console.error("Smart Link Formatter: Failed to replace placeholder.", error);
        new Notice("Error updating link in file.");
        didReplace = false;
    }
    
    this.activePlaceholders.delete(placeholder);
    return didReplace;
  }

  /**
   * Formats a URL at the cursor position by fetching its title and replacing it with a formatted link.
   * @param editor - The editor to format the link in.
   */
  async formatLinkAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    const urlInfo = extractUrlAtCursor(line, cursor.ch);
    if (!urlInfo) {
      new Notice("No URL found at cursor position");
      return;
    }

    const { url, start, end } = urlInfo;

    if (this.isBlacklisted(url)) {
      new Notice("URL is in blacklisted domains");
      return;
    }

    const startPos = { line: cursor.line, ch: start };
    const endPos = { line: cursor.line, ch: end };
    editor.setSelection(startPos, endPos);

    this.handleFormat(url, editor);
  }
}
