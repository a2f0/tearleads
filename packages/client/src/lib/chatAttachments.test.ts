import { afterEach, describe, expect, it, vi } from 'vitest';
import { objectUrlToDataUrl, uint8ArrayToDataUrl } from './chatAttachments';

describe('chatAttachments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('converts an object URL response to a data URL', async () => {
    const payload = new Uint8Array([72, 101, 108, 108, 111]);
    const response = new Response(payload, {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    await expect(objectUrlToDataUrl('blob:test')).resolves.toMatch(
      /^data:text\/plain;base64,/
    );
  });

  it('throws when object URL fetch fails', async () => {
    const response = new Response('missing', { status: 404 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    await expect(objectUrlToDataUrl('blob:missing')).rejects.toThrow(
      'Failed to load object URL: 404'
    );
  });

  it('converts Uint8Array data to a data URL', async () => {
    await expect(
      uint8ArrayToDataUrl(new Uint8Array([1, 2, 3]), 'application/octet-stream')
    ).resolves.toMatch(/^data:application\/octet-stream;base64,/);
  });

  it('throws when FileReader load result is not a string', async () => {
    class NonStringFileReader {
      result: unknown = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(): void {
        this.result = new ArrayBuffer(4);
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', NonStringFileReader);

    await expect(
      uint8ArrayToDataUrl(new Uint8Array([5, 6, 7]), 'application/octet-stream')
    ).rejects.toThrow('Failed to convert blob to data URL');
  });
});
