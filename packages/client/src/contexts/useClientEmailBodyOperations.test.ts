import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClientEmailBodyOperations } from './useClientEmailBodyOperations';

const mockGetAuthHeaderValue = vi.fn();
const mockGetBlob = vi.fn();
const mockGetCurrentKey = vi.fn();
const mockImportKey = vi.fn();
const mockDecrypt = vi.fn();

vi.mock('@/lib/authStorage', () => ({
  getAuthHeaderValue: () => mockGetAuthHeaderValue()
}));

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'https://api.test',
  api: {
    vfs: {
      getBlob: (...args: unknown[]) => mockGetBlob(...args)
    }
  }
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => mockGetCurrentKey()
  })
}));

vi.mock('@tearleads/shared', () => ({
  importKey: (...args: unknown[]) => mockImportKey(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args)
}));

describe('useClientEmailBodyOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns an object with fetchDecryptedBody', () => {
    const { result } = renderHook(() => useClientEmailBodyOperations());
    expect(result.current.fetchDecryptedBody).toBeInstanceOf(Function);
  });

  it('fetches, decrypts, and returns the email body', async () => {
    mockGetAuthHeaderValue.mockReturnValue('Bearer token');
    const envelope = {
      json: JSON.stringify({ encryptedBodyPath: 'blobs/email-body-123' })
    };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => envelope
    } as Response);
    mockGetBlob.mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
    mockGetCurrentKey.mockReturnValue(new Uint8Array(32));
    mockImportKey.mockResolvedValue('crypto-key');
    mockDecrypt.mockResolvedValue(new TextEncoder().encode('Hello World'));

    const { result } = renderHook(() => useClientEmailBodyOperations());
    const body = await result.current.fetchDecryptedBody('email-1');

    expect(body).toBe('Hello World');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      'https://api.test/connect/tearleads.v1.VfsService/GetEmail',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ id: 'email-1' })
      })
    );
    expect(mockGetBlob).toHaveBeenCalledWith('blobs/email-body-123');
  });

  it('returns inline rawData without fetching blob ciphertext', async () => {
    mockGetAuthHeaderValue.mockReturnValue('Bearer token');
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        json: JSON.stringify({
          rawData: 'From: system@tearleads.com\r\n\r\nHello from scaffold'
        })
      })
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    const body = await result.current.fetchDecryptedBody('email-inline');

    expect(body).toContain('Hello from scaffold');
    expect(mockGetBlob).not.toHaveBeenCalled();
    expect(mockImportKey).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('omits Authorization header when auth is null', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    const envelope = {
      json: JSON.stringify({ encryptedBodyPath: 'blobs/path' })
    };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => envelope
    } as Response);
    mockGetBlob.mockResolvedValue({ data: new Uint8Array() });
    mockGetCurrentKey.mockReturnValue(new Uint8Array(32));
    mockImportKey.mockResolvedValue('key');
    mockDecrypt.mockResolvedValue(new TextEncoder().encode(''));

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await result.current.fetchDecryptedBody('email-1');

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('throws on non-ok response', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      statusText: 'Not Found'
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Failed to fetch email: Not Found'
    );
  });

  it('throws on invalid envelope (not a record)', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => 'not-an-object'
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Invalid email response'
    );
  });

  it('throws when envelope json field is not a string', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ json: 123 })
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Invalid email response envelope'
    );
  });

  it('throws when email data is not a record', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ json: '"just a string"' })
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Invalid email data'
    );
  });

  it('throws when encryptedBodyPath is missing', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ json: JSON.stringify({}) })
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Email has no body content'
    );
  });

  it('throws when encryptedBodyPath is empty string', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        json: JSON.stringify({ encryptedBodyPath: '' })
      })
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Email has no body content'
    );
  });

  it('throws when encryption key is not available', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        json: JSON.stringify({ encryptedBodyPath: 'blobs/x' })
      })
    } as Response);
    mockGetBlob.mockResolvedValue({ data: new Uint8Array() });
    mockGetCurrentKey.mockReturnValue(null);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Encryption key not available'
    );
  });

  it('throws on array envelope (isRecord rejects arrays)', async () => {
    mockGetAuthHeaderValue.mockReturnValue(null);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => [1, 2, 3]
    } as Response);

    const { result } = renderHook(() => useClientEmailBodyOperations());
    await expect(result.current.fetchDecryptedBody('email-1')).rejects.toThrow(
      'Invalid email response'
    );
  });
});
