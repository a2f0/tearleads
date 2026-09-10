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
    const deleteGate = createDeferred();
    const view = renderDatabaseProvider({
      createSQLiteRuntime: () => {
        const runtime = factory.createSQLiteRuntime();
        const deleteData = runtime.deleteData;
        runtime.deleteData = async () => {
          await deleteGate.promise;
          await deleteData();
        };
        return runtime;
      },
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
        deleteGate.resolve();
        factory.releaseDelete();
        await purge;
      });
      expect(done).toBe(true);
      expect(factory.getStats()).toMatchObject(
        reuseDatabaseWorker
          ? { clientDeleteCount: 1, closeCount: 0, renewCount: 1 }
          : { deleteDataCount: 1 },
      );
    } finally {
      deleteGate.resolve();
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
