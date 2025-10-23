import { Plugin, Editor, Notice } from "obsidian";
import {
  LinkFormatterSettings,
  DEFAULT_SETTINGS,
  LinkFormatterSettingTab,
} from "./settings";
import { CLIENTS } from "clients";
import { generateUniqueToken } from "title-utils";
import { isLink } from "utils";
import { FailureMode } from "types/failure-mode";

const BUFFER = '\u200B';
const generatePlaceholder = (placeholder: string) => { return placeholder + BUFFER }
const TIMEOUT_MS = 10000


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
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    evt.preventDefault();
    if (!this.shouldReplace(editor, clipboardText)) return;

    const token = generateUniqueToken();
    const placeholder = generatePlaceholder(token);

    const selectionStartCursor = editor.getCursor('from');
    const startOffset = editor.posToOffset(selectionStartCursor); 
    editor.replaceSelection(placeholder + BUFFER); 
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

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Fetch timeout')), TIMEOUT_MS)
    );

    try {
      const client = CLIENTS.find(client => client.matches(clipboardText));
      if (client) {
        const metadata = await Promise.race([
          client.fetchMetadata(clipboardText),
          timeoutPromise
        ]) as Record<string, string | undefined>;
        
        const formattedText = client.format(metadata, clipboardText, this);
        
        this.replacePlaceholder(placeholder, formattedText, editor);
      } else {
        throw new Error("No client found for link");
      }
    } catch (error) {
      console.error("Failed to format link:", error);
      new Notice("Failed to format link");

      const failureText = FailureMode.format(this.settings.failureMode, clipboardText);
      this.replacePlaceholder(placeholder, failureText, editor);
    }
  }
  
  private shouldReplace(editor: Editor, text: string): boolean {
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
        editor.replaceSelection(text);
        return false;
    }

    // Check if cursor is inside inline code (between backticks)
    const backticksBefore = (textBeforeCursor.match(/`/g) || []).length;
    if (backticksBefore % 2 === 1) {
        editor.replaceSelection(text);
        return false;
    }

    // Check if pasting adjacent to inline code backticks
    const charBeforeCursor = cursor.ch > 0 ? line[cursor.ch - 1] : '';
    if (charBeforeCursor === '`' || charAfterCursor === '`') {
        editor.replaceSelection(text);
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
        editor.replaceSelection(text);
        return false;
    }

    // Check if inside YAML frontmatter
    if (cursor.line === 0 && line.trim() === '---') {
        editor.replaceSelection(text);
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
            editor.replaceSelection(text);
            return false;
        }
    }

    // Check if inside HTML comment
    const fullTextBeforeCursor = allLines.slice(0, cursor.line).join('\n') + '\n' + textBeforeCursor;
    const openComments = (fullTextBeforeCursor.match(/<!--/g) || []).length;
    const closeComments = (fullTextBeforeCursor.match(/-->/g) || []).length;
    if (openComments > closeComments) {
        editor.replaceSelection(text);
        return false;
    }

    return true;
  }

   /** 
   * Replaces the placeholder with the final text.
   * @param file - The file to replace the placeholder in.
   * @param placeholder - The placeholder to replace.
   * @param newText - The new text to replace the placeholder with.
   * @param editor - The editor to replace the placeholder in.
   */
  private async replacePlaceholder(
    placeholder: string,
    newText: string,
    editor: Editor
  ) {
    try {
        const editorContent = editor.getValue();
        
        if (editorContent.includes(placeholder)) {
            const startPos = editor.offsetToPos(editorContent.indexOf(placeholder));
            const endPos = editor.offsetToPos(editorContent.indexOf(placeholder) + placeholder.length);
            editor.replaceRange(newText, startPos, endPos);
        } else {
             console.warn("Smart Link Formatter: Placeholder not found in editor content.");
        }
    } catch (error) {
        console.error("Smart Link Formatter: Failed to replace placeholder.", error);
        new Notice("Error updating link in file.");
    }
  }
}
