import { detectPlatform } from '@/lib/utils';
import { getStorageAdapter } from './keyManagerStorageAdapters';
import * as nativeSecureStorage from './nativeSecureStorage';

/**
 * Result of orphan validation and cleanup.
 */
interface OrphanCleanupResult {
  /** Instance IDs that had Keystore entries but no registry entry */
  orphanedKeystoreEntries: string[];
  /** Instance IDs that were in registry but had no valid salt/KCV */
  orphanedRegistryEntries: string[];
  /** Whether any cleanup was performed */
  cleaned: boolean;
}

/**
 * Validate and prune orphaned Keystore and registry entries.
 *
 * This function detects two types of orphans:
 * 1. Keystore entries without corresponding registry entries
 *    (e.g., Android Keystore surviving app uninstall)
 * 2. Registry entries without valid salt/KCV
 *    (e.g., incomplete setup or corrupted state)
 *
 * Should be called during app initialization to clean up stale state.
 *
 * @param registryInstanceIds - All instance IDs currently in the registry
 * @param deleteRegistryEntry - Callback to delete an instance from registry
 * @returns Information about what was cleaned up
 */
export async function validateAndPruneOrphanedInstances(
  registryInstanceIds: string[],
  deleteRegistryEntry: (instanceId: string) => Promise<void>
): Promise<OrphanCleanupResult> {
  const result: OrphanCleanupResult = {
    orphanedKeystoreEntries: [],
    orphanedRegistryEntries: [],
    cleaned: false
  };

  // Skip orphan cleanup in test environments where IndexedDB may not be available
  if (typeof indexedDB === 'undefined') {
    return result;
  }

  try {
    const platform = detectPlatform();

    // Only check for orphaned Keystore entries on mobile platforms
    if (platform === 'ios' || platform === 'android') {
      const trackedKeystoreIds =
        await nativeSecureStorage.getTrackedKeystoreInstanceIds();
      const registryIdSet = new Set(registryInstanceIds);

      // Find Keystore entries that don't have corresponding registry entries
      result.orphanedKeystoreEntries = trackedKeystoreIds.filter(
        (keystoreId) => !registryIdSet.has(keystoreId)
      );

      // Clean up orphaned Keystore entries in parallel
      if (result.orphanedKeystoreEntries.length > 0) {
        await Promise.all(
          result.orphanedKeystoreEntries.map((keystoreId) =>
            nativeSecureStorage.clearSession(keystoreId)
          )
        );
      }
    }

    // Check for registry entries without valid salt/KCV
    for (const instanceId of registryInstanceIds) {
      const storage = await getStorageAdapter(instanceId);
      const salt = await storage.getSalt();
      const kcv = await storage.getKeyCheckValue();

      // If no salt exists, this is an orphaned registry entry
      // (salt is created during setup, so no salt means setup never completed
      // or the key storage was cleared without clearing the registry)
      if (!salt || !kcv) {
        result.orphanedRegistryEntries.push(instanceId);
        // Clean up any partial key storage
        await storage.clear();
        // Delete from registry
        await deleteRegistryEntry(instanceId);
      }
    }

    result.cleaned =
      result.orphanedKeystoreEntries.length > 0 ||
      result.orphanedRegistryEntries.length > 0;
  } catch (err) {
    // Orphan cleanup is non-critical; log and continue if it fails
    console.warn('Orphan cleanup failed:', err);
  }

  return result;
}
