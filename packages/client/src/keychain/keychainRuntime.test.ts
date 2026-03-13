import { beforeEach, describe, expect, it, vi } from 'vitest';

const getInstancesMock = vi.fn();
const getInstanceMock = vi.fn();
const deleteInstanceFromRegistryMock = vi.fn();
const getKeyStatusForInstanceMock = vi.fn();
const deleteSessionKeysForInstanceMock = vi.fn();
const getKeyManagerForInstanceMock = vi.fn();
const resetMock = vi.fn();

vi.mock('@/db/instanceRegistry', () => ({
  getInstances: (...args: unknown[]) => getInstancesMock(...args),
  getInstance: (...args: unknown[]) => getInstanceMock(...args),
  deleteInstanceFromRegistry: (...args: unknown[]) =>
    deleteInstanceFromRegistryMock(...args)
}));

vi.mock('@/db/crypto', () => ({
  getKeyStatusForInstance: (...args: unknown[]) =>
    getKeyStatusForInstanceMock(...args),
  deleteSessionKeysForInstance: (...args: unknown[]) =>
    deleteSessionKeysForInstanceMock(...args),
  getKeyManagerForInstance: (...args: unknown[]) =>
    getKeyManagerForInstanceMock(...args)
}));

import { clientKeychainDependencies } from './keychainRuntime';

describe('clientKeychainDependencies', () => {
  beforeEach(() => {
    getInstancesMock.mockReset();
    getInstanceMock.mockReset();
    deleteInstanceFromRegistryMock.mockReset();
    getKeyStatusForInstanceMock.mockReset();
    deleteSessionKeysForInstanceMock.mockReset();
    getKeyManagerForInstanceMock.mockReset();
    resetMock.mockReset();

    getKeyManagerForInstanceMock.mockReturnValue({ reset: resetMock });
  });

  it('delegates getInstances to instanceRegistry', async () => {
    const instances = [{ id: 'inst-1', name: 'Primary' }];
    getInstancesMock.mockResolvedValue(instances);

    const result = await clientKeychainDependencies.getInstances();

    expect(getInstancesMock).toHaveBeenCalled();
    expect(result).toBe(instances);
  });

  it('delegates getInstance to instanceRegistry', async () => {
    const instance = { id: 'inst-1', name: 'Primary' };
    getInstanceMock.mockResolvedValue(instance);

    const result = await clientKeychainDependencies.getInstance('inst-1');

    expect(getInstanceMock).toHaveBeenCalledWith('inst-1');
    expect(result).toBe(instance);
  });

  it('delegates deleteInstanceFromRegistry to instanceRegistry', async () => {
    deleteInstanceFromRegistryMock.mockResolvedValue(undefined);

    await clientKeychainDependencies.deleteInstanceFromRegistry('inst-1');

    expect(deleteInstanceFromRegistryMock).toHaveBeenCalledWith('inst-1');
  });

  it('delegates getKeyStatusForInstance to crypto', async () => {
    const status = {
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    };
    getKeyStatusForInstanceMock.mockResolvedValue(status);

    const result =
      await clientKeychainDependencies.getKeyStatusForInstance('inst-1');

    expect(getKeyStatusForInstanceMock).toHaveBeenCalledWith('inst-1');
    expect(result).toBe(status);
  });

  it('delegates deleteSessionKeysForInstance to crypto', async () => {
    deleteSessionKeysForInstanceMock.mockResolvedValue(undefined);

    await clientKeychainDependencies.deleteSessionKeysForInstance('inst-1');

    expect(deleteSessionKeysForInstanceMock).toHaveBeenCalledWith('inst-1');
  });

  it('resets instance keys via KeyManager', async () => {
    resetMock.mockResolvedValue(undefined);

    await clientKeychainDependencies.resetInstanceKeys('inst-1');

    expect(getKeyManagerForInstanceMock).toHaveBeenCalledWith('inst-1');
    expect(resetMock).toHaveBeenCalled();
  });
});
