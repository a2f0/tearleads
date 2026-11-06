import type { Tearleads } from "@tearleads/client-sdk";
import type { RefObject } from "react";

/**
 * Resolve once the SQLite runtime for `dbName` reaches "ready", reject if it
 * reaches "error" — spawning it (via `spawnRuntime`) when it is not already
 * booting. A newer readiness request or explicitly terminated worker rejects the
 * stale waiter instead of leaving its caller busy forever. A transient
 * same-target teardown remains pending so the managed recovery path can respawn
 * and satisfy the original waiter.
 */
export function waitForReadySQLiteRuntime(
  tearleads: Tearleads,
  currentDbNameRef: RefObject<string | null>,
  readinessGenerationRef: RefObject<number>,
  readinessGeneration: number,
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

  // Starting from "terminated" is an explicit recovery request: the spawn may
  // be gated on the killed runtime's asynchronous release, so keep waiting. A
  // waiter that observes termination after it started has been interrupted and
  // must reject instead of leaving its caller busy forever.
  let toleratingInitialTermination = tearleads.database.status === "terminated";

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      const { client, status } = tearleads.database.snapshot;
      toleratingInitialTermination =
        toleratingInitialTermination && status === "terminated";
      const outcome = readinessOutcome({
        client,
        currentDbName: currentDbNameRef.current,
        dbName,
        status,
        superseded: readinessGenerationRef.current !== readinessGeneration,
        toleratingInitialTermination,
      });
      if (outcome === "pending") {
        return;
      }
      settled = true;
      unsubscribe?.();
      if (outcome === "ready") {
        resolve();
      } else {
        reject(outcome);
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

function readinessOutcome(input: {
  readonly client: unknown;
  readonly currentDbName: string | null;
  readonly dbName: string;
  readonly status: Tearleads["database"]["snapshot"]["status"];
  readonly superseded: boolean;
  readonly toleratingInitialTermination: boolean;
}): "pending" | "ready" | Error {
  if (input.superseded) {
    return new Error("SQLite database initialization was superseded.");
  }
  if (input.status === "terminated" && !input.toleratingInitialTermination) {
    return new Error("SQLite database worker was terminated.");
  }
  const sameTarget = input.currentDbName === input.dbName;
  if (input.status === "ready" && input.client && sameTarget) {
    return "ready";
  }
  if (input.status === "error" && sameTarget) {
    return new Error("SQLite database failed to initialize.");
  }
  return "pending";
}
