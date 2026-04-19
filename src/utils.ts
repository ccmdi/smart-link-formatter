import { Extraction } from "types/extraction";
import { TitleReplacement } from "settings";

export const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
export const URL_REGEX = /https?:\/\/[^\s)]+/g;

/**
 * Escapes special characters in a string to be used in Markdown.
 * @param text - The string to escape.
 * @returns The escaped string.
 */
export function escapeMarkdownChars(text: string): string {
  return text.replace(/([\[\]|*_`\\])/g, "\\$1");
}

/**
 * Applies a list of regex replacements to text in sequence.
 * @param text - The text to transform
 * @param replacements - Array of find/replace patterns
 * @returns Transformed text
 */
export function applyTitleReplacements(text: string, replacements: TitleReplacement[]): string {
  let result = text;

  for (const { pattern, replacement, enabled } of replacements) {
    if (!enabled || !pattern) continue;

    try {
      const regex = new RegExp(pattern, 'g');
      result = result.replace(regex, replacement);
    } catch (e) {
      console.error(`Invalid replacement pattern "${pattern}":`, e);
    }
  }

  return result.trim();
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
 * Checks if a position is inside a protected context (code block, frontmatter, inline code, or HTML comment).
 * @param allLines - All lines of the document.
 * @param lineNum - The line number to check.
 * @param ch - The character position in the line.
 * @returns True if the position is in a protected context, false otherwise.
 */
export function isPositionProtected(allLines: string[], lineNum: number, ch: number): boolean {
  const line = allLines[lineNum];
  const textBefore = line.substring(0, ch);

  const backticksBefore = (textBefore.match(/`/g) || []).length;
  if (backticksBefore % 2 === 1) return true;

  const charBefore = ch > 0 ? line[ch - 1] : '';
  const charAfter = ch < line.length ? line[ch] : '';
  if (charBefore === '`' || charAfter === '`') return true;

  let inCodeBlock = false;
  for (let i = 0; i < lineNum; i++) {
    if (allLines[i].trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
  }
  if (inCodeBlock) return true;

  if (lineNum === 0 && line.trim() === '---') return true;
  if (lineNum > 0 && allLines[0].trim() === '---') {
    let inFrontmatter = true;
    for (let i = 1; i <= lineNum; i++) {
      if (allLines[i].trim() === '---') {
        inFrontmatter = false;
        break;
      }
    }
    if (inFrontmatter) return true;
  }

  const fullTextBefore = allLines.slice(0, lineNum).join('\n') + '\n' + textBefore;
  const openComments = (fullTextBefore.match(/<!--/g) || []).length;
  const closeComments = (fullTextBefore.match(/-->/g) || []).length;
  if (openComments > closeComments) return true;

  return false;
}

/**
 * Finds all plain URLs in the given line range that are not already inside markdown links or protected contexts.
 * @param allLines - All lines of the document.
 * @param startLine - The first line to scan (inclusive).
 * @param endLine - The last line to scan (inclusive).
 * @returns Array of URL matches with their positions.
 */
export function findUnformattedUrls(
  allLines: string[],
  startLine: number,
  endLine: number
): Array<{ url: string; line: number; start: number; end: number }> {
  URL_REGEX.lastIndex = 0;
  const results: Array<{ url: string; line: number; start: number; end: number }> = [];

  for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
    const line = allLines[lineNum];

    const markdownRanges: Array<{ start: number; end: number }> = [];
    MARKDOWN_LINK_REGEX.lastIndex = 0;
    let mdMatch;
    while ((mdMatch = MARKDOWN_LINK_REGEX.exec(line)) !== null) {
      markdownRanges.push({ start: mdMatch.index, end: mdMatch.index + mdMatch[0].length });
    }

    URL_REGEX.lastIndex = 0;
    let urlMatch;
    while ((urlMatch = URL_REGEX.exec(line)) !== null) {
      const start = urlMatch.index;
      const end = start + urlMatch[0].length;

      if (markdownRanges.some(r => start >= r.start && end <= r.end)) continue;
      if (isPositionProtected(allLines, lineNum, start)) continue;

      results.push({ url: urlMatch[0], line: lineNum, start, end });
    }
  }

  return results;
}

/**
 * Extracts a markdown link at the cursor position.
 * @param line - The line of text.
 * @param cursorCh - The cursor position in the line.
 * @returns Extraction object if cursor is within a markdown link, null otherwise.
 */
function extractMarkdownLink(line: string, cursorCh: number): Extraction | null {
  MARKDOWN_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MARKDOWN_LINK_REGEX.exec(line)) !== null) {
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
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_REGEX.exec(line)) !== null) {
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
