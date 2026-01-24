import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAuthError,
  clearStoredAuth,
  getAuthError,
  getAuthHeaderValue,
  getStoredAuthToken,
  getStoredRefreshToken,
  onAuthChange,
  readStoredAuth,
  setAuthError,
  setSessionExpiredError,
  storeAuth,
  updateStoredTokens
} from './auth-storage';

describe('auth-storage', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAuthError();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('auth error management', () => {
    it('gets and sets auth error', () => {
      expect(getAuthError()).toBeNull();
      setAuthError('Test error');
      expect(getAuthError()).toBe('Test error');
    });

    it('clears auth error', () => {
      setAuthError('Test error');
      clearAuthError();
      expect(getAuthError()).toBeNull();
    });

    it('sets session expired error', () => {
      setSessionExpiredError();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });
  });

  describe('auth change listener', () => {
    it('calls listener when auth changes', () => {
      const listener = vi.fn();
      const unsubscribe = onAuthChange(listener);

      setAuthError('Test');
      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it('removes listener on unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = onAuthChange(listener);
      unsubscribe();

      setAuthError('Test');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('stored auth', () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };

    it('reads stored auth when present', () => {
      storeAuth('test-token', 'test-refresh-token', mockUser);
      const result = readStoredAuth();
      expect(result.token).toBe('test-token');
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.user).toEqual(mockUser);
    });

    it('returns null when no auth stored', () => {
      const result = readStoredAuth();
      expect(result.token).toBeNull();
      expect(result.refreshToken).toBeNull();
      expect(result.user).toBeNull();
    });

    it('clears stored auth', () => {
      storeAuth('test-token', 'test-refresh-token', mockUser);
      clearStoredAuth();
      const result = readStoredAuth();
      expect(result.token).toBeNull();
      expect(result.refreshToken).toBeNull();
    });

    it('handles invalid JSON in stored user', () => {
      localStorage.setItem('auth_token', 'token');
      localStorage.setItem('auth_user', 'invalid-json');
      const result = readStoredAuth();
      expect(result.token).toBeNull();
      expect(result.user).toBeNull();
    });
  });

  describe('getStoredAuthToken', () => {
    it('returns token when present', () => {
      localStorage.setItem('auth_token', 'my-token');
      expect(getStoredAuthToken()).toBe('my-token');
    });

    it('returns null when token not present', () => {
      expect(getStoredAuthToken()).toBeNull();
    });

    it('returns null when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage error');
      });
      expect(getStoredAuthToken()).toBeNull();
    });
  });

  describe('getAuthHeaderValue', () => {
    it('returns Bearer token when present', () => {
      localStorage.setItem('auth_token', 'my-token');
      expect(getAuthHeaderValue()).toBe('Bearer my-token');
    });

    it('returns null when no token', () => {
      expect(getAuthHeaderValue()).toBeNull();
    });
  });

  describe('getStoredRefreshToken', () => {
    it('returns refresh token when present', () => {
      localStorage.setItem('auth_refresh_token', 'my-refresh-token');
      expect(getStoredRefreshToken()).toBe('my-refresh-token');
    });

    it('returns null when refresh token not present', () => {
      expect(getStoredRefreshToken()).toBeNull();
    });

    it('returns null when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage error');
      });
      expect(getStoredRefreshToken()).toBeNull();
    });
  });

  describe('updateStoredTokens', () => {
    it('updates access and refresh tokens', () => {
      updateStoredTokens('new-access', 'new-refresh');
      expect(getStoredAuthToken()).toBe('new-access');
      expect(getStoredRefreshToken()).toBe('new-refresh');
    });

    it('handles localStorage errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      expect(() => updateStoredTokens('token', 'refresh')).not.toThrow();
    });
  });

  describe('storeAuth error handling', () => {
    it('handles localStorage errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      expect(() =>
        storeAuth('token', 'refresh', { id: 'user', email: 'test@test.com' })
      ).not.toThrow();
    });
  });

  describe('clearStoredAuth error handling', () => {
    it('handles localStorage errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('Storage error');
      });
      // Should not throw
      expect(() => clearStoredAuth()).not.toThrow();
    });
  });
});
