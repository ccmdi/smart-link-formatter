import { describe, it, expect, vi } from 'vitest';
import { CLIENTS } from 'clients';
import { findUnformattedUrls, normalizeUrl } from 'utils';

vi.mock('obsidian', async () => {
  const mocks = await import('obsidian-test-mocks/obsidian');
  return {
    ...mocks,
    requestUrl: async (params: { url: string; method?: string; headers?: Record<string, string>; body?: string } | string) => {
      const url = typeof params === 'string' ? params : params.url;
      const method = typeof params === 'string' ? 'GET' : (params.method || 'GET');
      const headers = typeof params === 'string' ? {} : (params.headers || {});
      const body = typeof params === 'string' ? undefined : params.body;

      const response = await fetch(url, { method, headers, body });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        text,
        json,
        arrayBuffer: new ArrayBuffer(0),
      };
    },
  };
});

// -- Normalization --

describe('normalizeUrl', () => {
  it('strips www', () => {
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc');
  });

  it('normalizes http to https', () => {
    expect(normalizeUrl('http://github.com/foo/bar')).toBe('https://github.com/foo/bar');
  });

  it('normalizes both http and www', () => {
    expect(normalizeUrl('http://www.reddit.com/r/test')).toBe('https://reddit.com/r/test');
  });

  it('leaves https without www unchanged', () => {
    expect(normalizeUrl('https://youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc');
  });

  it('does not strip non-www subdomains', () => {
    expect(normalizeUrl('https://music.youtube.com/watch?v=abc')).toBe('https://music.youtube.com/watch?v=abc');
  });
});

// -- Client matching (uses real CLIENTS + real normalizeUrl) --

function matchClient(url: string) {
  const normalized = normalizeUrl(url);
  return CLIENTS.find(c => c.matches(normalized))?.name ?? null;
}

describe('client matching', () => {
  describe('YouTube', () => {
    it.each([
      'https://youtube.com/watch?v=abc',
      'https://www.youtube.com/watch?v=abc',
      'http://youtube.com/watch?v=abc',
      'http://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'http://youtu.be/abc',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('youtube');
    });
  });

  describe('YouTube Music', () => {
    it.each([
      'https://music.youtube.com/watch?v=abc',
      'http://music.youtube.com/watch?v=abc',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('youtube-music');
    });

    it('is not caught by regular YouTube client', () => {
      const normalized = normalizeUrl('https://music.youtube.com/watch?v=abc');
      const youtube = CLIENTS.find(c => c.name === 'youtube')!;
      expect(youtube.matches(normalized)).toBe(false);
    });
  });

  describe('Twitter/X', () => {
    it.each([
      'https://x.com/user/status/123456',
      'https://twitter.com/user/status/123456',
      'http://x.com/user/status/123456',
      'https://www.x.com/user/status/123456',
      'http://www.twitter.com/user/status/123456',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('twitter');
    });
  });

  describe('Reddit', () => {
    it.each([
      'https://reddit.com/r/test/comments/abc/def/',
      'https://www.reddit.com/r/test/comments/abc/def/',
      'http://reddit.com/r/test/comments/abc/def/',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('reddit');
    });
  });

  describe('GitHub', () => {
    it.each([
      'https://github.com/user/repo',
      'https://github.com/user/repo/',
      'http://github.com/user/repo',
      'https://www.github.com/user/repo',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('github');
    });
  });

  describe('Image', () => {
    it.each([
      'https://example.com/image.png',
      'https://example.com/photo.jpg',
      'https://example.com/icon.svg',
    ])('matches %s', (url) => {
      expect(matchClient(url)).toBe('image');
    });
  });

  describe('Default fallback', () => {
    it('matches any URL not caught by other clients', () => {
      expect(matchClient('https://obsidian.md')).toBe('default');
    });
  });
});

// -- Real network: fetchMetadata against live URLs --

describe('fetchMetadata (live network)', () => {
  const youtube = CLIENTS.find(c => c.name === 'youtube')!;
  const github = CLIENTS.find(c => c.name === 'github')!;
  const defaultClient = CLIENTS.find(c => c.name === 'default')!;

  it('YouTube: extracts title and channel from a real video', async () => {
    const metadata = await youtube.fetchMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(metadata.title).toBeTruthy();
    expect(metadata.channel).toBeTruthy();
  }, 15000);

  it('YouTube: works without www', async () => {
    const metadata = await youtube.fetchMetadata('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(metadata.title).toBeTruthy();
  }, 15000);

  it('GitHub: extracts owner and repo', async () => {
    const metadata = await github.fetchMetadata('https://github.com/obsidianmd/obsidian-api');
    expect(metadata.owner).toBeTruthy();
    expect(metadata.repo).toBeTruthy();
  }, 15000);

  it('Default: extracts page title from any site', async () => {
    const metadata = await defaultClient.fetchMetadata('https://obsidian.md');
    expect(metadata.title).toBeTruthy();
    expect(metadata.title).not.toBe('https://obsidian.md');
  }, 15000);
});

// -- findUnformattedUrls --

describe('findUnformattedUrls', () => {
  it('finds a plain URL in text', () => {
    const lines = ['Check out https://example.com for details'];
    const results = findUnformattedUrls(lines, 0, 0);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com');
  });

  it('skips URLs inside markdown links', () => {
    const lines = ['[Example](https://example.com)'];
    const results = findUnformattedUrls(lines, 0, 0);
    expect(results).toHaveLength(0);
  });

  it('finds multiple URLs across lines', () => {
    const lines = ['https://example.com', 'text', 'https://other.com'];
    const results = findUnformattedUrls(lines, 0, 2);
    expect(results).toHaveLength(2);
  });

  it('finds multiple URLs on the same line', () => {
    const lines = ['https://example.com and https://other.com'];
    const results = findUnformattedUrls(lines, 0, 0);
    expect(results).toHaveLength(2);
  });

  it('skips URLs in code blocks', () => {
    const lines = ['```', 'https://example.com', '```'];
    const results = findUnformattedUrls(lines, 0, 2);
    expect(results).toHaveLength(0);
  });

  it('skips URLs in inline code', () => {
    const lines = ['Use `https://example.com` as endpoint'];
    const results = findUnformattedUrls(lines, 0, 0);
    expect(results).toHaveLength(0);
  });

  it('finds URLs in table cells', () => {
    const lines = ['| https://example.com | https://other.com |'];
    const results = findUnformattedUrls(lines, 0, 0);
    expect(results).toHaveLength(2);
  });

  it('respects line range', () => {
    const lines = ['https://first.com', 'https://second.com', 'https://third.com'];
    const results = findUnformattedUrls(lines, 1, 1);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://second.com');
  });

  it('skips URLs in frontmatter', () => {
    const lines = ['---', 'source: https://example.com', '---', 'https://real.com'];
    const results = findUnformattedUrls(lines, 0, 3);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://real.com');
  });
});
