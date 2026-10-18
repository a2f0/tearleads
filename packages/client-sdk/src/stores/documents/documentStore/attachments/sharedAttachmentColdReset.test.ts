import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { attachmentContentSha256 } from "../../../../data/documents/attachmentContentIdentity";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { applyStoredAttachmentRemoval } from "../../../../data/persistence/documents/internal/attachmentStagingPersistence";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentPendingAttachments,
  documentProjection,
  documents,
} from "../../../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../../data/sqlite/sqlTableSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../../workflows/documents";
import { clearRemoteSyncState } from "../../../../workflows/sync/remoteReset";
import { deleteUnreferencedStagedAttachmentBytes } from "../attachmentUpload/attachmentStaging";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { removeAttachmentFromDocumentStore } from "./attachmentRemoval";

const STORAGE_KEY = "blob-cold-reset";
const SLOT_ID = "slot";
const BYTES = new Uint8Array([1, 2, 3]);
const ORGANIZATION_ID = "org-before-reset";

async function seedHeldAttachment(execSql: ExecSql, localId: string) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const doc = await createDocument(localId);
  const contentSha256 = await attachmentContentSha256(BYTES);
  addDocumentAttachments(doc, [
    {
      slotId: SLOT_ID,
      name: "shared.bin",
      byteLength: BYTES.length,
      mimeType: "application/octet-stream",
      contentSha256,
    },
  ]);
  const snapshot = bytesToBase64(exportFullHistorySnapshot(doc));
  const endVersionVector = encodeVersionVector(doc);
  const updatedAt = new Date().toISOString();
  const documentId = `remote-${localId}`;
  await db.insert(documents).values({
    appKind: "documents",
    localId,
    documentId,
    snapshotEndVersion: endVersionVector,
    effectiveAccessLevel: "admin",
    accessEpoch: 1,
    updatedAt,
  });
  await db.insert(documentHistoryCheckpoints).values({
    appKind: "documents",
    localId,
    snapshot,
    endVersionVector,
    revision: localId,
    updatedAt,
  });
  await db.insert(documentProjection).values({
    localId,
    documentId,
    containerId: null,
    organizationId: ORGANIZATION_ID,
    updatedAt,
  });
  await db.insert(documentAttachmentBlobProjection).values({
    localId,
    slotId: SLOT_ID,
    blobId: `blob-${localId}`,
    storageKey: STORAGE_KEY,
    mimeType: "application/octet-stream",
    byteLength: BYTES.length,
    contentSha256,
    updatedAt,
    detachedAt: null,
  });
}

async function withResetRuntime(
  name: string,
  run: (input: {
    blobStore: ReturnType<typeof createMemoryBlobStore>;
    execSql: ExecSql;
    openStore: (
      localId: string,
    ) => Promise<ReturnType<typeof createDocumentStoreState>>;
    runtime: ReturnType<typeof createDocumentsWorkflowRuntime>;
  }) => Promise<void>,
) {
  const { close, execSql } = await createTestExecSql(name);
  const blobStore = createMemoryBlobStore();
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: false,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
  const openStore = async (localId: string) => {
    const store = createDocumentStoreState(
      localId,
      runtime,
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    expect(await ensureDocumentStoreReady(store, () => undefined)).toBe(true);
    return store;
  };
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await blobStore.writeBytes(STORAGE_KEY, BYTES);
    for (const localId of ["doc-a", "doc-b"])
      await seedHeldAttachment(execSql, localId);
    await clearRemoteSyncState(execSql, { organizationId: ORGANIZATION_ID });
    await run({ blobStore, execSql, openStore, runtime });
  } finally {
    await reclaimDocumentOrphanBlobs(runtime);
    close();
  }
}

test("a cold store removes a reset attachment held only as a pending upload", async () => {
  await withResetRuntime("cold-reset-removal", async (input) => {
    const { db } = getClientSQLitePersistenceRuntime(input.execSql);
    const pendingFor = async (localId: string) =>
      (await db.select().from(documentPendingAttachments)).filter(
        (row) => row.localId === localId,
      );
    const first = await input.openStore("doc-a");
    // The reset left no held row, so only the pending upload names the bytes.
    expect(first.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
    expect(await pendingFor("doc-a")).toHaveLength(1);

    await removeAttachmentFromDocumentStore(first, () => undefined, SLOT_ID);
    await reclaimDocumentOrphanBlobs(input.runtime);
    expect(await pendingFor("doc-a")).toEqual([]);
    // doc-b still uploads from the shared copy.
    expect(await pendingFor("doc-b")).toHaveLength(1);
    expect(await input.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
    // A restart must not resurrect the removed slot from its pending row.
    const restarted = await input.openStore("doc-a");
    expect(restarted.snapshot.attachments).toEqual([]);

    const second = await input.openStore("doc-b");
    await removeAttachmentFromDocumentStore(second, () => undefined, SLOT_ID);
    await reclaimDocumentOrphanBlobs(input.runtime);
    expect(await db.select().from(documentPendingAttachments)).toEqual([]);
    expect(await input.blobStore.readBytes(STORAGE_KEY)).toBe(null);
  });
});

test("dropping the last pending upload queues its bytes for reclaim", async () => {
  await withResetRuntime("cold-reset-drop", async (input) => {
    for (const localId of ["doc-a", "doc-b"]) {
      await defaultDocumentsPersistence.deletePendingAttachment(
        input.execSql,
        localId,
        SLOT_ID,
        STORAGE_KEY,
      );
      await reclaimDocumentOrphanBlobs(input.runtime);
      expect(await input.blobStore.readBytes(STORAGE_KEY)).toEqual(
        localId === "doc-a" ? BYTES : null,
      );
    }
  });
});

// A document re-created after reset removes in detach mode; with no held row
// there is no detached marker whose later cleanup would queue the copy.
test("a detach-mode removal of a pending-only slot queues its copy", async () => {
  await withResetRuntime("cold-reset-detach", async (input) => {
    for (const localId of ["doc-a", "doc-b"]) {
      await getClientSQLitePersistenceRuntime(input.execSql).transaction((tx) =>
        applyStoredAttachmentRemoval({
          localId,
          removal: { mode: "detach", slotId: SLOT_ID, storageKey: STORAGE_KEY },
          tx,
        }),
      );
      await reclaimDocumentOrphanBlobs(input.runtime);
      expect(await input.blobStore.readBytes(STORAGE_KEY)).toEqual(
        localId === "doc-a" ? BYTES : null,
      );
    }
  });
});

test("a staged rollback keeps bytes a reset upload still references", async () => {
  await withResetRuntime("cold-reset-staged-rollback", async (input) => {
    const store = await input.openStore("doc-a");
    const generation = captureDocumentStoreSyncGeneration(store, store.doc);
    if (!generation) throw new Error("Expected a current store generation");
    const [pending] = store.pendingAttachments;
    if (!pending) throw new Error("Expected the reset pending upload");
    // A follow-up abort after an overlapping reset rolls back this key.
    await deleteUnreferencedStagedAttachmentBytes({
      generation,
      pendingAttachments: [pending],
      state: store,
    });
    expect(await input.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
  });
});
