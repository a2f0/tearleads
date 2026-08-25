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
