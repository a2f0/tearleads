import { expect } from "bun:test";
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
import { attachmentContentSha256 } from "../../../src/data/blobs/attachmentContentIdentity";
import { createMemoryBlobStore } from "../../../src/data/blobs/memoryBlobStore";
import {
  addDocumentAttachments,
  type DocumentAttachment,
} from "../../../src/data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../src/data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../../src/data/persistence/container-contents/documentContainerProjectionPersistence";
import { createDomainScope } from "../../../src/data/shared/domainScope";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../src/data/sqlite/schema";
import { documentProjection } from "../../../src/data/sqlite/schema/documentProjectionSchema";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../src/data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../src/data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../src/data/sqlite/sqlTableSchema";
import { removeAttachmentFromDocumentStore } from "../../../src/stores/documents/documentStore/attachments/attachmentRemoval";
import { noopDocumentStorePersistenceEffects } from "../../../src/stores/documents/documentStore/documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../../../src/stores/documents/documentStore/initialization";
import {
  createDocumentStoreState,
  type DocumentStoreState,
} from "../../../src/stores/documents/documentStore/state";
import { syncDetachedAttachmentBindings } from "../../../src/stores/documents/documentStore/sync/syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "../../../src/stores/documents/documentStore/sync/syncGeneration";
import type { DocumentsRuntime } from "../../../src/stores/documents/types";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsPersistence,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  loadPersistedDocumentContent,
  persistDocumentState,
  reclaimDocumentOrphanBlobs,
} from "../../../src/workflows/documents";
import { createPrincipalPolicyOperation } from "../../../src/workflows/principals/principalPolicyService";
import { createMaterializedSyncFixture } from "../workflows/materializedSyncFixture";

export const LOCAL_ID = "doc-readd";
export const SLOT_ID = "photo";
export const BYTES = new Uint8Array([1, 2, 3]);
export const OTHER_BYTES = new Uint8Array([4, 5, 6, 7]);
const ORGANIZATION_ID = "org-readd";
const REMOTE_ID = "550e8400-e29b-41d4-a716-446655440010";
export const BLOB_ID = "550e8400-e29b-41d4-a716-446655440657";
export const BINDING_ID = "550e8400-e29b-41d4-a716-446655440656";
export const OTHER_BLOB_ID = "550e8400-e29b-41d4-a716-446655440658";
export const OTHER_BINDING_ID = "550e8400-e29b-41d4-a716-446655440659";
// A hydrated copy is keyed by its blob, so holding that blob again reuses it.
export const STORAGE_KEY = `blob-${BLOB_ID}`;
export const OTHER_STORAGE_KEY = `blob-${OTHER_BLOB_ID}`;

export function binding(
  blobId: string,
  bindingId: string,
): BlobAttachmentSummary {
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
export async function commitPulledReadd(
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

export interface Panes {
  blobStore: ReturnType<typeof createMemoryBlobStore>;
  execSql: ExecSql;
  open: (persistence?: DocumentsPersistence) => Promise<DocumentStoreState>;
  rows: () => Promise<unknown[]>;
  pendingRows: () => Promise<unknown[]>;
  runtime: DocumentsRuntime;
  /** Rewrite the held row, e.g. as a replace or an earlier session left it. */
  setRow: (patch: {
    blobId?: string | null;
    detachedAt?: string | null;
  }) => Promise<void>;
  server: Server;
}

/** The server: a mutable binding list and the signed detaches it accepted. */
function createServerApi(
  server: Server,
  writerProjection: unknown,
): DocumentsWorkflowRuntimeInput["apiClient"] {
  return {
    listDocumentAttachments: async () => {
      const hook = server.onList;
      server.onList = null;
      await hook?.();
      return [...server.bindings];
    },
    getDocumentWriterProjection: async () => writerProjection,
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
  } as unknown as DocumentsWorkflowRuntimeInput["apiClient"];
}

export async function withPanes(
  name: string,
  run: (panes: Panes) => Promise<void>,
) {
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
    apiClient: createServerApi(server, fixture.writerProjection),
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
      setRow: async (patch) => {
        await db.update(documentAttachmentBlobProjection).set(patch).run();
      },
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
export async function removeAndDetach(pane: DocumentStoreState): Promise<void> {
  await removeAttachmentFromDocumentStore(pane, () => undefined, SLOT_ID);
  await runDetachPass(pane);
}

export async function runDetachPass(pane: DocumentStoreState): Promise<void> {
  const generation = captureDocumentStoreSyncGeneration(pane, pane.doc);
  if (!generation || !pane.record) throw new Error("Expected sync state");
  await syncDetachedAttachmentBindings(
    pane,
    pane.record,
    generation,
    createPrincipalPolicyOperation(),
  );
}
