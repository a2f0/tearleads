import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('toggles class when font setting changes', () => {
    mockGetSetting.mockReturnValue('system');
    const { rerender } = renderHook(() => useFontEffect());
    expect(document.documentElement.classList.contains('font-mono')).toBe(
      false
    );

    mockGetSetting.mockReturnValue('monospace');
    rerender();
    expect(document.documentElement.classList.contains('font-mono')).toBe(true);

    mockGetSetting.mockReturnValue('system');
    rerender();
    expect(document.documentElement.classList.contains('font-mono')).toBe(
      false
    );
  });
});
