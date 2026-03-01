import { Code, ConnectError } from '@connectrpc/connect';
import { DeleteSessionRequest } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectAuthContext } from '../../context.js';
import {
  getAuthContextOrThrow,
  getClientIpFromHeaders,
  getJwtSecretOrThrow,
  parseRequiredSessionId,
  toOptionalTimestamp,
  toRequiredTimestamp
} from './shared.js';

describe('connect auth shared helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('extracts first forwarded IP when x-forwarded-for is set', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 198.51.100.22'
    });

    expect(getClientIpFromHeaders(headers)).toBe('203.0.113.10');
  });

  it('falls back to x-real-ip when forwarded-for is absent', () => {
    const headers = new Headers({
      'x-real-ip': '198.51.100.77'
    });

    expect(getClientIpFromHeaders(headers)).toBe('198.51.100.77');
  });

  it('falls back to localhost when no client IP headers exist', () => {
    expect(getClientIpFromHeaders(new Headers())).toBe('127.0.0.1');
  });

  it('returns JWT secret when configured', () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    expect(getJwtSecretOrThrow('Failed')).toBe('test-secret');
  });

  it('throws internal error when JWT secret is missing', () => {
    vi.unstubAllEnvs();
    expect(() => getJwtSecretOrThrow('Failed')).toThrowError(ConnectError);
    try {
      getJwtSecretOrThrow('Failed');
      throw new Error('Expected ConnectError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (error instanceof ConnectError) {
        expect(error.code).toBe(Code.Internal);
      }
    }
  });

  it('returns auth context when present', () => {
    const context: ConnectAuthContext = {
      claims: {
        sub: 'user-1',
        jti: 'session-1'
      },
      session: {
        userId: 'user-1',
        email: 'user@example.com',
        admin: false,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1'
      }
    };

    expect(getAuthContextOrThrow({ values: context })).toBe(context);
  });

  it('throws unauthenticated when auth context is missing', () => {
    try {
      getAuthContextOrThrow({ values: null });
      throw new Error('Expected ConnectError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (error instanceof ConnectError) {
        expect(error.code).toBe(Code.Unauthenticated);
      }
    }
  });

  it('parses valid timestamps and handles invalid timestamps', () => {
    const dateValue = '2026-01-01T00:00:00.000Z';
    expect(toOptionalTimestamp(dateValue)).toBeDefined();
    expect(toOptionalTimestamp('invalid-date')).toBeUndefined();
    expect(() => toRequiredTimestamp('invalid-date')).toThrowError(
      ConnectError
    );
  });

  it('handles missing timestamp inputs safely', () => {
    expect(toOptionalTimestamp(undefined)).toBeUndefined();
    expect(toOptionalTimestamp(null)).toBeUndefined();

    expect(() => toRequiredTimestamp(undefined)).toThrowError(ConnectError);
    expect(() => toRequiredTimestamp(null)).toThrowError(ConnectError);
  });

  it('parses required session id and rejects empty values', () => {
    expect(
      parseRequiredSessionId(new DeleteSessionRequest({ sessionId: 'abc123' }))
    ).toBe('abc123');

    try {
      parseRequiredSessionId(new DeleteSessionRequest({ sessionId: '   ' }));
      throw new Error('Expected ConnectError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (error instanceof ConnectError) {
        expect(error.code).toBe(Code.InvalidArgument);
      }
    }
  });
});
