import { describe, expect, it } from 'vitest';
import {
  parseEnumWithCompactFallback,
  parseIdentifierWithCompactFallback,
  parseOccurredAtWithCompactFallback,
  parsePositiveSafeIntegerWithCompactFallback
} from './vfsDirectCrdtCompactDecoding.js';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('vfsDirectCrdtCompactDecoding', () => {
  it('parses identifiers from string and compact bytes', () => {
    expect(parseIdentifierWithCompactFallback('client-1', undefined)).toBe(
      'client-1'
    );

    const compactUtf8 = toBase64(new TextEncoder().encode('client-2'));
    expect(parseIdentifierWithCompactFallback(undefined, compactUtf8)).toBe(
      'client-2'
    );

    expect(
      parseIdentifierWithCompactFallback(undefined, new TextEncoder().encode('client-3'))
    ).toBe('client-3');

    expect(
      parseIdentifierWithCompactFallback(undefined, [99, 108, 105, 101, 110, 116, 45, 52])
    ).toBe('client-4');
  });

  it('parses UUID identifiers from compact 16-byte payloads', () => {
    const uuidBytes = Uint8Array.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x01
    ]);

    expect(parseIdentifierWithCompactFallback(undefined, toBase64(uuidBytes))).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
  });

  it('returns null for invalid compact identifiers', () => {
    expect(parseIdentifierWithCompactFallback(undefined, '***')).toBeNull();
    expect(parseIdentifierWithCompactFallback('   ', [])).toBeNull();
    expect(parseIdentifierWithCompactFallback(undefined, [256])).toBeNull();
    expect(parseIdentifierWithCompactFallback(undefined, [1.5])).toBeNull();
    expect(parseIdentifierWithCompactFallback(undefined, true)).toBeNull();
  });

  it('parses positive integers from legacy and compact fields', () => {
    expect(parsePositiveSafeIntegerWithCompactFallback(7, 9)).toBe(7);
    expect(parsePositiveSafeIntegerWithCompactFallback(undefined, '11')).toBe(
      11
    );
    expect(
      parsePositiveSafeIntegerWithCompactFallback(undefined, BigInt(13))
    ).toBe(13);
  });

  it('rejects non-positive or invalid integer payloads', () => {
    expect(parsePositiveSafeIntegerWithCompactFallback(0, '9')).toBeNull();
    expect(parsePositiveSafeIntegerWithCompactFallback(undefined, 'x')).toBeNull();
    expect(
      parsePositiveSafeIntegerWithCompactFallback(
        undefined,
        BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)
      )
    ).toBeNull();
  });

  it('parses occurredAt from ISO and occurredAtMs', () => {
    expect(
      parseOccurredAtWithCompactFallback('2026-03-13T00:00:00.000Z', undefined)
    ).toBe('2026-03-13T00:00:00.000Z');
    expect(parseOccurredAtWithCompactFallback(undefined, '1760572800000')).toBe(
      '2025-10-16T00:00:00.000Z'
    );
  });

  it('rejects invalid occurredAt payloads', () => {
    expect(parseOccurredAtWithCompactFallback('not-a-date', 1760572800000)).toBe(
      null
    );
    expect(parseOccurredAtWithCompactFallback(undefined, -1)).toBeNull();
    expect(parseOccurredAtWithCompactFallback(undefined, 'x')).toBeNull();
  });

  it('parses compact enums from legacy, names, and numbers', () => {
    const isLegacyValue = (candidate: unknown): candidate is 'alpha' | 'beta' =>
      candidate === 'alpha' || candidate === 'beta';

    expect(
      parseEnumWithCompactFallback('alpha', undefined, {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' }
      })
    ).toBe('alpha');

    expect(
      parseEnumWithCompactFallback(undefined, 'BETA', {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' }
      })
    ).toBe('beta');

    expect(
      parseEnumWithCompactFallback(undefined, 2, {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' }
      })
    ).toBe('beta');
  });

  it('supports unspecified compact enum values and invalid fallbacks', () => {
    const isLegacyValue = (candidate: unknown): candidate is 'alpha' | 'beta' =>
      candidate === 'alpha' || candidate === 'beta';

    expect(
      parseEnumWithCompactFallback(undefined, 0, {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' },
        allowUnspecified: true
      })
    ).toBeNull();

    expect(
      parseEnumWithCompactFallback(undefined, 'UNKNOWN', {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' }
      })
    ).toBeNull();

    expect(
      parseEnumWithCompactFallback(undefined, null, {
        isLegacyValue,
        numericMap: { 1: 'alpha', 2: 'beta' },
        nameMap: { ALPHA: 'alpha', BETA: 'beta' }
      })
    ).toBeNull();
  });
});
