import type { DatabaseStatus } from "@symcrypt/client-sdk";
import { type RefObject, useCallback, useMemo, useRef } from "react";

type SQLiteRuntimeStatus = DatabaseStatus;

/**
 * How many *consecutive* times a single database may be re-spawned after a boot
 * round-trip timeout before the failure is surfaced. One re-spawn almost always
 * clears the teardown/respawn race; the bound keeps a genuinely dead boot (e.g.
 * OPFS truly unavailable) from looping forever. The count is reset when the
 * database next boots successfully (see {@link TransientBootFailureRecovery.clearBudget}),
 * so unrelated one-off races over a long session each get the full budget.
 */
const MAX_TRANSIENT_BOOT_RESPAWNS = 3;

interface TransientBootFailureRecovery {
  /**
   * Handle a boot round-trip timeout for `dbName`: returns `true` when it tore
   * the stuck worker down and re-spawned a fresh one (this boot is handled),
   * `false` once the consecutive re-spawn budget is exhausted (the caller then
   * surfaces the error through the normal path).
   */
  readonly recoverFromBootTimeout: (dbName: string) => boolean;
  /** Reset `dbName`'s re-spawn budget — call once it boots successfully. */
  readonly clearBudget: (dbName: string) => void;
}

/**
 * Returns a handler for a database that failed to boot because a worker
 * round-trip never answered (see `isBootRoundTripTimeoutError`) — the signature
 * of the teardown/respawn race where a new identity's worker is spawned before
 * the previous one has released its owner lock / OPFS handles. Unlike an
 * unreadable database (unrecoverable ciphertext → wipe + recreate), the on-disk
 * data is fine; the fix is to tear the *stuck worker* down and re-spawn a fresh
 * one, which boots cleanly once the earlier teardown has settled.
 *
 * `spawnRuntimeForDbName` is taken as a ref to break the cycle with the spawn
 * hook (spawn needs this handler; recovery needs spawn) — mirroring
 * {@link useUnreadableDatabaseRecovery}.
 *
 * Returns `true` when it re-spawned (this boot is handled), `false` when the
 * re-spawn budget is exhausted — the caller then fails the boot through the
 * normal error path, which (unlike destroying here) keeps the current db name set
 * so a waiting `ensureIdentityReady` rejects instead of hanging.
 */
export function useTransientBootFailureRecovery(params: {
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  spawnRuntimeForDbName: RefObject<(dbName: string) => void>;
}): TransientBootFailureRecovery {
  const { destroyCurrentRuntime, log, spawnRuntimeForDbName } = params;
  const respawnsByDbName = useRef<Map<string, number>>(new Map());

  const recoverFromBootTimeout = useCallback(
    (dbName: string): boolean => {
      const priorRespawns = respawnsByDbName.current.get(dbName) ?? 0;
      if (priorRespawns >= MAX_TRANSIENT_BOOT_RESPAWNS) {
        log(
          `Database boot still timing out after ${priorRespawns} re-spawn(s); surfacing error: ${dbName}`,
        );
        return false;
      }

      respawnsByDbName.current.set(dbName, priorRespawns + 1);
      log(
        `Database boot timed out (likely a teardown/respawn race); tearing the stuck worker down and re-spawning ${dbName} (attempt ${
          priorRespawns + 1
        }/${MAX_TRANSIENT_BOOT_RESPAWNS}).`,
      );
      // Force the stuck worker down, then re-spawn. spawnRuntimeForDbName waits
      // for the release to settle before booting, so the fresh worker starts
      // only once the stuck one has let go of its owner lock and OPFS handles.
      destroyCurrentRuntime("idle");
      spawnRuntimeForDbName.current(dbName);
      return true;
    },
    [destroyCurrentRuntime, log, spawnRuntimeForDbName],
  );

  const clearBudget = useCallback((dbName: string) => {
    respawnsByDbName.current.delete(dbName);
  }, []);

  return useMemo(
    () => ({ clearBudget, recoverFromBootTimeout }),
    [clearBudget, recoverFromBootTimeout],
  );
}
