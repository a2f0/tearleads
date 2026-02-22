import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearFeatureFlagOverride,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAGS,
  FEATURE_FLAGS_STORAGE_KEY,
  type FeatureFlagKey,
  getFeatureFlagOverrides,
  onFeatureFlagsChange,
  resetFeatureFlagOverrides,
  setFeatureFlagOverride
} from '@/lib/featureFlags';

interface FeatureFlagEntry {
  key: FeatureFlagKey;
  label: string;
  description: string;
  defaultValue: boolean;
  value: boolean;
  isOverridden: boolean;
}

function buildEntries(
  overrides: Partial<Record<FeatureFlagKey, boolean>>
): FeatureFlagEntry[] {
  return FEATURE_FLAG_KEYS.map((key) => {
    const definition = FEATURE_FLAGS[key];
    const override = overrides[key];
    const isOverridden = typeof override === 'boolean';
    return {
      key,
      label: definition.label,
      description: definition.description,
      defaultValue: definition.defaultValue,
      value: isOverridden ? override : definition.defaultValue,
      isOverridden
    };
  });
}

export function useFeatureFlags() {
  const [overrides, setOverrides] = useState<
    Partial<Record<FeatureFlagKey, boolean>>
  >(() => getFeatureFlagOverrides());

  useEffect(() => {
    const sync = () => {
      setOverrides(getFeatureFlagOverrides());
    };

    const unsubscribe = onFeatureFlagsChange(sync);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === FEATURE_FLAGS_STORAGE_KEY) {
        sync();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const entries = useMemo(() => buildEntries(overrides), [overrides]);
  const hasOverrides = useMemo(
    () => entries.some((entry) => entry.isOverridden),
    [entries]
  );

  const setOverride = useCallback((key: FeatureFlagKey, value: boolean) => {
    setFeatureFlagOverride(key, value);
  }, []);

  const clearOverride = useCallback((key: FeatureFlagKey) => {
    clearFeatureFlagOverride(key);
  }, []);

  const resetOverrides = useCallback(() => {
    resetFeatureFlagOverrides();
  }, []);

  return {
    entries,
    hasOverrides,
    setOverride,
    clearOverride,
    resetOverrides
  };
}
