import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentResponseFixtures";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
} from "../../../../workflows/documents";
import { createDocumentStore } from "../index";

type CreateResult = Awaited<ReturnType<ApiClient["createDocumentResult"]>>;

const EDIT_1 = "Field log\nFirst line of the field log.";
const EDIT_2 =
  "Field log\nFirst line of the field log.\nA second edit adds another range.";

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error(message);
}

async function createSeededCreateResponse(
  request: DocumentCreateRequest,
  includeInitialSync: boolean,
): Promise<{
  readonly fixture: DocumentCreateFixture;
  readonly result: CreateResult;
}> {
  const createdFixture = await createResponseFromRequest(request);
  const seedId = request.initialSync?.outgoingUpdates[0]?.id;
  return {
    fixture: createdFixture,
    result: {
      data: {
        ...createdFixture,
        ...(includeInitialSync && seedId
          ? {
              initialSync: {
                acceptedOutgoingUpdateIds: [seedId],
                commitLsn: "0/10",
                commitLsnMode: "tracked" as const,
              },
            }
          : {}),
      },
      ok: true as const,
    },
  };
}

async function runConcurrentCreateAndEditRace(input: {
  readonly includeInitialSync: boolean;
  readonly name: string;
}) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(input.name);
  let releaseCreateCommit = () => {};
  const createCommitGate = new Promise<void>((resolve) => {
    releaseCreateCommit = resolve;
  });
  let releaseCreateCompaction = () => {};
  const createCompactionGate = new Promise<void>((resolve) => {
    releaseCreateCompaction = resolve;
  });
  let createCommitEntered = false;
  let holdNextHistoryTailRead = false;
  let acceptedUploadCount = 0;
  const remoteState: { storedDocument: DocumentCreateFixture | null } = {
    storedDocument: null,
  };
  let syncCalls = 0;

  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(sql, mutation, saveClientProjection) {
      const isCreateIdentityCommit =
        mutation.expectedRecord.documentId === null &&
        mutation.document.documentId !== null;
      if (isCreateIdentityCommit && !createCommitEntered) {
        createCommitEntered = true;
        holdNextHistoryTailRead = true;
        // Hold the serialized SQL mutation right before committing the created
        // documentId so a concurrent setText captures state.record with
        // documentId: null and queues right behind this commit.
        await createCommitGate;
      }
      return defaultDocumentsPersistence.commitDocumentMutation(
        sql,
        mutation,
        saveClientProjection,
      );
    },
    async readHistoryTailSize(sql, localId) {
      if (holdNextHistoryTailRead) {
        holdNextHistoryTailRead = false;
        // Let the concurrent setText finish its persist before the create pass
        // moves on to prepareDocumentOutgoingCoverage (exact browser timing
        // where Edit 2 loses the create commit and reloads Edit 1).
        await createCompactionGate;
      }
      return defaultDocumentsPersistence.readHistoryTailSize(sql, localId);
    },
  };

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const apiClient = createMockApiClient({
      createDocument: async () => null,
      createDocumentResult: async (request) => {
        const created = await createSeededCreateResponse(
          request,
          input.includeInitialSync,
        );
        remoteState.storedDocument = created.fixture;
        if (
          created.result.ok &&
          (created.result.data.initialSync?.acceptedOutgoingUpdateIds.length ??
            0) > 0
        ) {
          acceptedUploadCount += 1;
        }
        return created.result;
      },
      getContainerWriterProjection: async () => fixture.projection,
      getDocumentWriterProjection: async (documentId) =>
        remoteState.storedDocument?.id === documentId
          ? createStoredDocumentWriterProjection(
              fixture,
              remoteState.storedDocument,
            )
          : null,
      primeDocumentWriterProjection: () => undefined,
      syncDocument: async (_documentId, request) => {
        if (!remoteState.storedDocument) return null;
        syncCalls += 1;
        if (request.outgoingUpdates.length > 0) acceptedUploadCount += 1;
        return createEchoDocumentSyncResponse({
          commitLsn: `0/${10 + syncCalls}`,
          request,
          storedDocument: remoteState.storedDocument,
        });
      },
    });
    const runtime = createOnlineDocumentsRuntime({
      apiClient,
      execSql,
      fixture,
    });
    const offlineRuntime = {
      ...runtime,
      state: { ...runtime.state, online: false },
    };

    const localId = `${input.name}-local`;
    const store = createDocumentStore(localId, offlineRuntime, persistence);
    store.updateRuntime(offlineRuntime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Document store did not become ready.",
    );

    await store.setText(EDIT_1);
    expect(store.getSnapshot().text).toBe(EDIT_1);
    expect(store.getSnapshot().documentId).toBeNull();

    const publishedTexts: string[] = [store.getSnapshot().text];
    const unsubscribe = store.subscribe(() => {
      publishedTexts.push(store.getSnapshot().text);
    });

    // Go online to trigger the remote create for Edit 1.
    store.updateRuntime(runtime);
    store.requestSync();
    await waitFor(
      () => createCommitEntered,
      "Remote create did not reach commitDocumentMutation.",
    );

    // While persistCreatedRemoteDocument holds the SQL mutation (and before
    // state.record.documentId updates), type Edit 2. Its persist captures
    // currentRecord with documentId: null and waits behind the create commit.
    const edit2Promise = store.setText(EDIT_2);
    await Bun.sleep(25);
    releaseCreateCommit();

    await edit2Promise;
    releaseCreateCompaction();
    await waitFor(
      async () =>
        store.getSnapshot().documentId !== null &&
        !store.getSnapshot().syncing &&
        (await defaultDocumentsPersistence.listPendingUpdates(execSql, localId))
          .length === 0,
      "Document did not finish creating and syncing Edit 2.",
    );
    unsubscribe();

    const storedRecord = await defaultDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    return {
      acceptedUploadCount,
      createdRemoteId: remoteState.storedDocument?.id ?? null,
      publishedTexts,
      snapshot: store.getSnapshot(),
      storedRecord,
    };
  } finally {
    releaseCreateCommit();
    releaseCreateCompaction();
    close();
  }
}

