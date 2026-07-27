import { afterEach, expect, test } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { renderDatabaseProvider } from "../../../test/helpers/databaseProviderTestHarness";
import {
  createDeferred,
  createReusableSQLiteRuntimeFactory,
} from "../../../test/helpers/databaseRuntimeFactories";

const FIRST_FINGERPRINT =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_FINGERPRINT =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

afterEach(cleanup);

function installDeferredOpfsRemoval() {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const removalGate = createDeferred();
  const removalStartedSignal = createDeferred();
  let removalStarted = false;
  let removed = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => ({
          async getDirectoryHandle(name: string) {
            expect(name).toBe("tearleads-sqlite");
            return {
              async removeEntry(leaf: string) {
                expect(leaf).toBe(`app-identity-${FIRST_FINGERPRINT}.db`);
                removalStarted = true;
                removalStartedSignal.resolve();
                await removalGate.promise;
                removed = true;
              },
            };
          },
        }),
      },
    },
  });

  return {
    isRemovalStarted: () => removalStarted,
    isRemoved: () => removed,
    releaseRemoval: () => removalGate.resolve(),
    restore: () => {
      if (previousNavigator) {
        Object.defineProperty(globalThis, "navigator", previousNavigator);
      } else {
        Reflect.deleteProperty(globalThis, "navigator");
      }
    },
    waitForRemovalStart: () => removalStartedSignal.promise,
  };
}

test("purge during a pending close gates boot through name-based removal", async () => {
  const opfs = installDeferredOpfsRemoval();
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
    act(() => view.getControls().clearWorker());
    await act(async () => {
      const purge = view.getControls().purgeWorker();
      runtimeFactory.releaseClose();
      await opfs.waitForRemovalStart();
      expect(opfs.isRemovalStarted()).toBe(true);

      const ready = view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtimeFactory.getStats().initCount).toBe(1);

      opfs.releaseRemoval();
      await Promise.all([purge, ready]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(opfs.isRemoved()).toBe(true);
    expect(runtimeFactory.getStats()).toMatchObject({
      clientDeleteCount: 0,
      closeCount: 1,
      createCount: 1,
      initCount: 2,
      renewCount: 1,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
    opfs.restore();
  }
});

test("purge replaces a release gate before an earlier boot waiter runs", async () => {
  const opfs = installDeferredOpfsRemoval();
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferClose: true,
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: false,
  });

  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    act(() => view.getControls().killWorker());

    let ready!: Promise<void>;
    act(() => {
      ready = view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
    });
    await act(async () => {
      const purge = view.getControls().purgeWorker();
      runtimeFactory.releaseClose();
      await opfs.waitForRemovalStart();
      expect(runtimeFactory.getStats().createCount).toBe(1);

      opfs.releaseRemoval();
      await Promise.all([purge, ready]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(opfs.isRemoved()).toBe(true);
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 2,
      initCount: 2,
      terminateCount: 1,
    });
  } finally {
    view.unmount();
    opfs.restore();
  }
});

test("purge during boot retires the worker before name-based removal", async () => {
  const opfs = installDeferredOpfsRemoval();
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    act(() => {
      void view
        .getControls()
        .ensureIdentityReady(FIRST_FINGERPRINT)
        .catch(() => {});
    });
    await waitFor(() => expect(runtimeFactory.getStats().initCount).toBe(1));

    await act(async () => {
      const purge = view.getControls().purgeWorker();
      await opfs.waitForRemovalStart();
      expect(opfs.isRemovalStarted()).toBe(true);
      expect(runtimeFactory.getStats()).toMatchObject({
        clientDeleteCount: 0,
        createCount: 1,
        terminateCount: 1,
      });

      const ready = view.getControls().ensureIdentityReady(FIRST_FINGERPRINT);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtimeFactory.getStats().createCount).toBe(1);

      opfs.releaseRemoval();
      await Promise.all([purge, ready]);
      runtimeFactory.releaseFirstInit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(opfs.isRemoved()).toBe(true);
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 2,
      initCount: 2,
      renewCount: 0,
      terminateCount: 1,
    });
  } finally {
    view.unmount();
    opfs.restore();
  }
});

