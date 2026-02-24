import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: 'test_os_user' })
  }
}));

const originalEnv = process.env;

describe('postgresDefaults', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env['NODE_ENV'];
    delete process.env['USER'];
    delete process.env['LOGNAME'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isDevMode', () => {
    it('returns true when NODE_ENV is development', async () => {
      process.env['NODE_ENV'] = 'development';
      const { isDevMode } = await import('./postgresDefaults.js');
      expect(isDevMode()).toBe(true);
    });

    it('returns true when NODE_ENV is unset', async () => {
      delete process.env['NODE_ENV'];
      const { isDevMode } = await import('./postgresDefaults.js');
      expect(isDevMode()).toBe(true);
    });

    it('returns false when NODE_ENV is test', async () => {
      process.env['NODE_ENV'] = 'test';
      const { isDevMode } = await import('./postgresDefaults.js');
      expect(isDevMode()).toBe(false);
    });

    it('returns false when NODE_ENV is production', async () => {
      process.env['NODE_ENV'] = 'production';
      const { isDevMode } = await import('./postgresDefaults.js');
      expect(isDevMode()).toBe(false);
    });
  });

  describe('getPostgresDevDefaults', () => {
    it('returns empty object in non-dev mode', async () => {
      process.env['NODE_ENV'] = 'production';
      const { getPostgresDevDefaults } = await import('./postgresDefaults.js');
      expect(getPostgresDevDefaults()).toEqual({});
    });

    it('returns defaults with platform-aware host in dev mode', async () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['USER'];
      delete process.env['LOGNAME'];
      const { getPostgresDevDefaults } = await import('./postgresDefaults.js');
      const defaults = getPostgresDevDefaults();
      const expectedHost =
        process.platform === 'linux' ? '/var/run/postgresql' : 'localhost';
      expect(defaults.host).toBe(expectedHost);
      expect(defaults.port).toBe(5432);
      expect(defaults.database).toBe('tearleads_development');
      expect(defaults.user).toBe('test_os_user');
    });

    it('uses USER env var when available', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['USER'] = 'env_user';
      const { getPostgresDevDefaults } = await import('./postgresDefaults.js');
      expect(getPostgresDevDefaults().user).toBe('env_user');
    });

    it('uses LOGNAME when USER is unset', async () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['USER'];
      process.env['LOGNAME'] = 'logname_user';
      const { getPostgresDevDefaults } = await import('./postgresDefaults.js');
      expect(getPostgresDevDefaults().user).toBe('logname_user');
    });

    it('returns defaults when NODE_ENV is unset', async () => {
      delete process.env['NODE_ENV'];
      process.env['USER'] = 'dev_user';
      const { getPostgresDevDefaults } = await import('./postgresDefaults.js');
      const defaults = getPostgresDevDefaults();
      expect(defaults.port).toBe(5432);
      expect(defaults.database).toBe('tearleads_development');
      expect(defaults.user).toBe('dev_user');
    });
  });
});
