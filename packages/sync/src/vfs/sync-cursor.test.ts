import { describe, expect, it } from 'vitest';
import { decodeVfsSyncCursor, encodeVfsSyncCursor } from './sync-cursor.js';

describe('vfs sync cursor', () => {
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
    const payload = Buffer.from(
      JSON.stringify({
        version: 999,
        changedAt: '2025-01-02T03:04:05.000Z',
        changeId: 'change-123'
      }),
      'utf8'
    ).toString('base64url');

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });

  it('returns null for invalid timestamp', () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        changedAt: 'definitely-not-a-date',
        changeId: 'change-123'
      }),
      'utf8'
    ).toString('base64url');

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });
});
