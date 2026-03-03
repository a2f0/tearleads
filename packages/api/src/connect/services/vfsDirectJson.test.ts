import { describe, expect, it } from 'vitest';
import { encoded, isRecord, parseJsonBody } from './vfsDirectJson.js';

describe('vfsDirectJson', () => {
  it('parses JSON payload and normalizes blank payload to object', () => {
    expect(parseJsonBody('{"k":1}')).toEqual({ k: 1 });
    expect(parseJsonBody('   ')).toEqual({});
  });

  it('throws for invalid JSON payload', () => {
    expect(() => parseJsonBody('{bad')).toThrow(/Invalid JSON body/u);
  });

  it('supports simple value helpers', () => {
    expect(encoded('a/b c')).toBe('a%2Fb%20c');

    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});
