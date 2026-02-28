/**
 * Per-user active organization preference.
 * Stored in the same IndexedDB registry database as instance metadata,
 * keyed by `active_org_{userId}`.
 */

import { getFromStore, setInStore } from './registryStore';

export async function getActiveOrgForUser(
  userId: string
): Promise<string | null> {
  return getFromStore<string>(`active_org_${userId}`);
}

export async function setActiveOrgForUser(
  userId: string,
  orgId: string
): Promise<void> {
  await setInStore(`active_org_${userId}`, orgId);
}

export async function clearActiveOrgForUser(userId: string): Promise<void> {
  await setInStore(`active_org_${userId}`, null);
}
