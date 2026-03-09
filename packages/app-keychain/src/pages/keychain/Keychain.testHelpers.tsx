import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { setKeychainDependencies } from '../../lib/keychainDependencies';
import type { InstanceMetadata, KeyStatus } from '../../lib/types';
import { Keychain } from './Keychain';

export const mockGetKeyStatusForInstance =
  vi.fn<(instanceId: string) => Promise<KeyStatus>>();
export const mockDeleteSessionKeysForInstance =
  vi.fn<(instanceId: string) => Promise<void>>();
export const mockGetInstances = vi.fn<() => Promise<InstanceMetadata[]>>();

export function renderKeychain() {
  return render(
    <MemoryRouter>
      <Keychain />
    </MemoryRouter>
  );
}

export function createInstance(
  id: string,
  name: string,
  createdAt = Date.now(),
  lastAccessedAt = Date.now()
): InstanceMetadata {
  return { id, name, createdAt, lastAccessedAt };
}

export function createKeyStatus(
  salt = false,
  keyCheckValue = false,
  wrappingKey = false,
  wrappedKey = false
): KeyStatus {
  return { salt, keyCheckValue, wrappingKey, wrappedKey };
}

export function resetKeychainPageTestState(): void {
  vi.clearAllMocks();

  mockGetInstances.mockResolvedValue([]);
  mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());
  mockDeleteSessionKeysForInstance.mockResolvedValue(undefined);
  setKeychainDependencies({
    getInstances: () => mockGetInstances(),
    getInstance: async (instanceId) => {
      const instances = await mockGetInstances();
      return instances.find((instance) => instance.id === instanceId) ?? null;
    },
    deleteInstanceFromRegistry: async () => {},
    getKeyStatusForInstance: (instanceId) =>
      mockGetKeyStatusForInstance(instanceId),
    deleteSessionKeysForInstance: (instanceId) =>
      mockDeleteSessionKeysForInstance(instanceId),
    resetInstanceKeys: async () => {}
  });
}
