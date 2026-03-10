import { describe, expect, it } from 'vitest';
import {
  isVfsDatabaseNotInitializedError,
  isVfsTransientInstanceSwitchError,
  isVfsUnauthorizedError
} from './vfsSyncErrorClassification';

describe('vfsSyncErrorClassification', () => {
  it('detects unauthorized errors through nested cause chains', () => {
    const wrappedError = {
      message: 'rematerialization failed',
      cause: new Error('Unauthorized')
    };

    expect(isVfsUnauthorizedError(wrappedError)).toBe(true);
  });

  it('detects connect unauthenticated errors via numeric code', () => {
    const connectErrorLike = {
      name: 'ConnectError',
      code: 16,
      message: '[unknown] stale token'
    };

    expect(isVfsUnauthorizedError(connectErrorLike)).toBe(true);
  });

  it('detects unauthorized status codes nested in response envelopes', () => {
    const wrappedResponseError = {
      error: {
        response: {
          status: 401
        }
      }
    };

    expect(isVfsUnauthorizedError(wrappedResponseError)).toBe(true);
  });

  it('detects database initialization race errors through nested wrappers', () => {
    const wrappedDatabaseError = {
      error: {
        cause: {
          code: 'DATABASE_NOT_INITIALIZED',
          message: 'sqlite bootstrap pending'
        }
      }
    };

    expect(isVfsDatabaseNotInitializedError(wrappedDatabaseError)).toBe(true);
  });

  it('flags transient instance-switch errors and excludes unrelated failures', () => {
    const unauthorizedWrapper = {
      reason: {
        cause: new Error('API error: 401')
      }
    };
    const dbInitWrapper = {
      data: {
        message: 'Database not initialized'
      }
    };

    expect(isVfsTransientInstanceSwitchError(unauthorizedWrapper)).toBe(true);
    expect(isVfsTransientInstanceSwitchError(dbInitWrapper)).toBe(true);
    expect(
      isVfsTransientInstanceSwitchError(new Error('network timeout'))
    ).toBe(false);
  });
});
