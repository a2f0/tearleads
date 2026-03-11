import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthStorageRuntimeForTesting } from './authStorage';

describe('auth-storage without window', () => {
  it('no-ops when window is undefined', async () => {
    vi.stubGlobal('window', undefined);

    try {
      const { onAuthChange, setAuthError, clearAuthError, getAuthError } =
        await import('./authStorage');

      const unsubscribe = onAuthChange(() => {});
      expect(typeof unsubscribe).toBe('function');

      setAuthError('oops');
      expect(getAuthError()).toBe('oops');

      clearAuthError();
      expect(getAuthError()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('refresh token storage', () => {
  beforeEach(() => {
    resetAuthStorageRuntimeForTesting();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not read refresh token from localStorage', async () => {
    localStorage.setItem('auth_refresh_token', 'legacy-refresh-token');
    const { getStoredRefreshToken } = await import('./authStorage');

    expect(getStoredRefreshToken()).toBeNull();
  });

  it('stores refresh token only in memory when auth is saved', async () => {
    const { storeAuth, getStoredRefreshToken } = await import('./authStorage');

    storeAuth('access-token', 'refresh-token', {
      id: 'user-1',
      email: 'user@example.com'
    });

    expect(getStoredRefreshToken()).toBe('refresh-token');
    expect(localStorage.getItem('auth_refresh_token')).toBeNull();
  });

  it('can store access token only in memory', async () => {
    const { AUTH_TOKEN_KEY, getStoredAuthToken, storeAuth } = await import(
      './authStorage'
    );

    storeAuth(
      'access-token',
      'refresh-token',
      {
        id: 'user-1',
        email: 'user@example.com'
      },
      { persistToken: false }
    );

    expect(getStoredAuthToken()).toBe('access-token');
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});

describe('cross-tab refresh coordination', () => {
  beforeEach(() => {
    resetAuthStorageRuntimeForTesting();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('tryAcquireRefreshLock', () => {
    it('acquires lock when no lock exists', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      const acquired = tryAcquireRefreshLock();

      expect(acquired).toBe(true);
      expect(localStorage.getItem('auth_refresh_lock')).not.toBeNull();
    });

    it('acquires lock when existing lock is expired', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      const expiredLock = {
        tabId: 'other-tab',
        timestamp: Date.now() - 15000
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(expiredLock));

      const acquired = tryAcquireRefreshLock();

      expect(acquired).toBe(true);
    });

    it('does not acquire lock when another tab holds a valid lock', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      const validLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now()
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(validLock));

      const acquired = tryAcquireRefreshLock();

      expect(acquired).toBe(false);
    });
  });

  describe('releaseRefreshLock', () => {
    it('removes lock when this tab holds it', async () => {
      const { tryAcquireRefreshLock, releaseRefreshLock } = await import(
        './authStorage'
      );

      tryAcquireRefreshLock();
      expect(localStorage.getItem('auth_refresh_lock')).not.toBeNull();

      releaseRefreshLock();

      expect(localStorage.getItem('auth_refresh_lock')).toBeNull();
    });

    it('does not remove lock held by another tab', async () => {
      const { releaseRefreshLock } = await import('./authStorage');

      const otherTabLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now()
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(otherTabLock));

      releaseRefreshLock();

      expect(localStorage.getItem('auth_refresh_lock')).not.toBeNull();
    });
  });

  describe('isRefreshInProgress', () => {
    it('returns false when no lock exists', async () => {
      const { isRefreshInProgress } = await import('./authStorage');

      expect(isRefreshInProgress()).toBe(false);
    });

    it('returns true when another tab holds a valid lock', async () => {
      const { isRefreshInProgress } = await import('./authStorage');

      const validLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now()
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(validLock));

      expect(isRefreshInProgress()).toBe(true);
    });

    it('returns false when lock is expired', async () => {
      const { isRefreshInProgress } = await import('./authStorage');

      const expiredLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now() - 15000
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(expiredLock));

      expect(isRefreshInProgress()).toBe(false);
    });
  });

  describe('waitForRefreshCompletion', () => {
    it('returns true immediately when access token has changed', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_token', 'new-token');

      const result = await waitForRefreshCompletion('old-token', 1000);

      expect(result).toBe(true);
    });

    it('returns false when timeout expires without access token change', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_token', 'same-token');

      const result = await waitForRefreshCompletion('same-token', 200);

      expect(result).toBe(false);
    });

    it('returns true when lock is released and access token changed', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_token', 'old-token');

      const otherTabLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now()
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(otherTabLock));

      const waitPromise = waitForRefreshCompletion('old-token', 2000);

      setTimeout(() => {
        localStorage.setItem('auth_token', 'new-token');
        localStorage.removeItem('auth_refresh_lock');
      }, 100);

      const result = await waitPromise;

      expect(result).toBe(true);
    });
  });
});
