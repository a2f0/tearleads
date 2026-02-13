import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowOpacityEffect } from './useWindowOpacityEffect';

const mockGetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting
  })
}));

describe('useWindowOpacityEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('opaque-windows');
    mockGetSetting.mockReturnValue('translucent');
  });

  it('adds opaque-windows class when setting is opaque', () => {
    mockGetSetting.mockReturnValue('opaque');
    renderHook(() => useWindowOpacityEffect());
    expect(document.documentElement.classList.contains('opaque-windows')).toBe(
      true
    );
  });

  it('removes opaque-windows class when setting is translucent', () => {
    document.documentElement.classList.add('opaque-windows');
    mockGetSetting.mockReturnValue('translucent');
    renderHook(() => useWindowOpacityEffect());
    expect(document.documentElement.classList.contains('opaque-windows')).toBe(
      false
    );
  });

  it('toggles class when setting changes', () => {
    mockGetSetting.mockReturnValue('translucent');
    const { rerender } = renderHook(() => useWindowOpacityEffect());
    expect(document.documentElement.classList.contains('opaque-windows')).toBe(
      false
    );

    mockGetSetting.mockReturnValue('opaque');
    rerender();
    expect(document.documentElement.classList.contains('opaque-windows')).toBe(
      true
    );

    mockGetSetting.mockReturnValue('translucent');
    rerender();
    expect(document.documentElement.classList.contains('opaque-windows')).toBe(
      false
    );
  });
});
