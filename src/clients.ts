import { requestUrl } from "obsidian";
import { escapeMarkdownChars, formatDuration, formatDate } from "utils";
import { Notice } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { getPageTitle } from "title-utils";
import moment from "moment";

export interface Client {
  name: ClientName; // Unique identifier for the client
  displayName: string; // Human-readable name for settings UI
  defaultFormat: string; // Default format template with variables
  getAvailableVariables: () => string[]; // Returns list of available template variables
  fetchMetadata: (url: string) => Promise<Record<string, string | undefined>>;
  format: (
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ) => string;
  matches: (url: string) => boolean;
}

/**
 * Generic template formatter that automatically replaces variables in a template
 * based on the metadata object keys.
 * @param template - Template string with {variable} placeholders
 * @param metadata - Object containing variable values
 * @param url - The URL being formatted
 * @returns Formatted string with all variables replaced
 */
export function formatTemplate(
  template: string,
  metadata: Record<string, string | undefined>,
  url: string
): string {
  return template.replace(/{([^{}]+?)}/g, (match, key) => {
    const [variable, format] = key.split('|').map((s: string) => s.trim());

    if (variable === "url") {
      return url;
    }

    const value = metadata[variable];
    if (value === undefined) {
      return '';
    }

    const dateFields = ['upload_date'];
    if (format && dateFields.includes(variable) && moment(value).isValid()) {
      return moment(value).format(format);
    }

    return String(value);
  });
}

/**
 * Wraps formatted text in a markdown link.
 * If the text contains brackets like [{content}], it uses that as the link text.
 * Otherwise, it wraps the entire text as the link text.
 * @param formattedText - The formatted text from template
 * @param url - The URL to link to
 * @returns Final markdown link
 */
export function wrapInMarkdownLink(formattedText: string, url: string): string {
  const linkMatch = formattedText.match(/\[(.*?)\]/);
  if (linkMatch && linkMatch[1]) {
    const linkContent = linkMatch[1];
    const firstBracketIndex = formattedText.indexOf(linkMatch[0]);
    const suffix = formattedText
      .slice(firstBracketIndex + linkMatch[0].length)
      .trim();
    return `[${linkContent}](${url})${suffix ? " " + suffix : ""}`;
  } else {
    return `[${formattedText.trim()}](${url})`;
  }
}

class YouTubeClient implements Client {
  readonly name = "youtube" as const;
  displayName = "YouTube";
  defaultFormat = "[{title}] by {channel}";

  getAvailableVariables(): string[] {
    return [
      "title",
      "channel",
      "uploader",
      "duration",
      "views",
      "upload_date",
      "description",
      "url",
      "timestamp",
    ];
  }

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      const response = await requestUrl({ url: url, method: "GET" });
      const html = response.text;

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
            console.warn(
              "Could not find ytInitialPlayerResponse or ytInitialData in HTML."
            );
          }
        }
      } catch (parseError) {
        console.error("Failed to parse YouTube JSON data:", parseError);
        playerResponseJson = null;
      }

      if (playerResponseJson) {
        const videoDetails = playerResponseJson.videoDetails;
        const microformat =
          playerResponseJson.microformat?.playerMicroformatRenderer;

        if (videoDetails || microformat) {
          const title = videoDetails?.title || microformat?.title?.simpleText;
          const uploader =
            videoDetails?.author || microformat?.ownerChannelName?.simpleText;
          const description =
            videoDetails?.shortDescription ||
            microformat?.description?.simpleText;
          const views = videoDetails?.viewCount;
          const durationSeconds = videoDetails?.lengthSeconds;
          const uploadDate = microformat?.publishDate;

          return {
            title: title ? escapeMarkdownChars(title) : undefined,
            uploader: uploader ? escapeMarkdownChars(uploader) : undefined,
            channel: uploader ? escapeMarkdownChars(uploader) : undefined,
            description: description
              ? escapeMarkdownChars(description)
              : undefined,
            views: views ? parseInt(views).toLocaleString() : undefined,
            duration: durationSeconds
              ? formatDuration(parseInt(durationSeconds))
              : undefined,
            upload_date: uploadDate ? escapeMarkdownChars(uploadDate) : undefined,
          };
        } else {
          console.warn(
            "Could not find videoDetails or microformat in JSON data."
          );
        }
      }
    } catch (error) {
      console.error(
        `Failed to fetch or parse YouTube metadata for ${url}:`,
        error
      );
      new Notice("Failed to fetch YouTube data.", 3000);
    }

    // Fallback
    return {
      title: escapeMarkdownChars(url),
      uploader: undefined,
      channel: undefined,
      description: undefined,
      views: undefined,
      duration: undefined,
      upload_date: undefined,
    };
  }

  format(
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ): string {
    const urlObj = new URL(url);
    const seconds = this.getYouTubeTimestamp(urlObj);
    let timestampStr = "";
    if (seconds) {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      timestampStr =
        hours > 0
          ? `@${hours}:${mins.toString().padStart(2, "0")}:${secs
              .toString()
              .padStart(2, "0")}`
          : `@${mins}:${secs.toString().padStart(2, "0")}`;
    }

    // Add timestamp to metadata for template formatting
    const extendedMetadata = { ...metadata, timestamp: timestampStr };

    const template = plugin.settings.clientFormats?.[this.name] || this.defaultFormat;
    const formattedText = formatTemplate(template, extendedMetadata, url);
    return wrapInMarkdownLink(formattedText, url);
  }

  matches = (url: string) => {
    if (url.match(/^https?:\/\/(www\.youtube\.com|youtu\.be)\//)) {
      return true;
    }
    return false;
  };

  /**
   * Creates a YouTube timestamp from a given URL.
   * @param url - The URL to fetch the timestamp from.
   * @returns The YouTube timestamp as a number.
   */
  getYouTubeTimestamp(url: URL): number {
    let timestamp =
      url.searchParams.get("t") || url.searchParams.get("time_continue") || "";
    timestamp = timestamp.replace("s", "");
    return Number(timestamp);
  }
}

