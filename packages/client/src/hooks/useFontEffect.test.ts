import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsSyncedDetail } from '@/db/user-settings';
import { useFontEffect } from './useFontEffect';

// Mock the useSettings hook
const mockGetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting
  })
}));

describe('useFontEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('font-mono');
    mockGetSetting.mockReturnValue('system');
  });

  it('adds font-mono class when font setting is monospace', () => {
    mockGetSetting.mockReturnValue('monospace');
    renderHook(() => useFontEffect());
    expect(document.documentElement.classList.contains('font-mono')).toBe(true);
  });

  it('removes font-mono class when font setting is system', () => {
    document.documentElement.classList.add('font-mono');
    mockGetSetting.mockReturnValue('system');
    renderHook(() => useFontEffect());
    expect(document.documentElement.classList.contains('font-mono')).toBe(
      false
    );
  });

  it('handles settings-synced event with monospace font', () => {
    mockGetSetting.mockReturnValue('system');
    renderHook(() => useFontEffect());

    const event = new CustomEvent<SettingsSyncedDetail>('settings-synced', {
      detail: { settings: { font: 'monospace' } }
    });
    window.dispatchEvent(event);

    expect(document.documentElement.classList.contains('font-mono')).toBe(true);
  });

  it('handles settings-synced event with system font', () => {
    document.documentElement.classList.add('font-mono');
    mockGetSetting.mockReturnValue('monospace');
    renderHook(() => useFontEffect());

    const event = new CustomEvent<SettingsSyncedDetail>('settings-synced', {
      detail: { settings: { font: 'system' } }
    });
    window.dispatchEvent(event);

    expect(document.documentElement.classList.contains('font-mono')).toBe(
      false
    );
  });

  it('removes event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    mockGetSetting.mockReturnValue('system');
    const { unmount } = renderHook(() => useFontEffect());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'settings-synced',
      expect.any(Function)
    );
    removeEventListenerSpy.mockRestore();
  });
});
