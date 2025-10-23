import { requestUrl, Platform } from 'obsidian';
import { escapeMarkdownChars } from './utils';

/**
 * Checks if a string is undefined, null, or empty.
 * @param text - The string to check.
 * @returns True if blank, false otherwise.
 */
function blank(text: string | null | undefined): boolean {
  return text === undefined || text === null || text === '';
}

/**
 * Generates a unique placeholder token.
 * @returns The unique placeholder token.
 */
export function generateUniqueToken(url: string): string {
  const id = `link-placeholder-${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  return `<span class="link-loading" id="${id}" ${url ? `url="${url}"` : ''}>Loading...</span>`; 
}

/**
 * Extracts the last segment of a URL path.
 * @param url - The URL string.
 * @returns The last segment or a default string like "File" or the original URL on error.
 */
function getUrlFinalSegment(url: string): string {
  try {
    const urlObject = new URL(url); // Use new URL for proper parsing
    const segments = urlObject.pathname.split('/');
    // Filter out empty segments that can result from trailing slashes or multiple slashes
    const nonEmptySegments = segments.filter(segment => segment.length > 0);
    const last = nonEmptySegments.pop();
    return last || "File"; // If no segments, or last was empty after filtering.
  } catch (_) {
    return url; // Fallback to full URL if parsing fails
  }
}

// async wrapper to load a url in Electron BrowserWindow and settle on load finish or fail
async function loadElectronWindow(window: any, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`Smart Link Formatter: Timeout loading ${url} in Electron window.`);
      try {
        if (window && !window.isDestroyed()) {
          window.webContents.stop();
        }
      } catch (err) {
        // Ignore
      }
      reject(new Error(`Timeout loading URL: ${url}`));
    }, 30000); // 30-second timeout

    const didFinishLoad = () => {
      clearTimeout(timer);
      window.webContents.removeListener("did-finish-load", didFinishLoad);
      window.webContents.removeListener("did-fail-load", didFailLoad);
      resolve();
    };

    // Corrected signature for did-fail-load
    const didFailLoad = (event: Event, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
      clearTimeout(timer);
      if (isMainFrame === false) {
        console.debug(`Smart Link Formatter: Non-main frame load failed for ${validatedURL}: ${errorDescription}. Continuing for main frame.`);
        return; // Don't reject the promise for sub-frame failures
      }
      window.webContents.removeListener("did-finish-load", didFinishLoad);
      window.webContents.removeListener("did-fail-load", didFailLoad);
      reject(new Error(`Failed to load URL: ${validatedURL} - ${errorDescription} (Code: ${errorCode})`));
    };

    window.webContents.on("did-finish-load", didFinishLoad);
    window.webContents.on("did-fail-load", didFailLoad);
    window.loadURL(url);
  });
}

async function electronGetPageTitle(url: string): Promise<string | null> {
  if (Platform.isMobile) {
    console.warn("Smart Link Formatter: Electron not available on mobile platform.");
    return null;
  }

  let electronPkg: any;
  try {
    electronPkg = require("electron");
  } catch (e) {
    console.warn("Smart Link Formatter: Electron module not available.");
    return null;
  }

  if (!electronPkg || !electronPkg.remote) {
    console.warn("Smart Link Formatter: Electron remote module not available for electronGetPageTitle.");
    return null;
  }
  
  const { BrowserWindow } = electronPkg.remote;
  let window: any = null;

  try {
    window = new BrowserWindow({
      width: 1000,
      height: 600,
      webPreferences: {
        webSecurity: true,
        nodeIntegration: false,
        contextIsolation: true,
        images: false,
        javascript: true,
      },
      show: false,
    });
    window.webContents.setAudioMuted(true);

    await loadElectronWindow(window, url);

    const title = window.webContents.getTitle();
    return !blank(title) ? title : null;

  } catch (ex) {
    console.error(`Smart Link Formatter: Error in electronGetPageTitle for ${url}:`, ex);
    return null;
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

/**
 * Fetches page title using Obsidian's requestUrl.
 */
async function fetchTitleWithRequestUrl(urlToFetch: string): Promise<string> {
  try {
    const response = await requestUrl({ url: urlToFetch, method: 'GET' });
    const contentType = response.headers['content-type']?.toLowerCase();

    if (contentType && !contentType.includes('text/html')) {
      return getUrlFinalSegment(urlToFetch) || urlToFetch;
    }

    const text = response.text;
    const doc = new DOMParser().parseFromString(text, "text/html");
    const titleElement = doc.querySelector("title");
    const actualTitle = titleElement?.innerText?.trim();

    if (!blank(actualTitle)) {
      return actualTitle!;
    }
    
    const noTitleAttr = titleElement?.getAttribute('no-title')?.trim();
    if (!blank(noTitleAttr)) {
      return noTitleAttr!;
    }
    
    const h1Element = doc.querySelector('h1');
    const h1Text = h1Element?.innerText?.trim();
    if (!blank(h1Text)) {
        return h1Text!;
    }

    const metaTitleElement = doc.querySelector('meta[property="og:title"], meta[name="twitter:title"], meta[itemprop="name"]');
    const metaTitleContent = metaTitleElement?.getAttribute('content')?.trim();
    if (!blank(metaTitleContent)) {
        return metaTitleContent!;
    }

    return urlToFetch;
  } catch (error) {
    console.error(`Smart Link Formatter: Failed to fetch page title via requestUrl for ${urlToFetch}:`, error);
    return urlToFetch;
  }
}

/**
 * Tries to get Content-Type using a HEAD request.
 */
async function tryGetContentTypeAndSegment(url: string): Promise<string | null> {
  try {
    const response = await requestUrl({ url: url, method: "HEAD" });
    const contentType = response.headers['content-type']?.toLowerCase();
    
    if (contentType && !contentType.includes("text/html")) {
      return getUrlFinalSegment(url) || url;
    }
    return null;
  } catch (err) {
    console.warn(`Smart Link Formatter: HEAD request for ${url} failed or inconclusive. Proceeding with GET. Error:`, err);
    return null;
  }
}

/**
 * Main function to get page title using various strategies.
 * @param url - The URL to fetch the title from.
 * @returns The processed and Markdown-escaped page title.
 */
async function getPageTitleOrchestrator(url: string): Promise<string> {
  let processedUrl = url;
  if (!(processedUrl.startsWith('http') || processedUrl.startsWith('https'))) {
    processedUrl = 'https://' + processedUrl;
  }

  let title: string | null = null;

  const nonHtmlTitle = await tryGetContentTypeAndSegment(processedUrl);
  if (nonHtmlTitle) {
    return escapeMarkdownChars(nonHtmlTitle);
  }

  if (Platform.isMobile) {
    title = await fetchTitleWithRequestUrl(processedUrl);
  } else {
    try {
      title = await electronGetPageTitle(processedUrl);
    } catch (electronError) {
      console.error(`Smart Link Formatter: electronGetPageTitle failed for ${processedUrl}:`, electronError);
      title = null;
    }

    if (blank(title)) {
      title = await fetchTitleWithRequestUrl(processedUrl);
    }
  }
  
  return escapeMarkdownChars(title || processedUrl);
}

export { getPageTitleOrchestrator as getPageTitle }; 