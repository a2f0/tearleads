export type FeatureFlagKey = 'vfsServerRegistration' | 'vfsSecureUpload';

export interface FeatureFlagDefinition {
  label: string;
  description: string;
  defaultValue: boolean;
}

export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = [
  'vfsServerRegistration',
  'vfsSecureUpload'
];

// Re-export app feature utilities for convenience
export { getAppFeatures, isAppFeatureEnabled } from './appConfig.js';

export const FEATURE_FLAGS: Record<FeatureFlagKey, FeatureFlagDefinition> = {
  vfsServerRegistration: {
    label: 'VFS server registration',
    description: 'Send VFS registrations to the server after local writes.',
    defaultValue: false
  },
  vfsSecureUpload: {
    label: 'VFS secure upload',
    description:
      'Use end-to-end encrypted upload pipeline for file storage on server.',
    defaultValue: false
  }
};

export const FEATURE_FLAGS_STORAGE_KEY = 'tearleads_feature_flags';
const FEATURE_FLAGS_CHANGE_EVENT = 'tearleads_feature_flags_change';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOverrides(): Partial<Record<FeatureFlagKey, boolean>> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    const overrides: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const key of FEATURE_FLAG_KEYS) {
      const value = parsed[key];
      if (typeof value === 'boolean') {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

function writeOverrides(
  overrides: Partial<Record<FeatureFlagKey, boolean>>
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const sanitized: Partial<Record<FeatureFlagKey, boolean>> = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const value = overrides[key];
    if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }

  try {
    if (Object.keys(sanitized).length === 0) {
      localStorage.removeItem(FEATURE_FLAGS_STORAGE_KEY);
    } else {
      localStorage.setItem(
        FEATURE_FLAGS_STORAGE_KEY,
        JSON.stringify(sanitized)
      );
    }
    window.dispatchEvent(new Event(FEATURE_FLAGS_CHANGE_EVENT));
  } catch {
    return;
  }
}

export function getFeatureFlagOverrides(): Partial<
  Record<FeatureFlagKey, boolean>
> {
  return readOverrides();
}

export function getFeatureFlagValue(key: FeatureFlagKey): boolean {
  const override = readOverrides()[key];
  if (typeof override === 'boolean') {
    return override;
  }
  return FEATURE_FLAGS[key].defaultValue;
}

export function listFeatureFlags(): FeatureFlagKey[] {
  return [...FEATURE_FLAG_KEYS];
}

export function setFeatureFlagOverride(
  key: FeatureFlagKey,
  value: boolean
): void {
  const overrides = readOverrides();
  overrides[key] = value;
  writeOverrides(overrides);
}

export function clearFeatureFlagOverride(key: FeatureFlagKey): void {
  const overrides = readOverrides();
  delete overrides[key];
  writeOverrides(overrides);
}

export function resetFeatureFlagOverrides(): void {
  writeOverrides({});
}

export function onFeatureFlagsChange(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(FEATURE_FLAGS_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(FEATURE_FLAGS_CHANGE_EVENT, listener);
  };
}
