import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFeatureFlagOverride,
  FEATURE_FLAGS_STORAGE_KEY,
  getFeatureFlagOverrides,
  getFeatureFlagValue,
  resetFeatureFlagOverrides,
  setFeatureFlagOverride
} from './feature-flags';

describe('feature flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default value when no overrides exist', () => {
    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(false);
  });

  it('reads overrides from localStorage', () => {
    localStorage.setItem(
      FEATURE_FLAGS_STORAGE_KEY,
      JSON.stringify({ vfsServerRegistration: true })
    );

    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(true);
    expect(getFeatureFlagOverrides()).toEqual({
      vfsServerRegistration: true
    });
  });

  it('setFeatureFlagOverride writes to localStorage', () => {
    setFeatureFlagOverride('vfsServerRegistration', true);

    const stored = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;

    expect(parsed).toEqual({ vfsServerRegistration: true });
  });

  it('clearFeatureFlagOverride removes overrides', () => {
    setFeatureFlagOverride('vfsServerRegistration', true);
    clearFeatureFlagOverride('vfsServerRegistration');

    expect(localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY)).toBeNull();
  });

  it('resetFeatureFlagOverrides clears all overrides', () => {
    setFeatureFlagOverride('vfsServerRegistration', true);
    resetFeatureFlagOverrides();

    expect(localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY)).toBeNull();
  });

  it('handles invalid localStorage data gracefully', () => {
    localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, 'not-json');

    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(false);
    expect(getFeatureFlagOverrides()).toEqual({});
  });
});
