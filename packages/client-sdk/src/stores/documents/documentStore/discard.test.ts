import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENTS_APP_KIND } from "../../../data/persistence/documents/internal/constants";
import {
  hasRecordedTerminalSyncFailures,
  listDocumentPendingUpdates,
  recordDocumentSyncFailure,
} from "../../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentsRuntime } from "../types";
import { discardDocumentStoreLocalState } from "./discard";
import { createDocumentStoreState } from "./state";

function createRuntime(
  execSql: ExecSql,
  deletedBlobStorageKeys: string[] = [],
): DocumentsRuntime {
  return {
    infra: {
      blobStore: {
        deleteBytes: async (storageKey: string) => {
          deletedBlobStorageKeys.push(storageKey);
        },
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

async function saveSyncedDocumentRecord(
  execSql: ExecSql,
  localId: string,
  documentId: string | null,
  containerId: string | null,
): Promise<void> {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    id: localId,
    accessEpoch: 3,
    accessStateHash: "state-hash",
    containerId,
    contentKeyBundle: "content-key-bundle",
    documentId,
    documentKind: "note",
    documentKekTargets: "kek-targets",
    documentManifestBundle: "manifest-bundle",
    effectiveAccessLevel: "admin",
    lastCommitLsn: "42",
    loroSnapshot: "synced-snapshot-bytes",
    pendingBaseVersion: "base-version",
    text: "hello",
    title: "Stuck note",
  });
}

function createStoreState(
  execSql: ExecSql,
  localId: string,
  deletedBlobStorageKeys: string[] = [],
) {
  const state = createDocumentStoreState(
    localId,
    createRuntime(execSql, deletedBlobStorageKeys),
    sqlDocumentsPersistence,
    {
      emitPersistedDocument: () => undefined,
      registerDocumentIdentity: () => undefined,
    },
    null,
  );
  state.initialized = true;
  return state;
}

test("discard re-seeds the discovered-share shell and clears the queue", async () => {
  const { close, execSql } = await createTestExecSql("discard-remote");
  const localId = "discard-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", "folder-a");
    // The stuck shape this action exists for: a queued update the server
    // conflicts forever, plus its recorded terminal failure.
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
    const state = createStoreState(execSql, localId);

    expect(await discardDocumentStoreLocalState(state)).toBe(true);

    const shell = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    // The record survives as the freshly-discovered-share shell: identity and
    // placement kept (so priming's documents-row scan still finds it after a
    // restart), content and key bundles cleared (so re-initialization
    // hydrates the server copy instead of trusting discarded local state).
    expect(shell?.documentId).toBe("remote-doc");
    expect(shell?.containerId).toBe("folder-a");
    expect(shell?.title).toBe("Stuck note");
    expect(shell?.loroSnapshot).toBe("");
    expect(shell?.pendingBaseVersion ?? null).toBeNull();
    expect(shell?.contentKeyBundle ?? null).toBeNull();
    expect(shell?.lastCommitLsn ?? null).toBeNull();
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toEqual([]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
    // The store was reset for re-initialization, not marked removed: the
    // caller restarts hydration and the shell re-pulls.
    expect(state.record).toBeNull();
    expect(state.initialized).toBe(false);
  } finally {
    close();
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

    expect(await discardDocumentStoreLocalState(state)).toBe(false);

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.loroSnapshot).toBe("synced-snapshot-bytes");
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
    close();
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
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 5,
      localId,
      mimeType: "text/plain",
      name: "staged.txt",
      slotId: "slot-1",
      storageKey: "staged-storage-key",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "staged-blob",
      byteLength: 5,
      detachedAt: null,
      localId,
      mimeType: "text/plain",
      slotId: "slot-1",
      storageKey: "staged-storage-key",
    });
    // A detach marker from a discarded local removal: left behind, it would
    // filter the slot out of every projection after the re-pull restores it.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "detached-blob",
      byteLength: 7,
      detachedAt: new Date().toISOString(),
      localId,
      mimeType: "image/png",
      slotId: "slot-2",
      storageKey: "detached-storage-key",
    });
    // A live synced-attachment cache stays: hydration reuses it.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "cached-blob",
      byteLength: 9,
      detachedAt: null,
      localId,
      mimeType: "image/jpeg",
      slotId: "slot-3",
      storageKey: "cached-storage-key",
    });
    const deletedBlobStorageKeys: string[] = [];
    const state = createStoreState(execSql, localId, deletedBlobStorageKeys);

    expect(await discardDocumentStoreLocalState(state)).toBe(true);

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
    expect([...deletedBlobStorageKeys].sort()).toEqual([
      "detached-storage-key",
      "staged-storage-key",
    ]);
  } finally {
    close();
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

    expect(await discardDocumentStoreLocalState(state)).toBe(false);

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.loroSnapshot).toBe("synced-snapshot-bytes");
    expect(
      await listDocumentPendingUpdates(execSql, {
        appKind: DOCUMENTS_APP_KIND,
        localId,
      }),
    ).toHaveLength(1);
  } finally {
    close();
  }
});

test("discard refuses a document with no container to anchor the shell", async () => {
  const { close, execSql } = await createTestExecSql("discard-unanchored");
  const localId = "unanchored-doc";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocumentRecord(execSql, localId, "remote-doc", null);
    const state = createStoreState(execSql, localId);

    expect(await discardDocumentStoreLocalState(state)).toBe(false);

    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.loroSnapshot).toBe("synced-snapshot-bytes");
  } finally {
    close();
  }
});
