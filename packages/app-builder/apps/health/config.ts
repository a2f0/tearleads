import type { AppConfig } from '../../src/types.js';

/**
 * Health - Standalone health tracking app.
 * Focused on fitness, workouts, weight tracking, and blood pressure monitoring.
 */
const config: AppConfig = {
  id: 'health',
  displayName: 'Health',

  bundleIds: {
    ios: 'com.tearleads.health',
    android: 'com.tearleads.health',
    desktop: 'com.tearleads.health.desktop'
  },

  platforms: ['ios', 'android', 'pwa'],

  // Health-only feature set
  features: ['health'],

  api: {
    productionUrl: 'https://api.tearleads.com/v1',
    stagingUrl: 'https://staging-api.tearleads.com/v1'
  },

  theme: {
    // Health-focused green/wellness theme
    primaryColor: '#2D6A4F', // Forest green
    backgroundColor: '#1B2E26', // Dark green-gray
    accentColor: '#52B788' // Mint green
  },

  store: {
    androidKeyAlias: 'health'
  },

  keychainPrefix: 'com.tearleads.health'
};

export default config;
