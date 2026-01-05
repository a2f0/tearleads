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
});
