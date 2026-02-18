import { i18n } from '@client/i18n';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { InstanceMetadata, KeyStatus } from '../../lib/types';
import { setKeychainDependencies } from '../../lib/keychainDependencies';
import { Keychain } from './Keychain';

export const mockGetKeyStatusForInstance =
  vi.fn<(instanceId: string) => Promise<KeyStatus>>();
export const mockDeleteSessionKeysForInstance =
  vi.fn<(instanceId: string) => Promise<void>>();
export const mockGetInstances = vi.fn<() => Promise<InstanceMetadata[]>>();

vi.mock('@client/db/crypto/keyManager', () => ({
  getKeyStatusForInstance: (instanceId: string) =>
    mockGetKeyStatusForInstance(instanceId),
  deleteSessionKeysForInstance: (instanceId: string) =>
    mockDeleteSessionKeysForInstance(instanceId)
}));

vi.mock('@client/db/instanceRegistry', () => ({
  getInstances: () => mockGetInstances()
}));

export function renderKeychain() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Keychain />
      </MemoryRouter>
    </I18nextProvider>
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
