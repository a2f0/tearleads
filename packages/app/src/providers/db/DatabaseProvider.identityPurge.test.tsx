import { afterEach, expect, test } from "bun:test";
import { act, cleanup } from "@testing-library/react";
import { renderDatabaseProvider } from "../../../test/helpers/databaseProviderTestHarness";
import {
  createDeferred,
  createReusableSQLiteRuntimeFactory,
} from "../../../test/helpers/databaseRuntimeFactories";
import { installIdentityDataTestStorage } from "../../../test/helpers/identityDataTestStorage";

const A = "a".repeat(64);
const B = "b".repeat(64);
afterEach(cleanup);

for (const reuseDatabaseWorker of [false, true]) {
  test(`active identity purge awaits worker deletion (reuse=${reuseDatabaseWorker})`, async () => {
    const factory = createReusableSQLiteRuntimeFactory({ deferDelete: true });
    const view = renderDatabaseProvider({
      createSQLiteRuntime: factory.createSQLiteRuntime,
      reuseDatabaseWorker,
    });
    try {
      await view.controlsReady.promise;
      await act(async () => {
        await view.getControls().ensureIdentityReady(A);
      });
      let done = false;
      let purge!: Promise<void>;
      act(() => {
        purge = view
          .getControls()
          .purgeIdentityDatabase(A)
          .then(() => {
            done = true;
          });
      });
      expect(view.getControls().status).toBe("idle");
      expect(view.getControls().client).toBeNull();
      expect(done).toBe(false);
      await act(async () => {
        await Promise.resolve();
        expect(done).toBe(false);
        factory.releaseDelete();
        await purge;
      });
      expect(done).toBe(true);
      expect(factory.getStats()).toMatchObject(
        reuseDatabaseWorker
          ? { clientDeleteCount: 1, closeCount: 0, renewCount: 1 }
          : { clientDeleteCount: 1, terminateCount: 1 },
      );
    } finally {
      factory.releaseDelete();
      view.unmount();
    }
  });
}

test("inactive identity purge removes only the named OPFS database", async () => {
  const opfs = installIdentityDataTestStorage([A, B]);
  const factory = createReusableSQLiteRuntimeFactory();
  const view = renderDatabaseProvider({
    createSQLiteRuntime: factory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });
  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(B);
    });
    const otherClient = view.getControls().client;
    await act(async () => {
      await view.getControls().purgeIdentityDatabase(A);
    });
    expect(opfs.databases).toEqual(new Set([`app-identity-${B}.db`]));
    expect(view.getControls().client).toBe(otherClient);
    expect(view.getControls().status).toBe("ready");
    expect(factory.getStats()).toMatchObject({
      clientDeleteCount: 0,
      deleteDataCount: 0,
      closeCount: 0,
      terminateCount: 0,
    });
  } finally {
    view.unmount();
    opfs.restore();
  }
});

test("named purge waits for a pending close before deleting OPFS files", async () => {
  const opfs = installIdentityDataTestStorage([A, B]);
  const factory = createReusableSQLiteRuntimeFactory({ deferClose: true });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: factory.createSQLiteRuntime,
    reuseDatabaseWorker: true,
  });
  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(A);
    });
    act(() => {
      view.getControls().clearWorker();
    });
    await act(async () => {
      const purge = view.getControls().purgeIdentityDatabase(A);
      await Promise.resolve();
      expect(opfs.removals).toHaveLength(0);
      const next = view.getControls().ensureIdentityReady(B);
      factory.releaseClose();
      await Promise.all([purge, next]);
    });
    expect(opfs.databases).toEqual(new Set([`app-identity-${B}.db`]));
    expect(factory.getStats()).toMatchObject({ closeCount: 1, initCount: 2 });
  } finally {
    factory.releaseClose();
    view.unmount();
    opfs.restore();
  }
});

for (const reuseDatabaseWorker of [false, true]) {
  test(`clearing another identity during a named wipe closes it and gates boot (reuse=${reuseDatabaseWorker})`, async () => {
    const gate = createDeferred();
    const opfs = installIdentityDataTestStorage([A, B], () => gate.promise);
    const factory = createReusableSQLiteRuntimeFactory();
    const view = renderDatabaseProvider({
      createSQLiteRuntime: factory.createSQLiteRuntime,
      reuseDatabaseWorker,
    });
    try {
      await view.controlsReady.promise;
      await act(async () => {
        await view.getControls().ensureIdentityReady(B);
      });
      await act(async () => {
        const purge = view.getControls().purgeIdentityDatabase(A);
        view.getControls().clearWorker();
        expect(factory.getStats().closeCount).toBe(1);
        const boot = view.getControls().ensureIdentityReady(A);
        await Promise.resolve();
        await Promise.resolve();
        expect(factory.getStats().initCount).toBe(1);
        gate.resolve();
        await Promise.all([purge, boot]);
      });
      expect(view.getControls().status).toBe("ready");
      expect(factory.getStats().initCount).toBe(2);
      expect(opfs.databases).toEqual(new Set([`app-identity-${B}.db`]));
    } finally {
      gate.resolve();
      view.unmount();
      opfs.restore();
    }
  });
}

test("an unacknowledged worker delete fails instead of reporting a successful wipe", async () => {
  const factory = createReusableSQLiteRuntimeFactory({ deferDelete: true });
  const view = renderDatabaseProvider({
    createSQLiteRuntime: factory.createSQLiteRuntime,
    reuseDatabaseWorker: false,
  });
  try {
    await view.controlsReady.promise;
    await act(async () => {
      await view.getControls().ensureIdentityReady(A);
      await expect(view.getControls().purgeIdentityDatabase(A)).rejects.toThrow(
        /delete timed out/u,
      );
    });
    expect(factory.getStats()).toMatchObject({
      clientDeleteCount: 1,
      deleteDataCount: 0,
      terminateCount: 1,
    });
  } finally {
    factory.releaseDelete();
    view.unmount();
  }
});
