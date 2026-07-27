import { afterEach, expect, test } from "bun:test";
import { PERSISTENT_STORAGE_POLICY } from "@tearleads/client-sdk/sqlite";
import { act, cleanup, waitFor } from "@testing-library/react";
import { renderDatabaseProvider } from "../../../test/helpers/databaseProviderTestHarness";
import { createReusableSQLiteRuntimeFactory } from "../../../test/helpers/databaseRuntimeFactories";

const FIRST_FINGERPRINT =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_FINGERPRINT =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

afterEach(cleanup);

test("identity transitions close the old database and retain one worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    const firstClient = view.getControls().client;
    expect(firstClient).not.toBeNull();

    act(() => {
      view.getControls().clearWorkerForIdentitySwitch();
    });
    expect(view.getControls().status).toBe("idle");
    expect(view.getControls().client).toBeNull();
    expect(runtimeFactory.getStats().terminateCount).toBe(0);

    // A failed identity creation can roll back without leaving the old database
    // decrypted while provisioning is in flight.
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    expect(view.getControls().client).not.toBe(firstClient);
    expect(runtimeFactory.getStats().initCount).toBe(2);

    act(() => {
      view.getControls().clearWorkerForIdentitySwitch();
    });
    await act(async () => {
      await view.getControls().ensureIdentityReady(SECOND_FINGERPRINT);
    });

    expect(view.getControls().status).toBe("ready");
    expect(view.getControls().client).not.toBe(firstClient);
    expect(runtimeFactory.getStats()).toMatchObject({
      closeCount: 2,
      createCount: 1,
      deleteDataCount: 0,
      initCount: 3,
      renewCount: 2,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});

test("Retry closes and renews a reusable runtime without a second worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    const firstClient = view.getControls().client;

    act(() => {
      view.getControls().clearWorker();
    });
    expect(view.getControls()).toMatchObject({
      client: null,
      id: null,
      status: "idle",
    });

    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    expect(view.getControls().client).not.toBe(firstClient);
    expect(runtimeFactory.getStats()).toMatchObject({
      closeCount: 1,
      createCount: 1,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});

test("logout purge deletes and renews while retaining the physical worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
      await view.getControls().purgeWorker();
    });
    expect(view.getControls()).toMatchObject({
      client: null,
      id: null,
      status: "idle",
    });
    expect(runtimeFactory.getStats()).toMatchObject({
      clientDeleteCount: 1,
      createCount: 1,
      deleteDataCount: 0,
      initCount: 1,
      renewCount: 1,
      terminateCount: 0,
    });

    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 1,
      initCount: 2,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});

test("unreadable native databases are deleted inside the retained worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    firstExecError: new Error(
      "SQLITE_NOTADB: sqlite3 result code 26: file is not a database",
    ),
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
    storagePersistence: PERSISTENT_STORAGE_POLICY,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    await waitFor(() => expect(view.getControls().status).toBe("ready"));

    expect(runtimeFactory.getStats()).toMatchObject({
      clientDeleteCount: 1,
      createCount: 1,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});

test("a failed reusable close terminates before a retry constructs a worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    closeError: new Error("planned close failure"),
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    act(() => {
      view.getControls().clearWorker();
    });
    await waitFor(() => {
      expect(runtimeFactory.getStats().terminateCount).toBe(1);
    });
    expect(view.getControls()).toMatchObject({
      client: null,
      id: null,
      status: "idle",
    });

    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 2,
      initCount: 2,
      terminateCount: 1,
    });
  } finally {
    view.unmount();
  }
});

test("identity clear starts closing even when no rollback target follows", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferClose: true,
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    act(() => {
      view.getControls().clearWorkerForIdentitySwitch();
    });
    expect(view.getControls()).toMatchObject({
      client: null,
      id: null,
      status: "idle",
    });
    expect(runtimeFactory.getStats().closeCount).toBe(1);

    await act(async () => {
      runtimeFactory.releaseClose();
      await waitFor(() => {
        expect(runtimeFactory.getStats().renewCount).toBe(1);
      });
    });
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 1,
      initCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});

for (const reuseDatabaseWorker of [false, true]) {
  test(`SDK database stays cleared during and after a failed boot (reuse=${reuseDatabaseWorker})`, async () => {
    const runtimeFactory = createReusableSQLiteRuntimeFactory({
      deferFirstInit: true,
      firstInitError: new Error("planned boot failure"),
    });
    const originalConsoleError = console.error;
    const view = renderDatabaseProvider({
      createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
      reuseDatabaseWorker,
    });

    try {
      console.error = () => {};
      await view.controlsReady.promise;
      let ready!: Promise<void>;
      act(() => {
        ready = view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
      });
      await waitFor(() => {
        expect(runtimeFactory.getStats().initCount).toBe(1);
      });
      expect(view.getControls()).toMatchObject({
        client: null,
        id: null,
        status: "idle",
      });

      await act(async () => {
        runtimeFactory.releaseFirstInit();
        await expect(ready).rejects.toThrow(
          "SQLite database failed to initialize.",
        );
      });
      expect(view.getControls()).toMatchObject({
        client: null,
        id: null,
        status: "error",
      });
    } finally {
      console.error = originalConsoleError;
      view.unmount();
    }
  });
}

test("provider unmount still terminates a retained reusable worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  await view.controlsReady.promise;
  await act(async () => {
    await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    view.unmount();
  });
  await waitFor(() => {
    expect(runtimeFactory.getStats().terminateCount).toBe(1);
  });
});

test("a reusable worker retries a failed boot without constructing another worker", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    firstInitError: new Error("planned reusable sqlite init failure"),
  });
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    console.error = () => {};
    await view.controlsReady.promise;
    await act(async () => {
      await expect(
        view.getControls().ensureIdentityReady(FIRST_FINGERPRINT),
      ).rejects.toThrow("SQLite database failed to initialize.");
    });
    expect(view.getControls().status).toBe("error");

    act(() => {
      view.getControls().clearWorkerForIdentitySwitch();
    });
    expect(view.getControls().status).toBe("idle");

    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });

    expect(view.getControls().status).toBe("ready");
    expect(runtimeFactory.getStats()).toMatchObject({
      closeCount: 1,
      createCount: 1,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    console.error = originalConsoleError;
    view.unmount();
  }
});

test("a superseded timeout renews one worker for the latest identity", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
    firstInitError: new Error(
      "SQLite boot round-trip: database initialization timed out after 15000ms.",
    ),
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    let supersededReady!: Promise<unknown>;
    act(() => {
      supersededReady = view
        .getControls()
        .ensureIdentityReady(FIRST_FINGERPRINT)
        .then(
          () => null,
          (error: unknown) => error,
        );
    });
    await waitFor(() => {
      expect(runtimeFactory.getStats().initCount).toBe(1);
    });

    let latestReady!: Promise<void>;
    act(() => {
      latestReady = view.getControls().ensureIdentityReady(SECOND_FINGERPRINT);
    });
    await act(async () => {
      runtimeFactory.releaseFirstInit();
      await Promise.all([latestReady, supersededReady]);
    });

    expect(String(await supersededReady)).toContain("was superseded");
    expect(view.getControls().status).toBe("ready");
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 1,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
});
