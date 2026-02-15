// Import config from virtual module provided by vite-plugin-app-config
import generatedConfig from 'virtual:app-config';
import type { AppFeature } from '../../../app-builder/src/types.js';

/**
 * App configuration injected at build time via virtual module.
 * The actual config is loaded from packages/app-builder/apps/{APP}/config.ts
 * based on the APP environment variable (defaults to 'tearleads').
 */

interface AppConfigData {
  id: string;
  displayName: string;
  features: AppFeature[];
}

// Static config loaded once at module initialization
const config: AppConfigData = generatedConfig as AppConfigData;

/**
 * Get the current app ID.
 */
export function getAppId(): string {
  return config.id;
}

/**
 * Get the current app display name.
 */
export function getAppDisplayName(): string {
  return config.displayName;
}

/**
 * Get the list of enabled features for this app.
 */
export function getAppFeatures(): AppFeature[] {
  return config.features;
}

/**
 * Check if a specific feature is enabled for this app.
 */
export function isAppFeatureEnabled(feature: AppFeature): boolean {
  return config.features.includes(feature);
}
