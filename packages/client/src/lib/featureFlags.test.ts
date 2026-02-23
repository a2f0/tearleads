import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFeatureFlagOverride,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAGS_STORAGE_KEY,
  getFeatureFlagOverrides,
  getFeatureFlagValue,
  listFeatureFlags,
  onFeatureFlagsChange,
  resetFeatureFlagOverrides,
  setFeatureFlagOverride
} from './featureFlags';

describe('feature flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default value when no overrides exist', () => {
    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(true);
    expect(getFeatureFlagValue('vfsSecureUpload')).toBe(true);
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

    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(true);
    expect(getFeatureFlagOverrides()).toEqual({});
  });

  it('ignores non-boolean overrides', () => {
    localStorage.setItem(
      FEATURE_FLAGS_STORAGE_KEY,
      JSON.stringify({ vfsServerRegistration: 'yes' })
    );

    expect(getFeatureFlagOverrides()).toEqual({});
    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(true);
  });

  it('ignores non-record overrides', () => {
    localStorage.setItem(
      FEATURE_FLAGS_STORAGE_KEY,
      JSON.stringify(['vfsServerRegistration'])
    );

    expect(getFeatureFlagOverrides()).toEqual({});
    expect(getFeatureFlagValue('vfsServerRegistration')).toBe(true);
  });

  it('listFeatureFlags returns all flag keys', () => {
    const flags = listFeatureFlags();
    expect(flags).toEqual([...FEATURE_FLAG_KEYS]);
    expect(flags).not.toBe(FEATURE_FLAG_KEYS);
  });

  it('onFeatureFlagsChange notifies listeners when flags change', () => {
    const listener = vi.fn();
    const unsubscribe = onFeatureFlagsChange(listener);

    setFeatureFlagOverride('vfsServerRegistration', true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setFeatureFlagOverride('vfsServerRegistration', false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
