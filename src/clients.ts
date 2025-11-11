import { requestUrl } from "obsidian";
import { escapeMarkdownChars, formatDuration, formatDate, applyTitleReplacements } from "utils";
import { Notice } from "obsidian";
import SmartLinkFormatterPlugin from "main";
import { getPageTitle } from "title-utils";
import moment from "moment";
import { TitleReplacement } from "settings";

export abstract class Client {
  abstract readonly name: ClientName;
  abstract displayName: string;
  abstract defaultFormat: string;
  abstract getAvailableVariables(): string[];
  abstract fetchMetadata(url: string): Promise<Record<string, string | undefined>>;
  abstract matches(url: string): boolean;

  format(
    metadata: Record<string, string | undefined>,
    url: string,
    plugin: SmartLinkFormatterPlugin
  ): string {
    const template = plugin.settings.clientFormats?.[this.name] || this.defaultFormat;
    let formattedText = formatTemplate(template, metadata, url);

    if (plugin.settings.titleReplacements.length > 0) {
      formattedText = applyTitleReplacements(formattedText, plugin.settings.titleReplacements);
    }

    return wrapInMarkdownLink(formattedText, url);
  }
}

/**
 * Generic template formatter that automatically replaces variables in a template
 * based on the metadata object keys.
 *
 * Supports:
 * - Basic variables: {variable}
 * - Date formatting: {date_field|YYYY-MM-DD}
 * - Conditional formatting: {field?show_if_present:show_if_absent}
 *
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
  let result = template;
  let previousResult = '';

  while (result !== previousResult) {
    previousResult = result;

    result = result.replace(/{([^{}]+?)}/g, (match, key) => {
      // Check for conditional: {field?if_present:if_absent}
      const conditionalMatch = key.match(/^([^?|]+)\?(.*)$/);
      if (conditionalMatch) {
        const fieldName = conditionalMatch[1].trim();
        const branches = conditionalMatch[2];

        const fieldValue = fieldName === "url" ? url : metadata[fieldName];
        const isPresent = fieldValue !== undefined && fieldValue !== '';

        if (!isPresent) {
          for (let i = 1; i < branches.length; i++) {
            if (branches[i] === ':' && branches[i - 1] !== '\\') {
              return branches.substring(i + 1).replace(/\\:/g, ':');
            }
          }
          return '';
        }

        for (let i = 1; i < branches.length; i++) {
          if (branches[i] === ':' && branches[i - 1] !== '\\') {
            return branches.substring(0, i).replace(/\\:/g, ':');
          }
        }
        return branches.replace(/\\:/g, ':');
      }

      const [variable, format] = key.split('|').map((s: string) => s.trim());

      if (variable === "url") {
        return url;
      }

      const value = metadata[variable];
      if (value === undefined) {
        return '';
      }

      const dateFields = ['upload_date', 'created_at'];
      if (format && dateFields.includes(variable) && moment(value).isValid()) {
        return moment(value).format(format);
      }

      return String(value);
    });
  }

  return result;
}

/**
 * Wraps formatted text in a markdown link.
 * If the text contains brackets like [{content}], it uses that as the link text.
 * @param formattedText - The formatted text from template
 * @param url - The URL to link to
 * @returns Final markdown link
 */
export function wrapInMarkdownLink(formattedText: string, url: string): string {
  const isEmbed = formattedText.startsWith("!");
  const textToProcess = isEmbed ? formattedText.substring(1) : formattedText;

  let link;
  const linkMatch = textToProcess.match(/(?<!\\)\[(.*?)(?<!\\)\]/);

  if (linkMatch && linkMatch[1]) {
    const linkContent = linkMatch[1];
    const firstBracketIndex = textToProcess.indexOf(linkMatch[0]);
    const suffix = textToProcess
      .slice(firstBracketIndex + linkMatch[0].length);
    link = `[${linkContent}](${url})${suffix}`;
  } else {
    link = textToProcess.trim();
  }

  return isEmbed ? `!${link}` : link;
}

class YouTubeClient extends Client {
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

    return super.format(extendedMetadata, url, plugin);
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

class YouTubeMusicClient extends Client {
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

  matches = (url: string) => {
    return url.match(/^https?:\/\/music\.youtube\.com\//) !== null;
  };
}

class ImageClient extends Client {
  readonly name = "image" as const;
  displayName = "Image";
  defaultFormat = "![{title}]";

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
}

class TwitterClient extends Client {
  readonly name = "twitter" as const;
  displayName = "Twitter/X";
  defaultFormat = "[{text}] - @{author}";

  private queryId: string | null = null;
  private bearerToken: string | null = null;
  private features: any = null;
  private fieldToggles: any = null;

  getAvailableVariables(): string[] {
    return ["text", "author", "name", "likes", "retweets", "replies", "views", "created_at", "url"];
  }

  matches = (url: string) => {
    return /^https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
  };

