/**
 * Vehicles module state holder.
 * Provides database adapter access without coupling to client's state module.
 * The client configures this at startup via setVehiclesAdapter.
 */

import type { DatabaseAdapter } from '@tearleads/db/adapter';

let adapterInstance: DatabaseAdapter | null = null;
let initialized = false;

export function setVehiclesAdapter(adapter: DatabaseAdapter | null): void {
  adapterInstance = adapter;
  initialized = adapter !== null;
}

export function getDatabaseAdapter(): DatabaseAdapter {
  if (!adapterInstance) {
    throw new Error('Vehicles adapter not initialized');
  }
  return adapterInstance;
}

export function isDatabaseInitialized(): boolean {
  return initialized;
}
