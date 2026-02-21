import { describe, expect, it } from 'vitest';
import {
  createRequestNonce,
  isJsonValue,
  isTeeEchoRequest,
  isTeeEchoResponse,
  type JsonValue,
  parseTeeEchoRequest,
  parseTeeEchoResponse,
  stableStringify
} from './index.js';

describe('createRequestNonce', () => {
  it('creates nonce with default byte length', () => {
    const nonce = createRequestNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  it('throws for byte length less than 16', () => {
    expect(() => createRequestNonce(15)).toThrow(
      'byteLength must be at least 16'
    );
    expect(() => createRequestNonce(8)).toThrow(
      'byteLength must be at least 16'
    );
  });

  it('accepts byte length of 16', () => {
    const nonce = createRequestNonce(16);
    expect(nonce.length).toBeGreaterThan(0);
  });
});

describe('json utilities', () => {
  describe('isJsonValue', () => {
    it('returns true for primitives', () => {
      expect(isJsonValue(null)).toBe(true);
      expect(isJsonValue('string')).toBe(true);
      expect(isJsonValue(42)).toBe(true);
      expect(isJsonValue(true)).toBe(true);
      expect(isJsonValue(false)).toBe(true);
    });

    it('returns true for arrays of valid JSON values', () => {
      expect(isJsonValue([1, 2, 3])).toBe(true);
      expect(isJsonValue(['a', 'b'])).toBe(true);
      expect(isJsonValue([{ nested: true }])).toBe(true);
    });

    it('returns false for arrays with invalid items', () => {
      expect(isJsonValue([undefined])).toBe(false);
      expect(isJsonValue([() => {}])).toBe(false);
    });

    it('returns true for objects with valid values', () => {
      expect(isJsonValue({ key: 'value' })).toBe(true);
    });

    it('returns false for functions', () => {
      expect(isJsonValue(() => {})).toBe(false);
    });
  });

  describe('stableStringify', () => {
    it('handles null', () => {
      expect(stableStringify(null)).toBe('null');
    });

    it('handles booleans', () => {
      expect(stableStringify(true)).toBe('true');
      expect(stableStringify(false)).toBe('false');
    });

    it('handles arrays', () => {
      expect(stableStringify([1, 2, 3])).toBe('[1,2,3]');
      expect(stableStringify(['a', 'b'])).toBe('["a","b"]');
    });

    it('throws for non-finite numbers', () => {
      expect(() =>
        stableStringify(Number.POSITIVE_INFINITY as JsonValue)
      ).toThrow('Non-finite numbers');
      expect(() => stableStringify(Number.NaN as JsonValue)).toThrow(
        'Non-finite numbers'
      );
    });

    it('handles floating point numbers', () => {
      expect(stableStringify(3.14)).toBe('3.14');
    });

    it('throws for undefined object values', () => {
      const obj = { key: undefined } as unknown as JsonValue;
      expect(() => stableStringify(obj)).toThrow('Undefined object values');
    });
  });
});

describe('contracts', () => {
  describe('isTeeEchoRequest', () => {
    it('returns true for valid request', () => {
      expect(isTeeEchoRequest({ message: 'hello' })).toBe(true);
    });

    it('returns false for non-object', () => {
      expect(isTeeEchoRequest('string')).toBe(false);
      expect(isTeeEchoRequest(null)).toBe(false);
      expect(isTeeEchoRequest(undefined)).toBe(false);
    });

    it('returns false for missing message', () => {
      expect(isTeeEchoRequest({})).toBe(false);
    });

    it('returns false for empty message', () => {
      expect(isTeeEchoRequest({ message: '' })).toBe(false);
    });
  });

  describe('parseTeeEchoRequest', () => {
    it('parses valid request', () => {
      const result = parseTeeEchoRequest({ message: 'test' });
      expect(result).toEqual({ message: 'test' });
    });

    it('throws for invalid request', () => {
      expect(() => parseTeeEchoRequest({})).toThrow('Invalid tee echo request');
    });
  });

  describe('isTeeEchoResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isTeeEchoResponse({ message: 'hello', receivedAt: '2026-01-01' })
      ).toBe(true);
    });

    it('returns false for non-object', () => {
      expect(isTeeEchoResponse('string')).toBe(false);
    });

    it('returns false for missing fields', () => {
      expect(isTeeEchoResponse({ message: 'hello' })).toBe(false);
      expect(isTeeEchoResponse({ receivedAt: '2026-01-01' })).toBe(false);
    });
  });

  describe('parseTeeEchoResponse', () => {
    it('parses valid response', () => {
      const result = parseTeeEchoResponse({
        message: 'test',
        receivedAt: '2026-01-01'
      });
      expect(result).toEqual({ message: 'test', receivedAt: '2026-01-01' });
    });

    it('throws for invalid response', () => {
      expect(() => parseTeeEchoResponse({ message: 'test' })).toThrow(
        'Invalid tee echo response'
      );
    });
  });
});
