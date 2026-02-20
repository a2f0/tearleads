/**
 * ElectronKeyStorage session persistence tests.
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
  KeyManager
} from './keyManager';
import { mockDB, mockIDBStore, resetKeyBytesMap } from './keyManager.testUtils';

describe('ElectronKeyStorage session persistence', () => {
  const ELECTRON_INSTANCE_ID = 'electron-test-instance';

  // Mock Electron API
  const mockElectronApi = {
    getSalt: vi.fn(),
    setSalt: vi.fn(),
    getKeyCheckValue: vi.fn(),
    setKeyCheckValue: vi.fn(),
    clearKeyStorage: vi.fn(),
    getWrappingKey: vi.fn(),
    setWrappingKey: vi.fn(),
    getWrappedKey: vi.fn(),
    setWrappedKey: vi.fn(),
    hasSession: vi.fn(),
    clearSession: vi.fn()
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    // Reset all mock return values
    mockElectronApi.getSalt.mockResolvedValue(null);
    mockElectronApi.getKeyCheckValue.mockResolvedValue(null);
    mockElectronApi.getWrappingKey.mockResolvedValue(null);
    mockElectronApi.getWrappedKey.mockResolvedValue(null);
    mockElectronApi.hasSession.mockResolvedValue(false);

    // Set up window.electron.sqlite mock
    (
      window as unknown as { electron: { sqlite: typeof mockElectronApi } }
    ).electron = {
      sqlite: mockElectronApi
    };

    // Mock detectPlatform to return 'electron'
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');
  });

  afterEach(() => {
    // Clean up window.electron
    delete (window as unknown as { electron?: unknown }).electron;
  });

  describe('hasPersistedSession', () => {
    it('returns false when no session exists', async () => {
      mockElectronApi.hasSession.mockResolvedValue(false);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.hasPersistedSession();

      expect(result).toBe(false);
      expect(mockElectronApi.hasSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns true when session exists', async () => {
      mockElectronApi.hasSession.mockResolvedValue(true);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.hasPersistedSession();

      expect(result).toBe(true);
      expect(mockElectronApi.hasSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });
  });

  describe('persistSession', () => {
    it('stores wrapping key and wrapped key via IPC', async () => {
      mockElectronApi.getSalt.mockResolvedValue([1, 2, 3]);
      mockElectronApi.getKeyCheckValue.mockResolvedValue('test-kcv');

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.setupNewKey('password');

      const result = await keyManager.persistSession();

      expect(result).toBe(true);
      expect(mockElectronApi.setWrappingKey).toHaveBeenCalledWith(
        expect.any(Array),
        ELECTRON_INSTANCE_ID
      );
      expect(mockElectronApi.setWrappedKey).toHaveBeenCalledWith(
        expect.any(Array),
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns false when no current key', async () => {
      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.persistSession();

      expect(result).toBe(false);
      expect(mockElectronApi.setWrappingKey).not.toHaveBeenCalled();
    });

    it('returns false when Electron storage throws', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.setWrappingKey.mockRejectedValueOnce(
        new Error('ipc failed')
      );

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.setupNewKey('password');

      const result = await keyManager.persistSession();

      expect(result).toBe(false);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('restoreSession', () => {
    it('retrieves and unwraps the session key', async () => {
      mockElectronApi.getWrappingKey.mockResolvedValue([4, 4, 4]);
      mockElectronApi.getWrappedKey.mockResolvedValue([3, 3, 3]);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockElectronApi.getWrappingKey).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
      expect(mockElectronApi.getWrappedKey).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });

    it('returns null when no session stored', async () => {
      mockElectronApi.getWrappingKey.mockResolvedValue(null);
      mockElectronApi.getWrappedKey.mockResolvedValue(null);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
    });

    it('returns null when wrapping key retrieval fails', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.getWrappingKey.mockRejectedValueOnce(
        new Error('wrapping key failed')
      );
      mockElectronApi.getWrappedKey.mockResolvedValue([1, 2, 3]);

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns null when wrapped key retrieval fails', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      mockElectronApi.getWrappingKey.mockResolvedValue([1, 2, 3]);
      mockElectronApi.getWrappedKey.mockRejectedValueOnce(
        new Error('wrapped key failed')
      );

      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      const result = await keyManager.restoreSession();

      expect(result).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('clearPersistedSession', () => {
    it('clears session data via IPC', async () => {
      const keyManager = new KeyManager(ELECTRON_INSTANCE_ID);
      await keyManager.clearPersistedSession();

      expect(mockElectronApi.clearSession).toHaveBeenCalledWith(
        ELECTRON_INSTANCE_ID
      );
    });
  });
});

describe('ElectronKeyStorage adapter behavior', () => {
  const ELECTRON_STATUS_ID = 'electron-status';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIDBStore.clear();
    resetKeyBytesMap();
    mockDB.objectStoreNames.contains.mockReturnValue(true);
    clearAllKeyManagers();

    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('electron');
  });

  afterEach(async () => {
    const utils = await import('@/lib/utils');
    vi.mocked(utils.detectPlatform).mockReturnValue('web');
  });

  it('returns key status using Electron storage', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getSalt: vi.fn(async () => [1, 2, 3]),
          getKeyCheckValue: vi.fn(async () => 'kcv'),
          hasSession: vi.fn(async () => true)
        }
      },
      configurable: true
    });

    const result = await getKeyStatusForInstance(ELECTRON_STATUS_ID);

    expect(result).toEqual({
      salt: true,
      keyCheckValue: true,
      wrappingKey: true,
      wrappedKey: true
    });
  });

  it('returns false for missing Electron salt and key check value', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getSalt: vi.fn(async () => null),
          getKeyCheckValue: vi.fn(async () => null),
          hasSession: vi.fn(async () => false)
        }
      },
      configurable: true
    });

    const result = await getKeyStatusForInstance('electron-null-salt');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('skips salt and KCV IPC when Electron APIs are missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: { sqlite: {} },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-salt-kcv');
    const result = await keyManager.setupNewKey('password');

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('returns empty status when Electron storage APIs are missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: { sqlite: {} },
      configurable: true
    });

    const result = await getKeyStatusForInstance('electron-missing');

    expect(result).toEqual({
      salt: false,
      keyCheckValue: false,
      wrappingKey: false,
      wrappedKey: false
    });
  });

  it('handles missing Electron session IPC methods gracefully', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          setSalt: vi.fn(async () => undefined),
          setKeyCheckValue: vi.fn(async () => undefined)
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-session');
    await keyManager.setupNewKey('password');

    const result = await keyManager.persistSession();

    expect(result).toBe(true);
  });

  it('returns null when Electron wrapped key API is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getWrappingKey: vi.fn(async () => [1, 2, 3])
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-wrapped');
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('skips clearing Electron session when IPC is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {}
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-clear');
    await keyManager.clearPersistedSession();

    expect(true).toBe(true);
  });

  it('skips clearing key storage when Electron IPC is missing', async () => {
    const clearSession = vi.fn(async () => undefined);
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          clearSession
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-no-clear-storage');
    await keyManager.reset();

    expect(clearSession).toHaveBeenCalledWith('electron-no-clear-storage');
  });

  it('returns null when Electron wrapping key API is missing', async () => {
    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          getWrappedKey: vi.fn(async () => [1, 2, 3])
        }
      },
      configurable: true
    });

    const keyManager = new KeyManager('electron-missing-wrapping');
    const result = await keyManager.restoreSession();

    expect(result).toBeNull();
  });

  it('initializes and clears Electron storage on reset', async () => {
    const clearKeyStorage = vi.fn(async () => undefined);
    const clearSession = vi.fn(async () => undefined);

    Object.defineProperty(window, 'electron', {
      value: {
        sqlite: {
          clearKeyStorage,
          clearSession
        }
      },
      configurable: true
    });

    const manager = new KeyManager('electron-reset');
    await manager.reset();

    expect(clearKeyStorage).toHaveBeenCalledWith('electron-reset');
    expect(clearSession).toHaveBeenCalledWith('electron-reset');
  });
});