class YouTubeMusicClient implements Client {
  readonly name = "youtube-music" as const;
  displayName = "YouTube Music";
  defaultFormat = "[{title}] - {artist}";

  getAvailableVariables(): string[] {
    return ["title", "artist", "duration", "views", "url"];
  }

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      const videoId = this.extractVideoId(url);
      if (!videoId) {
        throw new Error("Could not extract video ID from URL");
      }

      const payload = {
        videoId: videoId,
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20251015.03.00",
            hl: "en",
            gl: "US"
          }
        }
      };

      const response = await requestUrl({
        url: "https://music.youtube.com/youtubei/v1/player?prettyPrint=false",
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = JSON.parse(response.text);
      const videoDetails = data.videoDetails;

      if (videoDetails) {
        return {
          title: videoDetails.title ? escapeMarkdownChars(videoDetails.title) : undefined,
          artist: videoDetails.author ? escapeMarkdownChars(videoDetails.author) : undefined,
          duration: videoDetails.lengthSeconds
            ? formatDuration(parseInt(videoDetails.lengthSeconds))
            : undefined,
          views: videoDetails.viewCount
            ? parseInt(videoDetails.viewCount).toLocaleString()
            : undefined,
        };
      }
    } catch (error) {
      console.error(
        `Failed to fetch YouTube Music metadata for ${url}:`,
        error
      );
      new Notice("Failed to fetch YouTube Music data.", 3000);
    }

    // Fallback
    return {
      title: escapeMarkdownChars(url),
      artist: undefined,
      duration: undefined,
      views: undefined,
    };
  }

  extractVideoId(url: string): string | null {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  }

  format(
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ): string {
    const template = plugin.settings.clientFormats?.[this.name] || this.defaultFormat;
    const formattedText = formatTemplate(template, metadata, url);
    return wrapInMarkdownLink(formattedText, url);
  }

  matches = (url: string) => {
    return url.match(/^https?:\/\/music\.youtube\.com\//) !== null;
  };
}

class ImageClient implements Client {
  readonly name = "image" as const;
  displayName = "Image";
  defaultFormat = "![{title}]({url})";

  getAvailableVariables(): string[] {
    return ["title", "url"];
  }

  matches = (url: string) => {
    return (
      url.match(/\.(jpg|jpeg|png|gif|bmp|tiff|ico|webp|svg|heic|heif)$/i) !==
      null
    );
  };

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      const filename = url.substring(url.lastIndexOf("/") + 1);
      return {
        title: filename
          ? escapeMarkdownChars(decodeURIComponent(filename))
          : "image",
      };
    } catch (error) {
      console.error("Error parsing image URL:", error);
      return { title: "image" };
    }
  }

  format(metadata: Record<string, string | undefined>, url: string): string {
    return `![${metadata.title || ""}](${url})`;
  }
}

class GitHubClient implements Client {
  readonly name = "github" as const;
  displayName = "GitHub";
  defaultFormat = "[{owner}/{repo}]: {description}";

  getAvailableVariables(): string[] {
    return ["owner", "repo", "description"];
  }

  matches = (url: string) => {
    return /^https?:\/\/github\.com\/[\w-]+\/[\w-]+(\/)?$/.test(url);
  };

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      const response = await requestUrl({ url: url, method: "GET" });
      const html = response.text;

      const titleMatch = html.match(
        /<meta property="og:title" content="([^"]+)"/
      );
      const fullRepoName = titleMatch?.[1];

      let owner, repo, description;
      if (fullRepoName) {
        [owner, repo] = fullRepoName.split("/");
        [repo, description] = repo.split(": ");
        owner = owner.split("- ")[1];
      }
      console.log(owner, "|", repo, "|", description);

      return {
        owner: owner ? escapeMarkdownChars(owner) : undefined,
        repo: repo ? escapeMarkdownChars(repo) : undefined,
        description: description ? escapeMarkdownChars(description) : undefined
      };
    } catch (error) {
      console.error(`Failed to fetch GitHub metadata for ${url}:`, error);
      new Notice("Failed to fetch GitHub data.", 3000);
    }
    
    const title = await getPageTitle(url);
    return { title: escapeMarkdownChars(title) };
  }

  format(
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ): string {
    const template = plugin.settings.clientFormats?.[this.name] || this.defaultFormat;
    const formattedText = formatTemplate(template, metadata, url);
    return wrapInMarkdownLink(formattedText, url);
  }
}

/**
 * Fallback client that matches every link and simply formats the title.
 */
class DefaultClient implements Client {
  readonly name = "default" as const;
  displayName = "Default";
  defaultFormat = "[{title}]";

  getAvailableVariables(): string[] {
      return ["title", "url"];
  }

  async fetchMetadata(url: string): Promise<Record<string, string | undefined>> {
      const title = await getPageTitle(url);
      return { title: title };
  }
  format(metadata: Record<string, string | undefined>, url: string, plugin: SmartLinkFormatterPlugin): string {
      const template = plugin.settings.clientFormats?.[this.name] || this.defaultFormat;
      const formattedText = formatTemplate(template, metadata, url);
      return wrapInMarkdownLink(formattedText, url);
  }
  matches(url: string): boolean {
      return true;
  }
}

export const CLIENTS = [
  new YouTubeClient(),
  new YouTubeMusicClient(),
  new ImageClient(),
  new GitHubClient(),
  new DefaultClient(),
] as const;

export type ClientName = (typeof CLIENTS)[number]["name"];
