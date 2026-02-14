/**
 * Unit tests for SettingsProvider.
 */

import {
  act,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Store for mocked localStorage
let localStorageData: Record<string, string> = {};

// Mock localStorage before imports
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageData[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageData[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageData[key];
    }),
    clear: vi.fn(() => {
      localStorageData = {};
    })
  },
  writable: true
});

// Import after mocks
import {
  SettingsProvider,
  useSettings,
  useSettingsOptional
} from './SettingsProvider.js';

function TestConsumer() {
  const { getSetting, setSetting, isSynced } = useSettings();
  return (
    <div>
      <span data-testid="theme">{getSetting('theme')}</span>
      <span data-testid="language">{getSetting('language')}</span>
      <span data-testid="synced">{isSynced ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => setSetting('theme', 'dark')}>
        Set Dark
      </button>
      <button type="button" onClick={() => setSetting('language', 'es')}>
        Set Spanish
      </button>
    </div>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe('SettingsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
  });

  describe('useSettings hook', () => {
    it('throws error when used outside SettingsProvider', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useSettings());
      }).toThrow('useSettings must be used within a SettingsProvider');

      consoleSpy.mockRestore();
    });

    it('returns context when used within provider', () => {
      const { result } = renderHook(() => useSettings(), { wrapper });

      expect(result.current).toHaveProperty('getSetting');
      expect(result.current).toHaveProperty('setSetting');
      expect(result.current).toHaveProperty('isSynced');
    });
  });

  describe('useSettingsOptional hook', () => {
    it('returns null when used outside SettingsProvider', () => {
      const { result } = renderHook(() => useSettingsOptional());

      expect(result.current).toBeNull();
    });

    it('returns context when used within provider', () => {
      const { result } = renderHook(() => useSettingsOptional(), { wrapper });

      expect(result.current).not.toBeNull();
      expect(result.current).toHaveProperty('getSetting');
    });
  });

  describe('getSetting', () => {
    it('returns default value when setting not in localStorage', () => {
      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');
      expect(screen.getByTestId('language')).toHaveTextContent('en');
    });

    it('returns value from localStorage', () => {
      localStorageData['theme'] = 'dark';
      localStorageData['i18nextLng'] = 'es';

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(screen.getByTestId('language')).toHaveTextContent('es');
    });
  });

  describe('setSetting', () => {
    it('updates setting and writes to localStorage', async () => {
      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>
      );

      await act(async () => {
        screen.getByText('Set Dark').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('does not call saveSettingToDb when not provided', async () => {
      const saveSettingToDb = vi.fn();

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>
      );

      await act(async () => {
        screen.getByText('Set Dark').click();
      });

      expect(saveSettingToDb).not.toHaveBeenCalled();
    });

    it('calls saveSettingToDb when provided', async () => {
      const saveSettingToDb = vi.fn().mockResolvedValue(undefined);

      render(
        <SettingsProvider saveSettingToDb={saveSettingToDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await act(async () => {
        screen.getByText('Set Dark').click();
      });

      expect(saveSettingToDb).toHaveBeenCalledWith('theme', 'dark');
    });

    it('handles database write errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const saveSettingToDb = vi.fn().mockRejectedValue(new Error('DB error'));

      render(
        <SettingsProvider saveSettingToDb={saveSettingToDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await act(async () => {
        screen.getByText('Set Dark').click();
      });

      // Should still update localStorage
      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');

      // Wait for the promise rejection to be handled
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to save setting theme to database:',
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });
  });

  describe('database sync', () => {
    it('syncs settings from database when getSettingsFromDb is provided', async () => {
      const getSettingsFromDb = vi.fn().mockResolvedValue({
        theme: 'tokyo-night',
        language: 'ua'
      });

      render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('synced')).toHaveTextContent('yes');
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('tokyo-night');
      expect(screen.getByTestId('language')).toHaveTextContent('ua');
    });

    it('writes database settings to localStorage on sync', async () => {
      const getSettingsFromDb = vi.fn().mockResolvedValue({
        theme: 'dark'
      });

      render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
      });
    });

    it('dispatches settings-synced event when settings loaded from db', async () => {
      const getSettingsFromDb = vi.fn().mockResolvedValue({
        theme: 'dark',
        language: 'es'
      });
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'settings-synced',
            detail: {
              settings: { theme: 'dark', language: 'es' }
            }
          })
        );
      });

      dispatchSpy.mockRestore();
    });

    it('does not dispatch event when no settings in database', async () => {
      const getSettingsFromDb = vi.fn().mockResolvedValue({});
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('synced')).toHaveTextContent('yes');
      });

      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'settings-synced' })
      );

      dispatchSpy.mockRestore();
    });

    it('only syncs once per database unlock', async () => {
      const getSettingsFromDb = vi.fn().mockResolvedValue({
        theme: 'dark'
      });

      const { rerender } = render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('synced')).toHaveTextContent('yes');
      });

      // Rerender with same function
      rerender(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      // Should only be called once
      expect(getSettingsFromDb).toHaveBeenCalledTimes(1);
    });

    it('handles sync errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const getSettingsFromDb = vi
        .fn()
        .mockRejectedValue(new Error('Sync error'));

      render(
        <SettingsProvider getSettingsFromDb={getSettingsFromDb}>
          <TestConsumer />
        </SettingsProvider>
      );

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to sync settings from database:',
          expect.any(Error)
        );
      });

      // Should still use defaults
      expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');

      consoleSpy.mockRestore();
    });
  });

  describe('children rendering', () => {
    it('renders children correctly', () => {
      render(
        <SettingsProvider>
          <div data-testid="child">Hello World</div>
        </SettingsProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello World');
    });
  });
});
