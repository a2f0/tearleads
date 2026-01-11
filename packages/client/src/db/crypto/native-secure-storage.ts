/**
 * Native secure storage adapter for iOS Keychain and Android Keystore.
 * Uses @capgo/capacitor-native-biometric for biometric-protected storage.
 *
 * This module provides secure storage for session keys on mobile platforms,
 * with optional biometric authentication for retrieval.
 */

import {
  BiometryType,
  NativeBiometric
} from '@capgo/capacitor-native-biometric';

/** Base server identifier for credential storage */
const SERVER_BASE = 'com.tearleads.rapid';

/** Storage key prefix for wrapped keys */
const WRAPPED_KEY_PREFIX = 'wrapped_key';

/** Storage key prefix for wrapping keys (hex-encoded) */
const WRAPPING_KEY_PREFIX = 'wrapping_key';

/**
 * IndexedDB tracking for Keystore instance IDs.
 * The NativeBiometric plugin doesn't support enumerating all stored credentials,
 * so we track which instance IDs have Keystore entries to enable orphan detection.
 */
const KEYSTORE_TRACKING_DB = 'rapid_keystore_tracking';
const KEYSTORE_TRACKING_STORE = 'instance_ids';

/**
 * Open the Keystore tracking IndexedDB.
 */
async function openKeystoreTrackingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEYSTORE_TRACKING_DB, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYSTORE_TRACKING_STORE)) {
        db.createObjectStore(KEYSTORE_TRACKING_STORE, {
          keyPath: 'instanceId'
        });
      }
    };
  });
}

/**
 * Track that an instance has Keystore entries.
 */
async function trackKeystoreInstance(instanceId: string): Promise<void> {
  try {
    const db = await openKeystoreTrackingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEYSTORE_TRACKING_STORE, 'readwrite');
      const store = tx.objectStore(KEYSTORE_TRACKING_STORE);
      store.put({ instanceId, createdAt: Date.now() });

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Ignore tracking errors - non-critical for core functionality
  }
}

/**
 * Remove an instance from Keystore tracking.
 */
async function untrackKeystoreInstance(instanceId: string): Promise<void> {
  try {
    const db = await openKeystoreTrackingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEYSTORE_TRACKING_STORE, 'readwrite');
      const store = tx.objectStore(KEYSTORE_TRACKING_STORE);
      store.delete(instanceId);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Ignore tracking errors - non-critical for core functionality
  }
}

/**
 * Get all instance IDs that have Keystore entries.
 * Used for orphan detection during app startup.
 */
export async function getTrackedKeystoreInstanceIds(): Promise<string[]> {
  try {
    const db = await openKeystoreTrackingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEYSTORE_TRACKING_STORE, 'readonly');
      const store = tx.objectStore(KEYSTORE_TRACKING_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        db.close();
        const entries = request.result as Array<{ instanceId: string }>;
        resolve(entries.map((e) => e.instanceId));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return [];
  }
}

export interface BiometricOptions {
  /** Whether to require biometric authentication for retrieval */
  useBiometric?: boolean;
  /** Title shown on biometric prompt */
  biometricTitle?: string;
  /** Subtitle shown on biometric prompt */
  biometricSubtitle?: string;
}

/** User-friendly biometry type names */
export type BiometryTypeName =
  | 'touchId'
  | 'faceId'
  | 'fingerprint'
  | 'iris'
  | 'none';

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType?: BiometryTypeName;
}

/**
 * Convert plugin's BiometryType enum to user-friendly string.
 */
function biometryTypeToString(type: BiometryType): BiometryTypeName {
  switch (type) {
    case BiometryType.TOUCH_ID:
      return 'touchId';
    case BiometryType.FACE_ID:
    case BiometryType.FACE_AUTHENTICATION:
      return 'faceId';
    case BiometryType.FINGERPRINT:
      return 'fingerprint';
    case BiometryType.IRIS_AUTHENTICATION:
      return 'iris';
    default:
      return 'none';
  }
}

/**
 * Check if biometric authentication is available on this device.
 */
export async function isBiometricAvailable(): Promise<BiometricAvailability> {
  try {
    const result = await NativeBiometric.isAvailable();
    const biometryType = biometryTypeToString(result.biometryType);

    // Build result object, only including biometryType if it's not 'none'
    if (biometryType !== 'none') {
      return {
        isAvailable: result.isAvailable,
        biometryType
      };
    }
    return { isAvailable: result.isAvailable };
  } catch {
    return { isAvailable: false };
  }
}

