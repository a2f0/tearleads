import { z } from 'zod';

/**
 * Hex color validation regex.
 */
const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

/**
 * Kebab-case validation regex.
 */
const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Bundle ID validation regex (reverse domain notation).
 */
const bundleIdRegex = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/**
 * Available app features.
 */
export const AppFeatureSchema = z.enum([
  'admin',
  'analytics',
  'audio',
  'businesses',
  'calendar',
  'camera',
  'classic',
  'compliance',
  'contacts',
  'email',
  'health',
  'mls-chat',
  'notes',
  'sync',
  'terminal',
  'vehicles',
  'wallet'
]);

/**
 * Supported platforms.
 */
export const AppPlatformSchema = z.enum(['ios', 'android', 'desktop', 'pwa']);

/**
 * Theme configuration schema.
 */
const AppThemeSchema = z.object({
  primaryColor: z
    .string()
    .regex(
      hexColorRegex,
      'Primary color must be a valid hex color (e.g., #3B82F6)'
    ),
  backgroundColor: z
    .string()
    .regex(
      hexColorRegex,
      'Background color must be a valid hex color (e.g., #0F172A)'
    ),
  accentColor: z
    .string()
    .regex(
      hexColorRegex,
      'Accent color must be a valid hex color (e.g., #22D3EE)'
    )
});

/**
 * API configuration schema.
 */
const AppApiConfigSchema = z.object({
  productionUrl: z.string().url('Production URL must be a valid URL'),
  stagingUrl: z.string().url('Staging URL must be a valid URL').optional()
});

/**
 * Store configuration schema.
 */
const AppStoreConfigSchema = z
  .object({
    appleTeamId: z.string().optional(),
    appleItcTeamId: z.string().optional(),
    androidKeyAlias: z.string().optional()
  })
  .optional();

/**
 * Assets configuration schema.
 */
const AppAssetsSchema = z.object({
  iconSource: z.string().optional(),
  splashSource: z.string().optional()
});

/**
 * Monitoring configuration schema.
 */
const AppMonitoringSchema = z.object({
  sentryDsn: z.string().url('Sentry DSN must be a valid URL').optional(),
  googleAnalyticsId: z.string().optional(),
  posthogToken: z.string().optional()
});

/**
 * Bundle IDs schema.
 */
const AppBundleIdsSchema = z.object({
  ios: z
    .string()
    .regex(bundleIdRegex, 'iOS bundle ID must be in reverse domain notation'),
  android: z
    .string()
    .regex(
      bundleIdRegex,
      'Android bundle ID must be in reverse domain notation'
    ),
  desktop: z
    .string()
    .regex(
      bundleIdRegex,
      'Desktop bundle ID must be in reverse domain notation'
    )
});

/**
 * Complete app configuration schema.
 */
export const AppConfigSchema = z.object({
  id: z
    .string()
    .regex(kebabCaseRegex, 'App ID must be kebab-case (e.g., "acme-crm")'),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(30, 'Display name too long'),
  bundleIds: AppBundleIdsSchema,
  urlScheme: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/, 'URL scheme must be lower-case and valid')
    .optional(),
  platforms: z
    .array(AppPlatformSchema)
    .min(1, 'At least one platform must be enabled'),
  features: z
    .array(AppFeatureSchema)
    .min(1, 'At least one feature must be enabled'),
  api: AppApiConfigSchema,
  theme: AppThemeSchema,
  store: AppStoreConfigSchema,
  assets: AppAssetsSchema.optional(),
  monitoring: AppMonitoringSchema.optional(),
  translations: z.record(z.string(), z.string()).optional(),
  keychainPrefix: z.string().optional()
});

/**
 * Validate an app configuration.
 * @throws ZodError if validation fails
 */
export function validateAppConfig(
  config: unknown
): z.infer<typeof AppConfigSchema> {
  return AppConfigSchema.parse(config);
}

/**
 * Safely validate an app configuration, returning a result object.
 */
export function safeValidateAppConfig(
  config: unknown
): ReturnType<typeof AppConfigSchema.safeParse> {
  return AppConfigSchema.safeParse(config);
}
