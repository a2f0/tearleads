import type { DatabaseStatus } from "@tearleads/client-sdk";
import { type RefObject, useCallback, useRef } from "react";
import { UnreadableDatabaseRecoveryError } from "./sqliteRuntimeErrors";

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
  logError: (message: string | Error, cause?: unknown) => void;
  purgeCurrentRuntime: () => Promise<void>;
  spawnRuntimeForDbName: RefObject<(dbName: string) => void>;
}): (dbName: string, cause: unknown) => void {
  const {
    destroyCurrentRuntime,
    logError,
    purgeCurrentRuntime,
    spawnRuntimeForDbName,
  } = params;
  const recoveredDbNamesRef = useRef<Set<string>>(new Set());

  return useCallback(
    (unreadableDbName: string, cause: unknown) => {
      if (recoveredDbNamesRef.current.has(unreadableDbName)) {
        logError(
          new UnreadableDatabaseRecoveryError(
            "still-unreadable",
            unreadableDbName,
            { cause },
          ),
        );
        destroyCurrentRuntime("error");
        return;
      }

      recoveredDbNamesRef.current.add(unreadableDbName);
      // The single most visible event this lifecycle can produce: the user's
      // whole local database is about to be deleted. Reported as a real Error
      // so it leaves the device, with the SQLite failure as its cause.
      logError(
        new UnreadableDatabaseRecoveryError("wiping", unreadableDbName, {
          cause,
        }),
      );
      // If the wipe itself fails (file-system or worker error), surface an error
      // instead of leaving the app wedged in a booting state with no recreate.
      void purgeCurrentRuntime()
        .then(() => {
          spawnRuntimeForDbName.current(unreadableDbName);
        })
        .catch((error: unknown) => {
          logError(
            new UnreadableDatabaseRecoveryError(
              "wipe-failed",
              unreadableDbName,
              {
                cause: error,
              },
            ),
          );
          destroyCurrentRuntime("error");
        });
    },
    [
      destroyCurrentRuntime,
      logError,
      purgeCurrentRuntime,
      spawnRuntimeForDbName,
    ],
  );
}
