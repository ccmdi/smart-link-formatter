/**
 * Escapes special characters in a string to be used in Markdown.
 * @param text - The string to escape.
 * @returns The escaped string.
 */
export function escapeMarkdownChars(text: string): string {
    return text.replace(/([\[\]|*_`\\])/g, "\\$1");
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
    parts.push(minutes.toString().padStart(hours > 0 ? 2 : 1, '0'));
    parts.push(seconds.toString().padStart(2, '0'));
  
    return parts.join(':');
  }