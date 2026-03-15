import { buildVfsV2ConnectMethodPath } from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('../apiCore', () => ({
  request: (path: string, params?: unknown) => requestMock(path, params)
}));

import { vfsRoutes } from './vfsRoutes';

describe('vfsRoutes blob operations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('decodes blob responses from array and base64 payloads', async () => {
    requestMock.mockResolvedValueOnce({
      data: [65, 66, 67],
      contentType: 'text/plain'
    });
    requestMock.mockResolvedValueOnce({
      data: 'encoded',
      contentType: undefined
    });

    const atobMock = vi.fn(() => 'XYZ');
    vi.stubGlobal('atob', atobMock);

    const arrayBlob = await vfsRoutes.getBlob('blob-array');
    const encodedBlob = await vfsRoutes.getBlob('blob-encoded');

    expect(Array.from(arrayBlob.data)).toEqual([65, 66, 67]);
    expect(arrayBlob.contentType).toBe('text/plain');
    expect(Array.from(encodedBlob.data)).toEqual([88, 89, 90]);
    expect(encodedBlob.contentType).toBeNull();
    expect(atobMock).toHaveBeenCalledWith('encoded');

    const [arrayPath, arrayParams] = requestMock.mock.calls[0] ?? [];
    const [encodedPath, encodedParams] = requestMock.mock.calls[1] ?? [];
    expect(arrayPath).toBe(buildVfsV2ConnectMethodPath('GetBlob'));
    expect(arrayParams?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-array' })
    );
    expect(encodedPath).toBe(buildVfsV2ConnectMethodPath('GetBlob'));
    expect(encodedParams?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-encoded' })
    );
  });

  it('returns empty blob data when payload is empty and throws without atob', async () => {
    requestMock.mockResolvedValueOnce({ data: '', contentType: undefined });

    const emptyBlob = await vfsRoutes.getBlob('blob-empty');
    expect(Array.from(emptyBlob.data)).toEqual([]);
    expect(emptyBlob.contentType).toBeNull();

    requestMock.mockResolvedValueOnce({
      data: 'QQ==',
      contentType: 'text/plain'
    });
    vi.stubGlobal('atob', undefined);

    await expect(vfsRoutes.getBlob('blob-error')).rejects.toThrow(
      'Unable to decode blob payload'
    );
  });

  it('routes deleteBlob through Connect and returns typed payload', async () => {
    requestMock.mockResolvedValueOnce({
      deleted: true,
      blobId: 'blob-1'
    });

    await expect(vfsRoutes.deleteBlob('blob-1')).resolves.toEqual({
      deleted: true,
      blobId: 'blob-1'
    });

    const [path, params] = requestMock.mock.calls[0] ?? [];
    expect(path).toBe(buildVfsV2ConnectMethodPath('DeleteBlob'));
    expect(params?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-1' })
    );
  });
});
