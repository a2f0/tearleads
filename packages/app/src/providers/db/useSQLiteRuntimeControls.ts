import type { DatabaseStatus, Tearleads } from "@tearleads/client-sdk";
import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { type RefObject, useCallback, useRef } from "react";
import { sqliteDbNameForSigningFingerprint } from "./sqliteDbName";
import { canReuseSQLiteRuntime } from "./sqliteRuntimeRetention";
import { waitForReadySQLiteRuntime } from "./waitForReadySQLiteRuntime";

type SQLiteRuntimeStatus = DatabaseStatus;

function useEnsureReadyForDbName(params: {
  clearCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  currentDbNameRef: RefObject<string | null>;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    clearCurrentRuntime,
    currentDbNameRef,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  const readinessGenerationRef = useRef(0);
  const readinessTargetDbNameRef = useRef<string | null>(null);
  return useCallback(
    (nextDbName: string) => {
      if (readinessTargetDbNameRef.current !== nextDbName) {
        readinessTargetDbNameRef.current = nextDbName;
        readinessGenerationRef.current += 1;
      }
      const readinessGeneration = readinessGenerationRef.current;
      targetDbNameRef.current = nextDbName;
      const canReuse = canReuseSQLiteRuntime(reuseWorker, runtimeRef.current);
      if (
        !canReuse &&
        currentDbNameRef.current &&
        currentDbNameRef.current !== nextDbName
      ) {
        clearCurrentRuntime("idle");
      }
      if (
        currentDbNameRef.current === nextDbName &&
        tearleads.database.status === "error"
      ) {
        clearCurrentRuntime("idle");
      }

      return waitForReadySQLiteRuntime(
        tearleads,
        currentDbNameRef,
        readinessGenerationRef,
        readinessGeneration,
        nextDbName,
        () => spawnRuntimeForDbName(nextDbName),
      );
    },
    [
      clearCurrentRuntime,
      currentDbNameRef,
      reuseWorker,
      runtimeRef,
      spawnRuntimeForDbName,
      targetDbNameRef,
      tearleads,
    ],
  );
}

export function useSQLiteRuntimeControls(params: {
  clearCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  currentDbNameRef: RefObject<string | null>;
  destroyCurrentRuntime: (nextStatus: SQLiteRuntimeStatus) => void;
  log: (message: string) => void;
  purgeCurrentRuntime: (dbName?: string) => Promise<void>;
  reuseWorker: boolean;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  spawnRuntimeForDbName: (nextDbName: string) => void;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}) {
  const {
    clearCurrentRuntime,
    currentDbNameRef,
    destroyCurrentRuntime,
    log,
    purgeCurrentRuntime,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  } = params;
  const ensureReadyForDbName = useEnsureReadyForDbName({
    clearCurrentRuntime,
    currentDbNameRef,
    reuseWorker,
    runtimeRef,
    spawnRuntimeForDbName,
    targetDbNameRef,
    tearleads,
  });

  const spawnRuntime = useCallback(() => {
    spawnRuntimeForDbName(targetDbNameRef.current);
  }, [spawnRuntimeForDbName]);

  const ensureReady = useCallback(
    () => ensureReadyForDbName(targetDbNameRef.current),
    [ensureReadyForDbName],
  );

  const ensureIdentityReady = useCallback(
    (signingFingerprint: string) =>
      ensureReadyForDbName(
        sqliteDbNameForSigningFingerprint(signingFingerprint),
      ),
    [ensureReadyForDbName],
  );

  // Detach SDK consumers, close the decrypted database, and retain a capable
  // physical worker for the next boot.
  const clearWorker = useCallback(() => {
    clearCurrentRuntime("idle");
  }, [clearCurrentRuntime]);

  // Identity changes use the same safe close-and-renew path. In particular, a
  // failed creation with no rollback target cannot leave the old DB open.
  const clearWorkerForIdentitySwitch = useCallback(() => {
    clearCurrentRuntime("idle");
  }, [clearCurrentRuntime]);

  const killWorker = useCallback(() => {
    if (!runtimeRef.current) {
      return;
    }

    destroyCurrentRuntime("terminated");
    log("Worker killed");
  }, [destroyCurrentRuntime, log]);

  const purgeWorker = useCallback(async () => {
    await purgeCurrentRuntime();
    log("Local database wiped");
  }, [log, purgeCurrentRuntime]);

  const purgeIdentityDatabase = useCallback(
    (signingFingerprint: string) =>
      purgeCurrentRuntime(
        sqliteDbNameForSigningFingerprint(signingFingerprint),
      ),
    [purgeCurrentRuntime],
  );

  return {
    clearWorker,
    clearWorkerForIdentitySwitch,
    ensureIdentityReady,
    ensureReady,
    killWorker,
    purgeIdentityDatabase,
    purgeWorker,
    spawnWorker: spawnRuntime,
  };
}
