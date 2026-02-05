import { describe, expect, it } from 'vitest';

describe('auth-storage without window', () => {
  it('no-ops when window is undefined', async () => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window;
    };
    const originalWindow = globalWithWindow.window;
    globalWithWindow.window = undefined as unknown as Window;

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
      globalWithWindow.window = originalWindow;
    }
  });
});
