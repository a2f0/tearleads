import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createProbeRuntime,
  settleWithin,
} from "../../../../test/helpers/remoteSyncWait";
import { waitFor } from "../../../../test/helpers/waitFor";
import {
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
} from "../../../data/sync/syncCoordinator";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";
import { createRemoteHistoryFixture } from "./documentStore.testFixtures";

test("a disposed coordinator cannot land its pass after re-registration", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-coordinator-disposal");
  let releaseFirstResponse: () => void = () => undefined;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let markFirstStarted: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        markFirstStarted();
        await firstResponseGate;
        return fixture.response;
      }
      return null;
    },
  });
  let commitCalls = 0;
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(execSql, input, saveProjection) {
      commitCalls += 1;
      return defaultDocumentsPersistence.commitDocumentMutation(
        execSql,
        input,
        saveProjection,
      );
    },
  };
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "disposed-coordinator-profile",
      runtime,
      persistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    commitCalls = 0;

    store.requestRemoteSync();
    await settleWithin(firstStarted, "first coordinator pass");
    disposeDomainSyncCoordinator(runtime.state.domainScope);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    expect(syncCalls).toBe(2);
    const commitsBeforeDisposedPassReturns = commitCalls;
    releaseFirstResponse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "disposed-coordinator-profile",
    );
    expect(commitCalls).toBe(commitsBeforeDisposedPassReturns);
    expect(persisted.document?.text).toBe("");
    expect(store.getSnapshot().text).toBe("");
  } finally {
    releaseFirstResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a disposed pass cannot clear a replacement lane's syncing state", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("disposed-pass-syncing-state");
  let releaseDisposedPass: () => void = () => undefined;
  const disposedPassGate = new Promise<void>((resolve) => {
    releaseDisposedPass = resolve;
  });
  let releaseReplacementPass: () => void = () => undefined;
  const replacementPassGate = new Promise<void>((resolve) => {
    releaseReplacementPass = resolve;
  });
  let markDisposedPassStarted: () => void = () => undefined;
  const disposedPassStarted = new Promise<void>((resolve) => {
    markDisposedPassStarted = resolve;
  });
  let markReplacementPassStarted: () => void = () => undefined;
  const replacementPassStarted = new Promise<void>((resolve) => {
    markReplacementPassStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        markDisposedPassStarted();
        await disposedPassGate;
      } else if (syncCalls === 2) {
        markReplacementPassStarted();
        await replacementPassGate;
      }
      return null;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "disposed-pass-syncing-state",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    store.requestRemoteSync();
    await settleWithin(disposedPassStarted, "disposed sync pass");
    expect(store.getSnapshot().syncing).toBe(true);

    disposeDomainSyncCoordinator(runtime.state.domainScope);
    store.requestRemoteSync();
    await settleWithin(replacementPassStarted, "replacement sync pass");
    expect(store.getSnapshot().syncing).toBe(true);

    releaseDisposedPass();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getSnapshot().syncing).toBe(true);

    releaseReplacementPass();
    await waitFor(
      () => !store.getSnapshot().syncing,
      "Replacement sync state did not settle",
    );
  } finally {
    releaseDisposedPass();
    releaseReplacementPass();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("coordinator disposal does not cancel an in-flight local persist", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(
    "coordinator-disposal-local-persist",
  );
  let releasePersist: () => void = () => undefined;
  const persistGate = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  let markPersistStarted: () => void = () => undefined;
  const persistStarted = new Promise<void>((resolve) => {
    markPersistStarted = resolve;
  });
  let blockMutationPersist = false;
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(execSql, input, saveProjection) {
      if (blockMutationPersist) {
        markPersistStarted();
        await persistGate;
      }
      return defaultDocumentsPersistence.commitDocumentMutation(
        execSql,
        input,
        saveProjection,
      );
    },
  };
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => null,
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "coordinator-disposal-local-persist",
      runtime,
      persistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    blockMutationPersist = true;
    const edit = store.setText("survives coordinator disposal");
    await settleWithin(persistStarted, "local persistence");
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    releasePersist();
    await settleWithin(edit, "local edit");

    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "coordinator-disposal-local-persist",
    );
    expect(persisted.document?.text).toBe("survives coordinator disposal");
  } finally {
    releasePersist();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("an ordinary remote request re-registers a disposed sync lane", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("disposed-lane-remote-request");
  let syncCalls = 0;
  let markPostDisposalSync: () => void = () => undefined;
  const postDisposalSync = new Promise<void>((resolve) => {
    markPostDisposalSync = resolve;
  });
  let callsBeforeDisposal = Number.POSITIVE_INFINITY;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls > callsBeforeDisposal) {
        markPostDisposalSync();
      }
      return null;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "disposed-lane-remote-request",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    callsBeforeDisposal = syncCalls;

    disposeDomainSyncCoordinator(runtime.state.domainScope);
    store.requestRemoteSync();
    await settleWithin(postDisposalSync, "post-disposal remote sync");
    expect(syncCalls).toBeGreaterThan(callsBeforeDisposal);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a stale pass cannot recreate its coordinator after disposal", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("disposed-lane-no-follow-up");
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      markSyncStarted();
      await responseGate;
      return fixture.response;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "disposed-lane-no-follow-up",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    store.requestRemoteSync();
    await settleWithin(syncStarted, "sync before coordinator disposal");

    disposeDomainSyncCoordinator(runtime.state.domainScope);
    releaseResponse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncCalls).toBe(1);
  } finally {
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a pass disposed during initialization cannot adopt a replacement lane", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("disposed-lane-initialization");
  let releaseLoad: () => void = () => undefined;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let releaseSync: () => void = () => undefined;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  let markLoadStarted: () => void = () => undefined;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  let syncCalls = 0;
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async loadDocumentStoreState(execSql, localId) {
      markLoadStarted();
      await loadGate;
      return defaultDocumentsPersistence.loadDocumentStoreState(
        execSql,
        localId,
      );
    },
  };
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        markSyncStarted();
        await syncGate;
      }
      return null;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "disposed-lane-initialization",
      runtime,
      persistence,
      fixture.writerProjection.documentId,
    );
    const initialization = store.ensureInitialized();
    await settleWithin(loadStarted, "document initialization");
    store.requestRemoteSync();
    await waitFor(
      () =>
        getDomainSyncCoordinatorSnapshot(runtime.state.domainScope).lanes.some(
          (lane) => lane.running,
        ),
      "Initial sync lane did not start",
    );

    disposeDomainSyncCoordinator(runtime.state.domainScope);
    store.requestRemoteSync();
    releaseLoad();
    expect(await initialization).toBe(true);
    await settleWithin(syncStarted, "replacement sync pass");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncCalls).toBe(1);
    releaseSync();
    await waitFor(
      () =>
        syncCalls >= 1 &&
        getDomainSyncCoordinatorSnapshot(runtime.state.domainScope).lanes.every(
          (lane) => !lane.running && !lane.requested,
        ),
      "Replacement sync lane did not settle",
    );
  } finally {
    releaseLoad();
    releaseSync();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
