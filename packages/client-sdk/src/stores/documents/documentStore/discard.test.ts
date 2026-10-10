import { expect, test } from "bun:test";
import {
  createStoreState,
  createDiscardTestExecSql as createTestExecSql,
  type RecordedProjectionDelete,
  saveSyncedDocumentRecord,
} from "../../../../test/helpers/documentDiscard";
import { sqlDocumentMoveIntentPersistence } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../../data/persistence/documents/internal/constants";
import {
  hasRecordedTerminalSyncFailures,
  listDocumentPendingUpdates,
  recordDocumentSyncFailure,
} from "../../../data/sqlite/documentPersistence";
import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import {
  deletePendingAttachment,
  saveLocalAttachmentRecords,
  savePendingAttachmentUpload,
} from "./attachmentPersistence";
import { discardDocumentStoreLocalState } from "./discard";
import { enqueuePendingUpdate } from "./persistence";
import type { DocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

test("discard re-seeds the discovered-share shell and clears the queue", async () => {
  const { close, execSql } = await createTestExecSql("discard-remote");
  const localId = "discard-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    // Reproduce a queued update the server conflicts forever plus its failure.
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "poisoned-bytes",
    });
    await recordDocumentSyncFailure(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId },
      {
        attemptedAt: new Date().toISOString(),
        message: "Update conflict recovery gave up after 5 re-key attempts",
        status: null,
      },
    );
    const projectionDeletes: RecordedProjectionDelete[] = [];
    const state = createStoreState(execSql, localId, [], projectionDeletes);

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      true,
    );

    // Clear the document-kind projection through the caller's registry.
    expect(projectionDeletes).toEqual([{ documentKind: "note", localId }]);
    // The shell retains identity but clears local content for rehydration.
    const shell = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(shell?.documentId).toBe("remote-doc");
    expect(shell?.containerId).toBe("folder-a");
    expect(shell?.title).toBe("Stuck note");
    expect(shell?.recoveryGeneration).toBe(1);
    expect(shell?.snapshotEndVersion).toBe("");
    expect(shell?.pendingBaseVersion ?? null).toBeNull();
    expect(shell?.contentKeyBundle ?? null).toBeNull();
    expect(shell?.lastCommitLsn ?? null).toBeNull();
    expect(shell?.pullContinuation).toBeUndefined();
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toEqual([]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
    // Reset for re-initialization so the shell re-pulls.
    expect(state.record).toBeNull();
    expect(state.initialized).toBe(false);
  } finally {
    await close();
  }
});

test("discard refuses a local-only document whose queue is its only copy", async () => {
  const { close, execSql } = await createTestExecSql("discard-local-only");
  const localId = "local-only-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, null, "folder-a");
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "only-copy-bytes",
    });
    const state = createStoreState(execSql, localId);

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      false,
    );

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.snapshotEndVersion).toBe("synced-end-version");
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toHaveLength(1);
    // Refusal leaves the store untouched — the queued write is still the only
    // copy of the edit, and the store keeps persisting it.
    expect(state.initialized).toBe(true);
  } finally {
    await close();
  }
});

test("discard keeps server links and reclaims staged upload bytes", async () => {
  const { close, execSql } = await createTestExecSql("discard-links-blobs");
  const localId = "linked-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    // Linked into a second container: the content re-pull does not rebuild
    // links, so the discard must carry them across the teardown itself.
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      "remote-doc",
      ["folder-a", "folder-b"],
    );
    // A staged upload whose row is the only durable pointer to its bytes —
    // including the settled local-attachment half a crash can leave behind,
    // which shares the staged storage key and would otherwise survive as a
    // mapping to the reclaimed bytes.
    const staged = {
      contentSha256: "0".repeat(64),
      byteLength: 5,
      localId,
      mimeType: "text/plain",
      name: "staged.txt",
      slotId: "slot-1",
      storageKey: "staged-storage-key",
    };
    await sqlDocumentsPersistence.savePendingAttachment(execSql, staged);
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      ...staged,
      blobId: "staged-blob",
      detachedAt: null,
    });
    // A detach marker from a discarded local removal: left behind, it would
    // filter the slot out of every projection after the re-pull restores it.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      ...staged,
      blobId: "detached-blob",
      byteLength: 7,
      detachedAt: new Date().toISOString(),
      mimeType: "image/png",
      slotId: "slot-2",
      storageKey: "detached-storage-key",
    });
    // A live synced-attachment cache stays: hydration reuses it.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      ...staged,
      blobId: "cached-blob",
      byteLength: 9,
      detachedAt: null,
      mimeType: "image/jpeg",
      slotId: "slot-3",
      storageKey: "cached-storage-key",
    });
    const deletedBlobStorageKeys: string[] = [];
    const state = createStoreState(execSql, localId, deletedBlobStorageKeys);

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      true,
    );

    expect(
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "remote-doc",
      ),
    ).toEqual(["folder-a", "folder-b"]);
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, localId),
    ).toEqual([]);
    const remainingLocalAttachments =
      await sqlDocumentsPersistence.listLocalAttachments(execSql, localId);
    expect(
      remainingLocalAttachments.map((attachment) => attachment.slotId),
    ).toEqual(["slot-3"]);
    await reclaimDocumentOrphanBlobs(state.runtime);
    expect([...deletedBlobStorageKeys].sort()).toEqual([
      "detached-storage-key",
      "staged-storage-key",
    ]);
  } finally {
    await close();
  }
});

