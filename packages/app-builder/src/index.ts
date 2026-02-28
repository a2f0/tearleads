/**
 * @tearleads/app-builder
 *
 * White-label app builder for multi-app builds.
 * Enables building multiple apps with different bundle IDs from a single codebase.
 */

export {
  ALL_FEATURE_PACKAGES,
  CORE_PACKAGES,
  FEATURE_TO_PACKAGES,
  getDisabledPackages,
  getEnabledPackages
} from './featureMap.js';
export {
  DEFAULT_APP_ID,
  getAppsDir,
  getDefaultAppId,
  listApps,
  loadAppConfig
} from './loader.js';
export {
  AppConfigSchema,
  AppFeatureSchema,
  AppPlatformSchema,
  safeValidateAppConfig,
  validateAppConfig
} from './schema.js';
export type {
  AppApiConfig,
  AppBundleIds,
  AppConfig,
  AppFeature,
  AppPlatform,
  AppStoreConfig,
  AppTheme,
  LoadedAppConfig
} from './types.js';
export { createAppConfigPlugin } from './vite/createAppConfigPlugin.js';
