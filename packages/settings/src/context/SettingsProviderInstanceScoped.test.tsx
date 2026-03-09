// one-component-per-file: allow -- test helper (TestConsumer) is colocated with provider tests
/**
 * Unit tests for SettingsProvider instance-scoped behavior.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
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
import { SettingsProvider, useSettings } from './SettingsProvider.js';

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
    </div>
  );
}

describe('SettingsProvider instance-scoped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
  });

  it('reads from instance-scoped localStorage key', () => {
    localStorageData['setting:inst-1:theme'] = 'dark';

    render(
      <SettingsProvider instanceId="inst-1">
        <TestConsumer />
      </SettingsProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('writes to instance-scoped localStorage key', async () => {
    render(
      <SettingsProvider instanceId="inst-1">
        <TestConsumer />
      </SettingsProvider>
    );

    await act(async () => {
      screen.getByText('Set Dark').click();
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'setting:inst-1:theme',
      'dark'
    );
  });

  it('reads scoped key over unscoped key', () => {
    localStorageData['theme'] = 'dark';
    localStorageData['setting:inst-1:theme'] = 'tokyo-night';

    render(
      <SettingsProvider instanceId="inst-1">
        <TestConsumer />
      </SettingsProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('tokyo-night');
  });

  it('resets sync state when instanceId changes', async () => {
    const getSettingsFromDb = vi.fn().mockResolvedValue({
      theme: 'dark'
    });

    const { rerender } = render(
      <SettingsProvider
        instanceId="inst-1"
        getSettingsFromDb={getSettingsFromDb}
      >
        <TestConsumer />
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('synced')).toHaveTextContent('yes');
    });

    const getSettingsFromDb2 = vi.fn().mockResolvedValue({
      theme: 'tokyo-night'
    });

    rerender(
      <SettingsProvider
        instanceId="inst-2"
        getSettingsFromDb={getSettingsFromDb2}
      >
        <TestConsumer />
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('synced')).toHaveTextContent('yes');
    });

    expect(getSettingsFromDb2).toHaveBeenCalled();
  });

  it('dispatches defaults on instance switch', async () => {
    const getSettingsFromDb = vi.fn().mockResolvedValue({
      theme: 'dark'
    });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { rerender } = render(
      <SettingsProvider
        instanceId="inst-1"
        getSettingsFromDb={getSettingsFromDb}
      >
        <TestConsumer />
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('synced')).toHaveTextContent('yes');
    });

    dispatchSpy.mockClear();

    rerender(
      <SettingsProvider instanceId="inst-2">
        <TestConsumer />
      </SettingsProvider>
    );

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings-synced',
        detail: {
          settings: expect.objectContaining({
            theme: 'light',
            language: 'en'
          })
        }
      })
    );

    dispatchSpy.mockRestore();
  });

  it('migrates unscoped settings on first use of instanceId', () => {
    localStorageData['theme'] = 'dark';
    localStorageData['i18nextLng'] = 'es';

    render(
      <SettingsProvider instanceId="inst-1">
        <TestConsumer />
      </SettingsProvider>
    );

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'setting:inst-1:theme',
      'dark'
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'setting:inst-1:i18nextLng',
      'es'
    );
  });

  it('dispatches settings-synced with DB values only', async () => {
    const getSettingsFromDb = vi.fn().mockResolvedValue({
      theme: 'dark'
    });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <SettingsProvider
        instanceId="inst-1"
        getSettingsFromDb={getSettingsFromDb}
      >
        <TestConsumer />
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'settings-synced',
          detail: {
            settings: { theme: 'dark' }
          }
        })
      );
    });

    dispatchSpy.mockRestore();
  });
});
