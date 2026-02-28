import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeVfsSyncCursor, encodeVfsSyncCursor } from './sync-cursor.js';

function encodePayloadForTest(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

describe('vfs sync cursor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encodes and decodes a cursor payload', () => {
    const encoded = encodeVfsSyncCursor({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: 'change-123'
    });

    const decoded = decodeVfsSyncCursor(encoded);

    expect(decoded).toEqual({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: 'change-123'
    });
  });

  it('returns null for malformed cursor input', () => {
    expect(decodeVfsSyncCursor('not-base64')).toBeNull();
  });

  it('returns null for unsupported version', () => {
    const payload = encodePayloadForTest({
      version: 999,
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: 'change-123'
    });

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });

  it('returns null for invalid timestamp', () => {
    const payload = encodePayloadForTest({
      version: 1,
      changedAt: 'definitely-not-a-date',
      changeId: 'change-123'
    });

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });

  it('works when Buffer is not available', () => {
    vi.stubGlobal('Buffer', undefined);

    const encoded = encodeVfsSyncCursor({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: 'change-123'
    });

    expect(decodeVfsSyncCursor(encoded)).toEqual({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: 'change-123'
    });
  });
});
