import type { DatabaseStatus, Tearleads } from "@tearleads/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import type { RefObject } from "react";
import { bootSQLiteRuntime } from "./bootSQLiteRuntime";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";

type SQLiteRuntimeStatus = DatabaseStatus;
const SQLITE_RUNTIME_RELEASE_TIMEOUT_MS = 1_000;

export function releaseSQLiteRuntime(runtime: SQLiteRuntime): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      try {
        runtime.terminateNow();
      } finally {
        resolve();
      }
    };

    timeoutId = setTimeout(finish, SQLITE_RUNTIME_RELEASE_TIMEOUT_MS);
    try {
      runtime.client.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

function configureSdkSQLiteRuntime(
  tearleads: Tearleads,
  runtime: SQLiteRuntime,
  status?: SQLiteRuntimeStatus,
) {
  tearleads.database.configure({
    client: runtime.client,
    id: runtime.id,
    status,
  });
}

function completeSQLiteRuntimeBoot(params: {
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  dbName: string;
  log: (message: string) => void;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, dbName, log } = params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  configureSdkSQLiteRuntime(tearleads, runtime);
  log(`Database initialized successfully: ${dbName}`);
  log("Worker spawned");
}

function failSQLiteRuntimeBoot(params: {
  runtime: SQLiteRuntime;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  bootingRef: RefObject<boolean>;
  tearleads: Tearleads;
  error: unknown;
}) {
  const { runtime, runtimeRef, bootingRef, tearleads, error } = params;

  if (runtimeRef.current !== runtime) {
    return;
  }

  bootingRef.current = false;
  console.error("Failed to initialize database worker:", error);
  configureSdkSQLiteRuntime(tearleads, runtime, "error");
}

interface StartSQLiteRuntimeBootParams {
  bootingRef: RefObject<boolean>;
  createSQLiteRuntime: () => SQLiteRuntime;
  currentDbNameRef: RefObject<string | null>;
  killedRef: RefObject<boolean>;
  log: (message: string) => void;
  nextDbName: string;
  persistence: DatabasePersistenceMode;
  resolveCipherKey: ResolveSqliteCipherKey;
  runtimeRef: RefObject<SQLiteRuntime | null>;
  targetDbNameRef: RefObject<string>;
  tearleads: Tearleads;
}

export function startSQLiteRuntimeBoot(params: StartSQLiteRuntimeBootParams) {
  const {
    bootingRef,
    createSQLiteRuntime,
    currentDbNameRef,
    killedRef,
    log,
    nextDbName,
    persistence,
    resolveCipherKey,
    runtimeRef,
    targetDbNameRef,
    tearleads,
  } = params;

  if (runtimeRef.current || bootingRef.current) {
    return;
  }

  killedRef.current = false;
  bootingRef.current = true;
  targetDbNameRef.current = nextDbName;
  currentDbNameRef.current = nextDbName;

  try {
    const runtime = createSQLiteRuntime();
    runtimeRef.current = runtime;
    configureSdkSQLiteRuntime(tearleads, runtime, "idle");

    void bootSQLiteRuntime(
      runtime,
      nextDbName,
      persistence,
      resolveCipherKey,
      log,
    )
      .then(() => {
        completeSQLiteRuntimeBoot({
          runtime,
          runtimeRef,
          bootingRef,
          tearleads,
          dbName: nextDbName,
          log,
        });
      })
      .catch((error) => {
        failSQLiteRuntimeBoot({
          runtime,
          runtimeRef,
          bootingRef,
          tearleads,
          error,
        });
      });
  } catch (error) {
    bootingRef.current = false;
    console.error("Failed to create database worker:", error);
    tearleads.database.clear("error");
  }
}
