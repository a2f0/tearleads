import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMimeMessage } from './mimeParser';

vi.mock('postal-mime', () => ({
  default: {
    parse: vi.fn()
  }
}));

async function getPostalMimeMock() {
  const mod = await import('postal-mime');
  return vi.spyOn(mod.default, 'parse');
}

describe('parseMimeMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a plain text email', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'Hello, this is a plain text email.',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.text).toBe('Hello, this is a plain text email.');
    expect(result.html).toBeNull();
    expect(result.attachments).toEqual([]);
  });

  it('parses an HTML-only email', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      html: '<p>Hello <b>World</b></p>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).toContain('<b>World</b>');
    expect(result.attachments).toEqual([]);
  });

  it('parses a multipart email with text and HTML parts', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'Plain text body',
      html: '<p>HTML <em>body</em></p>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.text).toBe('Plain text body');
    expect(result.html).toContain('<em>body</em>');
    expect(result.attachments).toEqual([]);
  });

  it('strips script tags from HTML', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'text',
      html: '<p>Safe</p><script>alert("xss")</script>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).not.toContain('script');
    expect(result.html).not.toContain('alert');
    expect(result.html).toContain('Safe');
  });

  it('strips iframe tags from HTML', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'text',
      html: '<p>Content</p><iframe src="http://evil.com"></iframe>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).not.toContain('iframe');
    expect(result.html).toContain('Content');
  });

  it('strips form tags from HTML', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'text',
      html: '<form action="/steal"><input name="pw"></form><p>OK</p>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).not.toContain('form');
    expect(result.html).not.toContain('input');
    expect(result.html).toContain('OK');
  });

  it('strips event handler attributes from HTML', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'text',
      html: '<p onclick="alert(1)" onmouseover="steal()">Click</p>',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('onmouseover');
    expect(result.html).toContain('Click');
  });

  it('preserves safe HTML tags and attributes', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'text',
      html: '<a href="https://example.com" target="_blank">Link</a><img src="pic.jpg" alt="photo">',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('alt="photo"');
  });

  it('extracts attachment metadata', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'See attached.',
      headers: [],
      headerLines: [],
      attachments: [
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          disposition: 'attachment' as const,
          content: new ArrayBuffer(1024),
          contentId: 'cid-123'
        }
      ]
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.text).toBe('See attached.');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      contentId: 'cid-123'
    });
  });

  it('handles missing attachment fields with defaults', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      headers: [],
      headerLines: [],
      attachments: [
        {
          filename: null,
          mimeType: 'application/octet-stream',
          disposition: null,
          content: new ArrayBuffer(0)
        }
      ]
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.attachments[0]).toEqual({
      filename: 'untitled',
      mimeType: 'application/octet-stream',
      size: 0,
      contentId: null
    });
  });

  it('handles empty result from postal-mime', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('');

    expect(result.text).toBeNull();
    expect(result.html).toBeNull();
    expect(result.attachments).toEqual([]);
  });

  it('treats empty HTML string as null', async () => {
    const mockParse = await getPostalMimeMock();
    mockParse.mockResolvedValue({
      text: 'Some text',
      html: '',
      headers: [],
      attachments: [],
      headerLines: []
    });

    const result = await parseMimeMessage('raw mime');

    expect(result.text).toBe('Some text');
    expect(result.html).toBeNull();
  });
});
