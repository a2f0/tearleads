import type { AppConfig } from '../../src/types.js';

/**
 * Tearleads - The original/default app configuration.
 * All features enabled, all platforms supported.
 */
const config: AppConfig = {
  id: 'tearleads',
  displayName: 'Tearleads',

  bundleIds: {
    ios: 'com.tearleads.app',
    android: 'com.tearleads.app',
    desktop: 'com.tearleads.desktop'
  },

  platforms: ['ios', 'android', 'desktop', 'pwa'],

  // All features enabled for the main app
  features: [
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
  ],

  api: {
    // API URL is set via VITE_API_URL environment variable at build time
    // These are fallback/documentation values
    productionUrl: 'https://api.tearleads.com/v1',
    stagingUrl: 'https://staging-api.tearleads.com/v1'
  },

  theme: {
    // Classic Refined theme colors (approximate hex for OKLCH values)
    primaryColor: '#4A5D8A', // oklch(42% 0.08 255) navy blue
    backgroundColor: '#1C2432', // oklch(16% 0.015 240) dark slate
    accentColor: '#62B6CB' // oklch(72% 0.1 205) cyan
  },

  store: {
    // These values come from environment variables in CI
    // appleTeamId: process.env.TEAM_ID
    // appleItcTeamId: process.env.ITC_TEAM_ID
    androidKeyAlias: 'tearleads'
  },

  keychainPrefix: 'com.tearleads.app'
};

export default config;
