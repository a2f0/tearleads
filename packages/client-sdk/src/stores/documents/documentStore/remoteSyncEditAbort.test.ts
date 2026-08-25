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

test("aborting a probe does not invalidate an edit awaiting persistence", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-wait-edit-abort");
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      markSyncStarted();
      await responseGate;
      return fixture.response;
    },
  });
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
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "edit-abort-profile",
      runtime,
      persistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    const abortController = new AbortController();
    const remoteProbe = store.requestRemoteSyncAndWait(abortController.signal);
    await settleWithin(syncStarted);

    blockMutationPersist = true;
    const edit = store.setText("durable local edit");
    await settleWithin(persistStarted, "local edit persistence");
    abortController.abort();
    releasePersist();

    expect(await settleWithin(remoteProbe)).toBe(false);
    await settleWithin(edit, "local edit");
    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "edit-abort-profile",
    );
    expect(persisted.document?.text).toBe("durable local edit");
  } finally {
    releasePersist();
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
