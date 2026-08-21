import {
  requestPersistentStorage,
  resolveStoragePersistencePolicy,
  type StoragePersistencePolicy,
} from "@symcrypt/client-sdk/sqlite";
import { useEffect, useMemo } from "react";

/**
 * Resolves the storage persistence policy from the host config and, once per
 * mount, asks the browser to make OPFS durable so the persistent SQLite database
 * and blob store survive eviction.
 *
 * The persistence request is a no-op when the policy is ephemeral or the
 * `navigator.storage.persist` API is unavailable, and it never blocks or fails
 * database boot — it only logs its outcome.
 */
export function usePersistentStoragePolicy(
  preferred: StoragePersistencePolicy | undefined,
  log: (message: string) => void,
): StoragePersistencePolicy {
  const persistencePolicy = useMemo(
    () => resolveStoragePersistencePolicy(preferred),
    [preferred],
  );

  useEffect(() => {
    let cancelled = false;
    void requestPersistentStorage(persistencePolicy).then((result) => {
      if (cancelled || result === "not-requested") {
        return;
      }
      log(`Persistent storage request: ${result}`);
    });

    return () => {
      cancelled = true;
    };
  }, [persistencePolicy, log]);

  return persistencePolicy;
}
