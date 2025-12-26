/**
 * Unit tests for web-crypto utilities.
 *
 * Note: Full Web Crypto API tests would require a browser environment.
 * jsdom doesn't fully support Web Crypto, so we test the functions
 * that work in Node.js and mock the complex crypto operations.
 */

import { describe, expect, it } from 'vitest';
import { generateSalt, secureZero } from './web-crypto';

describe('web-crypto', () => {
  describe('generateSalt', () => {
    it('generates a 32-byte salt', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(32);
    });

    it('generates unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      // Convert to strings to compare - should be different
      const str1 = Array.from(salt1).join(',');
      const str2 = Array.from(salt2).join(',');
      expect(str1).not.toEqual(str2);
    });
  });

  describe('secureZero', () => {
    it('zeroes out a buffer', () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      secureZero(buffer);

      // Should be all zeros
      expect(buffer.every((b) => b === 0)).toBe(true);
    });

    it('works on empty buffer', () => {
      const buffer = new Uint8Array(0);
      expect(() => secureZero(buffer)).not.toThrow();
    });

    it('works on large buffer', () => {
      const buffer = new Uint8Array(1000).fill(255);
      secureZero(buffer);
      expect(buffer.every((b) => b === 0)).toBe(true);
    });
  });
});
