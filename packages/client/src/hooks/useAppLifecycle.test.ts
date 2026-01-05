import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Capacitor App plugin
const mockAddListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: mockAddListener
  }
}));

// Mock detectPlatform - default to web
const mockDetectPlatform = vi.fn().mockReturnValue('web');
vi.mock('@/lib/utils', () => ({
  detectPlatform: () => mockDetectPlatform()
}));

describe('useAppLifecycle utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectPlatform.mockReturnValue('web');
    // Clear sessionStorage and localStorage before each test
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('session active tracking', () => {
    it('markSessionActive sets session storage flag', async () => {
      const { markSessionActive } = await import('./useAppLifecycle');
      markSessionActive();
      expect(sessionStorage.getItem('rapid_session_active')).toBe('true');
    });

    it('clearSessionActive removes session storage flag', async () => {
      const { markSessionActive, clearSessionActive } = await import(
        './useAppLifecycle'
      );
      markSessionActive();
      clearSessionActive();
      expect(sessionStorage.getItem('rapid_session_active')).toBeNull();
    });

    it('wasSessionActive returns true when session was active', async () => {
      const { markSessionActive, wasSessionActive } = await import(
        './useAppLifecycle'
      );
      markSessionActive();
      expect(wasSessionActive()).toBe(true);
    });

    it('wasSessionActive returns false when session was not active', async () => {
      const { wasSessionActive } = await import('./useAppLifecycle');
      expect(wasSessionActive()).toBe(false);
    });
  });

  describe('model persistence', () => {
    it('saveLastLoadedModel stores model ID in localStorage', async () => {
      const { saveLastLoadedModel } = await import('./useAppLifecycle');
      saveLastLoadedModel('test-model-id');
      expect(localStorage.getItem('rapid_last_loaded_model')).toBe(
        'test-model-id'
      );
    });

    it('getLastLoadedModel retrieves stored model ID', async () => {
      const { saveLastLoadedModel, getLastLoadedModel } = await import(
        './useAppLifecycle'
      );
      saveLastLoadedModel('test-model-id');
      expect(getLastLoadedModel()).toBe('test-model-id');
    });

    it('getLastLoadedModel returns null when no model stored', async () => {
      const { getLastLoadedModel } = await import('./useAppLifecycle');
      expect(getLastLoadedModel()).toBeNull();
    });

    it('clearLastLoadedModel removes stored model ID', async () => {
      const { saveLastLoadedModel, clearLastLoadedModel, getLastLoadedModel } =
        await import('./useAppLifecycle');
      saveLastLoadedModel('test-model-id');
      clearLastLoadedModel();
      expect(getLastLoadedModel()).toBeNull();
    });
  });

  describe('useAppLifecycle hook', () => {
    it('registers visibility change listener on web', async () => {
      mockDetectPlatform.mockReturnValue('web');
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      renderHook(() => useAppLifecycle({ onResume, onPause }));

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('removes visibility change listener on unmount (web)', async () => {
      mockDetectPlatform.mockReturnValue('web');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const { unmount } = renderHook(() => useAppLifecycle());

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('calls onResume when visibility changes to visible (web)', async () => {
      mockDetectPlatform.mockReturnValue('web');

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      renderHook(() => useAppLifecycle({ onResume, onPause }));

      // Simulate visibility change to visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true
      });

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(onResume).toHaveBeenCalled();
    });

    it('calls onPause when visibility changes to hidden (web)', async () => {
      mockDetectPlatform.mockReturnValue('web');

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      renderHook(() => useAppLifecycle({ onResume, onPause }));

      // Simulate visibility change to hidden
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true
      });

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(onPause).toHaveBeenCalled();
    });
  });

  describe('useAppLifecycle hook on mobile', () => {
    beforeEach(() => {
      vi.resetModules();
      mockDetectPlatform.mockReturnValue('ios');
    });

    it('registers app state change listener on iOS', async () => {
      vi.doMock('@/lib/utils', () => ({
        detectPlatform: () => 'ios'
      }));

      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockStateListener = vi
        .fn()
        .mockResolvedValue({ remove: mockRemove });
      vi.doMock('@capacitor/app', () => ({
        App: {
          addListener: mockStateListener
        }
      }));

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      await act(async () => {
        renderHook(() => useAppLifecycle({ onResume, onPause }));
        // Wait for async setup
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(mockStateListener).toHaveBeenCalledWith(
        'appStateChange',
        expect.any(Function)
      );
    });

    it('calls onResume when app becomes active on mobile', async () => {
      let stateChangeCallback: ((state: { isActive: boolean }) => void) | null =
        null;
      const mockRemove = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@/lib/utils', () => ({
        detectPlatform: () => 'ios'
      }));

      vi.doMock('@capacitor/app', () => ({
        App: {
          addListener: vi
            .fn()
            .mockImplementation(
              (
                _event: string,
                callback: (state: { isActive: boolean }) => void
              ) => {
                stateChangeCallback = callback;
                return Promise.resolve({ remove: mockRemove });
              }
            )
        }
      }));

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      await act(async () => {
        renderHook(() => useAppLifecycle({ onResume, onPause }));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Simulate app becoming active
      await act(async () => {
        stateChangeCallback?.({ isActive: true });
      });

      expect(onResume).toHaveBeenCalled();
    });

    it('calls onPause when app becomes inactive on mobile', async () => {
      let stateChangeCallback: ((state: { isActive: boolean }) => void) | null =
        null;
      const mockRemove = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@/lib/utils', () => ({
        detectPlatform: () => 'android'
      }));

      vi.doMock('@capacitor/app', () => ({
        App: {
          addListener: vi
            .fn()
            .mockImplementation(
              (
                _event: string,
                callback: (state: { isActive: boolean }) => void
              ) => {
                stateChangeCallback = callback;
                return Promise.resolve({ remove: mockRemove });
              }
            )
        }
      }));

      const { useAppLifecycle } = await import('./useAppLifecycle');
      const onResume = vi.fn();
      const onPause = vi.fn();

      await act(async () => {
        renderHook(() => useAppLifecycle({ onResume, onPause }));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Simulate app becoming inactive
      await act(async () => {
        stateChangeCallback?.({ isActive: false });
      });

      expect(onPause).toHaveBeenCalled();
    });

    it('removes listener on unmount (mobile)', async () => {
      const mockRemove = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@/lib/utils', () => ({
        detectPlatform: () => 'ios'
      }));

      vi.doMock('@capacitor/app', () => ({
        App: {
          addListener: vi.fn().mockResolvedValue({ remove: mockRemove })
        }
      }));

      const { useAppLifecycle } = await import('./useAppLifecycle');

      let unmountFn: () => void;
      await act(async () => {
        const { unmount } = renderHook(() => useAppLifecycle());
        unmountFn = unmount;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await act(async () => {
        unmountFn();
      });

      expect(mockRemove).toHaveBeenCalled();
    });

    it('handles App.addListener errors gracefully', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      vi.doMock('@/lib/utils', () => ({
        detectPlatform: () => 'ios'
      }));

      vi.doMock('@capacitor/app', () => ({
        App: {
          addListener: vi.fn().mockRejectedValue(new Error('Capacitor error'))
        }
      }));

      const { useAppLifecycle } = await import('./useAppLifecycle');

      await act(async () => {
        renderHook(() => useAppLifecycle());
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to set up app lifecycle listeners:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('storage error handling', () => {
    it('markSessionActive handles storage errors gracefully', async () => {
      const { markSessionActive } = await import('./useAppLifecycle');
      const originalSetItem = sessionStorage.setItem;
      sessionStorage.setItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => markSessionActive()).not.toThrow();

      sessionStorage.setItem = originalSetItem;
    });

    it('clearSessionActive handles storage errors gracefully', async () => {
      const { clearSessionActive } = await import('./useAppLifecycle');
      const originalRemoveItem = sessionStorage.removeItem;
      sessionStorage.removeItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => clearSessionActive()).not.toThrow();

      sessionStorage.removeItem = originalRemoveItem;
    });

    it('wasSessionActive handles storage errors gracefully', async () => {
      const { wasSessionActive } = await import('./useAppLifecycle');
      const originalGetItem = sessionStorage.getItem;
      sessionStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should return false instead of throwing
      expect(wasSessionActive()).toBe(false);

      sessionStorage.getItem = originalGetItem;
    });

    it('saveLastLoadedModel handles storage errors gracefully', async () => {
      const { saveLastLoadedModel } = await import('./useAppLifecycle');
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      expect(() => saveLastLoadedModel('model-id')).not.toThrow();

      localStorage.setItem = originalSetItem;
    });

    it('getLastLoadedModel handles storage errors gracefully', async () => {
      const { getLastLoadedModel } = await import('./useAppLifecycle');
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should return null instead of throwing
      expect(getLastLoadedModel()).toBeNull();

      localStorage.getItem = originalGetItem;
    });

    it('clearLastLoadedModel handles storage errors gracefully', async () => {
      const { clearLastLoadedModel } = await import('./useAppLifecycle');
      const originalRemoveItem = localStorage.removeItem;
      localStorage.removeItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() => clearLastLoadedModel()).not.toThrow();

      localStorage.removeItem = originalRemoveItem;
    });
  });
});
