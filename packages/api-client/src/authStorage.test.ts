import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('cross-tab refresh coordination', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('tryAcquireRefreshLock', () => {
    it('acquires lock when no lock exists', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      const acquired = tryAcquireRefreshLock('refresh-token-1');

      expect(acquired).toBe(true);
      expect(localStorage.getItem('auth_refresh_lock')).not.toBeNull();
    });

    it('acquires lock when existing lock is expired', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      // Set an expired lock (older than 10 seconds)
      const expiredLock = {
        tabId: 'other-tab',
        timestamp: Date.now() - 15000, // 15 seconds ago
        refreshToken: 'old-token'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(expiredLock));

      const acquired = tryAcquireRefreshLock('refresh-token-1');

      expect(acquired).toBe(true);
    });

    it('does not acquire lock when another tab holds a valid lock for same token', async () => {
      const { tryAcquireRefreshLock } = await import('./authStorage');

      // Set a valid lock from another tab
      const validLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now(),
        refreshToken: 'refresh-token-1'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(validLock));

      const acquired = tryAcquireRefreshLock('refresh-token-1');

      expect(acquired).toBe(false);
    });
  });

  describe('releaseRefreshLock', () => {
    it('removes lock when this tab holds it', async () => {
      const { tryAcquireRefreshLock, releaseRefreshLock } = await import(
        './authStorage'
      );

      tryAcquireRefreshLock('refresh-token-1');
      expect(localStorage.getItem('auth_refresh_lock')).not.toBeNull();

      releaseRefreshLock();

      expect(localStorage.getItem('auth_refresh_lock')).toBeNull();
    });

    it('does not remove lock held by another tab', async () => {
      const { releaseRefreshLock } = await import('./authStorage');

      const otherTabLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now(),
        refreshToken: 'refresh-token-1'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(otherTabLock));

      releaseRefreshLock();

      // Lock should still exist since it belongs to another tab
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
        timestamp: Date.now(),
        refreshToken: 'refresh-token-1'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(validLock));

      expect(isRefreshInProgress()).toBe(true);
    });

    it('returns false when lock is expired', async () => {
      const { isRefreshInProgress } = await import('./authStorage');

      const expiredLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now() - 15000, // 15 seconds ago
        refreshToken: 'refresh-token-1'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(expiredLock));

      expect(isRefreshInProgress()).toBe(false);
    });
  });

  describe('waitForRefreshCompletion', () => {
    it('returns true immediately when token has changed', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_refresh_token', 'new-token');

      const result = await waitForRefreshCompletion('old-token', 1000);

      expect(result).toBe(true);
    });

    it('returns false when timeout expires without token change', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_refresh_token', 'same-token');

      const result = await waitForRefreshCompletion('same-token', 200);

      expect(result).toBe(false);
    });

    it('returns true when lock is released and token changed', async () => {
      const { waitForRefreshCompletion } = await import('./authStorage');

      localStorage.setItem('auth_refresh_token', 'old-token');

      // Simulate another tab refreshing
      const otherTabLock = {
        tabId: 'other-tab-id',
        timestamp: Date.now(),
        refreshToken: 'old-token'
      };
      localStorage.setItem('auth_refresh_lock', JSON.stringify(otherTabLock));

      // Start waiting, then simulate the other tab completing
      const waitPromise = waitForRefreshCompletion('old-token', 2000);

      // Simulate other tab finishing after 100ms
      setTimeout(() => {
        localStorage.setItem('auth_refresh_token', 'new-token');
        localStorage.removeItem('auth_refresh_lock');
      }, 100);

      const result = await waitPromise;

      expect(result).toBe(true);
    });
  });
});
