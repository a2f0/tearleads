import { afterEach, describe, expect, it } from 'vitest';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from './authConfig.js';

const ACCESS_TTL_ENV = 'ACCESS_TOKEN_TTL_SECONDS';
const REFRESH_TTL_ENV = 'REFRESH_TOKEN_TTL_SECONDS';
const DEFAULT_ACCESS_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const originalAccessTtl = process.env[ACCESS_TTL_ENV];
const originalRefreshTtl = process.env[REFRESH_TTL_ENV];

afterEach(() => {
  if (originalAccessTtl === undefined) {
    delete process.env[ACCESS_TTL_ENV];
  } else {
    process.env[ACCESS_TTL_ENV] = originalAccessTtl;
  }

  if (originalRefreshTtl === undefined) {
    delete process.env[REFRESH_TTL_ENV];
  } else {
    process.env[REFRESH_TTL_ENV] = originalRefreshTtl;
  }
});

describe('authConfig', () => {
  it('returns configured positive access and refresh token TTLs', () => {
    process.env[ACCESS_TTL_ENV] = '1200';
    process.env[REFRESH_TTL_ENV] = '86400';

    expect(getAccessTokenTtlSeconds()).toBe(1200);
    expect(getRefreshTokenTtlSeconds()).toBe(86400);
  });

  it('falls back to defaults for invalid or non-positive values', () => {
    process.env[ACCESS_TTL_ENV] = '0';
    process.env[REFRESH_TTL_ENV] = 'not-a-number';

    expect(getAccessTokenTtlSeconds()).toBe(DEFAULT_ACCESS_TTL_SECONDS);
    expect(getRefreshTokenTtlSeconds()).toBe(DEFAULT_REFRESH_TTL_SECONDS);
  });
});
