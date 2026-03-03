import { describe, expect, it } from 'vitest';
import { parseBooleanEnv } from './vfsDirectParseBooleanEnv.js';

describe('vfsDirectParseBooleanEnv', () => {
  it('returns the provided default when value is undefined', () => {
    expect(parseBooleanEnv(undefined, true)).toBe(true);
    expect(parseBooleanEnv(undefined, false)).toBe(false);
  });

  it('parses truthy values', () => {
    for (const value of ['1', 'true', 'yes', 'on', '  TRUE  ']) {
      expect(parseBooleanEnv(value, false)).toBe(true);
    }
  });

  it('parses falsey values', () => {
    for (const value of ['0', 'false', 'no', 'off', '  false  ']) {
      expect(parseBooleanEnv(value, true)).toBe(false);
    }
  });

  it('falls back to default for unknown values', () => {
    expect(parseBooleanEnv('maybe', true)).toBe(true);
    expect(parseBooleanEnv('maybe', false)).toBe(false);
  });
});
