/**
 * Available features that can be enabled per app.
 * Each feature maps to one or more workspace packages.
 */
export type AppFeature =
  | 'admin'
  | 'analytics'
  | 'audio'
  | 'businesses'
  | 'calendar'
  | 'camera'
  | 'classic'
  | 'compliance'
  | 'contacts'
  | 'email'
  | 'health'
  | 'mls-chat'
  | 'notes'
  | 'sync'
  | 'terminal'
  | 'vehicles'
  | 'wallet';

/**
 * Supported build platforms.
 */
export type AppPlatform = 'ios' | 'android' | 'desktop' | 'pwa';

/**
 * Theme configuration for app branding.
 */
export interface AppTheme {
  /** Primary brand color (hex) */
  primaryColor: string;
  /** Background color (hex) */
  backgroundColor: string;
  /** Accent color (hex) */
  accentColor: string;
}

/**
 * API endpoint configuration.
 */
export interface AppApiConfig {
  /** Production API URL */
  productionUrl: string;
  /** Optional staging API URL */
  stagingUrl?: string | undefined;
}

/**
 * App store metadata and signing configuration.
 */
export interface AppStoreConfig {
  /** iOS App Store team ID (optional, falls back to env) */
  appleTeamId?: string | undefined;
  /** iOS App Store Connect team ID (optional, falls back to env) */
  appleItcTeamId?: string | undefined;
  /** Android signing key alias */
  androidKeyAlias?: string | undefined;
}

/**
 * Assets configuration for branding.
 */
export interface AppAssets {
  /** Path to 1024x1024 source icon */
  iconSource?: string | undefined;
  /** Path to source splash image */
  splashSource?: string | undefined;
}

/**
 * Monitoring and analytics configuration.
 */
export interface AppMonitoring {
  /** Sentry DSN for error reporting */
  sentryDsn?: string | undefined;
  /** Google Analytics measurement ID */
  googleAnalyticsId?: string | undefined;
  /** PostHog project API key */
  posthogToken?: string | undefined;
}

/**
 * Bundle identifiers per platform.
 */
export interface AppBundleIds {
  /** iOS bundle identifier (e.g., "com.acme.crm") */
  ios: string;
  /** Android application ID (e.g., "com.acme.crm") */
  android: string;
  /** Desktop/Electron app ID (e.g., "com.acme.crm.desktop") */
  desktop: string;
}

/**
 * Complete app configuration.
 */
export interface AppConfig {
  /** Unique app identifier (kebab-case, e.g., "acme-crm") */
  id: string;

  /** Display name shown in app stores and on device */
  displayName: string;

  /** Bundle identifiers per platform */
  bundleIds: AppBundleIds;

  /** Custom URL scheme (e.g., "acmeapp") */
  urlScheme?: string | undefined;

  /** Enabled platforms for this app */
  platforms: AppPlatform[];

  /** Enabled features (maps to workspace packages) */
  features: AppFeature[];

  /** API endpoint configuration */
  api: AppApiConfig;

  /** Theme/branding configuration */
  theme: AppTheme;

  /** App store and signing configuration */
  store?: AppStoreConfig | undefined;

  /** Visual assets (icons, splash) */
  assets?: AppAssets | undefined;

  /** Monitoring and analytics */
  monitoring?: AppMonitoring | undefined;

  /** Custom translation overrides */
  translations?: Record<string, string> | undefined;

  /** SQLite keychain prefix (defaults to iOS bundle ID) */
  keychainPrefix?: string | undefined;
}

/**
 * Result of loading an app config from disk.
 */
export interface LoadedAppConfig {
  /** The validated app configuration */
  config: AppConfig;
  /** Path to the app's config directory */
  configDir: string;
  /** Path to the app's assets directory */
  assetsDir: string;
}
