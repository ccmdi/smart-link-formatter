import { Extraction } from "types/extraction";

/**
 * Escapes special characters in a string to be used in Markdown.
 * @param text - The string to escape.
 * @returns The escaped string.
 */
export function escapeMarkdownChars(text: string): string {
  return text.replace(/([\[\]|*_`\\])/g, "\\$1");
}

export function unescapeHtml(text: string): string {
  const map = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'"
  };
  return text
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => map[m as keyof typeof map])
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function isLink(text: string): boolean {
  return !!text.match(/^https?:\/\//)
}

/**
 * Extracts a markdown link at the cursor position.
 * @param line - The line of text.
 * @param cursorCh - The cursor position in the line.
 * @returns Extraction object if cursor is within a markdown link, null otherwise.
 */
function extractMarkdownLink(line: string, cursorCh: number): Extraction | null {
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkRegex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (cursorCh >= start && cursorCh <= end) {
      return {
        url: match[2],
        start,
        end
      };
    }
  }

  return null;
}

/**
 * Extracts a plain URL at the cursor position.
 * @param line - The line of text.
 * @param cursorCh - The cursor position in the line.
 * @returns Extraction object if cursor is within a URL, null otherwise.
 */
function extractPlainUrl(line: string, cursorCh: number): Extraction | null {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (cursorCh >= start && cursorCh <= end) {
      return {
        url: match[0],
        start,
        end
      };
    }
  }

  return null;
}

/**
 * Extracts a URL at the cursor position in a line of text.
 * If the URL is inside an existing markdown link, returns the entire link for replacement.
 * @param line - The line of text.
 * @param cursorCh - The cursor position in the line.
 * @returns An object with the URL, start position, and end position, or null if no URL found.
 */
export function extractUrlAtCursor(line: string, cursorCh: number): Extraction | null {
  return extractMarkdownLink(line, cursorCh) 
  ?? extractPlainUrl(line, cursorCh);
}

/**
 * Formats a date string to a more readable format (YYYY/MM/DD).
 * @param dateStr - The date string to format.
 * @returns The formatted date string.
 */
export function formatDate(dateStr: string): string {
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
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(hours.toString());
  parts.push(minutes.toString().padStart(hours > 0 ? 2 : 1, "0"));
  parts.push(seconds.toString().padStart(2, "0"));

  return parts.join(":");
}
