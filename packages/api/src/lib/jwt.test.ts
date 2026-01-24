import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyJwt, verifyRefreshJwt } from './jwt.js';

describe('jwt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyJwt', () => {
    it('returns null when decoded payload is not a record', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue('not-an-object' as never);

      const result = verifyJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when sub is not a string', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 123,
        jti: 'token-id'
      } as never);

      const result = verifyJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when jti is not a string', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 'user-id',
        jti: { invalid: true }
      } as never);

      const result = verifyJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when email is defined but not a string', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 'user-id',
        jti: 'token-id',
        email: 12345
      } as never);

      const result = verifyJwt('some-token', 'secret');

      expect(result).toBeNull();
    });
  });

  describe('verifyRefreshJwt', () => {
    it('returns null when decoded payload is not a record', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue('not-an-object' as never);

      const result = verifyRefreshJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when sub is not a string', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 123,
        jti: 'token-id',
        sid: 'session-id',
        type: 'refresh'
      } as never);

      const result = verifyRefreshJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when type is not refresh', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 'user-id',
        jti: 'token-id',
        sid: 'session-id',
        type: 'access'
      } as never);

      const result = verifyRefreshJwt('some-token', 'secret');

      expect(result).toBeNull();
    });

    it('returns null when sid is not a string', () => {
      vi.spyOn(jwt, 'verify').mockReturnValue({
        sub: 'user-id',
        jti: 'token-id',
        sid: null,
        type: 'refresh'
      } as never);

      const result = verifyRefreshJwt('some-token', 'secret');

      expect(result).toBeNull();
    });
  });
});
