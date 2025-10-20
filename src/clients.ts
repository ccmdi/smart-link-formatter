import { requestUrl } from "obsidian";
import { escapeMarkdownChars, formatDuration, formatDate } from "utils";
import { Notice } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { getPageTitle } from "title-utils";

interface Client {
  fetchMetadata: (url: string) => Promise<Record<string, string | undefined>>;
  format: (
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ) => string;
  matches: (url: string) => boolean;
}

class YouTubeClient implements Client {
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
            upload_date: uploadDate
              ? formatDate(uploadDate.replace(/-/g, ""))
              : undefined,
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

    let formattedText = plugin.settings.printCommand;
    formattedText = formattedText.replace("{title}", metadata.title || "");
    formattedText = formattedText.replace("{channel}", metadata.channel || "");
    formattedText = formattedText.replace(
      "{uploader}",
      metadata.uploader || ""
    );
    formattedText = formattedText.replace(
      "{description}",
      metadata.description || ""
    );
    formattedText = formattedText.replace("{views}", metadata.views || "");
    formattedText = formattedText.replace(
      "{duration}",
      metadata.duration || ""
    );
    formattedText = formattedText.replace(
      "{upload_date}",
      metadata.upload_date || ""
    );
    formattedText = formattedText.replace("{url}", url);
    formattedText = formattedText.replace("{timestamp}", timestampStr);

    const linkMatch = formattedText.match(/\[(.*?)\]/); // IMPORTANT: Single bracket is clipboardText
    let finalFormattedLink = formattedText;
    if (linkMatch && linkMatch[1]) {
      const linkContent = linkMatch[1];
      const firstBracketIndex = formattedText.indexOf(linkMatch[0]);
      const suffix = formattedText
        .slice(firstBracketIndex + linkMatch[0].length)
        .trim();
      finalFormattedLink = `[${linkContent}](${url})${
        suffix ? " " + suffix : ""
      }`;
    } else {
      finalFormattedLink = `[${formattedText.trim()}](${url})`;
    }
    return finalFormattedLink;
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
    const displayText = metadata.artist
      ? `${metadata.title} - ${metadata.artist}`
      : metadata.title;

    return `[${displayText}](${url})`;
  }

  matches = (url: string) => {
    return url.match(/^https?:\/\/music\.youtube\.com\//) !== null;
  };
}

/**
 * Fallback client that matches every link and simply formats the title. 
 */
class DefaultClient implements Client {
    async fetchMetadata(url: string): Promise<Record<string, string | undefined>> {
        const title = await getPageTitle(url);
        return { title: title };
    }
    format(metadata: Record<string, string | undefined>, url: string, plugin: SmartLinkFormatterPlugin): string {
        return `[${metadata.title}](${url})`;
    }
    matches(url: string): boolean {
        return true;
    }
}

export const CLIENTS: Client[] = [
    new YouTubeClient(),
    new YouTubeMusicClient(),
    new DefaultClient()
];
