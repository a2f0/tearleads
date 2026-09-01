import { expect, test } from "bun:test";
import {
  createDocumentStore,
  DOCUMENTS_APP_KIND,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createLargeText } from "@tearleads/test-utils";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import {
  isPendingUpdateDetailRow,
  isPendingUpdateLengthRow,
  isProjectionLengthRow,
} from "../../../../test/helpers/document-store/documentStoreSyncRows";
import {
  createRuntime,
  createSqlRuntime,
  createSyncRuntime,
} from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("document store creates a document linked to the configured container", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );

  const store = createDocumentStore("container-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Container-scoped document store did not become ready.",
  );

  store.setText("shared container note");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.documentId !== null &&
      persistence.getState().document?.containerId === "shared-container" &&
      persistence.getState().document?.contentKeyBundle !== null &&
      persistence.getState().document?.documentKekTargets !== null &&
      persistence.getState().document?.documentManifestBundle !== null &&
      !store.getSnapshot().syncing,
    "Container-scoped note did not create and sync its document.",
  );
});

// Regression: a note created and never edited enqueues no pending updates, so
// the sync pass used to skip the remote create entirely — the note sat in the
// write queue as a pending create until its first edit.
test("an untouched new note still creates its remote document", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
  );

  const store = createDocumentStore("untouched-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      persistence.getState().document?.documentId != null &&
      persistence.getState().document?.contentKeyBundle !== null &&
      persistence.getState().document?.documentKekTargets !== null &&
      persistence.getState().document?.documentManifestBundle !== null &&
      !store.getSnapshot().syncing,
    "Untouched note did not flush its pending create.",
  );
  expect(persistence.getState().pendingUpdates).toHaveLength(0);
});

test("document store clears document state when access epoch changes", async () => {
  const persistence = createDocumentsPersistence();
  const runtime = createRuntime();

  await persistence.saveDocument(runtime.infra.execSql, {
    accessEpoch: 1,
    accessStateHash: "access-state-hash-1",
    containerId: "container-a",
    documentId: "remote-document",
    id: "epoch-note",
    lastCommitLsn: "0/10",
    snapshotEndVersion: "",
    text: "Existing note",
    contentKeyBundle: "stale-content-key-bundle",
    documentKekTargets: "stale-kek-targets",
    documentManifestBundle: "stale-manifest-bundle",
  });

  const store = createDocumentStore("epoch-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Epoch relink document store did not become ready.",
  );

  await expect(
    store.relink({
      accessEpoch: 2,
      accessStateHash: "access-state-hash-2",
      containerId: "container-b",
      documentId: "remote-document",
      localId: "epoch-note",
    }),
  ).resolves.toMatchObject({
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    id: "epoch-note",
  });

  expect(persistence.getState().document).toMatchObject({
    accessEpoch: 2,
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    lastCommitLsn: "0/10",
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  });
});

test("large note edits remain a single pending update row before sync", async () => {
  const runtime = await createSqlRuntime();

  try {
    const noteId = "large-note";
    const store = createDocumentStore(noteId, runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "SQLite-backed document store did not become ready.",
    );

    const largeText = createLargeText(1024 * 1024);
    store.setText(largeText);

    await waitForCondition(async () => {
      const pendingRows = await runtime.infra.execSql(
        `
 SELECT
 id,
 length(update_data) AS update_data_length
 FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 `,
        {
          ":appKind": DOCUMENTS_APP_KIND,
          ":localId": noteId,
        },
      );

      const projectionRows = await runtime.infra.execSql(
        `
 SELECT length(text) AS text_length
 FROM document_projection_text
 WHERE local_id = :localId
 `,
        {
          ":localId": noteId,
        },
      );
      const pendingRow = pendingRows[0];
      const projectionRow = projectionRows[0];

      return (
        pendingRows.length === 1 &&
        isPendingUpdateLengthRow(pendingRow) &&
        isProjectionLengthRow(projectionRow) &&
        Number(pendingRow.update_data_length ?? 0) > 256 * 1024 &&
        Number(projectionRow.text_length ?? 0) === largeText.length
      );
    }, "Large note edit was not persisted as a single pending update.");

    const pendingRows = await runtime.infra.execSql(
      `
 SELECT
 id,
 length(update_data) AS update_data_length,
 partial_start_version_vector,
 partial_end_version_vector
 FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 `,
      {
        ":appKind": DOCUMENTS_APP_KIND,
        ":localId": noteId,
      },
    );
    const pendingRow = pendingRows[0];

    expect(pendingRows).toHaveLength(1);
    if (!isPendingUpdateDetailRow(pendingRow)) {
      throw new Error("Expected a pending update detail row.");
    }

    expect(Number(pendingRow.update_data_length ?? 0)).toBeGreaterThan(
      256 * 1024,
    );
    expect(pendingRow.partial_start_version_vector).toBeString();
    expect(pendingRow.partial_end_version_vector).toBeString();
  } finally {
    runtime.close();
  }
});

