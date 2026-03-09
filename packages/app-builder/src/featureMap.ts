import type { AppFeature } from './types.js';

/**
 * Mapping of features to their required workspace packages.
 * Each feature can require one or more packages.
 */
export const FEATURE_TO_PACKAGES: Record<AppFeature, string[]> = {
  admin: ['@tearleads/app-admin'],
  analytics: ['@tearleads/app-analytics'],
  audio: ['@tearleads/app-audio'],
  businesses: ['@tearleads/app-businesses'],
  calendar: ['@tearleads/app-calendar'],
  camera: ['@tearleads/app-camera'],
  classic: ['@tearleads/app-classic'],
  compliance: ['@tearleads/app-compliance'],
  contacts: ['@tearleads/app-contacts'],
  email: ['@tearleads/app-email'],
  health: ['@tearleads/app-health'],
  'mls-chat': ['@tearleads/app-mls-chat'],
  notes: ['@tearleads/app-notes'],
  sync: ['@tearleads/vfs-sync'],
  terminal: ['@tearleads/app-terminal'],
  vehicles: ['@tearleads/app-vehicles'],
  wallet: ['@tearleads/app-wallet']
};

/**
 * Core packages that are always included regardless of features.
 */
export const CORE_PACKAGES = [
  '@tearleads/db',
  '@tearleads/app-help',
  '@tearleads/app-keychain',
  '@tearleads/app-notifications',
  '@tearleads/app-search',
  '@tearleads/app-settings',
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
