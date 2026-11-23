import { expect } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import { attachmentContentSha256 } from "../../../src/data/blobs/attachmentContentIdentity";
import { createMemoryBlobStore } from "../../../src/data/blobs/memoryBlobStore";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
} from "../../../src/data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../src/data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../../src/data/persistence/container-contents/documentContainerProjectionPersistence";
import { createDomainScope } from "../../../src/data/shared/domainScope";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
} from "../../../src/data/sqlite/schema";
import { documentProjection } from "../../../src/data/sqlite/schema/documentProjectionSchema";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../src/data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../src/data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../src/data/sqlite/sqlTableSchema";
import { noopDocumentStorePersistenceEffects } from "../../../src/stores/documents/documentStore/documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../../../src/stores/documents/documentStore/initialization";
import {
  createDocumentStoreState,
  type DocumentStoreState,
} from "../../../src/stores/documents/documentStore/state";
import { syncDetachedAttachmentBindings } from "../../../src/stores/documents/documentStore/sync/syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "../../../src/stores/documents/documentStore/sync/syncGeneration";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
} from "../../../src/workflows/documents";
import { createPrincipalPolicyOperation } from "../../../src/workflows/principals/principalPolicyService";
import { createMaterializedSyncFixture } from "../workflows/materializedSyncFixture";
import { liveDocumentView } from "./syncedDocumentView";

const ORGANIZATION_ID = "org-removed-slot";
const REMOTE_ID = "550e8400-e29b-41d4-a716-446655440110";
const BYTES = new Uint8Array([1, 2, 3]);

/** The binding the server lists for `slotId`, with ids derived from it. */
export function bindingFor(slotId: string): BlobAttachmentSummary {
  return {
    bindingId: `binding-${slotId}`,
    blobId: `blob-${slotId}`,
    slotId,
  } as BlobAttachmentSummary;
}

/**
 * A synced document recording `slotIds`, holding the bytes of `heldSlotIds`
 * (each bound to `bindingFor(slotId).blobId`) and nothing for the rest.
 */
async function seedDocument(
  execSql: ExecSql,
  blobStore: ReturnType<typeof createMemoryBlobStore>,
  slotIds: readonly string[],
  heldSlotIds: readonly string[],
  accessLevel: "admin" | "read",
) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const localId = "doc-a";
  const contentSha256 = await attachmentContentSha256(BYTES);
  const doc = await createDocument(localId);
  ensureDocumentAttachmentStructure(doc);
  addDocumentAttachments(
    doc,
    slotIds.map((slotId) => ({
      byteLength: BYTES.length,
      contentSha256,
      mimeType: "image/png",
      name: `${slotId}.png`,
      slotId,
    })),
  );
  const endVersionVector = encodeVersionVector(doc);
  const updatedAt = new Date().toISOString();
  await db.insert(documents).values({
    accessEpoch: 1,
    appKind: "documents",
    documentId: REMOTE_ID,
    effectiveAccessLevel: accessLevel,
    localId,
    snapshotEndVersion: endVersionVector,
    updatedAt,
  });
  await db.insert(documentHistoryCheckpoints).values({
    appKind: "documents",
    endVersionVector,
    localId,
    revision: localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
    updatedAt,
  });
  await db.insert(documentProjection).values({
    containerId: null,
    documentId: REMOTE_ID,
    localId,
    organizationId: ORGANIZATION_ID,
    updatedAt,
  });
  for (const slotId of heldSlotIds) {
    const storageKey = `held-${slotId}`;
    await blobStore.writeBytes(storageKey, BYTES);
    await db.insert(documentAttachmentBlobProjection).values({
      blobId: bindingFor(slotId).blobId,
      byteLength: BYTES.length,
      contentSha256,
      detachedAt: null,
      localId,
      mimeType: "image/png",
      slotId,
      storageKey,
      updatedAt,
    });
  }
}

export interface RemovedSlotDetachHarness {
  /** Bindings the server lists, by slot; a landed detach removes one. */
  readonly bound: Map<string, BlobAttachmentSummary>;
  readonly detachRequests: BlobAttachmentDetachRequest[];
  /** How many times a pass listed the document's bindings. */
  listings: number;
  /** Bindings whose detach the API refuses for a newer document. */
  readonly refused: Set<string>;
  open(
    slotIds: readonly string[],
    heldSlotIds?: readonly string[],
    accessLevel?: "admin" | "read",
  ): Promise<DocumentStoreState>;
  /** A fresh store over the opened document, as after a restart. */
  reopen(): Promise<DocumentStoreState>;
}

/** A store over a document whose remote bindings `run` controls. */
export async function withRemovedSlotDetachHarness(
  run: (harness: RemovedSlotDetachHarness) => Promise<void>,
) {
  const { close, execSql } = await createTestExecSql("removed-slot-detach");
  const fixture = await createMaterializedSyncFixture({
    documentId: REMOTE_ID,
    organizationId: ORGANIZATION_ID,
  });
  const blobStore = createMemoryBlobStore();
  let failure: object | null = null;
  const openStore = async () => {
    const store = createDocumentStoreState(
      "doc-a",
      runtime,
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    expect(await ensureDocumentStoreReady(store, () => undefined)).toBe(true);
    store.resolveProjectionUserKey = fixture.resolveProjectionUserKey;
    return store;
  };
  const harness: RemovedSlotDetachHarness = {
    bound: new Map(),
    detachRequests: [],
    listings: 0,
    open: async (slotIds, heldSlotIds = [], accessLevel = "admin") => {
      await seedDocument(execSql, blobStore, slotIds, heldSlotIds, accessLevel);
      return openStore();
    },
    refused: new Set(),
    reopen: openStore,
  };
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {
      detachBlobAttachment: async (
        blobId: string,
        bindingId: string,
        request: BlobAttachmentDetachRequest,
      ) => {
        harness.detachRequests.push(request);
        if (harness.refused.has(bindingId)) {
          // The client records each failure as a new object.
          failure = {
            code: "attachment_document_changed",
            kind: "http",
            message: "Document changed",
            status: 409,
          };
          return null;
        }
        const slotId = [...harness.bound.values()].find(
          (binding) => binding.bindingId === bindingId,
        )?.slotId;
        if (slotId) harness.bound.delete(slotId);
        return { blobId, bindingId, documentId: REMOTE_ID, slotId };
      },
      getDocumentWriterProjection: async () => fixture.writerProjection,
      getRequestFailure: () => failure,
      listDocumentAttachments: async () => {
        harness.listings += 1;
        return [...harness.bound.values()];
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
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await run(harness);
  } finally {
    close();
  }
}

/** One detach pass at the live document's version, as a synced pass runs. */
export async function runDetachPass(state: DocumentStoreState) {
  const generation = captureDocumentStoreSyncGeneration(state, state.doc);
  if (!generation || !state.record) throw new Error("Expected sync state");
  await syncDetachedAttachmentBindings(
    state,
    state.record,
    generation,
    createPrincipalPolicyOperation(),
    liveDocumentView(state.doc),
  );
}
