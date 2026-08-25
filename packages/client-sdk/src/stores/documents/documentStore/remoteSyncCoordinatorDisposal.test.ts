import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createProbeRuntime,
  settleWithin,
} from "../../../../test/helpers/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../../data/sync/syncCoordinator";
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
