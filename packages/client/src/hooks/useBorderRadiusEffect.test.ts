import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBorderRadiusEffect } from './useBorderRadiusEffect';

const mockGetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting
  })
}));

describe('useBorderRadiusEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('square-corners');
    mockGetSetting.mockReturnValue('rounded');
  });

  it('adds square-corners class when setting is square', () => {
    mockGetSetting.mockReturnValue('square');
    renderHook(() => useBorderRadiusEffect());
    expect(document.documentElement.classList.contains('square-corners')).toBe(
      true
    );
  });

  it('removes square-corners class when setting is rounded', () => {
    document.documentElement.classList.add('square-corners');
    mockGetSetting.mockReturnValue('rounded');
    renderHook(() => useBorderRadiusEffect());
    expect(document.documentElement.classList.contains('square-corners')).toBe(
      false
    );
  });

  it('toggles class when setting changes', () => {
    mockGetSetting.mockReturnValue('rounded');
    const { rerender } = renderHook(() => useBorderRadiusEffect());
    expect(document.documentElement.classList.contains('square-corners')).toBe(
      false
    );

    mockGetSetting.mockReturnValue('square');
    rerender();
    expect(document.documentElement.classList.contains('square-corners')).toBe(
      true
    );

    mockGetSetting.mockReturnValue('rounded');
    rerender();
    expect(document.documentElement.classList.contains('square-corners')).toBe(
      false
    );
  });
});
