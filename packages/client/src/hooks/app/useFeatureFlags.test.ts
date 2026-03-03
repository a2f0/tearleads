import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FEATURE_FLAGS_STORAGE_KEY } from '@/lib/featureFlags';
import { useFeatureFlags } from './useFeatureFlags';

describe('useFeatureFlags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current.hasOverrides).toBe(false);

    act(() => {
      localStorage.setItem(
        FEATURE_FLAGS_STORAGE_KEY,
        JSON.stringify({ vfsServerRegistration: false })
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'tearleads_unrelated' })
      );
    });

    expect(result.current.hasOverrides).toBe(false);
  });

  it('syncs overrides when feature flag storage key changes', () => {
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current.hasOverrides).toBe(false);

    act(() => {
      localStorage.setItem(
        FEATURE_FLAGS_STORAGE_KEY,
        JSON.stringify({ vfsServerRegistration: false })
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: FEATURE_FLAGS_STORAGE_KEY })
      );
    });

    expect(result.current.hasOverrides).toBe(true);
    expect(
      result.current.entries.find(
        (entry) => entry.key === 'vfsServerRegistration'
      )
    ).toMatchObject({
      value: false,
      isOverridden: true
    });
  });
});
