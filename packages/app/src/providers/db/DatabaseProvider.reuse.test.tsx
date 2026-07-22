import { afterEach, expect, test } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { renderDatabaseProvider } from "../../../test/helpers/databaseProviderTestHarness";
import { createReusableSQLiteRuntimeFactory } from "../../../test/helpers/databaseRuntimeFactories";

const FIRST_FINGERPRINT =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_FINGERPRINT =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

afterEach(cleanup);

test("worker reuse detaches the old database and renews its client", async () => {
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

    // A failed identity creation rolls back to the still-open first database.
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    expect(view.getControls().client).toBe(firstClient);
    expect(runtimeFactory.getStats().initCount).toBe(1);

    act(() => {
      view.getControls().clearWorkerForIdentitySwitch();
    });
    await act(async () => {
      await view.getControls().ensureIdentityReady(SECOND_FINGERPRINT);
    });

    expect(view.getControls().status).toBe("ready");
    expect(view.getControls().client).not.toBe(firstClient);
    expect(runtimeFactory.getStats()).toMatchObject({
      closeCount: 1,
      createCount: 1,
      deleteDataCount: 0,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
  }
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
    act(() => {
      void view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
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
      await latestReady;
    });

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
