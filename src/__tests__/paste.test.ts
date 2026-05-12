import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, Editor, TFile, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import SmartLinkFormatterPlugin from 'main';
import { DEFAULT_SETTINGS } from 'settings';

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

function createEditor(content = ''): InstanceType<typeof Editor> {
  const editor = new (Editor as any)();
  if (content) editor.setValue(content);
  return editor;
}

function createClipboardEvent(text: string) {
  return {
    clipboardData: {
      getData: (type: string) => type === 'text/plain' ? text : '',
    },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

async function waitForResolution(editor: any, timeout = 15000) {
  const start = Date.now();
  while (editor.getValue().includes('Loading...') && Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 100));
  }
}

let plugin: SmartLinkFormatterPlugin;

beforeEach(() => {
  const app = App.createConfigured__({
    files: { 'test.md': '' },
  });

  const leaf = WorkspaceLeaf.create__(app.workspace.asOriginalType2__());
  (leaf as any).file__ = TFile.create__((app as any).vault, 'test.md');
  (app.workspace as any).activeLeaf = leaf;

  const manifest = { id: 'smart-link-formatter', name: 'Smart Link Formatter', version: '1.0.0', minAppVersion: '1.0.0', description: '', author: '', authorUrl: '' };
  plugin = new SmartLinkFormatterPlugin(app.asOriginalType__(), manifest);
  plugin.settings = { ...DEFAULT_SETTINGS };
});

describe('paste integration', () => {
  it('single URL: produces a markdown link', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(content).not.toContain('Loading...');
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
  }, 15000);

  it('single YouTube URL: uses YouTube client format', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toMatch(/\[.+\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ\)/);
    expect(content).toContain(' by ');
  }, 15000);

  it('single YouTube URL without www: still uses YouTube client', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('https://youtube.com/watch?v=dQw4w9WgXcQ');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toContain(' by ');
    expect(content).not.toContain('YouTube');
  }, 15000);

  it('multiple URLs: each gets formatted independently', async () => {
    const editor = createEditor();
    const text = 'https://obsidian.md\nhttps://github.com/obsidianmd/obsidian-api';
    const evt = createClipboardEvent(text);

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(content).not.toContain('Loading...');
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
    expect(content).toMatch(/\[.+\]\(https:\/\/github\.com\/obsidianmd\/obsidian-api\)/);
  }, 20000);

  it('prose with URLs: formats URLs, keeps surrounding text', async () => {
    const editor = createEditor();
    const text = 'Check out https://obsidian.md for details';
    const evt = createClipboardEvent(text);

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toContain('Check out');
    expect(content).toContain('for details');
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
  }, 15000);

  it('plain text without URLs: does not intercept', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('just some regular text');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(editor.getValue()).toBe('');
  }, 5000);

  it('autoLink disabled: does not intercept', async () => {
    plugin.settings.autoLink = false;
    const editor = createEditor();
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('blacklisted domain: does not intercept', async () => {
    plugin.settings.blacklistedDomains = 'obsidian.md';
    const editor = createEditor();
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('paste into code block: does not intercept', async () => {
    const editor = createEditor('```\n\n```');
    editor.setCursor({ line: 1, ch: 0 });
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('custom format: uses client format from settings', async () => {
    plugin.settings.clientFormats = { default: '[{title}]' };
    const editor = createEditor();
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
  }, 15000);

  it('paste into markdown link parens: URL inserted but not formatted', async () => {
    const editor = createEditor('[link text]()');
    editor.setCursor({ line: 0, ch: 12 });
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toBe('[link text](https://obsidian.md)');
  }, 5000);

  it('pasteIntoSelection enabled + text selected: defers to default', async () => {
    plugin.settings.pasteIntoSelection = true;
    const editor = createEditor('select me');
    editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 9 });
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('multiple URLs with one blacklisted: only formats non-blacklisted', async () => {
    plugin.settings.blacklistedDomains = 'blocked.com';
    const editor = createEditor();
    const text = 'https://obsidian.md\nhttps://blocked.com/page';
    const evt = createClipboardEvent(text);

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
    expect(content).toContain('https://blocked.com/page');
    expect(content).not.toMatch(/\[.+\]\(https:\/\/blocked\.com/);
  }, 15000);

  it('paste into frontmatter: does not intercept', async () => {
    const editor = createEditor('---\n\n---');
    editor.setCursor({ line: 1, ch: 0 });
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('paste into HTML comment: does not intercept', async () => {
    const editor = createEditor('<!--\n\n-->');
    editor.setCursor({ line: 1, ch: 0 });
    const evt = createClipboardEvent('https://obsidian.md');

    await plugin.handlePaste(evt, editor.asOriginalType__());

    expect(evt.preventDefault).not.toHaveBeenCalled();
  }, 5000);

  it('single URL with trailing whitespace: still formats', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('https://obsidian.md  \n');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(content).not.toContain('Loading...');
  }, 15000);

  it('multiple URLs with blank lines between them', async () => {
    const editor = createEditor();
    const text = 'https://obsidian.md\n\nhttps://github.com/obsidianmd/obsidian-api';
    const evt = createClipboardEvent(text);

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toMatch(/\[.+\]\(https:\/\/obsidian\.md\)/);
    expect(content).toMatch(/\[.+\]\(https:\/\/github\.com\/obsidianmd\/obsidian-api\)/);
  }, 20000);

  it('image URL: uses image client embed format', async () => {
    const editor = createEditor();
    const evt = createClipboardEvent('https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toMatch(/^!\[.+\]\(https:\/\/upload\.wikimedia\.org/);
  }, 15000);

  it('failure mode revert: pastes raw URL on fetch failure', async () => {
    plugin.settings.failureMode = 'revert' as any;
    const editor = createEditor();
    const evt = createClipboardEvent('https://youtube.com/watch?v=ZZZZZZ_nonexistent_id');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toBe('https://youtube.com/watch?v=ZZZZZZ_nonexistent_id');
  }, 20000);

  it('failure mode alert: shows failure message on fetch failure', async () => {
    plugin.settings.failureMode = 'alert' as any;
    const editor = createEditor();
    const evt = createClipboardEvent('https://youtube.com/watch?v=ZZZZZZ_nonexistent_id');

    await plugin.handlePaste(evt, editor.asOriginalType__());
    await waitForResolution(editor);

    const content = editor.getValue();
    expect(content).toBe('[Failed to fetch title](https://youtube.com/watch?v=ZZZZZZ_nonexistent_id)');
  }, 20000);
});
