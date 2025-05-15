import { Plugin, Editor, Notice, requestUrl, MarkdownView, TFile } from "obsidian";
import {
  LinkFormatterSettings,
  DEFAULT_SETTINGS,
  LinkFormatterSettingTab,
} from "./settings";


/**
 * Creates a YouTube timestamp from a given URL.
 * @param url - The URL to fetch the timestamp from.
 * @returns The YouTube timestamp as a number.
 */
function getYouTubeTimestamp(url: URL): number {
  let timestamp =
    url.searchParams.get("t") || url.searchParams.get("time_continue") || "";
  timestamp = timestamp.replace("s", "");
  return Number(timestamp);
}

/**
 * Fetches the page title from a given URL.
 * @param url - The URL to fetch the title from.
 * @returns The page title as a string.
 */
async function getPageTitle(url: string): Promise<string> {
  try {
    const response = await requestUrl(url);
    const text = response.text;
    const doc = new DOMParser().parseFromString(text, "text/html");
    const title = doc.querySelector("title");
    return escapeMarkdownChars(title?.innerText || url);
  } catch (error) {
    console.error(`Failed to fetch page title for ${url}:`, error);
    return url;
  }
}

/**
 * Formats a date string to a more readable format (YYYY/MM/DD).
 * @param dateStr - The date string to format.
 * @returns The formatted date string.
 */
function formatDate(dateStr: string): string {
  if (dateStr.match(/^\d{8}$/)) {
    return `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(
      6,
      8
    )}`;
  }
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return (
        date.getFullYear() +
        "/" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(date.getDate()).padStart(2, "0")
      );
    }
  } catch (e) {
    console.error("Failed to parse date:", e);
  }
  return dateStr;
}

/**
 * Formats a duration in seconds to a more readable format (HH:MM:SS).
 * @param totalSeconds - The duration in seconds.
 * @returns The formatted duration string.
 */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(hours.toString());
  parts.push(minutes.toString().padStart(hours > 0 ? 2 : 1, '0'));
  parts.push(seconds.toString().padStart(2, '0'));

  return parts.join(':');
}

/**
 * Escapes special characters in a string to be used in Markdown.
 * @param text - The string to escape.
 * @returns The escaped string.
 */
