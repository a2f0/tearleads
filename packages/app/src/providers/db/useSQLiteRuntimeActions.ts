import type { DatabaseStatus, Tearleads } from "@tearleads/client-sdk";
import {
  purgeOpfsSqliteDatabase,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { type RefObject, useCallback, useMemo } from "react";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  canReuseSQLiteRuntime,
  logSQLiteRuntimeReuseUnavailable,
  type ReusableSQLiteRuntime,
  releaseSQLiteRuntime,
  renewReusableSQLiteRuntime,
  resetReusableSQLiteRuntimeDatabase,
  type SQLiteRuntimeResetMode,
} from "./sqliteRuntimeRetention";

export interface SQLiteRuntimeOperation {
  readonly kind: "close" | "delete" | "purge" | "release";
  readonly promise: Promise<void>;
  readonly runtime: SQLiteRuntime | null;
}

interface RuntimeRefs {
  readonly bootGenerationRef: RefObject<number>;
  readonly bootingRef: RefObject<boolean>;
  readonly currentDbNameRef: RefObject<string | null>;
  readonly runtimeOperationRef: RefObject<SQLiteRuntimeOperation | null>;
  readonly runtimeRef: RefObject<SQLiteRuntime | null>;
}

function clearRuntimeState(
  refs: RuntimeRefs,
  tearleads: Tearleads,
  status: DatabaseStatus,
): void {
  refs.bootGenerationRef.current += 1;
  refs.bootingRef.current = false;
  refs.currentDbNameRef.current = null;
  tearleads.database.clear(status);
}

function trackRuntimeOperation(
  refs: RuntimeRefs,
  runtime: SQLiteRuntime | null,
  result: Promise<void>,
  kind: SQLiteRuntimeOperation["kind"],
): Promise<void> {
  let operation!: SQLiteRuntimeOperation;
  const settled = result.then(
    () => {},
    () => {},
  );
  operation = {
    kind,
    promise: settled.finally(() => {
      if (refs.runtimeOperationRef.current === operation) {
        refs.runtimeOperationRef.current = null;
      }
    }),
    runtime,
  };
  refs.runtimeOperationRef.current = operation;
  return result;
}

function terminateRuntime(
  refs: RuntimeRefs,
  tearleads: Tearleads,
  status: DatabaseStatus,
): void {
  const runtime = refs.runtimeRef.current;
  refs.runtimeRef.current = null;
  clearRuntimeState(refs, tearleads, status);
  if (!runtime) {
    return;
  }

  const pending = refs.runtimeOperationRef.current;
  if (pending?.runtime === runtime) {
    runtime.terminateNow();
    void trackRuntimeOperation(refs, runtime, Promise.resolve(), "release");
    return;
  }
  void trackRuntimeOperation(
    refs,
    runtime,
    releaseSQLiteRuntime(runtime),
    "release",
  );
}

function retainRuntimeAfterReset(params: {
  readonly refs: RuntimeRefs;
  readonly runtime: ReusableSQLiteRuntime;
  readonly mode: SQLiteRuntimeResetMode;
  readonly log: (message: string) => void;
}): Promise<void> {
  const { refs, runtime, mode, log } = params;
  let operation!: SQLiteRuntimeOperation;
  const result = resetReusableSQLiteRuntimeDatabase(runtime, mode)
    .then(() => {
      // A purge may synchronously chain a name-based removal behind this close
      // and replace the operation gate. Runtime ownership is the authoritative
      // signal: every termination path clears it before the reset can settle.
      if (refs.runtimeRef.current === runtime) {
        renewReusableSQLiteRuntime(runtime);
      }
    })
    .catch((error: unknown) => {
      if (refs.runtimeRef.current === runtime) {
        refs.runtimeRef.current = null;
      }
      log(
        `Failed to ${mode} the reusable database runtime; worker terminated: ${unknownErrorMessage(error)}`,
      );
      throw error;
    });
  const settled = result.then(
    () => {},
    () => {},
  );
  operation = {
    kind: mode,
    promise: settled.finally(() => {
      if (refs.runtimeOperationRef.current === operation) {
        refs.runtimeOperationRef.current = null;
      }
    }),
    runtime,
  };
  refs.runtimeOperationRef.current = operation;
  return result;
}

