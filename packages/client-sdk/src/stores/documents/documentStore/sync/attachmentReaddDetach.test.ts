import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import { attachmentContentSha256 } from "../../../../data/blobs/attachmentContentIdentity";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../../data/sqlite/schema";
import { documentProjection } from "../../../../data/sqlite/schema/documentProjectionSchema";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../../data/sqlite/sqlTableSchema";
import { listPendingDownloads } from "../../../../workflows/container-contents/documentQueries/pendingDownloads";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsPersistence,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  loadPersistedDocumentContent,
  persistDocumentState,
  reclaimDocumentOrphanBlobs,
} from "../../../../workflows/documents";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import type { DocumentsRuntime } from "../../types";
import { replaceAttachmentInDocumentStore } from "../attachments";
import { commitHydratedAttachment } from "../attachments/attachmentHydrationCommit";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const LOCAL_ID = "doc-readd";
const SLOT_ID = "photo";
const BYTES = new Uint8Array([1, 2, 3]);
const OTHER_BYTES = new Uint8Array([4, 5, 6, 7]);
const ORGANIZATION_ID = "org-readd";
const REMOTE_ID = "550e8400-e29b-41d4-a716-446655440010";
const BLOB_ID = "550e8400-e29b-41d4-a716-446655440657";
const BINDING_ID = "550e8400-e29b-41d4-a716-446655440656";
const OTHER_BLOB_ID = "550e8400-e29b-41d4-a716-446655440658";
const OTHER_BINDING_ID = "550e8400-e29b-41d4-a716-446655440659";
// A hydrated copy is keyed by its blob, so holding that blob again reuses it.
const STORAGE_KEY = `blob-${BLOB_ID}`;
const OTHER_STORAGE_KEY = `blob-${OTHER_BLOB_ID}`;

function binding(blobId: string, bindingId: string): BlobAttachmentSummary {
  // The detach pass reads only these identifiers before signing its own event.
  return { blobId, bindingId, slotId: SLOT_ID } as BlobAttachmentSummary;
}

async function slotAttachment(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<DocumentAttachment> {
  return {
    byteLength: bytes.length,
    contentSha256: await attachmentContentSha256(bytes),
    mimeType: "application/octet-stream",
    name: "photo.bin",
    slotId: SLOT_ID,
  };
}

async function seedHeldAttachment(execSql: ExecSql) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const doc = await createDocument(LOCAL_ID);
  const attachment = await slotAttachment(BYTES);
  addDocumentAttachments(doc, [attachment]);
  const snapshot = bytesToBase64(exportFullHistorySnapshot(doc));
  const endVersionVector = encodeVersionVector(doc);
  const updatedAt = new Date().toISOString();
  await db.insert(documents).values({
    appKind: "documents",
    localId: LOCAL_ID,
    documentId: REMOTE_ID,
    snapshotEndVersion: endVersionVector,
    effectiveAccessLevel: "admin",
    accessEpoch: 1,
    updatedAt,
  });
  await db.insert(documentHistoryCheckpoints).values({
    appKind: "documents",
    localId: LOCAL_ID,
    snapshot,
    endVersionVector,
    revision: LOCAL_ID,
    updatedAt,
  });
  await db.insert(documentProjection).values({
    localId: LOCAL_ID,
    documentId: REMOTE_ID,
    containerId: null,
    organizationId: ORGANIZATION_ID,
    title: "Photo",
    updatedAt,
  });
  await db.insert(documentAttachmentBlobProjection).values({
    localId: LOCAL_ID,
    slotId: SLOT_ID,
    blobId: BLOB_ID,
    storageKey: STORAGE_KEY,
    mimeType: attachment.mimeType,
    byteLength: attachment.byteLength,
    contentSha256: attachment.contentSha256,
    updatedAt,
    detachedAt: null,
  });
}

/**
 * Another device's re-add of the slot reaching this database through a pull:
 * committed history gains the slot while no local row changes.
 */
async function commitPulledReadd(
  execSql: ExecSql,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    LOCAL_ID,
  );
  const writer = await loadPersistedDocumentContent({
    execSql,
    localId: LOCAL_ID,
    persistence: defaultDocumentsPersistence,
  });
  if (!record || !writer) throw new Error("Expected a stored document");
  const before = encodeVersionVector(writer);
  addDocumentAttachments(writer, [await slotAttachment(bytes)]);
  writer.commit();
  const saved = await persistDocumentState({
    currentDoc: writer,
    currentRecord: record,
    deleteDocumentPlacements,
    documentProjectors: defaultDocumentProjectorRegistry,
    execSql,
    historyUpdateOrigin: "remote",
    historyUpdates: [bytesToBase64(exportUpdatesSince(writer, before))],
    localId: LOCAL_ID,
    patch: { snapshotEndVersion: encodeVersionVector(writer) },
    persistence: defaultDocumentsPersistence,
  });
  if (!saved) throw new Error("Expected the pulled re-add to commit");
}