/**
 * Verify user identity using biometric authentication.
 * Returns true if verification succeeded, false otherwise.
 */
export async function verifyBiometric(
  options: BiometricOptions = {}
): Promise<boolean> {
  try {
    const availability = await isBiometricAvailable();
    if (!availability.isAvailable) {
      return false;
    }

    await NativeBiometric.verifyIdentity({
      title: options.biometricTitle || 'Unlock Database',
      subtitle:
        options.biometricSubtitle || 'Authenticate to restore your session',
      useFallback: true // Allow device passcode as fallback
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Convert Uint8Array to hex string for storage.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string back to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Get the server identifier for a specific instance and key type.
 * Each database instance has its own namespace to support multiple databases.
 */
function getServerId(instanceId: string, keyType: string): string {
  return `${SERVER_BASE}.${keyType}.${instanceId}`;
}

/**
 * Store the wrapped key in secure storage.
 * The wrapped key is the database encryption key encrypted with the wrapping key.
 */
export async function storeWrappedKey(
  instanceId: string,
  wrappedKey: Uint8Array
): Promise<boolean> {
  try {
    await NativeBiometric.setCredentials({
      username: WRAPPED_KEY_PREFIX,
      password: bytesToHex(wrappedKey),
      server: getServerId(instanceId, WRAPPED_KEY_PREFIX)
    });
    // Track this instance ID for orphan detection
    await trackKeystoreInstance(instanceId);
    return true;
  } catch (error) {
    console.error('Failed to store wrapped key:', error);
    return false;
  }
}

/**
 * Retrieve the wrapped key from secure storage.
 * Optionally requires biometric authentication.
 */
export async function retrieveWrappedKey(
  instanceId: string,
  options: BiometricOptions = {}
): Promise<Uint8Array | null> {
  try {
    // Verify biometric if requested
    if (options.useBiometric) {
      const verified = await verifyBiometric(options);
      if (!verified) {
        return null;
      }
    }

    const credentials = await NativeBiometric.getCredentials({
      server: getServerId(instanceId, WRAPPED_KEY_PREFIX)
    });

    if (!credentials.password) {
      return null;
    }

    return hexToBytes(credentials.password);
  } catch {
    return null;
  }
}

/**
 * Store the wrapping key in secure storage.
 * The wrapping key is used to encrypt/decrypt the database key.
 * Note: This stores the raw bytes of the wrapping key, not a CryptoKey object.
 */
export async function storeWrappingKeyBytes(
  instanceId: string,
  wrappingKeyBytes: Uint8Array
): Promise<boolean> {
  try {
    await NativeBiometric.setCredentials({
      username: WRAPPING_KEY_PREFIX,
      password: bytesToHex(wrappingKeyBytes),
      server: getServerId(instanceId, WRAPPING_KEY_PREFIX)
    });
    return true;
  } catch (error) {
    console.error('Failed to store wrapping key:', error);
    return false;
  }
}

/**
 * Retrieve the wrapping key bytes from secure storage.
 */
export async function retrieveWrappingKeyBytes(
  instanceId: string
): Promise<Uint8Array | null> {
  try {
    const credentials = await NativeBiometric.getCredentials({
      server: getServerId(instanceId, WRAPPING_KEY_PREFIX)
    });

    if (!credentials.password) {
      return null;
    }

    return hexToBytes(credentials.password);
  } catch {
    return null;
  }
}

/**
 * Check if a session exists for the given instance.
 */
export async function hasSession(instanceId: string): Promise<boolean> {
  try {
    const credentials = await NativeBiometric.getCredentials({
      server: getServerId(instanceId, WRAPPED_KEY_PREFIX)
    });
    return !!credentials.password;
  } catch {
    return false;
  }
}

/**
 * Clear all session data for the given instance.
 */
export async function clearSession(instanceId: string): Promise<void> {
  try {
    await NativeBiometric.deleteCredentials({
      server: getServerId(instanceId, WRAPPED_KEY_PREFIX)
    });
  } catch {
    // Ignore errors when no credentials exist
  }

  try {
    await NativeBiometric.deleteCredentials({
      server: getServerId(instanceId, WRAPPING_KEY_PREFIX)
    });
  } catch {
    // Ignore errors when no credentials exist
  }

  // Remove from tracking
  await untrackKeystoreInstance(instanceId);
}
