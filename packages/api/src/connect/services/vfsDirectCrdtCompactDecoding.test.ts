import { describe, expect, it } from 'vitest';
import {
  parseIdentifier,
  parseInteger
} from './vfsDirectCrdtCompactDecoding.js';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('vfsDirectCrdtCompactDecoding', () => {
  it('parses identifiers from string and base64 bytes', () => {
    expect(parseIdentifier('client-1')).toBe('client-1');
    expect(parseIdentifier('desktop')).toBe('desktop');

    const compactUtf8 = toBase64(new TextEncoder().encode('client-2'));
    // Since 'client-2' is not 16 bytes, it will be decoded as a UTF-8 string
    expect(parseIdentifier(compactUtf8)).toBe('client-2');
  });

  it('parses UUID identifiers from compact 16-byte base64 payloads', () => {
    const uuidBytes = Uint8Array.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x01
    ]);

    expect(parseIdentifier(toBase64(uuidBytes))).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
  });

  it('returns null for invalid identifiers', () => {
    expect(parseIdentifier(undefined)).toBeNull();
    expect(parseIdentifier('   ')).toBeNull();
    expect(parseIdentifier(true)).toBeNull();
  });

  it('parses integers', () => {
    expect(parseInteger(7)).toBe(7);
    expect(parseInteger('11')).toBe(11);
  });

  it('rejects invalid integer payloads', () => {
    expect(parseInteger('x')).toBeNull();
    expect(parseInteger('2026-03-09T12:00:00.000Z')).toBeNull();
    expect(parseInteger(true)).toBeNull();
  });
});
