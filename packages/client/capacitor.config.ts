import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tearleads.rapid',
  appName: 'Tearleads',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  ios: {
    // Enable WebView debugging for Appium tests (iOS 16.4+)
    webContentsDebuggingEnabled: true
  },
  android: {
    // Enable WebView debugging for Appium tests
    webContentsDebuggingEnabled: true
  },
  plugins: {
    CapacitorSQLite: {
      // Store databases in Library/CapacitorDatabase (not visible to iTunes, backed up to iCloud)
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      // Enable encryption on iOS
      iosIsEncryption: true,
      // Enable encryption on Android
      androidIsEncryption: true,
      // Use memory security (wipe database from memory on close)
      iosKeychainPrefix: 'com.tearleads.rapid',
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
