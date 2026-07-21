import type { Tearleads } from "@tearleads/client-sdk";
import type { RefObject } from "react";

/**
 * Resolve once the SQLite runtime for `dbName` reaches "ready", reject if it
 * reaches "error" — spawning it (via `spawnRuntime`) when it is not already
 * booting. Both terminal checks are gated on `currentDbNameRef` still pointing at
 * `dbName`, so a runtime that was torn down mid-wait (its db name cleared) is
 * ignored rather than mistaken for this boot's outcome.
 */
export function waitForReadySQLiteRuntime(
  tearleads: Tearleads,
  currentDbNameRef: RefObject<string | null>,
  dbName: string,
  spawnRuntime: () => void,
): Promise<void> {
  if (
    tearleads.database.status === "ready" &&
    tearleads.database.client &&
    currentDbNameRef.current === dbName
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      const { client, status } = tearleads.database.snapshot;
      if (status === "ready" && client && currentDbNameRef.current === dbName) {
        settled = true;
        unsubscribe?.();
        resolve();
      } else if (status === "error" && currentDbNameRef.current === dbName) {
        settled = true;
        unsubscribe?.();
        reject(new Error("SQLite database failed to initialize."));
      }
    };

    unsubscribe = tearleads.database.subscribe(finish);
    finish();
    if (!settled) {
      spawnRuntime();
      finish();
    }
  });
}
