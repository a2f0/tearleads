import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { addDocumentAttachments } from "../../data/documents/documentContent";
import { documentOrphanBlobReclaims } from "../../data/sqlite/documentOrphanBlobReclaims";
import {
  clientSqlTables,
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentPendingAttachments,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const STALE = "2026-05-01T00:00:00.000Z";

// A document whose durable history checkpoint advertises exactly `slotIds`.
// Export before encoding so the pending ops commit into the oplog version.
async function createSnapshot(slotIds: ReadonlyArray<string>) {
  const doc = await createDocument("remote-reset-detached-test-doc");
  addDocumentAttachments(
    doc,
    slotIds.map((slotId) => ({
      byteLength: 12,
      mimeType: "image/png",
      name: `${slotId}.png`,
      slotId,
    })),
  );
  const snapshot = bytesToBase64(exportFullHistorySnapshot(doc));
  return { endVersionVector: encodeVersionVector(doc), snapshot };
}

function localAttachment(slotId: string, detachedAt: string | null) {
  return {
    localId: "doc-1",
    slotId,
    blobId: `blob-${slotId}`,
    storageKey: `local/${slotId}`,
    mimeType: "image/png",
    byteLength: 12,
    updatedAt: STALE,
    detachedAt,
  };
}

async function seedResetFixture(
  execSql: Parameters<typeof clearRemoteSyncState>[0],
  input: {
    attachments: ReadonlyArray<ReturnType<typeof localAttachment>>;
    snapshotSlotIds: ReadonlyArray<string>;
  },
) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const { endVersionVector, snapshot } = await createSnapshot(
    input.snapshotSlotIds,
  );
  await db.insert(documents).values({
    appKind: "documents",
    localId: "doc-1",
    documentId: "doc-remote-old",
    snapshotEndVersion: endVersionVector,
    accessEpoch: 1,
    accessStateHash: "old-access-state",
    lastCommitLsn: "1",
    documentManifestBundle: "{}",
    contentKeyBundle: "{}",
    documentKekTargets: "{}",
    updatedAt: STALE,
  });
  await db.insert(documentHistoryCheckpoints).values({
    appKind: "documents",
    localId: "doc-1",
    snapshot,
    endVersionVector,
    revision: "revision-doc-1",
    updatedAt: STALE,
  });
  await db.insert(documentProjection).values({
    localId: "doc-1",
    documentId: "doc-remote-old",
    containerId: null,
    organizationId: "org-old",
    updatedAt: STALE,
  });
  if (input.attachments.length > 0) {
    await db
      .insert(documentAttachmentBlobProjection)
      .values([...input.attachments]);
  }
  return db;
}

test("clearRemoteSyncState leaves an unlinked slot out of the requeue", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-detached-requeue-test",
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const db = await seedResetFixture(execSql, {
      attachments: [
        localAttachment("slot-live", null),
        localAttachment("slot-unlinked", STALE),
      ],
      snapshotSlotIds: ["slot-live"],
    });

    await clearRemoteSyncState(execSql, { organizationId: "org-old" });

    const pendingRows = await db
      .select({ slotId: documentPendingAttachments.slotId })
      .from(documentPendingAttachments);
    expect(pendingRows.map((row) => row.slotId)).toEqual(["slot-live"]);

    // The unlinked slot's row outlives the reset because it still owns that
    // slot's local bytes; the document lane's detach cleanup deletes both.
    const projectionRows = await db
      .select({ slotId: documentAttachmentBlobProjection.slotId })
      .from(documentAttachmentBlobProjection);
    expect(projectionRows.map((row) => row.slotId)).toEqual(["slot-unlinked"]);
  } finally {
    close();
  }
});

test("clearRemoteSyncState requeues a slot the snapshot still advertises", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-detached-interrupted-test",
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    // An unlink interrupted between marking the row and persisting the
    // document: the marker is set, but the durable snapshot the reset is about
    // to republish still advertises the slot. Trusting the marker here would
    // publish a document advertising an attachment with no blob to bind.
    const db = await seedResetFixture(execSql, {
      attachments: [localAttachment("slot-interrupted", STALE)],
      snapshotSlotIds: ["slot-interrupted"],
    });

    await clearRemoteSyncState(execSql, { organizationId: "org-old" });

    const pendingRows = await db
      .select({
        name: documentPendingAttachments.name,
        slotId: documentPendingAttachments.slotId,
      })
      .from(documentPendingAttachments);
    expect(pendingRows).toEqual([
      { name: "slot-interrupted.png", slotId: "slot-interrupted" },
    ]);

    const projectionRows = await db
      .select({ slotId: documentAttachmentBlobProjection.slotId })
      .from(documentAttachmentBlobProjection);
    expect(projectionRows).toEqual([]);
  } finally {
    close();
  }
});

test("clearRemoteSyncState preserves a pending-only attachment upload", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-pending-only-attachment-test",
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const db = await seedResetFixture(execSql, {
      attachments: [],
      snapshotSlotIds: ["slot-pending"],
    });
    await db.insert(documentPendingAttachments).values({
      byteLength: 12,
      createdAt: STALE,
      localId: "doc-1",
      mimeType: "image/png",
      name: "slot-pending.png",
      slotId: "slot-pending",
      storageKey: "local/pending-only",
      uploadBlobId: "old-remote-blob",
      uploadContentKey: "old-content-key",
      uploadContentKeyEpoch: 3,
      uploadIv: "old-iv",
      uploadPartSize: 5,
      uploadPlaintextSha256: "old-plaintext-hash",
      uploadStageId: "old-remote-stage",
    });

    const result = await clearRemoteSyncState(execSql, {
      organizationId: "org-old",
    });

    expect(result.queuedAttachmentUploadCount).toBe(1);
    expect(await db.select().from(documentPendingAttachments)).toEqual([
      expect.objectContaining({
        localId: "doc-1",
        name: "slot-pending.png",
        slotId: "slot-pending",
        storageKey: "local/pending-only",
        uploadBlobId: null,
        uploadContentKey: null,
        uploadContentKeyEpoch: null,
        uploadIv: null,
        uploadPartSize: null,
        uploadPlaintextSha256: null,
        uploadStageId: null,
      }),
    ]);
    expect(await db.select().from(documentOrphanBlobReclaims)).toEqual([]);
  } finally {
    close();
  }
});

test("clearRemoteSyncState queues dropped pending-only bytes for reclaim", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-dropped-pending-attachment-test",
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const db = await seedResetFixture(execSql, {
      attachments: [],
      snapshotSlotIds: [],
    });
    await db.insert(documentPendingAttachments).values({
      byteLength: 12,
      createdAt: STALE,
      localId: "doc-1",
      mimeType: "image/png",
      name: "slot-dropped.png",
      slotId: "slot-dropped",
      storageKey: "local/dropped-pending-only",
      uploadBlobId: null,
      uploadContentKey: null,
      uploadContentKeyEpoch: null,
      uploadIv: null,
      uploadPartSize: null,
      uploadPlaintextSha256: null,
      uploadStageId: null,
    });

    const result = await clearRemoteSyncState(execSql, {
      organizationId: "org-old",
    });

    expect(result.queuedAttachmentUploadCount).toBe(0);
    expect(await db.select().from(documentPendingAttachments)).toEqual([]);
    expect(await db.select().from(documentOrphanBlobReclaims)).toEqual([
      { storageKey: "local/dropped-pending-only" },
    ]);
  } finally {
    close();
  }
});
