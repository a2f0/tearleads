import { expect, mock, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { attachmentContentSha256 } from "../../../data/documents/attachmentContentIdentity";
import { addDocumentAttachments } from "../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentPendingAttachments,
  documentProjection,
  documents,
} from "../../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../data/sqlite/sqlTableSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import { removeAttachmentFromDocumentStore } from "./attachmentRemoval";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { createDocumentStoreState } from "./state";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const STORAGE_KEY = "blob-cold-reset";
const SLOT_ID = "slot";
const BYTES = new Uint8Array([1, 2, 3]);
const ORGANIZATION_ID = "org-before-reset";
const REMOTE_ID = "550e8400-e29b-41d4-a716-446655440010";
const BLOB_ID = "550e8400-e29b-41d4-a716-446655440657";
const BINDING_ID = "550e8400-e29b-41d4-a716-446655440656";

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
  const documentId = REMOTE_ID;
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

async function withPendingRuntime(
  name: string,
  bound: boolean,
  run: (input: {
    listBindings: ReturnType<
      typeof mock<() => Promise<BlobAttachmentSummary[]>>
    >;
    detachRequests: BlobAttachmentDetachRequest[];
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
  const fixture = await createMaterializedSyncFixture({
    organizationId: ORGANIZATION_ID,
    documentId: REMOTE_ID,
  });
  const detachRequests: BlobAttachmentDetachRequest[] = [];
  // This pass reads only the active binding identifiers before authoring its
  // own signed detach against the verified writer projection.
  const binding = {
    blobId: BLOB_ID,
    bindingId: BINDING_ID,
    slotId: SLOT_ID,
  } as BlobAttachmentSummary;
  const listBindings = mock(async () => (bound ? [binding] : []));
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {
      listDocumentAttachments: listBindings,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      detachBlobAttachment: async (
        blobId: string,
        bindingId: string,
        request: BlobAttachmentDetachRequest,
      ) => {
        detachRequests.push(request);
        bound = false;
        return { blobId, bindingId, documentId: REMOTE_ID, slotId: SLOT_ID };
      },
    } as unknown as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: {
      isAuthenticated: false,
      organizationId: ORGANIZATION_ID,
      userId: fixture.author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
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
    store.resolveProjectionUserKey = fixture.resolveProjectionUserKey;
    return store;
  };
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await blobStore.writeBytes(STORAGE_KEY, BYTES);
    await seedHeldAttachment(execSql, "doc-a");
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.delete(documentAttachmentBlobProjection);
    await db.insert(documentPendingAttachments).values({
      localId: "doc-a",
      slotId: SLOT_ID,
      storageKey: STORAGE_KEY,
      name: "pending.bin",
      mimeType: "application/octet-stream",
      byteLength: BYTES.length,
      contentSha256: await attachmentContentSha256(BYTES),
      createdAt: new Date().toISOString(),
      uploadBlobId: BLOB_ID,
      uploadContentKey: "key",
      uploadIv: "iv",
      uploadContentKeyEpoch: 1,
      uploadPlaintextSha256: "0".repeat(64),
    });
    await run({
      blobStore,
      execSql,
      openStore,
      runtime,
      listBindings,
      detachRequests,
    });
  } finally {
    try {
      await reclaimDocumentOrphanBlobs(runtime);
    } finally {
      close();
    }
  }
}

// The upload identity is durable before bind. A committed bind with a lost
// response therefore looks exactly like this pending-only row on restart.
test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "pending upload removal retries detach (restart: %s, bound: %s)",
  async (restart, bound) => {
    await withPendingRuntime("pending-upload-detach", bound, async (input) => {
      const state = await input.openStore("doc-a");
      expect(state.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
      // An in-flight hydration pass captured these maps before removal.
      const before = [
        state.attachmentBlobIdBySlotId,
        state.attachmentContentSha256BySlotId,
        state.attachmentStorageKeyBySlotId,
      ];
      await removeAttachmentFromDocumentStore(state, () => undefined, SLOT_ID);
      for (const captured of before) expect(captured[SLOT_ID]).toBeUndefined();
      const { db } = getClientSQLitePersistenceRuntime(input.execSql);
      expect(await db.select().from(documentPendingAttachments)).toEqual([]);
      expect(
        await db.select().from(documentAttachmentBlobProjection),
      ).toMatchObject([
        {
          blobId: BLOB_ID,
          storageKey: STORAGE_KEY,
          detachedAt: expect.any(String),
        },
      ]);
      await reclaimDocumentOrphanBlobs(input.runtime);
      expect(await input.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);

      const current = restart ? await input.openStore("doc-a") : state;
      expect(current.snapshot.attachments).toEqual([]);
      expect(current.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(STORAGE_KEY);
      expect(current.attachmentBlobIdBySlotId[SLOT_ID]).toBe(BLOB_ID);
      expect(current.attachmentContentSha256BySlotId[SLOT_ID]).toBe(
        await attachmentContentSha256(BYTES),
      );
      const generation = captureDocumentStoreSyncGeneration(
        current,
        current.doc,
      );
      if (!generation || !current.record)
        throw new Error("Expected sync state");
      input.listBindings.mockRejectedValueOnce(new Error("offline"));
      await expect(
        syncDetachedAttachmentBindings(current, current.record, generation),
      ).rejects.toThrow("offline");
      expect(
        await db.select().from(documentAttachmentBlobProjection),
      ).toHaveLength(1);
      // A later pass may find the bind absent (never committed or already detached).
      // It still has to list before dropping the marker and reclaiming the bytes.
      await syncDetachedAttachmentBindings(current, current.record, generation);
      expect(input.listBindings).toHaveBeenCalledTimes(2);
      expect(input.listBindings).toHaveBeenCalledWith(REMOTE_ID);
      expect(input.detachRequests).toHaveLength(bound ? 1 : 0);
      if (bound)
        expect(input.detachRequests[0]?.body).toMatchObject({
          eventType: "attachment.detach",
          blobId: BLOB_ID,
          bindingId: BINDING_ID,
          documentId: REMOTE_ID,
          slotId: SLOT_ID,
        });
      expect(await db.select().from(documentAttachmentBlobProjection)).toEqual(
        [],
      );
      await reclaimDocumentOrphanBlobs(input.runtime);
      expect(await input.blobStore.readBytes(STORAGE_KEY)).toBeNull();
    });
  },
);
