import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestJwt } from '@/test/jwtTestUtils';
import {
  decodeJwt,
  getJwtExpiration,
  getJwtTimeRemaining,
  isJwtExpired
} from './jwt';

describe('jwt utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('decodeJwt', () => {
    it('decodes a valid JWT', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const exp = Math.floor(now / 1000) + 3600;
      const token = createTestJwt(exp);
      const claims = decodeJwt(token);
      expect(claims).toEqual({ sub: 'user123', exp });
    });

    it('returns null for invalid token format', () => {
      expect(decodeJwt('invalid')).toBeNull();
      expect(decodeJwt('only.two')).toBeNull();
      expect(decodeJwt('')).toBeNull();
    });

    it('returns null for invalid base64', () => {
      expect(decodeJwt('a.!!!invalid!!!.c')).toBeNull();
    });
  });

  describe('getJwtExpiration', () => {
    it('returns expiration timestamp', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const exp = Math.floor(now / 1000) + 3600;
      const token = createTestJwt(exp);
      expect(getJwtExpiration(token)).toBe(exp);
    });

    it('returns null for token without exp claim', () => {
      const header = btoa(JSON.stringify({ alg: 'HS256' }));
      const payload = btoa(JSON.stringify({ sub: 'user123' }));
      const token = `${header}.${payload}.sig`;
      expect(getJwtExpiration(token)).toBeNull();
    });

    it('returns null for invalid token', () => {
      expect(getJwtExpiration('invalid')).toBeNull();
    });
  });

  describe('isJwtExpired', () => {
    it('returns false for non-expired token', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const exp = Math.floor(now / 1000) + 3600;
      const token = createTestJwt(exp);
      expect(isJwtExpired(token)).toBe(false);
    });

    it('returns true for expired token', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const exp = Math.floor(now / 1000) - 3600;
      const token = createTestJwt(exp);
      expect(isJwtExpired(token)).toBe(true);
    });

    it('returns true for invalid token', () => {
      expect(isJwtExpired('invalid')).toBe(true);
    });
  });

  describe('getJwtTimeRemaining', () => {
    it('returns milliseconds remaining for non-expired token', () => {
      // Set a fixed time first
      const baseTime = new Date('2024-01-01T12:00:00.000Z').getTime();
      vi.setSystemTime(baseTime);

      // Create token that expires 1 hour from the fixed time
      const exp = Math.floor(baseTime / 1000) + 3600;
      const token = createTestJwt(exp);

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);

      const remaining = getJwtTimeRemaining(token);
      expect(remaining).toBe(3600 * 1000 - 1000); // Exactly 3599000ms
    });

    it('returns null for expired token', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const exp = Math.floor(now / 1000) - 3600;
      const token = createTestJwt(exp);
      expect(getJwtTimeRemaining(token)).toBeNull();
    });

    it('returns null for invalid token', () => {
      expect(getJwtTimeRemaining('invalid')).toBeNull();
    });
  });
});
