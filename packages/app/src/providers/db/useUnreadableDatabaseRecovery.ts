import type { DatabaseStatus } from "@symcrypt/client-sdk";
import { type RefObject, useCallback, useRef } from "react";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

type SQLiteRuntimeStatus = DatabaseStatus;

/**
 * Returns a handler for a persisted database whose on-disk bytes cannot be
 * decrypted with the resolved key (a key/keyring desync, e.g. the keyring's
 * localStorage manifest was evicted while the OPFS db survived, so a fresh root
 * was minted). The ciphertext is unrecoverable without the lost key, so the only
 * path back to a working app is to wipe the OPFS files and boot a fresh database.
 *
 * Guarded to one recovery per db name: if the recreated database *also* comes
 * back unreadable (an unstable key, not a one-off eviction), surface an error
 * instead of looping forever.
 *
 * `spawnRuntimeForDbName` is taken as a ref to break the cycle with the spawn
 * hook (spawn needs this handler; recovery needs spawn).
 */
export function useUnreadableDatabaseRecovery(params: {
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  purgeCurrentRuntime: () => Promise<void>;
  spawnRuntimeForDbName: RefObject<(dbName: string) => void>;
}): (dbName: string) => void {
  const {
    destroyCurrentRuntime,
    log,
    purgeCurrentRuntime,
    spawnRuntimeForDbName,
  } = params;
  const recoveredDbNamesRef = useRef<Set<string>>(new Set());

  return useCallback(
    (unreadableDbName: string) => {
      if (recoveredDbNamesRef.current.has(unreadableDbName)) {
        log(
          `Database still unreadable after recreate; surfacing error: ${unreadableDbName}`,
        );
        destroyCurrentRuntime("error");
        return;
      }

      recoveredDbNamesRef.current.add(unreadableDbName);
      // If the wipe itself fails (file-system or worker error), surface an error
      // instead of leaving the app wedged in a booting state with no recreate.
      void purgeCurrentRuntime()
        .then(() => {
          spawnRuntimeForDbName.current(unreadableDbName);
        })
        .catch((error: unknown) => {
          log(
            `Failed to wipe the unreadable database; surfacing error: ${unknownErrorMessage(error)}`,
          );
          destroyCurrentRuntime("error");
        });
    },
    [destroyCurrentRuntime, log, purgeCurrentRuntime, spawnRuntimeForDbName],
  );
}