test("a local edit overlapping its own seeded remote create survives and syncs", async () => {
  const result = await runConcurrentCreateAndEditRace({
    includeInitialSync: true,
    name: "seeded-create-edit-race",
  });

  expect(result.snapshot.documentId).toBe(result.createdRemoteId);
  expect(result.snapshot.text).toBe(EDIT_2);
  expect(result.storedRecord?.text).toBe(EDIT_2);
  expect(result.storedRecord?.documentId).toBe(result.createdRemoteId);
  expect(result.acceptedUploadCount).toBe(2);
  for (let index = 1; index < result.publishedTexts.length; index += 1) {
    expect(result.publishedTexts[index]?.length ?? 0).toBeGreaterThanOrEqual(
      result.publishedTexts[index - 1]?.length ?? 0,
    );
  }
});

test("a local edit overlapping an unseeded remote create also survives and syncs", async () => {
  const result = await runConcurrentCreateAndEditRace({
    includeInitialSync: false,
    name: "unseeded-create-edit-race",
  });

  expect(result.snapshot.documentId).toBe(result.createdRemoteId);
  expect(result.snapshot.text).toBe(EDIT_2);
  expect(result.storedRecord?.text).toBe(EDIT_2);
  expect(result.storedRecord?.documentId).toBe(result.createdRemoteId);
  expect(result.acceptedUploadCount).toBeGreaterThanOrEqual(1);
  for (let index = 1; index < result.publishedTexts.length; index += 1) {
    expect(result.publishedTexts[index]?.length ?? 0).toBeGreaterThanOrEqual(
      result.publishedTexts[index - 1]?.length ?? 0,
    );
  }
});

