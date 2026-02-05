import { describe, expect, it, vi } from 'vitest';

describe('auth-storage without window', () => {
  it('no-ops when window is undefined', async () => {
    vi.stubGlobal('window', undefined);

    try {
      const { onAuthChange, setAuthError, clearAuthError, getAuthError } =
        await import('./auth-storage');

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
