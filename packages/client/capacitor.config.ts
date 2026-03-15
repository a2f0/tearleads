import type { CapacitorConfig } from '@capacitor/cli';

type CapacitorBuildEnv = Readonly<Record<string, string | undefined>>;

const RELEASE_BUILD_PATTERN = /release/i;

export function getCapacitorBuildConfiguration(
  env: CapacitorBuildEnv = process.env
): string {
  return env['CAPACITOR_BUILD_CONFIGURATION'] ?? 'Debug';
}

export function isCapacitorReleaseBuild(
  env: CapacitorBuildEnv = process.env
): boolean {
  return RELEASE_BUILD_PATTERN.test(getCapacitorBuildConfiguration(env));
}

export function isCapacitorHttpEnabled(
  env: CapacitorBuildEnv = process.env
): boolean {
  return !isCapacitorReleaseBuild(env);
}

const config: CapacitorConfig = {
  appId: 'com.tearleads.app',
  appName: 'Tearleads',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  plugins: {
    // Native HTTP is only needed for local device development against the
    // plain HTTP API server. Release builds should use standard webview fetch.
    CapacitorHttp: {
      enabled: isCapacitorHttpEnabled()
    },
    CapacitorSQLite: {
      // Store database in Library (hidden from Files app) instead of Documents
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      // Enable encryption on iOS
      iosIsEncryption: true,
      // Enable encryption on Android
      androidIsEncryption: true,
      // Use memory security (wipe database from memory on close)
      iosKeychainPrefix: 'com.tearleads.app',
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
