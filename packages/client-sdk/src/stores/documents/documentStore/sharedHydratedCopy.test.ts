import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import type { DocumentsRuntime } from "../types";
import { discardDocumentStoreLocalState } from "./discard";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

// Hydration stores a blob's bytes under `blob-${blobId}` for every slot that
// holds it, so one copy can back slots in several documents (#2365, #18).
const SHARED_STORAGE_KEY = "blob-shared";

function createRuntime(execSql: ExecSql, deleted: string[]): DocumentsRuntime {
  return {
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {
        deleteBytes: async (storageKey: string) => {
          deleted.push(storageKey);
        },
        openByteSource: async () => null,
      },
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
}

async function saveDocument(
  execSql: ExecSql,
  localId: string,
  documentId: string | null,
): Promise<void> {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    id: localId,
    accessEpoch: 1,
    accessStateHash: "state-hash",
    containerId: "folder-a",
    contentKeyBundle: "content-key-bundle",
    documentId,
    documentKind: "note",
    documentKekTargets: "kek-targets",
    documentManifestBundle: "manifest-bundle",
    effectiveAccessLevel: "admin",
    snapshotEndVersion: "synced-end-version",
    text: "hello",
    title: localId,
  });
}

async function holdSharedCopy(
  execSql: ExecSql,
  localId: string,
  detachedAt: string | null,
): Promise<void> {
  await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
    blobId: "shared",
    byteLength: 5,
    contentSha256: "0".repeat(64),
    detachedAt,
    localId,
    mimeType: "text/plain",
    slotId: "slot-1",
    storageKey: SHARED_STORAGE_KEY,
  });
}

test("detaching one slot keeps a hydrated copy another document holds", async () => {
  const { close, execSql } = await createTestExecSql("shared-copy-detach");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveDocument(execSql, "doc-a", null);
    await holdSharedCopy(execSql, "doc-a", null);
    await holdSharedCopy(execSql, "doc-b", null);
    const deleted: string[] = [];
    const state = createDocumentStoreState(
      "doc-a",
      createRuntime(execSql, deleted),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    const record = await sqlDocumentsPersistence.loadDocument(execSql, "doc-a");
    if (!record) throw new Error("Expected the saved document");
    // The document dropped slot-1, so its local copy is a detach marker.
    const doc = await createDocument("shared-copy-detach");
    ensureDocumentAttachmentStructure(doc);
    state.initialized = true;
    state.doc = doc;
    state.record = record;
    state.attachmentStorageKeyBySlotId = { "slot-1": SHARED_STORAGE_KEY };
    const generation = captureDocumentStoreSyncGeneration(state, doc);
    if (!generation) throw new Error("Expected a sync generation");

    await syncDetachedAttachmentBindings(state, record, generation);
    await reclaimDocumentOrphanBlobs(state.runtime);

    expect(
      await sqlDocumentsPersistence.listLocalAttachments(execSql, "doc-a"),
    ).toEqual([]);
    expect(deleted).toEqual([]);
    // Once no slot holds the copy, the reclaim deletes it.
    await sqlDocumentsPersistence.deleteLocalAttachment(
      execSql,
      "doc-b",
      "slot-1",
      SHARED_STORAGE_KEY,
    );
    await reclaimDocumentOrphanBlobs(state.runtime);
    expect(deleted).toEqual([SHARED_STORAGE_KEY]);
  } finally {
    close();
  }
});

test("discarding one document keeps a hydrated copy another document holds", async () => {
  const { close, execSql } = await createTestExecSql("shared-copy-discard");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveDocument(execSql, "doc-a", "remote-doc-a");
    // doc-a's copy is a detach marker the discard drops; doc-b still shows it.
    await holdSharedCopy(execSql, "doc-a", new Date().toISOString());
    await holdSharedCopy(execSql, "doc-b", null);
    const deleted: string[] = [];
    const state = createDocumentStoreState(
      "doc-a",
      createRuntime(execSql, deleted),
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    state.initialized = true;

    expect(await discardDocumentStoreLocalState(state, "remote-doc-a")).toBe(
      true,
    );
    await reclaimDocumentOrphanBlobs(state.runtime);
    expect(deleted).toEqual([]);
    expect(
      (
        await sqlDocumentsPersistence.listLocalAttachments(execSql, "doc-b")
      ).map((attachment) => attachment.storageKey),
    ).toEqual([SHARED_STORAGE_KEY]);
    await sqlDocumentsPersistence.deleteLocalAttachment(
      execSql,
      "doc-b",
      "slot-1",
      SHARED_STORAGE_KEY,
    );
    await reclaimDocumentOrphanBlobs(state.runtime);
    expect(deleted).toEqual([SHARED_STORAGE_KEY]);
  } finally {
    close();
  }
});
