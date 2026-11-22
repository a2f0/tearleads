import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import { liveDocumentView } from "../../../../../test/helpers/stores/syncedDocumentView";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
} from "../../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { createDomainScope } from "../../../../data/shared/domainScope";
import { clientSqlTables } from "../../../../data/sqlite/schema";
import { documentProjection } from "../../../../data/sqlite/schema/documentProjectionSchema";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../../data/sqlite/sqlTableSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
} from "../../../../workflows/documents";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const SLOT_ID = "contact-photos:portrait";
const ORGANIZATION_ID = "org-removed-slot";
const REMOTE_ID = "550e8400-e29b-41d4-a716-446655440110";
const IMPORTED: BlobAttachmentSummary = {
  bindingId: "550e8400-e29b-41d4-a716-446655440156",
  blobId: "550e8400-e29b-41d4-a716-446655440157",
  slotId: SLOT_ID,
} as BlobAttachmentSummary;

/** A synced document whose content records `slotIds`, with no bytes held. */
async function seedDocument(
  execSql: ExecSql,
  localId: string,
  slotIds: readonly string[],
) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const doc = await createDocument(localId);
  ensureDocumentAttachmentStructure(doc);
  addDocumentAttachments(
    doc,
    slotIds.map((slotId) => ({
      byteLength: 3,
      contentSha256: "a".repeat(64),
      mimeType: "image/png",
      name: "avatar.png",
      slotId,
    })),
  );
  const endVersionVector = encodeVersionVector(doc);
  const updatedAt = new Date().toISOString();
  await db.insert(documents).values({
    accessEpoch: 1,
    appKind: "documents",
    documentId: REMOTE_ID,
    effectiveAccessLevel: "admin",
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
}

interface Harness {
  readonly detachRequests: BlobAttachmentDetachRequest[];
  /** Whether the API refuses each detach for a newer document. */
  refuse: boolean;
  open(slotIds: readonly string[]): Promise<DocumentStoreState>;
}

async function withHarness(run: (harness: Harness) => Promise<void>) {
  const { close, execSql } = await createTestExecSql("removed-slot-detach");
  const fixture = await createMaterializedSyncFixture({
    documentId: REMOTE_ID,
    organizationId: ORGANIZATION_ID,
  });
  let bound = true;
  let failure: object | null = null;
  const harness: Harness = {
    detachRequests: [],
    open: async (slotIds) => {
      await seedDocument(execSql, "doc-a", slotIds);
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
    },
    refuse: false,
  };
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {
      detachBlobAttachment: async (
        blobId: string,
        bindingId: string,
        request: BlobAttachmentDetachRequest,
      ) => {
        harness.detachRequests.push(request);
        if (harness.refuse) {
          // The client records each failure as a new object.
          failure = {
            code: "attachment_document_changed",
            kind: "http",
            message: "Document changed",
            status: 409,
          };
          return null;
        }
        bound = false;
        return { blobId, bindingId, documentId: REMOTE_ID, slotId: SLOT_ID };
      },
      getDocumentWriterProjection: async () => fixture.writerProjection,
      getRequestFailure: () => failure,
      listDocumentAttachments: async () => (bound ? [IMPORTED] : []),
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
      blobStore: createMemoryBlobStore(),
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

async function runDetachPass(state: DocumentStoreState) {
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

test("a store that saw a slot recorded detaches the binding its removal left", async () => {
  await withHarness(async (harness) => {
    const state = await harness.open([SLOT_ID]);
    expect(state.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
    // Removed before the importer's binding arrived: no bytes, no marker.
    await removeAttachmentFromDocumentStore(state, () => undefined, SLOT_ID);
    const view = liveDocumentView(state.doc);
    expect(view.slotIds.has(SLOT_ID)).toBe(false);

    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.detachRequests[0]).toMatchObject({
      body: { bindingId: IMPORTED.bindingId, slotId: SLOT_ID },
      documentVersionVector: view.versionVector,
    });

    // Settled: a later pass lists nothing for the slot and sends nothing.
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
  });
}, 20_000);

test("a store that never saw the slot recorded leaves its binding", async () => {
  await withHarness(async (harness) => {
    // This client never parsed the slot, e.g. one a newer client records.
    const state = await harness.open([]);
    await runDetachPass(state);
    expect(harness.detachRequests).toEqual([]);
  });
}, 20_000);

test("a refused detach waits for a newer version and asks for a pull", async () => {
  await withHarness(async (harness) => {
    const state = await harness.open([SLOT_ID]);
    await removeAttachmentFromDocumentStore(state, () => undefined, SLOT_ID);
    harness.refuse = true;
    const signal = state.remoteUpdateSignalSeq;

    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
    expect(state.remoteUpdateSignalSeq).toBe(signal + 1);

    // The pull brought nothing: the same view sends no second detach.
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);

    // A newer version, still without the slot, is tried once more.
    state.doc?.getText("refused-detach-edit").insert(0, "edit");
    state.doc?.commit();
    harness.refuse = false;
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(2);
    expect(harness.detachRequests[1]?.documentVersionVector).toBe(
      liveDocumentView(state.doc).versionVector,
    );
  });
}, 20_000);