function purgeCapturedDatabaseAfterOperation(params: {
  readonly dbName: string | null;
  readonly operation: SQLiteRuntimeOperation;
  readonly refs: RuntimeRefs;
}): Promise<void> {
  const { dbName, operation, refs } = params;
  let retainedRuntime: SQLiteRuntime | null = null;
  const result = operation.promise
    .then(() => {
      retainedRuntime = refs.runtimeRef.current;
      return dbName ? purgeOpfsSqliteDatabase(dbName) : undefined;
    })
    .catch((error: unknown) => {
      if (refs.runtimeRef.current === retainedRuntime) {
        refs.runtimeRef.current = null;
      }
      retainedRuntime?.terminateNow();
      throw error;
    });
  // The pending close has renewed to an uninitialized client. Track deletion
  // of the captured database by name immediately so no waiter can boot between
  // the close settling and its OPFS removal.
  return trackRuntimeOperation(refs, operation.runtime, result, "purge");
}

function purgeCapturedDatabase(params: {
  readonly dbName: string | null;
  readonly refs: RuntimeRefs;
  readonly runtime: SQLiteRuntime | null;
}): Promise<void> {
  const { dbName, refs, runtime } = params;
  const result = Promise.resolve()
    .then(() => (dbName ? purgeOpfsSqliteDatabase(dbName) : undefined))
    .catch((error: unknown) => {
      if (refs.runtimeRef.current === runtime) {
        refs.runtimeRef.current = null;
      }
      runtime?.terminateNow();
      throw error;
    });
  return trackRuntimeOperation(refs, runtime, result, "purge");
}

async function purgeNonReadySQLiteRuntime(params: {
  readonly dbName: string | null;
  readonly retireRuntime: boolean;
  readonly refs: RuntimeRefs;
  readonly runtime: SQLiteRuntime;
  readonly tearleads: Tearleads;
}): Promise<void> {
  const { dbName, refs, retireRuntime, runtime, tearleads } = params;
  if (retireRuntime) {
    terminateRuntime(refs, tearleads, "idle");
    const releaseOperation = refs.runtimeOperationRef.current;
    if (releaseOperation) {
      await purgeCapturedDatabaseAfterOperation({
        dbName,
        operation: releaseOperation,
        refs,
      });
      return;
    }
  }
  await purgeCapturedDatabase({ dbName, refs, runtime });
}

async function purgeSQLiteRuntime(params: {
  readonly dbName: string | null;
  readonly log: (message: string) => void;
  readonly refs: RuntimeRefs;
  readonly reuseWorker: boolean;
  readonly tearleads: Tearleads;
}): Promise<void> {
  const { dbName, log, refs, reuseWorker, tearleads } = params;
  let runtime = refs.runtimeRef.current;
  const wasBooting = refs.bootingRef.current;
  const runtimeStatus = tearleads.database.status;
  const runtimeHadDatabase = refs.currentDbNameRef.current !== null;
  clearRuntimeState(refs, tearleads, "idle");

  if (runtime && wasBooting) {
    // close/delete can acknowledge before an in-flight init finishes acquiring
    // its database. Retire this worker before deleting by name so a zombie init
    // cannot survive onto a renewed connection.
    terminateRuntime(refs, tearleads, "idle");
    const releaseOperation = refs.runtimeOperationRef.current;
    if (releaseOperation) {
      await purgeCapturedDatabaseAfterOperation({
        dbName,
        operation: releaseOperation,
        refs,
      });
      return;
    }
    runtime = null;
  }

  const pendingOperation = refs.runtimeOperationRef.current;
  if (pendingOperation) {
    // Install this purge as the synchronous successor to every in-flight
    // operation. Waiters already attached to the predecessor will then observe
    // this new gate before they can spawn, and a failed/no-op delete still gets
    // the captured name-based fallback.
    await purgeCapturedDatabaseAfterOperation({
      dbName,
      operation: pendingOperation,
      refs,
    });
    return;
  }

  if (
    runtime &&
    runtimeStatus !== "ready" &&
    (runtimeStatus === "error" ||
      (!runtimeHadDatabase && canReuseSQLiteRuntime(reuseWorker, runtime)))
  ) {
    await purgeNonReadySQLiteRuntime({
      dbName,
      retireRuntime: runtimeStatus === "error",
      refs,
      runtime,
      tearleads,
    });
    return;
  }

  // An idle runtime that still has a db name completed init but failed its
  // readability probe. Its worker owns the OPFS handle, and native WKWebViews
  // cannot delete that database from the main thread, so deliberately fall
  // through to the worker-side delete/renew path below.
  if (runtime && canReuseSQLiteRuntime(reuseWorker, runtime)) {
    await retainRuntimeAfterReset({ refs, runtime, mode: "delete", log });
    return;
  }
  if (runtime) {
    logSQLiteRuntimeReuseUnavailable(reuseWorker, runtime, log);
    refs.runtimeRef.current = null;
    const result = runtime.deleteData().catch((error: unknown) => {
      runtime.terminateNow();
      throw error;
    });
    await trackRuntimeOperation(refs, runtime, result, "delete");
    return;
  }
  if (dbName) {
    await purgeCapturedDatabase({ dbName, refs, runtime: null });
  }
}

