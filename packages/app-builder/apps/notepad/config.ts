import type { AppConfig } from '../../src/types.js';

/**
 * Notepad - A minimal notes-only app.
 * Single feature, all platforms.
 */
const config: AppConfig = {
  id: 'notepad',
  displayName: 'Notepad',

  bundleIds: {
    ios: 'com.tearleads.notepad',
    android: 'com.tearleads.notepad',
    desktop: 'com.tearleads.notepad.desktop'
  },

  platforms: ['ios', 'android', 'desktop', 'pwa'],

  // Notes only - minimal feature set
  features: ['notes'],

  api: {
    productionUrl: 'https://api.tearleads.com/v1',
    stagingUrl: 'https://staging-api.tearleads.com/v1'
  },

  theme: {
    // Warm paper-like theme for a notes app
    primaryColor: '#D4A574', // warm tan/paper
    backgroundColor: '#2C2417', // dark warm brown
    accentColor: '#F5E6D3' // cream/off-white
  },

  store: {
    androidKeyAlias: 'notepad'
  }
  // keychainPrefix defaults to bundleIds.ios when not specified
};

export default config;
