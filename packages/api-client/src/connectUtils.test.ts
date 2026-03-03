import { describe, expect, it } from 'vitest';

import { normalizeBearerToken, toConnectBaseUrl } from './connectUtils';

describe('toConnectBaseUrl', () => {
  it('appends /connect when base url does not include it', () => {
    expect(toConnectBaseUrl('https://api.example.com')).toBe(
      'https://api.example.com/connect'
    );
  });

  it('returns existing /connect suffix unchanged', () => {
    expect(toConnectBaseUrl('https://api.example.com/connect')).toBe(
      'https://api.example.com/connect'
    );
  });

  it('trims whitespace and trailing slash before appending /connect', () => {
    expect(toConnectBaseUrl('  https://api.example.com/  ')).toBe(
      'https://api.example.com/connect'
    );
  });

  it('throws when apiBaseUrl is blank after trimming', () => {
    expect(() => toConnectBaseUrl('   ')).toThrow('apiBaseUrl is required');
  });
});

describe('normalizeBearerToken', () => {
  it('returns null for nullish or blank tokens', () => {
    expect(normalizeBearerToken(undefined)).toBeNull();
    expect(normalizeBearerToken(null)).toBeNull();
    expect(normalizeBearerToken('')).toBeNull();
    expect(normalizeBearerToken('   ')).toBeNull();
  });

  it('returns trimmed token when it has no Bearer prefix', () => {
    expect(normalizeBearerToken('  abc123  ')).toBe('abc123');
  });

  it('removes Bearer prefix and trims remaining token', () => {
    expect(normalizeBearerToken('Bearer abc123')).toBe('abc123');
    expect(normalizeBearerToken('  Bearer   abc123   ')).toBe('abc123');
  });

  it('returns trimmed token when value is only Bearer prefix text', () => {
    expect(normalizeBearerToken('Bearer')).toBe('Bearer');
    expect(normalizeBearerToken('Bearer   ')).toBe('Bearer');
  });
});
