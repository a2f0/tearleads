import type { AppConfig } from '../../src/types.js';

/**
 * Tearleads Staging - Side-by-side staging variant.
 * Same features as production but with staging bundle IDs and API URL.
 */
const config: AppConfig = {
  id: 'tearleads-staging',
  displayName: 'TL Staging',

  bundleIds: {
    ios: 'com.tearleads.app.staging',
    android: 'com.tearleads.app.staging',
    desktop: 'com.tearleads.desktop.staging'
  },

  urlScheme: 'tearleads-staging',

  platforms: ['ios', 'android', 'desktop', 'pwa'],

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
    productionUrl: 'https://staging-api.tearleads.com/v1',
    stagingUrl: 'https://staging-api.tearleads.com/v1'
  },

  theme: {
    primaryColor: '#4A5D8A',
    backgroundColor: '#1C2432',
    accentColor: '#62B6CB'
  },

  store: {
    androidKeyAlias: 'tearleads'
  },

  keychainPrefix: 'com.tearleads.app.staging'
};

export default config;
