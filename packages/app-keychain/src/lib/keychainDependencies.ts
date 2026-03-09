import type { InstanceMetadata, KeyStatus } from './types';

export interface KeychainDependencies {
  getInstances: () => Promise<InstanceMetadata[]>;
  getInstance: (instanceId: string) => Promise<InstanceMetadata | null>;
  deleteInstanceFromRegistry: (instanceId: string) => Promise<void>;
  getKeyStatusForInstance: (instanceId: string) => Promise<KeyStatus>;
  deleteSessionKeysForInstance: (instanceId: string) => Promise<void>;
  resetInstanceKeys: (instanceId: string) => Promise<void>;
}

let dependencies: KeychainDependencies | null = null;

export function setKeychainDependencies(next: KeychainDependencies): void {
  dependencies = next;
}

export function getKeychainDependencies(): KeychainDependencies | null {
  return dependencies;
}
