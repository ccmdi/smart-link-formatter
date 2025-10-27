import { Extraction } from "types/extraction";

/**
 * Escapes special characters in a string to be used in Markdown.
 * @param text - The string to escape.
 * @returns The escaped string.
 */
export function escapeMarkdownChars(text: string): string {
  return text.replace(/([\[\]|*_`\\])/g, "\\$1");
}

export function isLink(text: string): boolean {
  return !!text.match(/^https?:\/\//)
}

/**
 * Extracts a URL at the cursor position in a line of text.
 * If the URL is inside an existing markdown link, returns the entire link for replacement.
 * @param line - The line of text.
 * @param cursorCh - The cursor position in the line.
 * @returns An object with the URL, start position, and end position, or null if no URL found.
 */
export function extractUrlAtCursor(line: string, cursorCh: number): Extraction | null {
  // First check if cursor is inside a markdown link: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let mdMatch: RegExpExecArray | null;

  while ((mdMatch = markdownLinkRegex.exec(line)) !== null) {
    const linkStart = mdMatch.index;
    const linkEnd = linkStart + mdMatch[0].length;
    const urlInLink = mdMatch[2];

    // Check if cursor is anywhere within the markdown link
    if (cursorCh >= linkStart && cursorCh <= linkEnd) {
      return {
        url: urlInLink,
        start: linkStart,
        end: linkEnd
      };
    }
  }

  const urlRegex = /https?:\/\/[^\s)]+/g;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Check if cursor is within this URL
    if (cursorCh >= start && cursorCh <= end) {
      return {
        url: match[0],
        start: start,
        end: end
      };
    }
  }

  return null;
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
