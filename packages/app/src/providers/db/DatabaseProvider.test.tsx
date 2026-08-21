import { afterEach, expect, test } from "bun:test";
import { PERSISTENT_STORAGE_POLICY } from "@symcrypt/client-sdk/sqlite";
import { act, cleanup, waitFor } from "@testing-library/react";
import { renderDatabaseProvider } from "../../../test/helpers/databaseProviderTestHarness";
import {
  createBootTimeoutSQLiteRuntimeFactory,
  createRecordingSQLiteRuntimeFactory,
  createRestartSensitiveSQLiteRuntimeFactory,
  createRetryableSQLiteRuntimeFactory,
  createUnreadableThenHealedSQLiteRuntimeFactory,
  createUnreadableUnwipeableSQLiteRuntimeFactory,
} from "../../../test/helpers/databaseRuntimeFactories";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";

const TEST_SIGNING_FINGERPRINT =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(() => {
  cleanup();
});

test("ensureIdentityReady retries a failed identity database initialization", async () => {
  const runtimeFactory = createRetryableSQLiteRuntimeFactory();
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    console.error = () => {};
    await view.controlsReady.promise;
    let firstError: unknown;
    await act(async () => {
      try {
        await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      } catch (error: unknown) {
        firstError = error;
      }
    });
    expect(firstError).toBeInstanceOf(Error);
    expect(String(firstError)).toContain(
      "SQLite database failed to initialize.",
    );
    await waitFor(() => {
      expect(view.getControls().status).toBe("error");
    });

    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    expect(runtimeFactory.getStats()).toEqual({
      createCount: 2,
      destroyCount: 1,
      initCount: 2,
    });
  } finally {
    console.error = originalConsoleError;
    view.unmount();
  }
});

test("a transient boot round-trip timeout auto-recovers by re-spawning", async () => {
  // The teardown/respawn race: a boot worker round-trip never answers. Unlike the
  // manual retry above, no consumer re-call is needed — the managed runtime tears
  // the stuck worker down and re-spawns a fresh one, which boots cleanly.
  const runtimeFactory = createBootTimeoutSQLiteRuntimeFactory(1);
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    console.error = () => {};
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });
    // Initial spawn (init times out) + one recovery re-spawn (init succeeds).
    expect(runtimeFactory.getStats().createCount).toBe(2);
  } finally {
    console.error = originalConsoleError;
    view.unmount();
  }
});

test("a persistent boot round-trip timeout surfaces an error after the cap", async () => {
  const runtimeFactory = createBootTimeoutSQLiteRuntimeFactory(
    Number.POSITIVE_INFINITY,
  );
  const originalConsoleError = console.error;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    console.error = () => {};
    await view.controlsReady.promise;
    let readyError: unknown;
    await act(async () => {
      try {
        await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      } catch (error: unknown) {
        readyError = error;
      }
    });
    expect(readyError).toBeInstanceOf(Error);
    await waitFor(() => {
      expect(view.getControls().status).toBe("error");
    });
    // Initial spawn + 3 bounded re-spawns, all timing out, before surfacing.
    expect(runtimeFactory.getStats().createCount).toBe(4);
  } finally {
    console.error = originalConsoleError;
    view.unmount();
  }
});

test("spawnWorker waits for a killed identity worker to release SQLite", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });

    act(() => {
      view.getControls().spawnWorker();
    });
    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 0,
    });

    await act(async () => {
      runtimeFactory.releaseClose();
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 2,
      initCount: 2,
      terminateCount: 1,
    });
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});

test("pagehide terminates a killed worker while graceful release is pending", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });
    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 0,
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 1,
    });

    await act(async () => {
      runtimeFactory.releaseClose();
      await Promise.resolve();
    });
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});

test("queued spawnWorker after kill is abandoned when provider unmounts", async () => {
  const runtimeFactory = createRestartSensitiveSQLiteRuntimeFactory();
  let unmounted = false;
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(TEST_SIGNING_FINGERPRINT);
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    act(() => {
      view.getControls().killWorker();
    });
    await waitFor(() => {
      expect(view.getControls().status).toBe("terminated");
    });
    act(() => {
      view.getControls().spawnWorker();
    });

    await act(async () => {
      view.unmount();
      unmounted = true;
      runtimeFactory.releaseClose();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeFactory.getStats()).toEqual({
      closeCount: 1,
      createCount: 1,
      initCount: 1,
      terminateCount: 1,
    });
  } finally {
    if (!unmounted) {
      view.unmount();
    }
  }
});

test("wipes and recreates a persisted database that is unreadable with the resolved key", async () => {
  const runtimeFactory = createUnreadableThenHealedSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    storagePersistence: PERSISTENT_STORAGE_POLICY,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureReady();
    });

    await waitFor(() => {
      expect(view.getControls().status).toBe("ready");
    });

    // The first (unreadable) database was wiped exactly once, then a fresh
    // runtime was created and booted successfully.
    expect(runtimeFactory.getStats()).toEqual({
      createCount: 2,
      deleteDataCount: 1,
    });
  } finally {
    view.unmount();
  }
});

test("surfaces an error when an unreadable database cannot be wiped", async () => {
  const runtimeFactory = createUnreadableUnwipeableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    storagePersistence: PERSISTENT_STORAGE_POLICY,
  });

  try {
    await view.controlsReady.promise;
    act(() => {
      view.getControls().spawnWorker();
    });

    // Boot hits SQLITE_NOTADB, recovery tries to wipe, the wipe fails: the runtime
    // must settle to "error" rather than hang, and must not loop creating workers.
    await waitFor(() => {
      expect(view.getControls().status).toBe("error");
    });
    expect(runtimeFactory.getStats().createCount).toBe(1);
  } finally {
    view.unmount();
  }
});

test("the storage persistence policy and keyring cipher key thread into init", async () => {
  const runtimeFactory = createRecordingSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    storagePersistence: PERSISTENT_STORAGE_POLICY,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureReady();
    });

    await waitFor(() => {
      expect(runtimeFactory.getInitOptions().length).toBeGreaterThan(0);
    });
    for (const options of runtimeFactory.getInitOptions()) {
      expect(options.persistence).toBe(
        PERSISTENT_STORAGE_POLICY.databasePersistence,
      );
      // The cipher key must come from the keyring session, never a hardcoded
      // value, now that the database is persisted to disk.
      expect(options.key).toBe("test-sqlite-key");
      expect(options.key).not.toBe("development-key");
    }
  } finally {
    view.unmount();
  }
});