interface Server {
  bindings: BlobAttachmentSummary[];
  detached: BlobAttachmentDetachRequest[];
  onDetach: (() => Promise<void>) | null;
  onList: (() => Promise<void>) | null;
}

interface Panes {
  blobStore: ReturnType<typeof createMemoryBlobStore>;
  execSql: ExecSql;
  open: (persistence?: DocumentsPersistence) => Promise<DocumentStoreState>;
  rows: () => Promise<unknown[]>;
  pendingRows: () => Promise<unknown[]>;
  runtime: DocumentsRuntime;
  server: Server;
}

async function withPanes(name: string, run: (panes: Panes) => Promise<void>) {
  const { close, execSql } = await createTestExecSql(name);
  const blobStore = createMemoryBlobStore();
  const fixture = await createMaterializedSyncFixture({
    organizationId: ORGANIZATION_ID,
    documentId: REMOTE_ID,
  });
  const server: Server = {
    bindings: [binding(BLOB_ID, BINDING_ID)],
    detached: [],
    onDetach: null,
    onList: null,
  };
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {
      listDocumentAttachments: async () => {
        const hook = server.onList;
        server.onList = null;
        await hook?.();
        return [...server.bindings];
      },
      getDocumentWriterProjection: async () => fixture.writerProjection,
      detachBlobAttachment: async (
        blobId: string,
        bindingId: string,
        request: BlobAttachmentDetachRequest,
      ) => {
        // The hook runs while the signed detach is in flight.
        const hook = server.onDetach;
        server.onDetach = null;
        await hook?.();
        server.detached.push(request);
        server.bindings = server.bindings.filter(
          (active) => active.bindingId !== bindingId,
        );
        return { blobId, bindingId, documentId: REMOTE_ID, slotId: SLOT_ID };
      },
    } as unknown as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: {
      isAuthenticated: false,
      organizationId: ORGANIZATION_ID,
      userId: fixture.author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
    },
    deleteDocumentPlacements,
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
  // Each pane is its own runtime (registry, sync coordinator, Loro peer) over
  // the same database and server.
  const open = async (persistence = defaultDocumentsPersistence) => {
    const pane = createDocumentStoreState(
      LOCAL_ID,
      {
        ...runtime,
        state: { ...runtime.state, domainScope: createDomainScope() },
      },
      persistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    expect(await ensureDocumentStoreReady(pane, () => undefined)).toBe(true);
    pane.resolveProjectionUserKey = fixture.resolveProjectionUserKey;
    return pane;
  };
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await blobStore.writeBytes(STORAGE_KEY, BYTES);
    await seedHeldAttachment(execSql);
    await run({
      blobStore,
      execSql,
      open,
      pendingRows: () => db.select().from(documentPendingAttachments),
      rows: () => db.select().from(documentAttachmentBlobProjection),
      runtime,
      server,
    });
  } finally {
    try {
      await reclaimDocumentOrphanBlobs(runtime);
    } finally {
      close();
    }
  }
}

/** Remove the slot in `pane`, then run its detach pass. */
async function removeAndDetach(pane: DocumentStoreState): Promise<void> {
  await removeAttachmentFromDocumentStore(pane, () => undefined, SLOT_ID);
  await runDetachPass(pane);
}

async function runDetachPass(pane: DocumentStoreState): Promise<void> {
  const generation = captureDocumentStoreSyncGeneration(pane, pane.doc);
  if (!generation || !pane.record) throw new Error("Expected sync state");
  await syncDetachedAttachmentBindings(
    pane,
    pane.record,
    generation,
    createPrincipalPolicyOperation(),
  );
}

