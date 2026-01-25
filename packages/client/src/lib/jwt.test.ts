import { describe, expect, it } from 'vitest';
import {
  decodeJwt,
  getJwtExpiration,
  getJwtTimeRemaining,
  isJwtExpired
} from './jwt';

// Create a test JWT with a specific expiration
function createTestJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: 'user123', exp }));
  const signature = 'test-signature';
  return `${header}.${payload}.${signature}`;
}

describe('jwt utilities', () => {
  describe('decodeJwt', () => {
    it('decodes a valid JWT', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
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
      const exp = Math.floor(Date.now() / 1000) + 3600;
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
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = createTestJwt(exp);
      expect(isJwtExpired(token)).toBe(false);
    });

    it('returns true for expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const token = createTestJwt(exp);
      expect(isJwtExpired(token)).toBe(true);
    });

    it('returns true for invalid token', () => {
      expect(isJwtExpired('invalid')).toBe(true);
    });
  });

  describe('getJwtTimeRemaining', () => {
    it('returns milliseconds remaining for non-expired token', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = createTestJwt(exp);
      const remaining = getJwtTimeRemaining(token);
      expect(remaining).toBeGreaterThan(3500000);
      expect(remaining).toBeLessThanOrEqual(3600000);
    });

    it('returns null for expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const token = createTestJwt(exp);
      expect(getJwtTimeRemaining(token)).toBeNull();
    });

    it('returns null for invalid token', () => {
      expect(getJwtTimeRemaining('invalid')).toBeNull();
    });
  });
});
