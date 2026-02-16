import type { AppConfig } from '../types.js';

/**
 * Get the custom URL scheme for an app.
 * Falls back to the last part of the reverse-domain bundle ID if not specified.
 * Example: com.tearleads.app -> app
 */
export function getUrlScheme(
  config: AppConfig,
  platform: 'ios' | 'android'
): string {
  if (config.urlScheme) {
    return config.urlScheme;
  }

  const bundleId =
    platform === 'ios' ? config.bundleIds.ios : config.bundleIds.android;
  const parts = bundleId.split('.');
  return parts[parts.length - 1] || 'app';
}
