import type { KeychainDependencies } from '@tearleads/keychain';
import {
  deleteSessionKeysForInstance,
  getKeyManagerForInstance,
  getKeyStatusForInstance
} from '@/db/crypto';
import {
  deleteInstanceFromRegistry,
  getInstance,
  getInstances
} from '@/db/instanceRegistry';

export const clientKeychainDependencies: KeychainDependencies = {
  getInstances,
  getInstance,
  deleteInstanceFromRegistry,
  getKeyStatusForInstance,
  deleteSessionKeysForInstance,
  async resetInstanceKeys(instanceId: string): Promise<void> {
    const manager = getKeyManagerForInstance(instanceId);
    await manager.reset();
  }
};
