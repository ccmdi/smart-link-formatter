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

    const dateFields = ['upload_date', 'created_at'];
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
  const isEmbed = formattedText.startsWith("!");
  const textToProcess = isEmbed ? formattedText.substring(1) : formattedText;

  let link;
  const linkMatch = textToProcess.match(/\[(.*?)\]/);

  if (linkMatch && linkMatch[1]) {
    const linkContent = linkMatch[1];
    const firstBracketIndex = textToProcess.indexOf(linkMatch[0]);
    const suffix = textToProcess
      .slice(firstBracketIndex + linkMatch[0].length)
      .trim();
    link = `[${linkContent}](${url})${suffix ? " " + suffix : ""}`;
  } else {
    link = `[${textToProcess.trim()}](${url})`;
  }

  return isEmbed ? `!${link}` : link;
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

class TwitterClient implements Client {
  readonly name = "twitter" as const;
  displayName = "Twitter/X";
  defaultFormat = "[{text}] - @{author}";

  getAvailableVariables(): string[] {
    return ["text", "author", "name", "likes", "retweets", "replies", "views", "created_at", "url"];
  }

  matches = (url: string) => {
    return /^https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
  };

  async getGuestToken(): Promise<string> {
    const response = await requestUrl({
      url: "https://api.x.com/1.1/guest/activate.json",
      method: "POST",
      headers: {
        "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
      }
    });

    const data = JSON.parse(response.text);
    return data.guest_token;
  }

  async fetchMetadata(
    url: string
  ): Promise<Record<string, string | undefined>> {
    try {
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

      const features = {
        creator_subscriptions_tweet_preview_api_enabled: true,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: false,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        payments_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_enhance_cards_enabled: false
      };

      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
        withDisallowedReplyControls: true,
        withAuxiliaryUserLabels: true
      };

      const apiUrl = `https://x.com/i/api/graphql/jGOLj4UQ6l5z9uUKfhqEHA/TweetResultByRestId?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

      const response = await requestUrl({
        url: apiUrl,
        method: "GET",
        headers: {
          "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
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
  new TwitterClient(),
  new GitHubClient(),
  new DefaultClient(),
] as const;

export type ClientName = (typeof CLIENTS)[number]["name"];
