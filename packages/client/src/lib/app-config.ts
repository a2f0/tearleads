import type { AppFeature } from '../../../app-builder/src/types.js';
// Import generated config - Vite handles JSON imports
import generatedConfig from '../../generated/app-config.json';

/**
 * App configuration injected at build time.
 * Falls back to full feature set if config is not generated.
 */

interface AppConfigData {
  id: string;
  displayName: string;
  features: AppFeature[];
}

function loadConfig(): AppConfigData {
  // Use the generated config directly
  return generatedConfig as AppConfigData;
}

/**
 * Get the current app ID.
 */
export function getAppId(): string {
  return loadConfig().id;
}

/**
 * Get the current app display name.
 */
export function getAppDisplayName(): string {
  return loadConfig().displayName;
}

/**
 * Get the list of enabled features for this app.
 */
export function getAppFeatures(): AppFeature[] {
  return loadConfig().features;
}

/**
 * Check if a specific feature is enabled for this app.
 */
export function isAppFeatureEnabled(feature: AppFeature): boolean {
  return loadConfig().features.includes(feature);
}