test("an external relink from null in the same container and epoch still rejects a stale edit", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "same-container-relink-race",
  );
  const localId = "same-container-relink-local";
  let relinkBeforeNextCommit = false;
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(sql, mutation, saveClientProjection) {
      if (relinkBeforeNextCommit) {
        relinkBeforeNextCommit = false;
        await defaultDocumentsPersistence.relinkPersistedDocument(sql, {
          accessEpoch: 1,
          containerId: fixture.projection.containerId,
          documentId: "foreign-relink-document",
          localId,
        });
      }
      return defaultDocumentsPersistence.commitDocumentMutation(
        sql,
        mutation,
        saveClientProjection,
      );
    },
  };

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const runtime = createOnlineDocumentsRuntime({
      apiClient: createMockApiClient(),
      execSql,
      fixture,
    });
    const offlineRuntime = {
      ...runtime,
      state: { ...runtime.state, online: false },
    };
    const store = createDocumentStore(localId, offlineRuntime, persistence);
    store.updateRuntime(offlineRuntime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Same-container relink store did not become ready.",
    );

    relinkBeforeNextCommit = true;
    await store.setText("stale edit after external relink");

    expect(store.getSnapshot()).toMatchObject({
      documentId: "foreign-relink-document",
      text: "",
    });
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, localId),
    ).toMatchObject({
      documentId: "foreign-relink-document",
      text: "",
    });
    expect(
      await defaultDocumentsPersistence.listPendingUpdates(execSql, localId),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a write-access downgrade during remote create still rejects a concurrent edit", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "create-downgrade-edit-race",
  );
  const localId = "create-downgrade-edit-local";
  let releaseCreateCommit = () => {};
  const createCommitGate = new Promise<void>((resolve) => {
    releaseCreateCommit = resolve;
  });
  let releaseCreateCompaction = () => {};
  const createCompactionGate = new Promise<void>((resolve) => {
    releaseCreateCompaction = resolve;
  });
  let createCommitEntered = false;
  let holdNextHistoryTailRead = false;
  let storedDocument: DocumentCreateFixture | null = null;
  let downgraded = false;

  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(sql, mutation, saveClientProjection) {
      const isCreateIdentityCommit =
        mutation.expectedRecord.documentId === null &&
        mutation.document.documentId !== null;
      if (isCreateIdentityCommit && !createCommitEntered) {
        createCommitEntered = true;
        holdNextHistoryTailRead = true;
        await createCommitGate;
        const committed =
          await defaultDocumentsPersistence.commitDocumentMutation(
            sql,
            mutation,
            saveClientProjection,
          );
        // Simulate another pane downgrading write access right after the remote
        // create commits, before the queued local edit runs prepareDocumentMutation.
        const current = await defaultDocumentsPersistence.loadDocument(
          sql,
          localId,
        );
        if (current && !downgraded) {
          downgraded = true;
          await defaultDocumentsPersistence.saveDocument(sql, {
            ...current,
            effectiveAccessLevel: "read",
          });
        }
        return committed;
      }
      return defaultDocumentsPersistence.commitDocumentMutation(
        sql,
        mutation,
        saveClientProjection,
      );
    },
    async readHistoryTailSize(sql, id) {
      if (holdNextHistoryTailRead) {
        holdNextHistoryTailRead = false;
        await createCompactionGate;
      }
      return defaultDocumentsPersistence.readHistoryTailSize(sql, id);
    },
  };

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const apiClient = createMockApiClient({
      createDocument: async () => null,
      createDocumentResult: async (request) => {
        const created = await createSeededCreateResponse(request, true);
        storedDocument = created.fixture;
        return created.result;
      },
      getContainerWriterProjection: async () => fixture.projection,
      getDocumentWriterProjection: async (documentId) =>
        storedDocument?.id === documentId
          ? createStoredDocumentWriterProjection(fixture, storedDocument)
          : null,
      primeDocumentWriterProjection: () => undefined,
      syncDocument: async (_documentId, request) =>
        storedDocument
          ? createEchoDocumentSyncResponse({
              commitLsn: "0/11",
              request,
              storedDocument,
            })
          : null,
    });
    const runtime = createOnlineDocumentsRuntime({
      apiClient,
      execSql,
      fixture,
    });
    const offlineRuntime = {
      ...runtime,
      state: { ...runtime.state, online: false },
    };
    const store = createDocumentStore(localId, offlineRuntime, persistence);
    store.updateRuntime(offlineRuntime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Downgrade race store did not become ready.",
    );

    await store.setText(EDIT_1);
    store.updateRuntime(runtime);
    store.requestSync();
    await waitFor(
      () => createCommitEntered,
      "Remote create did not reach commitDocumentMutation.",
    );

    const edit2Promise = store.setText(EDIT_2);
    await Bun.sleep(25);
    releaseCreateCommit();
    await edit2Promise;
    releaseCreateCompaction();

    await waitFor(
      () =>
        store.getSnapshot().documentId !== null &&
        store.getSnapshot().effectiveAccessLevel === "read",
      "Store did not reload the read-only downgrade.",
    );
    expect(store.getSnapshot().text).toBe(EDIT_1);
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, localId),
    ).toMatchObject({
      effectiveAccessLevel: "read",
      text: EDIT_1,
    });
    expect(
      await defaultDocumentsPersistence.listPendingUpdates(execSql, localId),
    ).toEqual([]);
  } finally {
    releaseCreateCommit();
    releaseCreateCompaction();
    close();
  }
});
