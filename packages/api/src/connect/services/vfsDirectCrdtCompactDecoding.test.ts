import { describe, expect, it } from 'vitest';
import {
  parseIdentifier,
  parseInteger
} from './vfsDirectCrdtCompactDecoding.js';

describe('vfsDirectCrdtCompactDecoding', () => {
  it('parses canonical domain identifiers', () => {
    expect(parseIdentifier('client-1')).toBe('client-1');
    expect(parseIdentifier('desktop')).toBe('desktop');
  });

  it('parses canonical UUID identifiers', () => {
    expect(parseIdentifier('00000000-0000-0000-0000-000000000001')).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
  });

  it('returns null for legacy-shape and invalid identifiers', () => {
    expect(parseIdentifier('Y2xpZW50LTI=')).toBeNull();
    expect(parseIdentifier(undefined)).toBeNull();
    expect(parseIdentifier('   ')).toBeNull();
    expect(parseIdentifier(true)).toBeNull();
  });

  it('parses integers', () => {
    expect(parseInteger(7)).toBe(7);
  });

  it('rejects legacy-shape and invalid integer payloads', () => {
    expect(parseInteger('11')).toBeNull();
    expect(parseInteger('x')).toBeNull();
    expect(parseInteger('2026-03-09T12:00:00.000Z')).toBeNull();
    expect(parseInteger(true)).toBeNull();
  });
});
