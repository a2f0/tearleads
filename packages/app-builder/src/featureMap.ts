import type { AppFeature } from './types.js';

/**
 * Mapping of features to their required workspace packages.
 * Each feature can require one or more packages.
 */
export const FEATURE_TO_PACKAGES: Record<AppFeature, string[]> = {
  admin: ['@tearleads/admin'],
  analytics: ['@tearleads/analytics'],
  audio: ['@tearleads/audio'],
  businesses: ['@tearleads/businesses'],
  calendar: ['@tearleads/calendar'],
  camera: ['@tearleads/camera'],
  classic: ['@tearleads/classic'],
  compliance: ['@tearleads/compliance'],
  contacts: ['@tearleads/contacts'],
  email: ['@tearleads/email'],
  health: ['@tearleads/health'],
  'mls-chat': ['@tearleads/mls-chat'],
  notes: ['@tearleads/notes'],
  sync: ['@tearleads/vfs-sync'],
  terminal: ['@tearleads/terminal'],
  vehicles: ['@tearleads/vehicles'],
  wallet: ['@tearleads/wallet']
};

/**
 * Core packages that are always included regardless of features.
 */
export const CORE_PACKAGES = [
  '@tearleads/db',
  '@tearleads/help',
  '@tearleads/keychain',
  '@tearleads/notifications',
  '@tearleads/search',
  '@tearleads/settings',
  '@tearleads/shared',
  '@tearleads/ui',
  '@tearleads/vfs-explorer',
  '@tearleads/window-manager'
] as const;

/**
 * All feature packages (excludes core packages).
 */
export const ALL_FEATURE_PACKAGES = Object.values(FEATURE_TO_PACKAGES).flat();

/**
 * Get the list of packages enabled for a given set of features.
 * Always includes core packages.
 */
export function getEnabledPackages(features: AppFeature[]): string[] {
  const packages = new Set<string>(CORE_PACKAGES);

  for (const feature of features) {
    const featurePackages = FEATURE_TO_PACKAGES[feature];
    for (const pkg of featurePackages) {
      packages.add(pkg);
    }
  }

  return Array.from(packages).sort();
}

/**
 * Get the list of packages that should be disabled (stubbed out)
 * for a given set of features.
 */
export function getDisabledPackages(features: AppFeature[]): string[] {
  const enabledSet = new Set(getEnabledPackages(features));
  return ALL_FEATURE_PACKAGES.filter((pkg) => !enabledSet.has(pkg)).sort();
}