for (const reuseDatabaseWorker of [false, true]) {
  test(`purge after a failed boot deletes by name (reuse=${reuseDatabaseWorker})`, async () => {
    const opfs = installDeferredOpfsRemoval();
    const runtimeFactory = createReusableSQLiteRuntimeFactory({
      firstInitError: new Error("planned init failure"),
    });
    const originalConsoleError = console.error;
    const view = renderDatabaseProvider({
      createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
      reuseDatabaseWorker,
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

      let purge!: Promise<void>;
      act(() => {
        purge = view.getControls().purgeWorker();
      });
      await waitFor(() => expect(opfs.isRemovalStarted()).toBe(true));
      expect(runtimeFactory.getStats()).toMatchObject({
        clientDeleteCount: 0,
        terminateCount: 1,
      });

      await act(async () => {
        opfs.releaseRemoval();
        await purge;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(opfs.isRemoved()).toBe(true);
      expect(view.getControls()).toMatchObject({
        client: null,
        id: null,
        status: "idle",
      });
    } finally {
      console.error = originalConsoleError;
      view.unmount();
      opfs.restore();
    }
  });
}

test("clear during boot retires the unresolved runtime before retry", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    act(() => {
      void view
        .getControls()
        .ensureIdentityReady(FIRST_FINGERPRINT)
        .catch(() => {});
    });
    await waitFor(() => expect(runtimeFactory.getStats().initCount).toBe(1));
    act(() => view.getControls().clearWorker());
    await waitFor(() =>
      expect(runtimeFactory.getStats().terminateCount).toBe(1),
    );

    await act(async () => {
      await view.getControls().ensureIdentityReady(SECOND_FINGERPRINT);
      runtimeFactory.releaseFirstInit();
    });
    expect(view.getControls().status).toBe("ready");
    expect(runtimeFactory.getStats()).toMatchObject({
      createCount: 2,
      initCount: 2,
      renewCount: 0,
      terminateCount: 1,
    });
  } finally {
    view.unmount();
  }
});

test("terminating a worker rejects its pending readiness waiter", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferFirstInit: true,
  });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: runtimeFactory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });

  try {
    await view.controlsReady.promise;
    let readyOutcome!: Promise<unknown>;
    act(() => {
      readyOutcome = view
        .getControls()
        .ensureIdentityReady(FIRST_FINGERPRINT)
        .then(
          () => null,
          (error: unknown) => error,
        );
    });
    await waitFor(() => expect(runtimeFactory.getStats().initCount).toBe(1));

    act(() => view.getControls().killWorker());
    expect(String(await readyOutcome)).toContain("worker was terminated");
    expect(view.getControls()).toMatchObject({
      client: null,
      id: null,
      status: "terminated",
    });
    runtimeFactory.releaseFirstInit();
  } finally {
    view.unmount();
  }
});

test("terminating a recovery worker rejects its pending readiness waiter", async () => {
  const runtimeFactory = createReusableSQLiteRuntimeFactory({
    deferSecondInit: true,
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
    act(() => view.getControls().killWorker());
    expect(view.getControls().status).toBe("terminated");

    let readyOutcome!: Promise<unknown>;
    act(() => {
      readyOutcome = view
        .getControls()
        .ensureIdentityReady(FIRST_FINGERPRINT)
        .then(
          () => null,
          (error: unknown) => error,
        );
    });
    await waitFor(() => expect(runtimeFactory.getStats().initCount).toBe(2));

    act(() => view.getControls().killWorker());
    expect(String(await readyOutcome)).toContain("worker was terminated");
    runtimeFactory.releaseSecondInit();
  } finally {
    view.unmount();
  }
});