test.each([
  ["the restoring pane reopens", true],
  ["the restoring pane stays closed", false],
])(
  "a slot re-added with the same bytes before the binding list returns keeps its binding and copy (%s)",
  async (_label, secondPaneOpens) => {
    await withPanes("readd-same-copy", async (panes) => {
      const first = await panes.open();
      let second: DocumentStoreState | null = null;
      panes.server.onList = async () => {
        await commitPulledReadd(panes.execSql, BYTES);
        if (secondPaneOpens) second = await panes.open();
      };
      await removeAndDetach(first);

      expect(panes.server.detached).toEqual([]);
      expect(panes.server.bindings).toEqual([binding(BLOB_ID, BINDING_ID)]);
      expect(await panes.rows()).toMatchObject([
        { blobId: BLOB_ID, storageKey: STORAGE_KEY, detachedAt: null },
      ]);
      expect(first.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(STORAGE_KEY);
      if (second) {
        expect(
          (second as DocumentStoreState).snapshot.attachments,
        ).toMatchObject([{ slotId: SLOT_ID }]);
      }
      await reclaimDocumentOrphanBlobs(panes.runtime);
      expect(await panes.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
    });
  },
);

test("a slot re-added with other bytes keeps its new binding and frees its first download", async () => {
  await withPanes("readd-other-copy", async (panes) => {
    const first = await panes.open();
    panes.server.onList = async () => {
      // Another device replaced the slot's bytes and bound them.
      panes.server.bindings = [binding(OTHER_BLOB_ID, OTHER_BINDING_ID)];
      await commitPulledReadd(panes.execSql, OTHER_BYTES);
      const second = await panes.open();
      // Opening settled the earlier copy: the new one is a first download.
      expect(second.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
      expect(await listPendingDownloads(panes.execSql)).toMatchObject([
        { objectKind: "attachment", slotId: SLOT_ID },
      ]);
      const currentDoc = second.doc;
      if (!currentDoc) throw new Error("Expected a loaded document");
      const [attachment] = getDocumentAttachments(currentDoc);
      if (!attachment) throw new Error("Expected the re-added slot");
      // The verified download of the new bytes.
      await commitHydratedAttachment({
        state: second,
        currentDoc,
        hydratedBlob: {
          attachment,
          binding: { blobId: OTHER_BLOB_ID },
          bytes: OTHER_BYTES,
          contentSha256: attachment.contentSha256,
          storageKey: OTHER_STORAGE_KEY,
        },
        expectedStorageKey: null,
        generationIsCurrent: () => true,
      });
    };
    await removeAndDetach(first);

    expect(panes.server.detached).toEqual([]);
    expect(panes.server.bindings).toEqual([
      binding(OTHER_BLOB_ID, OTHER_BINDING_ID),
    ]);
    const reopened = await panes.open();
    expect(reopened.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(
      OTHER_STORAGE_KEY,
    );
    expect(await panes.rows()).toMatchObject([
      {
        blobId: OTHER_BLOB_ID,
        storageKey: OTHER_STORAGE_KEY,
        detachedAt: null,
      },
    ]);
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(OTHER_STORAGE_KEY)).toEqual(
      OTHER_BYTES,
    );
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toBeNull();
  });
});

test("a slot re-added while its detach is in flight uploads its held bytes again", async () => {
  await withPanes("readd-during-detach", async (panes) => {
    const first = await panes.open();
    panes.server.onDetach = () => commitPulledReadd(panes.execSql, BYTES);
    await removeAndDetach(first);

    // The detach landed, so the re-added slot has no binding until the held
    // bytes upload again.
    expect(panes.server.detached).toHaveLength(1);
    expect(panes.server.bindings).toEqual([]);
    expect(await panes.rows()).toMatchObject([
      { blobId: null, storageKey: STORAGE_KEY, detachedAt: null },
    ]);
    expect(await panes.pendingRows()).toMatchObject([
      { slotId: SLOT_ID, storageKey: STORAGE_KEY, name: "photo.bin" },
    ]);
    expect(first.pendingAttachments).toMatchObject([
      { slotId: SLOT_ID, storageKey: STORAGE_KEY },
    ]);
    await first.writeChain;
    // The live document caught up, so the upload lane sees the slot.
    expect(first.snapshot.attachments).toMatchObject([{ slotId: SLOT_ID }]);
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
  });
});

test("a staged re-add that rolls back leaves the removal to clean up", async () => {
  await withPanes("readd-rolled-back", async (panes) => {
    const first = await panes.open();
    let failCommits = false;
    let refusedCommits = 0;
    const failing: DocumentsPersistence = {
      ...defaultDocumentsPersistence,
      commitDocumentMutation: async (...args) => {
        if (failCommits) {
          refusedCommits += 1;
          throw new Error("disk full");
        }
        return defaultDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    panes.server.onList = async () => {
      const second = await panes.open(failing);
      failCommits = true;
      await replaceAttachmentInDocumentStore(second, () => undefined, SLOT_ID, {
        bytes: OTHER_BYTES,
        mimeType: "application/octet-stream",
        name: "photo.bin",
      });
      // The staged re-add reached its commit, which failed and rolled back.
      expect(refusedCommits).toBe(1);
      expect(second.snapshot.attachments).toEqual([]);
    };
    await removeAndDetach(first);

    expect(panes.server.detached).toHaveLength(1);
    expect(panes.server.bindings).toEqual([]);
    expect(await panes.rows()).toEqual([]);
    expect(await panes.pendingRows()).toEqual([]);
    expect(first.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toBeNull();
  });
});