export function useSQLiteRuntimeActions(params: {
  readonly bootGenerationRef: RefObject<number>;
  readonly bootingRef: RefObject<boolean>;
  readonly currentDbNameRef: RefObject<string | null>;
  readonly log: (message: string) => void;
  readonly reuseWorker: boolean;
  readonly runtimeOperationRef: RefObject<SQLiteRuntimeOperation | null>;
  readonly runtimeRef: RefObject<SQLiteRuntime | null>;
  readonly targetDbNameRef: RefObject<string>;
  readonly tearleads: Tearleads;
}) {
  const {
    bootGenerationRef,
    bootingRef,
    currentDbNameRef,
    log,
    reuseWorker,
    runtimeOperationRef,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;
  const refs = useMemo<RuntimeRefs>(
    () => ({
      bootGenerationRef,
      bootingRef,
      currentDbNameRef,
      runtimeOperationRef,
      runtimeRef,
    }),
    [
      bootGenerationRef,
      bootingRef,
      currentDbNameRef,
      runtimeOperationRef,
      runtimeRef,
    ],
  );

  const destroyCurrentRuntime = useCallback(
    (status: DatabaseStatus) => {
      terminateRuntime(refs, tearleads, status);
    },
    [refs, tearleads],
  );

  const clearCurrentRuntime = useCallback(
    (status: DatabaseStatus) => {
      const runtime = runtimeRef.current;
      const wasBooting = bootingRef.current;
      clearRuntimeState(refs, tearleads, status);
      if (!runtime) {
        return;
      }
      if (wasBooting) {
        terminateRuntime(refs, tearleads, status);
        return;
      }
      if (runtimeOperationRef.current?.runtime === runtime) {
        return;
      }
      if (canReuseSQLiteRuntime(reuseWorker, runtime)) {
        void retainRuntimeAfterReset({ refs, runtime, mode: "close", log });
        return;
      }
      logSQLiteRuntimeReuseUnavailable(reuseWorker, runtime, log);
      terminateRuntime(refs, tearleads, status);
    },
    [
      bootingRef,
      log,
      refs,
      reuseWorker,
      runtimeOperationRef,
      runtimeRef,
      tearleads,
    ],
  );

  const purgeCurrentRuntime = useCallback(
    () =>
      purgeSQLiteRuntime({
        dbName: currentDbNameRef.current ?? targetDbNameRef.current,
        log,
        refs,
        reuseWorker,
        tearleads,
      }),
    [currentDbNameRef, log, refs, reuseWorker, targetDbNameRef, tearleads],
  );

  return useMemo(
    () => ({
      clearCurrentRuntime,
      destroyCurrentRuntime,
      purgeCurrentRuntime,
    }),
    [clearCurrentRuntime, destroyCurrentRuntime, purgeCurrentRuntime],
  );
}
