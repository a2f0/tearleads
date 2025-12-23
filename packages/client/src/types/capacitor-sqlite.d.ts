/**
 * Type augmentations for @capacitor-community/sqlite.
 * These extend the library's types with methods that exist but aren't typed.
 */

import '@capacitor-community/sqlite';

declare module '@capacitor-community/sqlite' {
  interface CapacitorSQLitePlugin {
    /**
     * Clear the stored encryption secret from secure storage.
     * This removes the passphrase from Keychain (iOS) or EncryptedSharedPreferences (Android).
     */
    clearEncryptionSecret(): Promise<void>;
  }
}