test("discard refuses a document with a queued move intent", async () => {
  const { close, execSql } = await createTestExecSql("discard-move-pending");
  const localId = "moving-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      updateData: "queued-bytes",
    });
    // The local containerId is now the move's optimistic placement, not
    // server truth — reseeding it would silently commit the move locally
    // while discarding the intent that was meant to perform it.
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "remote-doc",
      localId,
      sourceContainerId: "folder-server",
      targetContainerId: "folder-a",
    });
    const state = createStoreState(execSql, localId);

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      false,
    );

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.snapshotEndVersion).toBe("synced-end-version");
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toHaveLength(1);
  } finally {
    await close();
  }
});

test("a failing byte store cannot fail the discard once rows committed", async () => {
  const { close, execSql } = await createTestExecSql("discard-blob-fail");
  const localId = "blob-fail-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      contentSha256: "0".repeat(64),
      byteLength: 5,
      localId,
      mimeType: "text/plain",
      name: "staged.txt",
      slotId: "slot-1",
      storageKey: "staged-storage-key",
    });
    const state = createStoreState(execSql, localId);
    (
      state.runtime.infra.blobStore as {
        deleteBytes: (storageKey: string) => Promise<void>;
      }
    ).deleteBytes = async () => {
      throw new Error("byte store unavailable");
    };

    // A rejecting byte store must not turn a committed discard into a
    // reported failure; the key stays queued for a later reclaim.
    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      true,
    );
    expect(
      await execSql("SELECT storage_key FROM document_orphan_blob_reclaims"),
    ).toEqual([{ storage_key: "staged-storage-key" }]);
    const shell = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(shell?.snapshotEndVersion).toBe("");
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, localId),
    ).toEqual([]);
  } finally {
    await close();
  }
});

test("discard refuses when the persisted identity is not the expected one", async () => {
  const { close, execSql } = await createTestExecSql("discard-identity");
  const localId = "relinked-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    const state = createStoreState(execSql, localId);

    // A stale caller (or a relink that raced the request) must never discard
    // a different identity's edits.
    expect(
      await discardDocumentStoreLocalState(state, "some-other-remote-doc"),
    ).toBe(false);

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.snapshotEndVersion).toBe("synced-end-version");
    expect(state.initialized).toBe(true);
  } finally {
    await close();
  }
});

test("stale writers cannot resurrect rows after a discard", async () => {
  const { close, execSql } = await createTestExecSql("discard-races");
  const localId = "raced-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    const state = createStoreState(execSql, localId);
    // A live doc makes the pre-discard generation observable; the discard
    // drops it, which is exactly what stales the captured generation.
    state.doc = {} as DocumentStoreState["doc"];
    const staleGeneration = captureDocumentStoreSyncGeneration(
      state,
      state.doc,
    );
    if (!staleGeneration) throw new Error("Expected a live generation");

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      true,
    );

    // Writers that captured their generation before the discard land after
    // it. Each validates INSIDE its serialized mutation and skips, so the
    // rows the teardown removed stay removed — this is the in-flight edit /
    // attachment settlement / initialization-recovery resurrection class.
    await enqueuePendingUpdate(
      state,
      new Uint8Array([1, 2, 3]),
      undefined,
      staleGeneration,
    );
    await savePendingAttachmentUpload(
      state,
      {
        contentSha256: "0".repeat(64),
        byteLength: 3,
        localId,
        mimeType: null,
        name: "late.bin",
        slotId: "slot-late",
        storageKey: "late-storage-key",
      },
      staleGeneration,
    );
    await saveLocalAttachmentRecords(
      state,
      [
        {
          blobId: "late-blob",
          byteLength: 3,
          contentSha256: "0".repeat(64),
          detachedAt: null,
          localId,
          mimeType: null,
          slotId: "slot-late",
          storageKey: "late-storage-key",
        },
      ],
      null,
      staleGeneration,
    );
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, localId),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(execSql, localId),
    ).toEqual([]);

    // Control: the gates discriminate rather than block — a generation
    // captured from the CURRENT (post-reset) store still writes.
    const currentGeneration = captureDocumentStoreSyncGeneration(
      state,
      state.doc,
    );
    if (!currentGeneration) throw new Error("Expected a live generation");
    await saveLocalAttachmentRecords(
      state,
      [
        {
          blobId: "current-blob",
          byteLength: 3,
          contentSha256: "0".repeat(64),
          detachedAt: null,
          localId,
          mimeType: null,
          slotId: "slot-current",
          storageKey: "current-storage-key",
        },
      ],
      null,
      currentGeneration,
    );
    expect(
      (
        await sqlDocumentsPersistence.listLocalAttachments(execSql, localId)
      ).map((attachment) => attachment.slotId),
    ).toEqual(["slot-current"]);

    // The refused-discard direction: rows the refusal preserved must survive
    // a stale delete racing the reset.
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      contentSha256: "0".repeat(64),
      byteLength: 4,
      localId,
      mimeType: null,
      name: "kept.bin",
      slotId: "slot-kept",
      storageKey: "kept-storage-key",
    });
    await deletePendingAttachment(
      state,
      "slot-kept",
      "kept-storage-key",
      staleGeneration,
    );
    expect(
      (
        await sqlDocumentsPersistence.listPendingAttachments(execSql, localId)
      ).map((attachment) => attachment.slotId),
    ).toEqual(["slot-kept"]);
    await deletePendingAttachment(
      state,
      "slot-kept",
      "kept-storage-key",
      currentGeneration,
    );
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, localId),
    ).toEqual([]);
  } finally {
    await close();
  }
});

test("discard refuses a document with no container to anchor the shell", async () => {
  const { close, execSql } = await createTestExecSql("discard-unanchored");
  const localId = "unanchored-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", null);
    const state = createStoreState(execSql, localId);

    expect(await discardDocumentStoreLocalState(state, "remote-doc")).toBe(
      false,
    );

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.snapshotEndVersion).toBe("synced-end-version");
  } finally {
    await close();
  }
});
