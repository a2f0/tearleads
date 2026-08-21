import { afterEach, expect, test } from "bun:test";
import { SymCrypt } from "@symcrypt/client-sdk";
import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@symcrypt/client-sdk/sqlite";
import { waitFor } from "@testing-library/react";
import { createReusableSQLiteRuntimeFactory } from "../../../test/helpers/databaseRuntimeFactories";
import { startSQLiteRuntimeBoot } from "./sqliteRuntimeLifecycle";

const DB_A = "identity-a";
const DB_B = "identity-b";

interface LifecycleHarness {
  boot: (dbName: string) => void;
  dispose: () => void;
  invalidateBoot: () => void;
  readyRuntimeIds: string[];
  symcrypt: SymCrypt;
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
  const symcrypt = new SymCrypt({
    logger: { log() {}, logError() {} },
    online: false,
  });
  const runtimeRef: { current: SQLiteRuntime | null } = { current: null };
  const bootGenerationRef = { current: 0 };
  const bootingRef = { current: false };
  const currentDbNameRef: { current: string | null } = { current: null };
  const targetDbNameRef = { current: DB_A };
  const readyRuntimeIds: string[] = [];
  const unsubscribe = symcrypt.database.subscribe(() => {
    const snapshot = symcrypt.database.snapshot;
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
      nextDbName: dbName,
      onTransientBootFailure: params.onTransientBootFailure ?? (() => false),
      onUnreadableDatabase: params.onUnreadableDatabase ?? (() => {}),
      persistence: params.persistence ?? "memory",
      resolveCipherKey: async () => "cipher-key",
      reuseWorker: true,
      runtimeRef,
      targetDbNameRef,
      symcrypt,
    });
  };

  const harness = {
    boot,
    dispose: () => {
      unsubscribe();
      runtimeRef.current?.terminateNow();
      symcrypt.dispose();
    },
    invalidateBoot: () => {
      bootGenerationRef.current += 1;
      bootingRef.current = false;
      symcrypt.database.clear("idle");
    },
    readyRuntimeIds,
    symcrypt,
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
    expect(harness.symcrypt.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });

  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(runtimeFactory.getStats().createCount).toBe(1);
  expect(runtimeFactory.getStats().renewCount).toBe(1);
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
    expect(harness.symcrypt.database.status).toBe("ready");
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
    expect(harness.symcrypt.database.status).toBe("ready");
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
    expect(harness.symcrypt.database.status).toBe("ready");
    expect(runtimeFactory.getStats().initializedDbNames).toEqual([DB_A, DB_B]);
  });
  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);

  runtimeFactory.releaseFirstInit();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(harness.symcrypt.database.status).toBe("ready");
  expect(harness.readyRuntimeIds).toEqual(["reusable-2"]);
  expect(runtimeFactory.getStats()).toMatchObject({
    createCount: 1,
    initCount: 2,
    renewCount: 1,
    terminateCount: 0,
  });
});