test("document store persists commitLsn and reuses it as minLsn on the next sync", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls: syncDocumentCalls,
    },
  );
  const store = createDocumentStore("default", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().document?.lastCommitLsn === "0/10" &&
      !store.getSnapshot().syncing,
    "Untouched store did not settle its initial create flush.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/20",
    "Initial note document sync did not persist the returned commitLsn.",
  );

  store.setText("hello again");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 3 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/30",
    "Follow-up note sync did not reuse and refresh the persisted commitLsn.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 0,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/20",
      outgoingUpdateCount: 1,
    },
  ]);
});

test("document store skips clean read-only syncs until a remote update event arrives", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls: syncDocumentCalls,
    },
  );
  const store = createDocumentStore("clean-sync", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().document?.lastCommitLsn === "0/10" &&
      !store.getSnapshot().syncing,
    "Untouched store did not settle its initial create flush.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/20" &&
      !store.getSnapshot().syncing,
    "Initial clean-sync document write did not settle.",
  );

  store.requestSync();
  await getOrCreateDomainSyncCoordinator(runtime.state.domainScope).waitForIdle(
    {
      quietMs: 20,
      timeoutMs: 1_000,
    },
  );

  expect(syncDocumentCalls).toHaveLength(2);

  const remoteDocumentId = store.getSnapshot().documentId;
  expect(remoteDocumentId).toBeString();
  store.updateRuntime(
    cloneDocumentsTestRuntime(runtime, {
      state: {
        events: [
          {
            documentId: remoteDocumentId,
            id: "event-1",
            type: "document_update_created",
          },
        ],
      },
    }),
  );

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 3 &&
      persistence.getState().document?.lastCommitLsn === "0/30" &&
      !store.getSnapshot().syncing,
    "Remote update event did not trigger a read-only document sync.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 0,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/20",
      outgoingUpdateCount: 0,
    },
  ]);
});

test("document store forced remote sync pulls a clean remote document without an event", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls: syncDocumentCalls,
    },
  );
  const store = createDocumentStore("forced-clean-sync", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().document?.lastCommitLsn === "0/10" &&
      !store.getSnapshot().syncing,
    "Untouched store did not settle its initial create flush.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.lastCommitLsn === "0/20" &&
      !store.getSnapshot().syncing,
    "Initial forced-clean-sync document write did not settle.",
  );

  store.requestRemoteSync();

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 3 &&
      persistence.getState().document?.lastCommitLsn === "0/30" &&
      !store.getSnapshot().syncing,
    "Forced remote sync did not perform a clean read-only document pull.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 0,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/20",
      outgoingUpdateCount: 0,
    },
  ]);
});

test("document store ignores update events for locally accepted writes", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const acceptedUpdateIdsBySync: string[][] = [];
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      onSyncDocumentRequest: (request) => {
        acceptedUpdateIdsBySync.push(
          request.outgoingUpdates.map((update) => update.id),
        );
      },
      syncCalls: syncDocumentCalls,
    },
  );
  const store = createDocumentStore("local-event-sync", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().document?.documentId != null &&
      !store.getSnapshot().syncing,
    "Untouched store did not settle its initial create flush.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      acceptedUpdateIdsBySync[1]?.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      !store.getSnapshot().syncing,
    "Initial local-event document write did not settle.",
  );

  const remoteDocumentId = store.getSnapshot().documentId;
  expect(remoteDocumentId).toBeString();
  store.updateRuntime(
    cloneDocumentsTestRuntime(runtime, {
      state: {
        events: [
          {
            documentId: remoteDocumentId,
            id: "event-1",
            type: "document_update_created",
            updateIds: acceptedUpdateIdsBySync[1],
          },
        ],
      },
    }),
  );

  await getOrCreateDomainSyncCoordinator(runtime.state.domainScope).waitForIdle(
    {
      quietMs: 20,
      timeoutMs: 1_000,
    },
  );

  expect(syncDocumentCalls).toHaveLength(2);
});
