/**
 * CapacitorKeyStorage and platform session tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock() calls must be in each test file (hoisted)
vi.mock('@tearleads/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tearleads/shared')>();
  const { createSharedMock } = await import('./keyManager.testUtils');
  return { ...original, ...createSharedMock() };
});

vi.mock('./nativeSecureStorage', async () => {
  const { createNativeStorageMock } = await import('./keyManager.testUtils');
  return createNativeStorageMock();
});

vi.mock('@/lib/utils', async () => {
  const { createUtilsMock } = await import('./keyManager.testUtils');
  return createUtilsMock();
});

import {
  clearAllKeyManagers,
  getKeyStatusForInstance,
  isBiometricAvailable,
  KeyManager
} from './keyManager';
import { mockDB, mockIDBStore, resetKeyBytesMap } from './keyManager.testUtils';

describe('CapacitorKeyStorage session persistence', () => {
  const IOS_INSTANCE_ID = 'ios-test-instance';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
  });

  afterEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns false when wrapping key storage fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    consoleError.mockRestore();
  });

  it('returns false when wrapped key storage fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(true);
    vi.mocked(nativeStorage.storeWrappedKey).mockResolvedValueOnce(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    consoleError.mockRestore();
  });

  it('returns null when wrapping key retrieval throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockRejectedValueOnce(
      new Error('wrapping key failed')
    );
    vi.mocked(nativeStorage.retrieveWrappedKey).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns null when wrapped key retrieval throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );
    vi.mocked(nativeStorage.retrieveWrappedKey).mockImplementationOnce(() => {
      throw new Error('wrapped key failed');
    });

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns null when wrapping key is missing', async () => {
    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.retrieveWrappingKeyBytes).mockResolvedValueOnce(
      null
    );
    vi.mocked(nativeStorage.retrieveWrappedKey).mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('clears native session data on clearPersistedSession', async () => {
    const nativeStorage = await import('./nativeSecureStorage');

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.clearPersistedSession();

    expect(nativeStorage.clearSession).toHaveBeenCalledWith(IOS_INSTANCE_ID);
  });

  it('persists session when native storage succeeds', async () => {
    const nativeStorage = await import('./nativeSecureStorage');
    vi.mocked(nativeStorage.storeWrappingKeyBytes).mockResolvedValueOnce(true);
    vi.mocked(nativeStorage.storeWrappedKey).mockResolvedValueOnce(true);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });
});

describe('platform session checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();
  });

  it('initializes storage when persisting without prior setup', async () => {
    const keyManager = new KeyManager('persist-init');

    Object.defineProperty(keyManager, 'currentKey', {
      value: new Uint8Array([1, 2, 3]),
      writable: true
    });
    Object.defineProperty(keyManager, 'storage', {
      value: null,
      writable: true
    });

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });

  it('uses existing storage when checking for a key', async () => {
    const keyManager = new KeyManager('repeat-has-key');
    await keyManager.hasExistingKey();
    const result = await keyManager.hasExistingKey();

    expect(result).toBe(false);
  });

  it('uses existing storage when setting up a key', async () => {
    const keyManager = new KeyManager('repeat-setup');
    await keyManager.setupNewKey('password');
    const result = await keyManager.setupNewKey('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses existing storage when unlocking a key', async () => {
    const keyManager = new KeyManager('repeat-unlock');
    await keyManager.setupNewKey('password');
    keyManager.clearKey();

    const result = await keyManager.unlockWithPassword('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses existing storage when checking persisted session', async () => {
    const keyManager = new KeyManager('repeat-session-check');
    await keyManager.setupNewKey('password');

    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(false);
  });

  it('uses existing storage when restoring a session', async () => {
    const keyManager = new KeyManager('repeat-restore');
    await keyManager.setupNewKey('password');

    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('delegates hasPersistedSession to native storage on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.hasSession).mockResolvedValueOnce(true);

    const keyManager = new KeyManager('ios-has-session');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(true);
    expect(nativeStorage.hasSession).toHaveBeenCalledWith('ios-has-session');

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns false on Electron when IPC is unavailable', async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');

    Object.defineProperty(window, 'electron', {
      value: undefined,
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-ipc');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(false);

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('uses native session check for key status on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.hasSession).mockResolvedValueOnce(false);

    const result = await getKeyStatusForInstance('ios-status');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });
});

describe('isBiometricAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false on non-mobile platforms', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.mocked(utils.detectPlatform).mockReturnValue('web');

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: false });
    expect(nativeStorage.isBiometricAvailable).not.toHaveBeenCalled();
  });

  it('returns native biometric availability on iOS', async () => {
    const utils = await import('@/lib/utils');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.mocked(utils.detectPlatform).mockReturnValue('ios');
    vi.mocked(nativeStorage.isBiometricAvailable).mockResolvedValueOnce({
      isAvailable: true
    });

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: true });
    expect(nativeStorage.isBiometricAvailable).toHaveBeenCalled();

    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });
});
