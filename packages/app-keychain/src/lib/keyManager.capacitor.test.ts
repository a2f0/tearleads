/**
 * CapacitorKeyStorage and platform session tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock() calls must be in each test file (hoisted)
function selectRunnerMockFactory<ModuleShape>(
  bunFactory: () => ModuleShape,
  vitestFactory: () => Promise<ModuleShape>
) {
  if (typeof Reflect.get(globalThis, 'Bun') !== 'undefined') {
    return bunFactory;
  }

  return vitestFactory;
}

vi.mock(
  '@tearleads/shared',
  selectRunnerMockFactory(
    () => createSharedMock(),
    async () => {
      const { sharedModuleMockFactory } = await import(
        './keyManager.testUtils'
      );
      return sharedModuleMockFactory();
    }
  )
);
vi.mock(
  './nativeSecureStorage',
  selectRunnerMockFactory(
    () => createNativeStorageMock(),
    async () => {
      const { nativeStorageModuleMockFactory } = await import(
        './keyManager.testUtils'
      );
      return nativeStorageModuleMockFactory();
    }
  )
);
vi.mock(
  './detectPlatform',
  selectRunnerMockFactory(
    () => createUtilsMock(),
    async () => {
      const { detectPlatformModuleMockFactory } = await import(
        './keyManager.testUtils'
      );
      return detectPlatformModuleMockFactory();
    }
  )
);

import {
  clearAllKeyManagers,
  getKeyStatusForInstance,
  isBiometricAvailable,
  KeyManager
} from './keyManager';
import {
  createNativeStorageMock,
  createSharedMock,
  createUtilsMock,
  mockDB,
  mockIDBStore,
  resetKeyBytesMap,
  setupGlobalMocks
} from './keyManager.testUtils';

describe('CapacitorKeyStorage session persistence', () => {
  const IOS_INSTANCE_ID = 'ios-test-instance';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    setupGlobalMocks();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValue(true);
    vi.spyOn(nativeStorage, 'storeWrappedKey').mockResolvedValue(true);
    vi.spyOn(nativeStorage, 'retrieveWrappingKeyBytes').mockResolvedValue(null);
    vi.spyOn(nativeStorage, 'retrieveWrappedKey').mockResolvedValue(null);
    vi.spyOn(nativeStorage, 'hasSession').mockResolvedValue(false);
    vi.spyOn(nativeStorage, 'clearSession').mockResolvedValue(undefined);

    const utils = await import('./detectPlatform');
    vi.spyOn(utils, 'detectPlatform').mockReturnValue('ios');
  });

  afterEach(async () => {
    const utils = await import('./detectPlatform');
    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');
  });

  it('retries when wrapping key storage fails once', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValueOnce(
      false
    );

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
    expect(nativeStorage.storeWrappingKeyBytes).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('returns false when wrapping key storage fails on every attempt', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValue(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    expect(nativeStorage.storeWrappingKeyBytes).toHaveBeenCalledTimes(3);
    expect(nativeStorage.storeWrappedKey).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('retries when wrapped key storage fails once', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValueOnce(
      true
    );
    vi.spyOn(nativeStorage, 'storeWrappedKey').mockResolvedValueOnce(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
    expect(nativeStorage.storeWrappingKeyBytes).toHaveBeenCalledTimes(2);
    expect(nativeStorage.storeWrappedKey).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('returns false when wrapped key storage fails on every attempt', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValue(true);
    vi.spyOn(nativeStorage, 'storeWrappedKey').mockResolvedValue(false);

    const keyManager = new KeyManager(IOS_INSTANCE_ID);
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(false);
    expect(nativeStorage.storeWrappingKeyBytes).toHaveBeenCalledTimes(3);
    expect(nativeStorage.storeWrappedKey).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });

  it('returns null when wrapping key retrieval throws', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const nativeStorage = await import('./nativeSecureStorage');
    vi.spyOn(nativeStorage, 'retrieveWrappingKeyBytes').mockRejectedValueOnce(
      new Error('wrapping key failed')
    );
    vi.spyOn(nativeStorage, 'retrieveWrappedKey').mockResolvedValueOnce(
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
    vi.spyOn(nativeStorage, 'retrieveWrappingKeyBytes').mockResolvedValueOnce(
      new Uint8Array([1, 2, 3])
    );
    vi.spyOn(nativeStorage, 'retrieveWrappedKey').mockImplementationOnce(() => {
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
    vi.spyOn(nativeStorage, 'retrieveWrappingKeyBytes').mockResolvedValueOnce(
      null
    );
    vi.spyOn(nativeStorage, 'retrieveWrappedKey').mockResolvedValueOnce(
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
    vi.spyOn(nativeStorage, 'storeWrappingKeyBytes').mockResolvedValueOnce(
      true
    );
    vi.spyOn(nativeStorage, 'storeWrappedKey').mockResolvedValueOnce(true);

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
    setupGlobalMocks();
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
    const utils = await import('./detectPlatform');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('ios');
    vi.spyOn(nativeStorage, 'hasSession').mockResolvedValueOnce(true);

    const keyManager = new KeyManager('ios-has-session');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(true);
    expect(nativeStorage.hasSession).toHaveBeenCalledWith('ios-has-session');

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');
  });

  it('returns false on Electron when IPC is unavailable', async () => {
    const utils = await import('./detectPlatform');
    vi.spyOn(utils, 'detectPlatform').mockReturnValue('electron');

    Object.defineProperty(window, 'electron', {
      value: undefined,
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-ipc');
    const result = await keyManager.hasPersistedSession();

    expect(result).toBe(false);

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');
  });

  it('uses native session check for key status on iOS', async () => {
    const utils = await import('./detectPlatform');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('ios');
    vi.spyOn(nativeStorage, 'hasSession').mockResolvedValueOnce(false);

    const result = await getKeyStatusForInstance('ios-status');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');
  });
});

describe('isBiometricAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false on non-mobile platforms', async () => {
    const utils = await import('./detectPlatform');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: false });
    expect(nativeStorage.isBiometricAvailable).not.toHaveBeenCalled();
  });

  it('returns native biometric availability on iOS', async () => {
    const utils = await import('./detectPlatform');
    const nativeStorage = await import('./nativeSecureStorage');

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('ios');
    vi.spyOn(nativeStorage, 'isBiometricAvailable').mockResolvedValueOnce({
      isAvailable: true
    });

    const result = await isBiometricAvailable();

    expect(result).toEqual({ isAvailable: true });
    expect(nativeStorage.isBiometricAvailable).toHaveBeenCalled();

    vi.spyOn(utils, 'detectPlatform').mockReturnValue('web');
  });
});
