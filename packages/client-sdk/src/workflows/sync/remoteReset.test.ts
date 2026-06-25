import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { addDocumentAttachments } from "../../data/documents/documentContent";
import {
  clientSqlTables,
  containerCreateIntents,
  containerMoveIntents,
  containerSyncLaneChecks,
  containerSyncWatermarks,
  containers,
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentMoveIntents,
  documentPendingAttachments,
  documentPendingUpdates,
  documentProjection,
  documents,
  principalPolicies,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("clearRemoteSyncState keeps local content and requeues remote sync work", async () => {
  const { close, execSql } = await createTestExecSql("sync-remote-reset-test");

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const stale = "2026-05-01T00:00:00.000Z";
    const doc = await createDocument("remote-reset-test-doc");
    doc.getText("text").update("keep this note");
    addDocumentAttachments(doc, [
      {
        byteLength: 12,
        mimeType: "image/png",
        name: "photo.png",
        slotId: "slot-1",
      },
    ]);
    const metadataDoc = await createDocument("remote-reset-test-metadata");
    metadataDoc.getMap("container").set("name", "Child");

    await db.transaction(async (tx) => {
      await tx.insert(containers).values([
        {
          id: "root",
          organizationId: "org-old",
          parentId: null,
          metadataDocumentId: "root-metadata-remote",
          systemSlot: null,
          localCreatedAt: stale,
          localUpdatedAt: stale,
          serverCreatedAt: stale,
          serverUpdatedAt: stale,
        },
        {
          id: "child",
          organizationId: "org-old",
          parentId: "root",
          metadataDocumentId: "child-metadata-remote",
          systemSlot: null,
          localCreatedAt: stale,
          localUpdatedAt: stale,
          serverCreatedAt: stale,
          serverUpdatedAt: stale,
        },
      ]);
      await tx.insert(documents).values([
        {
          appKind: "documents",
          localId: "doc-1",
          documentId: "doc-remote-old",
          loroSnapshot: bytesToBase64(exportAllUpdates(doc)),
          accessEpoch: 8,
          accessStateHash: "old-access-state",
          lastCommitLsn: "22",
          documentManifestBundle: "{}",
          contentKeyBundle: "{}",
          documentKekTargets: "{}",
          updatedAt: stale,
        },
        {
          appKind: "container-metadata",
          localId: "child",
          documentId: "child-metadata-remote",
          loroSnapshot: bytesToBase64(exportAllUpdates(metadataDoc)),
          accessEpoch: 4,
          accessStateHash: "old-metadata-access-state",
          lastCommitLsn: "11",
          documentManifestBundle: "{}",
          contentKeyBundle: "{}",
          documentKekTargets: "{}",
          updatedAt: stale,
        },
      ]);
      await tx.insert(documentProjection).values({
        localId: "doc-1",
        documentId: "doc-remote-old",
        containerId: "child",
        documentKind: "note",
        text: "keep this note",
        title: "Note",
        updatedAt: stale,
      });
      await tx.insert(documentAttachmentBlobProjection).values({
        localId: "doc-1",
        slotId: "slot-1",
        blobId: "blob-old",
        storageKey: "local/blob",
        mimeType: "image/png",
        byteLength: 12,
        updatedAt: stale,
      });
      await tx.insert(documentPendingUpdates).values({
        id: "old-update",
        appKind: "documents",
        localId: "doc-1",
        updateData: "old",
        partialStartVersionVector: "old",
        partialEndVersionVector: "old",
        sourceVersionVector: null,
        createdAt: stale,
      });
      await tx.insert(documentContainerProjection).values({
        documentId: "doc-remote-old",
        containerId: "child",
        updatedAt: stale,
      });
      await tx.insert(principalPolicies).values({
        principalType: "organization",
        principalId: "org-old",
        stateHash: "state",
        currentStateJson: "{}",
        currentPayloadJson: "{}",
        currentProjectionJson: "[]",
        currentMemberEnvelopesJson: "[]",
        previousStatesJson: "[]",
        updatedAt: stale,
      });
      await tx.insert(documentMoveIntents).values({
        id: "doc-move",
        localId: "doc-1",
        documentId: "doc-remote-old",
        targetContainerId: "child",
        sourceContainerId: "root",
        replaceLinkedContainers: false,
        intentType: "document.move",
        syncStatus: "pending",
        lastError: null,
        lastAttemptedAt: null,
        createdAt: stale,
        updatedAt: stale,
      });
      await tx.insert(containerMoveIntents).values({
        id: "container-move",
        containerId: "child",
        parentContainerId: "root",
        previousParentContainerId: null,
        intentType: "container.move",
        syncStatus: "pending",
        lastError: null,
        lastAttemptedAt: null,
        createdAt: stale,
        updatedAt: stale,
      });
      await tx.insert(containerCreateIntents).values({
        id: "old-create",
        containerId: "child",
        parentContainerId: "root",
        intentType: "container.create",
        syncStatus: "synced",
        remoteContainerId: "child",
        remoteMetadataDocumentId: "child-metadata-remote",
        remoteMetadataAccessStateHash: "old",
        lastError: null,
        createdAt: stale,
        updatedAt: stale,
      });
      await tx.insert(containerSyncWatermarks).values({
        laneKind: "container_parent",
        laneId: "root",
        watermarkUpdatedAt: stale,
        watermarkId: "child",
        updatedAt: stale,
      });
      await tx.insert(containerSyncLaneChecks).values({
        laneKind: "container_parent",
        laneId: "root",
        checkedAt: stale,
      });
    });

    const result = await clearRemoteSyncState(execSql);

    expect(result).toEqual({
      clearedContainerCreateIntentCount: 1,
      clearedContainerMoveIntentCount: 1,
      clearedDocumentMoveIntentCount: 1,
      clearedPrincipalPolicyCount: 1,
      clearedSyncCursorCount: 2,
      queuedAttachmentUploadCount: 1,
      queuedContainerCreateCount: 1,
      queuedDocumentUpdateCount: 2,
      resetContainerCount: 2,
      resetDocumentCount: 2,
    });

    const resetDocuments = await db
      .select()
      .from(documents)
      .orderBy(documents.appKind, documents.localId);
    expect(resetDocuments).toEqual([
      expect.objectContaining({
        accessEpoch: 1,
        accessStateHash: null,
        appKind: "container-metadata",
        contentKeyBundle: null,
        documentId: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        lastCommitLsn: null,
        localId: "child",
      }),
      expect.objectContaining({
        accessEpoch: 1,
        accessStateHash: null,
        appKind: "documents",
        contentKeyBundle: null,
        documentId: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        lastCommitLsn: null,
        localId: "doc-1",
      }),
    ]);
    const pendingUpdates = await db.select().from(documentPendingUpdates);
    expect(pendingUpdates).toHaveLength(2);
    expect(pendingUpdates.every((row) => row.updateData !== "old")).toBe(true);

    const pendingAttachments = await db
      .select()
      .from(documentPendingAttachments);
    expect(pendingAttachments).toEqual([
      expect.objectContaining({
        byteLength: 12,
        localId: "doc-1",
        mimeType: "image/png",
        name: "photo.png",
        slotId: "slot-1",
        storageKey: "local/blob",
      }),
    ]);
    expect(await db.select().from(documentAttachmentBlobProjection)).toEqual(
      [],
    );

    const [projection] = await db.select().from(documentProjection);
    expect(projection).toEqual(
      expect.objectContaining({
        containerId: "child",
        documentId: null,
        localId: "doc-1",
      }),
    );

    const resetContainers = await db
      .select()
      .from(containers)
      .orderBy(containers.id);
    expect(resetContainers).toEqual([
      expect.objectContaining({
        id: "child",
        metadataDocumentId: null,
        organizationId: "",
        serverCreatedAt: null,
        serverUpdatedAt: null,
      }),
      expect.objectContaining({
        id: "root",
        metadataDocumentId: null,
        organizationId: "",
        serverCreatedAt: null,
        serverUpdatedAt: null,
      }),
    ]);

    expect(await db.select().from(containerCreateIntents)).toEqual([
      expect.objectContaining({
        containerId: "child",
        parentContainerId: "root",
        remoteContainerId: null,
        syncStatus: "pending",
      }),
    ]);
    expect(await db.select().from(principalPolicies)).toEqual([]);
    expect(await db.select().from(documentContainerProjection)).toEqual([]);
    expect(await db.select().from(documentMoveIntents)).toEqual([]);
    expect(await db.select().from(containerMoveIntents)).toEqual([]);
    expect(await db.select().from(containerSyncWatermarks)).toEqual([]);
    expect(await db.select().from(containerSyncLaneChecks)).toEqual([]);
  } finally {
    close();
  }
});
