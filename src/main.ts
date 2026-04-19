import { Plugin, Editor, Notice } from "obsidian";
import {
  LinkFormatterSettings,
  DEFAULT_SETTINGS,
  LinkFormatterSettingTab,
} from "./settings";
import { CLIENTS } from "clients";
import { generateUniqueToken } from "title-utils";
import { isLink, extractUrlAtCursor, unescapeHtml, isPositionProtected, findUnformattedUrls } from "utils";
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

    this.addCommand({
      id: 'format-all-links',
      name: 'Format all links',
      editorCallback: (editor: Editor) => {
        this.formatAllLinks(editor);
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
        
        const formattedText = unescapeHtml(
          client.format(metadata, clipboardText, this)
        );
        
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
    if (!isLink(text)) return false;

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    if (editor.somethingSelected()) {
        return true;
    }

    const textBeforeCursor = line.substring(0, cursor.ch);
    const charAfterCursor = cursor.ch < line.length ? line[cursor.ch] : '';

    const potentialLinkMatch = textBeforeCursor.match(/\[.*?\]\($/);
    if (potentialLinkMatch && charAfterCursor === ')') {
        return false;
    }

    const allLines = editor.getValue().split('\n');
    return !isPositionProtected(allLines, cursor.line, cursor.ch);
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
            // Fallback: placeholder was removed/modified, insert at current cursor position
            console.warn("Smart Link Formatter: Placeholder not found, inserting at cursor position.");
            editor.replaceSelection(newText);
            didReplace = true;
        }
    } catch (error) {
        console.error("Smart Link Formatter: Failed to replace placeholder.", error);
        new Notice("Error updating link in file.");
        didReplace = false;
    }

    this.activePlaceholders.delete(placeholder);
    return didReplace;
  }

  private formatAllLinks(editor: Editor) {
    const hasSelection = editor.somethingSelected();
    const allLines = editor.getValue().split('\n');

    let startLine: number, endLine: number;
    if (hasSelection) {
      startLine = editor.getCursor('from').line;
      endLine = editor.getCursor('to').line;
    } else {
      startLine = 0;
      endLine = allLines.length - 1;
    }

    const urls = findUnformattedUrls(allLines, startLine, endLine)
      .filter(u => !this.isBlacklisted(u.url));

    if (urls.length === 0) {
      new Notice("No unformatted links found");
      return;
    }

    new Notice(`Formatting ${urls.length} link${urls.length > 1 ? 's' : ''}...`);

    for (const { url, line, start, end } of urls.reverse()) {
      editor.setSelection({ line, ch: start }, { line, ch: end });
      this.handleFormat(url, editor);
    }
  }

  async formatLinkAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    const extraction = extractUrlAtCursor(line, cursor.ch);
    if (!extraction) {
      new Notice("No URL found at cursor position");
      return;
    }

    const { url, start, end } = extraction;

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
