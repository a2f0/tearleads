import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { addDocumentAttachments } from "../../data/documents/documentContent";
import {
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../data/sqlite/organizationReadModelSchema";
import {
  clientSqlTables,
  containerCreateIntents,
  containerMoveIntents,
  containerSyncLaneChecks,
  containerSyncWatermarks,
  containers,
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentHistoryCheckpoints,
  documentMoveIntents,
  documentPendingAttachments,
  documentPendingUpdates,
  documentProjection,
  documentProjectionText,
  documents,
  principalPolicies,
  trustedUserIdentityPins,
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
    // Content lives ONLY in the durable-history tables; the record rows carry
    // just the content frontier. Export before encoding so pending ops commit.
    const docSnapshot = bytesToBase64(exportFullHistorySnapshot(doc));
    const docVersion = encodeVersionVector(doc);
    const metadataSnapshot = bytesToBase64(exportAllUpdates(metadataDoc));
    const metadataVersion = encodeVersionVector(metadataDoc);

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
          snapshotEndVersion: docVersion,
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
          snapshotEndVersion: metadataVersion,
          accessEpoch: 4,
          accessStateHash: "old-metadata-access-state",
          lastCommitLsn: "11",
          documentManifestBundle: "{}",
          contentKeyBundle: "{}",
          documentKekTargets: "{}",
          updatedAt: stale,
        },
      ]);
      await tx.insert(documentHistoryCheckpoints).values([
        {
          appKind: "documents",
          localId: "doc-1",
          snapshot: docSnapshot,
          endVersionVector: docVersion,
          revision: "revision-doc-1",
          updatedAt: stale,
        },
        {
          appKind: "container-metadata",
          localId: "child",
          snapshot: metadataSnapshot,
          endVersionVector: metadataVersion,
          revision: "revision-child",
          updatedAt: stale,
        },
      ]);
      await tx.insert(documentProjection).values({
        localId: "doc-1",
        documentId: "doc-remote-old",
        containerId: "child",
        documentKind: "note",
        title: "Note",
        updatedAt: stale,
      });
      await tx.insert(documentProjectionText).values({
        localId: "doc-1",
        text: "keep this note",
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
      await tx.insert(trustedUserIdentityPins).values({
        encapsulationKeyFingerprint: "b".repeat(64),
        encapsulationPublicKey: "kem-public-key",
        encapsulationSuite: "ML-KEM-1024",
        firstSeenAt: stale,
        formatVersion: 1,
        identityTrustDomain: "https://api.example.test/v1",
        signingKeyFingerprint: "a".repeat(64),
        signingPublicKey: "signing-public-key",
        signingSuite: "ML-DSA-87",
        userId: "11111111-1111-4111-8111-111111111111",
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
      await tx.insert(organizationReadModelState).values({
        organizationId: "org-old",
        cursor: "opaque-cursor",
        profileDocumentId: null,
        memberGroupId: "members-group",
        updatedAt: stale,
      });
      await tx.insert(organizationReadModelRequesters).values({
        organizationId: "org-old",
        userId: "user-old",
        isOrgAdmin: true,
        updatedAt: stale,
      });
      await tx.insert(organizationReadModelDirectoryUsers).values({
        organizationId: "org-old",
        userId: "user-old",
        sortOrder: 0,
        signingKeyFingerprint: "signing-fingerprint",
        signingPublicKey: "signing-public-key",
        encapsulationPublicKey: "encapsulation-public-key",
        encapsulationKeyFingerprint: "encapsulation-fingerprint",
        createdAt: stale,
        status: "active",
        profileDocumentId: null,
        joinedAt: stale,
        updatedAt: stale,
        disabledAt: null,
        disabledByUserId: null,
      });
      await tx.insert(organizationReadModelGroups).values({
        organizationId: "org-old",
        groupId: "group-old",
        sortOrder: 0,
        name: "Old group",
        createdAt: stale,
        isBuiltin: false,
        stateHash: "group-state",
        stateVersion: 1,
        keyEpoch: 1,
        memberCount: 1,
      });
      await tx.insert(organizationReadModelPolicyHeads).values({
        organizationId: "org-old",
        principalType: "group",
        principalId: "group-old",
        stateHash: "group-state",
        stateVersion: 1,
        keyEpoch: 1,
        keyFingerprint: "group-key-fingerprint",
        memberCount: 1,
      });
      await tx.insert(organizationReadModelGroupMemberships).values({
        organizationId: "org-old",
        groupId: "group-old",
        stateHash: "group-state",
      });
      await tx.insert(organizationReadModelGroupMembers).values({
        organizationId: "org-old",
        groupId: "group-old",
        userId: "user-old",
        sortOrder: 0,
        stateHash: "group-state",
        role: "member",
        signingKeyFingerprint: "signing-fingerprint",
        signingPublicKey: "signing-public-key",
        encapsulationPublicKey: "encapsulation-public-key",
        encapsulationKeyFingerprint: "encapsulation-fingerprint",
      });
      await tx.insert(organizationReadModelContainerGrants).values({
        organizationId: "org-old",
        containerId: "container-old",
        subjectType: "group",
        subjectId: "group-old",
        sortOrder: 0,
        accessLevel: "read",
        createdAt: stale,
        depth: 1,
        isBuiltin: false,
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "manifest-old",
        metadataDocumentId: "metadata-old",
        parentId: "root-old",
        updatedAt: stale,
        userId: null,
        signingKeyFingerprint: null,
        groupId: "group-old",
        groupName: "Old group",
        organizationName: null,
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
    // The durable history is the only content source and must survive a reset.
    expect(await db.select().from(documentHistoryCheckpoints)).toHaveLength(2);
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
    expect(await db.select().from(documentProjectionText)).toEqual([
      { localId: "doc-1", text: "keep this note" },
    ]);

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
    expect(await db.select().from(trustedUserIdentityPins)).toEqual([
      expect.objectContaining({
        identityTrustDomain: "https://api.example.test/v1",
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ]);
    expect(await db.select().from(documentContainerProjection)).toEqual([]);
    expect(await db.select().from(documentMoveIntents)).toEqual([]);
    expect(await db.select().from(containerMoveIntents)).toEqual([]);
    expect(await db.select().from(containerSyncWatermarks)).toEqual([]);
    expect(await db.select().from(containerSyncLaneChecks)).toEqual([]);
    expect(await db.select().from(organizationReadModelState)).toEqual([]);
    expect(await db.select().from(organizationReadModelRequesters)).toEqual([]);
    expect(await db.select().from(organizationReadModelDirectoryUsers)).toEqual(
      [],
    );
    expect(await db.select().from(organizationReadModelGroups)).toEqual([]);
    expect(await db.select().from(organizationReadModelPolicyHeads)).toEqual(
      [],
    );
    expect(
      await db.select().from(organizationReadModelGroupMemberships),
    ).toEqual([]);
    expect(await db.select().from(organizationReadModelGroupMembers)).toEqual(
      [],
    );
    expect(
      await db.select().from(organizationReadModelContainerGrants),
    ).toEqual([]);
  } finally {
    close();
  }
});
