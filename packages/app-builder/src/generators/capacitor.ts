import type { AppConfig } from '../types.js';

/**
 * Generate capacitor.config.ts content from an app configuration.
 */
export function generateCapacitorConfig(config: AppConfig): string {
  const keychainPrefix = config.keychainPrefix || config.bundleIds.ios;

  return `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${config.bundleIds.ios}',
  appName: '${config.displayName}',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  plugins: {
    CapacitorSQLite: {
      // Store database in Library (hidden from Files app) instead of Documents
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      // Enable encryption on iOS
      iosIsEncryption: true,
      // Enable encryption on Android
      androidIsEncryption: true,
      // Use memory security (wipe database from memory on close)
      iosKeychainPrefix: '${keychainPrefix}',
      // Biometric authentication (optional, can enable later)
      iosBiometric: {
        biometricAuth: false
      },
      androidBiometric: {
        biometricAuth: false
      }
    }
  }
};

export default config;
`;
}

/**
 * Generate a JSON version of the app config for build-time injection.
 * This can be used by vite.config.ts to inject app metadata.
 */
export function generateAppMetadataJson(config: AppConfig): string {
  const metadata = {
    id: config.id,
    displayName: config.displayName,
    bundleIds: config.bundleIds,
    platforms: config.platforms,
    features: config.features,
    api: config.api,
    theme: config.theme
  };

  return JSON.stringify(metadata, null, 2);
}
