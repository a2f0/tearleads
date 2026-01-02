import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppVersion } from './useAppVersion';

// Mock detectPlatform
vi.mock('../lib/utils', () => ({
  detectPlatform: vi.fn()
}));

// Mock Capacitor App
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn()
  }
}));

// Import mocks after mocking
import { App } from '@capacitor/app';
import { detectPlatform } from '../lib/utils';

describe('useAppVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on web platform', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('web');
    });

    it('returns __APP_VERSION__ after mount', async () => {
      const { result } = renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(result.current).toBe(__APP_VERSION__);
      });
    });

    it('does not call Capacitor App.getInfo', async () => {
      renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(App.getInfo).not.toHaveBeenCalled();
      });
    });
  });

  describe('on native platform (iOS)', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('ios');
      vi.mocked(App.getInfo).mockResolvedValue({
        name: 'Test App',
        id: 'com.test.app',
        build: '1.2.3',
        version: '1.2.3'
      });
    });

    it('returns build version from Capacitor after mount', async () => {
      const { result } = renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(result.current).toBe('1.2.3');
      });
    });

    it('calls Capacitor App.getInfo', async () => {
      renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(App.getInfo).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('on electron platform', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('electron');
    });

    it('returns __APP_VERSION__ after mount', async () => {
      const { result } = renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(result.current).toBe(__APP_VERSION__);
      });
    });

    it('does not call Capacitor App.getInfo', async () => {
      renderHook(() => useAppVersion());

      await waitFor(() => {
        expect(App.getInfo).not.toHaveBeenCalled();
      });
    });
  });
});