  async loadTwitterAPIConfig(): Promise<void> {
    try {
      const graphqlResponse = await requestUrl({
        url: "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json",
        method: "GET"
      });
      const graphqlData = JSON.parse(graphqlResponse.text);

      const endpoint = graphqlData.find((item: any) =>
        item.exports?.operationName === "TweetResultByRestId"
      );

      if (endpoint) {
        this.queryId = endpoint.exports.queryId;

        const metadata = endpoint.exports.metadata;
        if (metadata) {
          if (metadata.featureSwitch) {
            this.features = {};
            for (const [key, val] of Object.entries(metadata.featureSwitch)) {
              const value = (val as any).value;
              this.features[key] = value === "true" ? true : value === "false" ? false : value;
            }
          }

          if (metadata.fieldToggles) {
            this.fieldToggles = {};
            for (const toggle of metadata.fieldToggles) {
              this.fieldToggles[toggle] = true;
            }
          }
        }
      }

      const apiResponse = await requestUrl({
        url: "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/deck/json/API.json",
        method: "GET"
      });
      const apiData = JSON.parse(apiResponse.text);
      this.bearerToken = apiData.header?.authorization;

    } catch (error) {
      console.error("Failed to load Twitter API config from GitHub:", error);
      this.queryId = "jGOLj4UQ6l5z9uUKfhqEHA";
      this.bearerToken = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
    }
  }

  async getGuestToken(): Promise<string> {
    if (!this.bearerToken) {
      await this.loadTwitterAPIConfig();
    }

    const response = await requestUrl({
      url: "https://api.x.com/1.1/guest/activate.json",
      method: "POST",
      headers: {
        "authorization": this.bearerToken!
      }
    });

    const data = JSON.parse(response.text);
    return data.guest_token;
  }

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      if (!this.queryId || !this.bearerToken) {
        await this.loadTwitterAPIConfig();
      }

      const tweetId = this.extractTweetId(url);
      if (!tweetId) {
        throw new Error("Could not extract tweet ID from URL");
      }

      const guestToken = await this.getGuestToken();

      const variables = {
        tweetId: tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false
      };

      const apiUrl = `https://x.com/i/api/graphql/${this.queryId}/TweetResultByRestId?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(this.features))}&fieldToggles=${encodeURIComponent(JSON.stringify(this.fieldToggles))}`;

      const response = await requestUrl({
        url: apiUrl,
        method: "GET",
        headers: {
          "authorization": this.bearerToken!,
          "x-guest-token": guestToken,
          "x-twitter-active-user": "yes",
          "x-twitter-client-language": "en"
        }
      });

      const data = JSON.parse(response.text);
      const result = data?.data?.tweetResult?.result;

      if (!result) {
        throw new Error("Tweet result not found");
      }

      const legacy = result.legacy;
      const username = result.core.user_results.result.core.screen_name;
      const authorName = result.core.user_results.result.core.name;

      return {
        text: legacy?.full_text ? escapeMarkdownChars(legacy.full_text) : undefined,
        author: username ? escapeMarkdownChars(username) : undefined,
        name: authorName ? escapeMarkdownChars(authorName) : undefined,
        likes: legacy?.favorite_count,
        retweets: legacy?.retweet_count,
        replies: legacy?.reply_count,
        views: result.views?.count ? parseInt(result.views.count).toLocaleString() : undefined,
        created_at: legacy?.created_at ? escapeMarkdownChars(legacy.created_at) : undefined
      };
    } catch (error) {
      console.error(`Failed to fetch Twitter metadata for ${url}:`, error);
      new Notice("Failed to fetch Twitter data.", 3000);
    }

    // Fallback
    return {
      text: escapeMarkdownChars(url),
      author: undefined,
      name: undefined,
      likes: undefined,
      retweets: undefined,
      replies: undefined,
      views: undefined,
      created_at: undefined
    };
  }

  extractTweetId(url: string): string | null {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }
}

class RedditClient extends Client {
  readonly name = "reddit" as const;
  displayName = "Reddit";
  defaultFormat = "[{title}] - r/{subreddit}";

  getAvailableVariables(): string[] {
    return ["title", "subreddit", "author", "upvotes", "comments", "created_at", "url"];
  }

  matches = (url: string) => {
    return /^https?:\/\/(www\.)?reddit\.com\/r\/[\w-]+\/comments\//.test(url);
  };

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
      const jsonUrl = url.replace(/\/$/, '') + '.json';

      const response = await requestUrl({
        url: jsonUrl,
        method: "GET",
        headers: {
          "User-Agent": "Obsidian Smart Link Formatter"
        }
      });

      const data = JSON.parse(response.text);

      const postData = data[0]?.data?.children?.[0]?.data;

      if (!postData) {
        throw new Error("Could not find post data");
      }

      return {
        title: postData.title ? escapeMarkdownChars(postData.title) : undefined,
        subreddit: postData.subreddit ? escapeMarkdownChars(postData.subreddit) : undefined,
        author: postData.author ? escapeMarkdownChars(postData.author) : undefined,
        upvotes: postData.ups ? postData.ups.toLocaleString() : undefined,
        comments: postData.num_comments ? postData.num_comments.toLocaleString() : undefined,
        created_at: postData.created_utc ? new Date(postData.created_utc * 1000).toISOString() : undefined
      };
    } catch (error) {
      console.error(`Failed to fetch Reddit metadata for ${url}:`, error);
      new Notice("Failed to fetch Reddit data.", 3000);
    }

    // Fallback
    return {
      title: escapeMarkdownChars(url),
      subreddit: undefined,
      author: undefined,
      upvotes: undefined,
      comments: undefined,
      created_at: undefined
    };
  }
}

class GitHubClient extends Client {
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
}

/**
 * Fallback client that matches every link and simply formats the title.
 */
class DefaultClient extends Client {
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

  matches(url: string): boolean {
      return true;
  }
}

export const CLIENTS = [
  new YouTubeClient(),
  new YouTubeMusicClient(),
  new ImageClient(),
  new TwitterClient(),
  new RedditClient(),
  new GitHubClient(),
  new DefaultClient(),
] as const;

export type ClientName = (typeof CLIENTS)[number]["name"];