function escapeMarkdownChars(text: string): string {
  return text.replace(/([[\]|*_`\\])/g, "\\$1");
}

/**
 * Generates a unique placeholder token.
 * @returns The unique placeholder token.
 */
function generateUniqueToken(): string {
  const id = `link-placeholder-${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  return `<span class="link-loading" id="${id}">Loading...</span>`; 
}

/**
 * Fetches YouTube metadata from a given URL.
 * @param url - The URL to fetch the metadata from.
 * @returns The YouTube metadata as a record of strings.
 */
async function fetchYouTubeMetadata(url: string): Promise<Record<string, string | undefined>> {
  try {
    const response = await requestUrl({ url: url, method: 'GET' });
    const html = response.text;

    // Try to find the ytInitialPlayerResponse
    let playerResponseJson: any = null;
    try {
        const match = html.match(/var ytInitialPlayerResponse = ({.*?});/);
        if (match && match[1]) {
            playerResponseJson = JSON.parse(match[1]);
        } else {
             const dataMatch = html.match(/var ytInitialData = ({.*?});/);
             if (dataMatch && dataMatch[1]) {
                  playerResponseJson = JSON.parse(dataMatch[1]);
             } else {
                 console.warn("Could not find ytInitialPlayerResponse or ytInitialData in HTML.");
             }
        }
    } catch (parseError) {
         console.error("Failed to parse YouTube JSON data:", parseError);
         playerResponseJson = null;
    }

    if (playerResponseJson) {
      const videoDetails = playerResponseJson.videoDetails;
      const microformat = playerResponseJson.microformat?.playerMicroformatRenderer;

      if (videoDetails || microformat) {
          const title = videoDetails?.title || microformat?.title?.simpleText;
          const uploader = videoDetails?.author || microformat?.ownerChannelName?.simpleText;
          const description = videoDetails?.shortDescription || microformat?.description?.simpleText;
          const views = videoDetails?.viewCount;
          const durationSeconds = videoDetails?.lengthSeconds;
          const uploadDate = microformat?.publishDate;

          return {
              title: title,
              uploader: uploader,
              channel: uploader,
              description: description, 
              views: views ? parseInt(views).toLocaleString() : undefined,
              duration: durationSeconds ? formatDuration(parseInt(durationSeconds)) : undefined,
              upload_date: uploadDate ? formatDate(uploadDate.replace(/-/g, '')) : undefined,
          };
      } else {
           console.warn("Could not find videoDetails or microformat in JSON data.");
      }
    }

  } catch (error) {
    console.error(`Failed to fetch or parse YouTube metadata for ${url}:`, error);
    new Notice("Failed to fetch YouTube data.", 3000);
  }

  // Fallback
  return {
      title: url,
      uploader: undefined,
      channel: undefined,
      description: undefined,
      views: undefined,
  };
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

    this.registerMarkdownPostProcessor((el) => {
      el.querySelectorAll('.link-loading').forEach((loadingEl) => {
        loadingEl.addClass('link-loading');
      });
    });
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
    if (!activeFile) return; // Should not happen in editor paste, but safety check

    // --- Context Check ---
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
    // --- End Context Check ---

    evt.preventDefault();

    const placeholder = generateUniqueToken();
    
    const selectionStartCursor = editor.getCursor('from');
    const startOffset = editor.posToOffset(selectionStartCursor); 

    editor.replaceSelection(placeholder); 
    
    const placeholderStartPos = editor.offsetToPos(startOffset);
    const placeholderEndPos = editor.offsetToPos(startOffset + placeholder.length);
    
    editor.setCursor(placeholderEndPos);

    // --- Blacklist Check ---
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
      // YouTube
      if (clipboardText.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/)) {
        const metadata = await fetchYouTubeMetadata(clipboardText);

        const urlObj = new URL(clipboardText);
        const seconds = getYouTubeTimestamp(urlObj);
        let timestampStr = "";
        if (seconds) {
           const hours = Math.floor(seconds / 3600);
           const mins = Math.floor((seconds % 3600) / 60);
           const secs = seconds % 60;
           timestampStr = hours > 0 
             ? `@${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
             : `@${mins}:${secs.toString().padStart(2, '0')}`;
        }

        let formattedText = this.settings.printCommand;

        formattedText = formattedText.replace('{title}', escapeMarkdownChars(metadata.title || ''));
        formattedText = formattedText.replace('{channel}', escapeMarkdownChars(metadata.channel || '')); 
        formattedText = formattedText.replace('{uploader}', escapeMarkdownChars(metadata.uploader || ''));
        formattedText = formattedText.replace('{description}', escapeMarkdownChars(metadata.description || ''));
        formattedText = formattedText.replace('{views}', metadata.views || '');
        formattedText = formattedText.replace('{duration}', metadata.duration || '');
        formattedText = formattedText.replace('{upload_date}', metadata.upload_date || '');

        formattedText = formattedText.replace('{url}', clipboardText);
        formattedText = formattedText.replace('{timestamp}', timestampStr);
        formattedText = formattedText.replace('{thumbnail}', ''); 

        const linkMatch = formattedText.match(/\[(.*?)\]/); // IMPORTANT: Single bracket is clipboardText
        let finalFormattedLink = formattedText;

        if (linkMatch && linkMatch[1]) {
          const linkContent = linkMatch[1];
          const firstBracketIndex = formattedText.indexOf(linkMatch[0]);
          const suffix = formattedText.slice(firstBracketIndex + linkMatch[0].length).trim();
           
          finalFormattedLink = `[${linkContent}](${clipboardText})${
            suffix ? " " + suffix : ""
          }`;
        } else {
           finalFormattedLink = `[${formattedText.trim()}](${clipboardText})`;
        }

         this.replacePlaceholder(activeFile, placeholder, finalFormattedLink, editor);
      } 

      //Other links
      else {
        const title = await getPageTitle(clipboardText);
        
        let formattedText = this.settings.defaultLinkFormat;
        formattedText = formattedText.replace('{title}', title);
        formattedText = formattedText.replace('{url}', clipboardText);

        const linkMatch = formattedText.match(/\[(.*?)\]/); // IMPORTANT: Single bracket is clipboardText
        let finalFormattedLink = "";

        if (linkMatch && linkMatch[1]) {
          const linkContent = linkMatch[1];
          const firstBracketIndex = formattedText.indexOf(linkMatch[0]);
          const suffix = formattedText
            .slice(firstBracketIndex + linkMatch[0].length)
            .trim();
          finalFormattedLink = `[${linkContent}](${clipboardText})${
            suffix ? " " + suffix : ""
          }`;
        } else {
          finalFormattedLink = `[${formattedText.trim()}](${clipboardText})`;
        }
        this.replacePlaceholder(
          activeFile,
          placeholder,
          finalFormattedLink,
          editor
        );
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
        const vaultContent = await this.app.vault.read(file);
        const editorContent = editor.getValue();

        // Prefer editor content for replacement if it contains the placeholder, 
        // as it's likely the most up-to-date. Otherwise, use vault content.
        if (editorContent.includes(placeholder)) {
            const startPos = editor.offsetToPos(editorContent.indexOf(placeholder));
            const endPos = editor.offsetToPos(editorContent.indexOf(placeholder) + placeholder.length);
            editor.replaceRange(newText, startPos, endPos);
        } else if (vaultContent.includes(placeholder)) {
            const newContent = vaultContent.replace(placeholder, newText);
            await this.app.vault.modify(file, newContent);
        } else {
             console.warn("Smart Link Formatter: Placeholder not found in editor or vault content.");
        }
    } catch (error) {
        console.error("Smart Link Formatter: Failed to replace placeholder.", error);
        new Notice("Error updating link in file.");
    }
  }
}
