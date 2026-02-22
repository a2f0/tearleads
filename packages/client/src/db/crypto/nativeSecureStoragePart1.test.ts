/**
 * Unit tests for native-secure-storage module.
 *
 * These tests verify the session persistence behavior on mobile platforms
 * (iOS/Android) using the NativeBiometric plugin.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create hoisted mocks that are available before vi.mock runs
const {
  mockIsAvailable,
  mockVerifyIdentity,
  mockSetCredentials,
  mockGetCredentials,
  mockDeleteCredentials
} = vi.hoisted(() => ({
  mockIsAvailable: vi.fn(),
  mockVerifyIdentity: vi.fn(),
  mockSetCredentials: vi.fn(),
  mockGetCredentials: vi.fn(),
  mockDeleteCredentials: vi.fn()
}));

// Mock the NativeBiometric plugin
vi.mock('@capgo/capacitor-native-biometric', () => ({
  NativeBiometric: {
    isAvailable: mockIsAvailable,
    verifyIdentity: mockVerifyIdentity,
    setCredentials: mockSetCredentials,
    getCredentials: mockGetCredentials,
    deleteCredentials: mockDeleteCredentials
  },
  BiometryType: {
    TOUCH_ID: 1,
    FACE_ID: 2,
    FINGERPRINT: 3,
    IRIS_AUTHENTICATION: 4,
    FACE_AUTHENTICATION: 5,
    NONE: 0
  }
}));

// Import after mocking
import { BiometryType } from '@capgo/capacitor-native-biometric';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  clearSession,
  getTrackedKeystoreInstanceIds,
  hasSession,
  isBiometricAvailable,
  retrieveWrappedKey,
  retrieveWrappingKeyBytes,
  storeWrappedKey,
  storeWrappingKeyBytes,
  verifyBiometric
} from './nativeSecureStorage';

const TEST_INSTANCE_ID = 'test-instance-123';describe('native-secure-storage', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isBiometricAvailable', () => {
    it.each([
      {
        type: BiometryType.FACE_ID,
        name: 'faceId',
        description: 'Face ID'
      },
      {
        type: BiometryType.TOUCH_ID,
        name: 'touchId',
        description: 'Touch ID'
      },
      {
        type: BiometryType.FINGERPRINT,
        name: 'fingerprint',
        description: 'fingerprint'
      }
    ])('returns isAvailable true with biometryType when $description is available', async ({
      type,
      name
    }) => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: type
      });

      const result = await isBiometricAvailable();

      expect(result).toEqual({
        isAvailable: true,
        biometryType: name
      });
    });

    it('returns isAvailable false when biometric is not available', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: false,
        biometryType: BiometryType.NONE
      });

      const result = await isBiometricAvailable();

      expect(result).toEqual({ isAvailable: false });
    });

    it('returns isAvailable false when plugin throws error', async () => {
      mockIsAvailable.mockRejectedValue(new Error('Plugin not ready'));

      const result = await isBiometricAvailable();

      expect(result).toEqual({ isAvailable: false });
    });

    it('handles plugin not being ready on cold start gracefully', async () => {
      // Simulate plugin not ready scenario
      mockIsAvailable.mockRejectedValue(
        new Error('Capacitor plugin not available')
      );

      const result = await isBiometricAvailable();

      expect(result).toEqual({ isAvailable: false });
      expect(mockIsAvailable).toHaveBeenCalled();
    });
  });

  describe('verifyBiometric', () => {
    it('returns true when biometric verification succeeds', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: BiometryType.FACE_ID
      });
      mockVerifyIdentity.mockResolvedValue(undefined);

      const result = await verifyBiometric();

      expect(result).toBe(true);
      expect(mockVerifyIdentity).toHaveBeenCalledWith({
        title: 'Unlock Database',
        subtitle: 'Authenticate to restore your session',
        useFallback: true
      });
    });

    it('returns false when biometric is not available', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: false,
        biometryType: BiometryType.NONE
      });

      const result = await verifyBiometric();

      expect(result).toBe(false);
      expect(mockVerifyIdentity).not.toHaveBeenCalled();
    });

    it('returns false when user cancels biometric prompt', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: BiometryType.FACE_ID
      });
      mockVerifyIdentity.mockRejectedValue(new Error('User cancelled'));

      const result = await verifyBiometric();

      expect(result).toBe(false);
    });

    it('uses custom title and subtitle when provided', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: BiometryType.FACE_ID
      });
      mockVerifyIdentity.mockResolvedValue(undefined);

      await verifyBiometric({
        biometricTitle: 'Custom Title',
        biometricSubtitle: 'Custom Subtitle'
      });

      expect(mockVerifyIdentity).toHaveBeenCalledWith({
        title: 'Custom Title',
        subtitle: 'Custom Subtitle',
        useFallback: true
      });
    });
  });

  describe.each([
    {
      fn: storeWrappedKey,
      fnName: 'storeWrappedKey',
      keyName: 'wrapped_key',
      keyBytes: new Uint8Array([1, 2, 3, 4, 5]),
      keyHex: '0102030405',
      errorMessage: 'Failed to store wrapped key:'
    },
    {
      fn: storeWrappingKeyBytes,
      fnName: 'storeWrappingKeyBytes',
      keyName: 'wrapping_key',
      keyBytes: new Uint8Array([10, 20, 30, 40]),
      keyHex: '0a141e28',
      errorMessage: 'Failed to store wrapping key:'
    }
  ])('$fnName', ({ fn, keyName, keyBytes, keyHex, errorMessage }) => {
    it('stores key successfully', async () => {
      mockSetCredentials.mockResolvedValue(undefined);

      const result = await fn(TEST_INSTANCE_ID, keyBytes);

      expect(result).toBe(true);
      expect(mockSetCredentials).toHaveBeenCalledWith({
        username: keyName,
        password: keyHex,
        server: `com.tearleads.app.${keyName}.${TEST_INSTANCE_ID}`
      });
    });

    it('returns false when storage fails', async () => {
      const consoleSpy = mockConsoleError();
      mockSetCredentials.mockRejectedValue(new Error('Storage error'));

      const result = await fn(TEST_INSTANCE_ID, new Uint8Array([1, 2, 3]));

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(errorMessage, expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('retrieveWrappedKey', () => {
    it('retrieves wrapped key without biometric when useBiometric is false', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: '0102030405'
      });

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: false
      });

      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      expect(mockVerifyIdentity).not.toHaveBeenCalled();
    });

    it('verifies biometric before retrieving when useBiometric is true', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: BiometryType.FACE_ID
      });
      mockVerifyIdentity.mockResolvedValue(undefined);
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: 'aabbccdd'
      });

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: true
      });

      expect(mockVerifyIdentity).toHaveBeenCalled();
      expect(result).toEqual(new Uint8Array([170, 187, 204, 221]));
    });

    it('returns null when biometric verification fails', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: true,
        biometryType: BiometryType.FACE_ID
      });
      mockVerifyIdentity.mockRejectedValue(new Error('User cancelled'));

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: true
      });

      expect(result).toBeNull();
      expect(mockGetCredentials).not.toHaveBeenCalled();
    });

    it('returns null when biometric is not available but useBiometric is true', async () => {
      mockIsAvailable.mockResolvedValue({
        isAvailable: false,
        biometryType: BiometryType.NONE
      });

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: true
      });

      expect(result).toBeNull();
      expect(mockGetCredentials).not.toHaveBeenCalled();
    });

    it('returns null when credentials do not exist', async () => {
      mockGetCredentials.mockRejectedValue(new Error('Credentials not found'));

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: false
      });

      expect(result).toBeNull();
    });

    it('returns null when password is empty', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: ''
      });

      const result = await retrieveWrappedKey(TEST_INSTANCE_ID, {
        useBiometric: false
      });

      expect(result).toBeNull();
    });
  });

  describe('retrieveWrappingKeyBytes', () => {
    it('retrieves wrapping key bytes successfully', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapping_key',
        password: 'deadbeef'
      });

      const result = await retrieveWrappingKeyBytes(TEST_INSTANCE_ID);

      expect(result).toEqual(new Uint8Array([222, 173, 190, 239]));
    });

    it('returns null when credentials do not exist', async () => {
      mockGetCredentials.mockRejectedValue(new Error('Not found'));

      const result = await retrieveWrappingKeyBytes(TEST_INSTANCE_ID);

      expect(result).toBeNull();
    });

    it('does not require biometric verification', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapping_key',
        password: 'aabbccdd'
      });

      await retrieveWrappingKeyBytes(TEST_INSTANCE_ID);

      expect(mockVerifyIdentity).not.toHaveBeenCalled();
    });
  });

  describe('hasSession', () => {
    it('returns true when session credentials exist', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: 'somekey'
      });

      const result = await hasSession(TEST_INSTANCE_ID);

      expect(result).toBe(true);
      expect(mockGetCredentials).toHaveBeenCalledWith({
        server: `com.tearleads.app.wrapped_key.${TEST_INSTANCE_ID}`
      });
    });

    it('returns false when no credentials exist', async () => {
      mockGetCredentials.mockRejectedValue(new Error('Not found'));

      const result = await hasSession(TEST_INSTANCE_ID);

      expect(result).toBe(false);
    });

    it('returns false when password is empty', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: ''
      });

      const result = await hasSession(TEST_INSTANCE_ID);

      expect(result).toBe(false);
    });

    it('does not trigger biometric prompt', async () => {
      mockGetCredentials.mockResolvedValue({
        username: 'wrapped_key',
        password: 'somekey'
      });

      await hasSession(TEST_INSTANCE_ID);

      expect(mockVerifyIdentity).not.toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    it('deletes both wrapped and wrapping key credentials', async () => {
      mockDeleteCredentials.mockResolvedValue(undefined);

      await clearSession(TEST_INSTANCE_ID);

      expect(mockDeleteCredentials).toHaveBeenCalledTimes(2);
      expect(mockDeleteCredentials).toHaveBeenCalledWith({
        server: `com.tearleads.app.wrapped_key.${TEST_INSTANCE_ID}`
      });
      expect(mockDeleteCredentials).toHaveBeenCalledWith({
        server: `com.tearleads.app.wrapping_key.${TEST_INSTANCE_ID}`
      });
    });

    it('does not throw when credentials do not exist', async () => {
      mockDeleteCredentials.mockRejectedValue(new Error('Not found'));

      await expect(clearSession(TEST_INSTANCE_ID)).resolves.toBeUndefined();
    });
  });
});
