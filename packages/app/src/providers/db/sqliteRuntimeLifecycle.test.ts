import { afterEach, expect, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { waitFor } from "@testing-library/react";
import {
  createCrashableSQLiteRuntimeFactory,
  createReusableSQLiteRuntimeFactory,
} from "../../../test/helpers/databaseRuntimeFactories";
import { UnreadableDatabaseRecoveryError } from "./sqliteRuntimeErrors";
import { startSQLiteRuntimeBoot } from "./sqliteRuntimeLifecycle";

const DB_A = "identity-a";
const DB_B = "identity-b";

interface LifecycleHarness {
  boot: (dbName: string) => void;
  crashes: Error[];
  dispose: () => void;
  invalidateBoot: () => void;
  logged: Array<[string | Error, unknown]>;
  readyRuntimeIds: string[];
  releaseRuntime: () => void;
  tearleads: Tearleads;
}

const harnesses: LifecycleHarness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.dispose();
  }
});

function createLifecycleHarness(params: {
  createSQLiteRuntime: () => SQLiteRuntime;
  onTransientBootFailure?: (dbName: string) => boolean;
  onUnreadableDatabase?: (dbName: string) => void;
  persistence?: DatabasePersistenceMode;
}): LifecycleHarness {
  const tearleads = new Tearleads({
    logger: { log() {}, logError() {} },
    online: false,
  });
  const runtimeRef: { current: SQLiteRuntime | null } = { current: null };
  const bootGenerationRef = { current: 0 };
  const bootingRef = { current: false };
  const currentDbNameRef: { current: string | null } = { current: null };
  const targetDbNameRef = { current: DB_A };
  const readyRuntimeIds: string[] = [];
  const logged: Array<[string | Error, unknown]> = [];
  const crashes: Error[] = [];
  const unsubscribe = tearleads.database.subscribe(() => {
    const snapshot = tearleads.database.snapshot;
    if (snapshot.status === "ready" && snapshot.id) {
      readyRuntimeIds.push(snapshot.id);
    }
  });

  const boot = (dbName: string) => {
    // The managed spawner records the latest requested target before delegating
    // to startSQLiteRuntimeBoot, including while another boot is still pending.
    targetDbNameRef.current = dbName;
    startSQLiteRuntimeBoot({
      bootGenerationRef,
      bootingRef,
      createSQLiteRuntime: params.createSQLiteRuntime,
      currentDbNameRef,
      log() {},
      logError(message, cause) {
        logged.push([message, cause]);
      },
      nextDbName: dbName,
      onWorkerCrash(error) {
        crashes.push(error);
      },
      onTransientBootFailure: params.onTransientBootFailure ?? (() => false),
      onUnreadableDatabase: params.onUnreadableDatabase ?? (() => {}),
      persistence: params.persistence ?? "memory",
      resolveCipherKey: async () => "cipher-key",
      reuseWorker: true,
      runtimeRef,
      targetDbNameRef,
      tearleads,
    });
  };

  const harness = {
    boot,
    crashes,
    dispose: () => {
      unsubscribe();
      runtimeRef.current?.terminateNow();
      tearleads.dispose();
    },
    invalidateBoot: () => {
      bootGenerationRef.current += 1;
      bootingRef.current = false;
      tearleads.database.clear("idle");
    },
    logged,
    readyRuntimeIds,
    releaseRuntime: () => {
      runtimeRef.current?.terminateNow();
      runtimeRef.current = null;
    },
    tearleads,
  };
  harnesses.push(harness);
  return harness;
}

test("a superseded boot never publishes the obsolete database", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
  });
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  harness.boot(DB_A);
  harness.boot(DB_B);
  runtimeFactory.releaseFirstInit();

  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });

  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(runtimeFactory.getStats().createCount).toBe(1);
  expect(runtimeFactory.getStats().renewCount).toBe(1);
});

test("a boot failure reports the original error through logError", async () => {
  const initError = new Error("Missing required OPFS APIs.");
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    firstInitError: initError,
  });
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  harness.boot(DB_A);
  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("error");
  });

  expect(harness.logged).toEqual([
    ["Failed to initialize database worker", initError],
  ]);
});

test("wiping an unreadable database reports a real Error carrying the SQLite failure", async () => {
  const sqliteError = new Error("SQLITE_NOTADB: file is not a database");
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    firstInitError: sqliteError,
  });
  const wipedDbNames: string[] = [];
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    onUnreadableDatabase: (dbName) => {
      wipedDbNames.push(dbName);
    },
    persistence: "opfs-sahpool",
  });

  harness.boot(DB_A);
  await waitFor(() => {
    expect(wipedDbNames).toEqual([DB_A]);
  });

  expect(harness.logged).toHaveLength(1);
  const [reported, cause] = harness.logged[0] ?? [];
  expect(cause).toBeUndefined();
  expect(reported).toBeInstanceOf(UnreadableDatabaseRecoveryError);
  expect(reported).toMatchObject({
    stage: "wiping",
    cause: sqliteError,
    message: `Database is unreadable with the resolved cipher key; wiping and recreating ${DB_A}.`,
  });
});

test("a worker crash reaches the crash handler only while the runtime is owned", async () => {
  const runtimeFactory = createCrashableSQLiteRuntimeFactory();
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  harness.boot(DB_A);
  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("ready");
  });

  const crash = new Error("Database worker failed. script load failed");
  runtimeFactory.crash(crash);
  expect(harness.crashes).toEqual([crash]);

  harness.releaseRuntime();
  runtimeFactory.crash(new Error("Database worker failed. after release"));
  expect(harness.crashes).toEqual([crash]);
});

test("a superseded unreadable failure boots the latest target without wiping", async () => {
  let transientRecoveryCount = 0;
  let unreadableRecoveryCount = 0;
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
    firstInitError: new Error("SQLITE_NOTADB: file is not a database"),
  });
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    onTransientBootFailure: () => {
      transientRecoveryCount += 1;
      return true;
    },
    onUnreadableDatabase: () => {
      unreadableRecoveryCount += 1;
    },
    persistence: "opfs-sahpool",
  });

  harness.boot(DB_A);
  harness.boot(DB_B);
  runtimeFactory.releaseFirstInit();

  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });

  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(transientRecoveryCount).toBe(0);
  expect(unreadableRecoveryCount).toBe(0);
});

test("a superseded timeout reboots the latest target on a fresh connection", async () => {
  const recoveredDbNames: string[] = [];
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
    firstInitError: new Error(
      "SQLite boot round-trip: database initialization timed out after 15000ms.",
    ),
  });
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    onTransientBootFailure: (dbName) => {
      recoveredDbNames.push(dbName);
      return true;
    },
  });

  harness.boot(DB_A);
  harness.boot(DB_B);
  runtimeFactory.releaseFirstInit();

  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });

  expect(recoveredDbNames).toEqual([]);
  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(runtimeFactory.getStats().renewCount).toBe(1);
});

test("an invalidated boot cannot settle over a newer reusable connection", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
  });
  const harness = createLifecycleHarness({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  harness.boot(DB_A);
  harness.invalidateBoot();
  harness.boot(DB_B);

  await waitFor(() => {
    expect(harness.tearleads.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });
  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);

  runtimeFactory.releaseFirstInit();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(harness.tearleads.database.status).toBe("ready");
  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(runtimeFactory.getStats()).toMatchObject({
    createCount: 1,
    initCount: 2,
    renewCount: 1,
    terminateCount: 0,
  });
});
