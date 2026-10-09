import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
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
import { clearRemoteSyncState } from "../../../workflows/sync/remoteReset";
import { removeAttachmentFromDocumentStore } from "./attachments";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { createDocumentStoreState } from "./state";

const STORAGE_KEY = "blob-shared-reset";
const SLOT_ID = "slot";
const BYTES = new Uint8Array([1, 2, 3]);
const ORGANIZATION_ID = "org-before-reset";

async function seedSharedAttachment(execSql: ExecSql, localId: string) {
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
    blobId: "shared-reset",
    storageKey: STORAGE_KEY,
    mimeType: "application/octet-stream",
    byteLength: BYTES.length,
    contentSha256,
    updatedAt,
    detachedAt: null,
  });
}

test.each([false, true])(
  "shared bytes survive one open-store removal (reset: %s)",
  async (reset) => {
    const { close, execSql } = await createTestExecSql(
      "shared-attachment-reset",
    );
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
    try {
      await ensureSqlTables(execSql, clientSqlTables);
      await blobStore.writeBytes(STORAGE_KEY, BYTES);
      const stores = [];
      for (const localId of ["doc-a", "doc-b"]) {
        await seedSharedAttachment(execSql, localId);
        const store = createDocumentStoreState(
          localId,
          runtime,
          defaultDocumentsPersistence,
          noopDocumentStorePersistenceEffects,
          null,
        );
        expect(await ensureDocumentStoreReady(store, () => undefined)).toBe(
          true,
        );
        expect(store.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(STORAGE_KEY);
        stores.push(store);
      }
      const [first, second] = stores;
      if (!first || !second) throw new Error("Expected both open stores");
      if (reset) {
        await clearRemoteSyncState(execSql, {
          organizationId: ORGANIZATION_ID,
        });
        for (const store of stores) {
          await setDocumentText(store, () => undefined, "edit after reset");
          expect(store.record?.documentId).toBe(null);
          expect(store.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(STORAGE_KEY);
        }
      }

      await removeAttachmentFromDocumentStore(first, () => undefined, SLOT_ID);
      await reclaimDocumentOrphanBlobs(runtime);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const references = reset
        ? await db.select().from(documentPendingAttachments)
        : await db.select().from(documentAttachmentBlobProjection);
      expect(
        references.some(
          (row) => row.localId === "doc-b" && row.storageKey === STORAGE_KEY,
        ),
      ).toBe(true);
      expect(await blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);

      if (reset) {
        expect(first.snapshot.attachments).toEqual([]);
        await removeAttachmentFromDocumentStore(
          second,
          () => undefined,
          SLOT_ID,
        );
        await reclaimDocumentOrphanBlobs(runtime);
        expect(await db.select().from(documentPendingAttachments)).toEqual([]);
        expect(await blobStore.readBytes(STORAGE_KEY)).toBe(null);
      }
    } finally {
      await reclaimDocumentOrphanBlobs(runtime);
      close();
    }
  },
);
