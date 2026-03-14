import { afterEach, describe, expect, it } from 'vitest';
import { decodeVfsSyncCursor, encodeVfsSyncCursor } from './sync-cursor.js';

const CURSOR_CHANGE_ID = '00000000-0000-0000-0000-000000000123';

function encodeBytesToBase64Url(bytes: Uint8Array): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const byte1 = bytes[index] ?? 0;
    index += 1;
    const byte2 = index < bytes.length ? bytes[index++] : undefined;
    const byte3 = index < bytes.length ? bytes[index++] : undefined;

    const chunk = (byte1 << 16) | ((byte2 ?? 0) << 8) | (byte3 ?? 0);
    output += chars[(chunk >> 18) & 63];
    output += chars[(chunk >> 12) & 63];
    if (byte2 !== undefined) {
      output += chars[(chunk >> 6) & 63];
    }
    if (byte3 !== undefined) {
      output += chars[chunk & 63];
    }
  }

  return output;
}

function uuidToBytesForTest(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  if (hex.length !== 32) {
    throw new Error(`invalid UUID for test payload: ${uuid}`);
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function encodePayloadForTest(
  version: number,
  timestampMs: bigint,
  changeId: string
): string {
  const bytes = new Uint8Array(25);
  bytes[0] = version;
  new DataView(bytes.buffer).setBigInt64(1, timestampMs, false);
  bytes.set(uuidToBytesForTest(changeId), 9);
  return encodeBytesToBase64Url(bytes);
}

describe('vfs sync cursor', () => {
  const originalBufferDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'Buffer'
  );

  afterEach(() => {
    if (originalBufferDescriptor) {
      Object.defineProperty(globalThis, 'Buffer', originalBufferDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, 'Buffer');
  });

  it('encodes and decodes a cursor payload', () => {
    const encoded = encodeVfsSyncCursor({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: CURSOR_CHANGE_ID
    });

    const decoded = decodeVfsSyncCursor(encoded);

    expect(decoded).toEqual({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: CURSOR_CHANGE_ID
    });
  });

  it('returns null for malformed cursor input', () => {
    expect(decodeVfsSyncCursor('not-base64')).toBeNull();
  });

  it('returns null for unsupported version', () => {
    const payload = encodePayloadForTest(
      1,
      BigInt(Date.parse('2025-01-02T03:04:05.000Z')),
      CURSOR_CHANGE_ID
    );

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });

  it('returns null for invalid timestamp', () => {
    const payload = encodePayloadForTest(
      2,
      9_223_372_036_854_775_807n,
      CURSOR_CHANGE_ID
    );

    expect(decodeVfsSyncCursor(payload)).toBeNull();
  });

  it('works when Buffer is not available', () => {
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      writable: true,
      value: undefined
    });

    const encoded = encodeVfsSyncCursor({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: CURSOR_CHANGE_ID
    });

    expect(decodeVfsSyncCursor(encoded)).toEqual({
      changedAt: '2025-01-02T03:04:05.000Z',
      changeId: CURSOR_CHANGE_ID
    });
  });
});
