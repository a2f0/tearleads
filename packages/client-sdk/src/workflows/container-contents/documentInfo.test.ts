import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadDocumentInfo } from "./documentInfo";

function createDocumentWriterProjection(): DocumentWriterProjectionResponse {
  return {
    authorizingContainerPaths: [
      {
        containerId: "container-1",
        containerKeks: [
          {
            accessManifestHash: "container-manifest-hash",
            containerId: "container-1",
            containerKeyEpoch: 1,
            containerKeyEpochId: "container-key-epoch-1",
            keyEpoch: {},
            keyEpochHash: "container-key-epoch-hash",
            keyTargetHash: "container-key-target-hash",
            parentContainerKeyEpochId: null,
            recipientTargets: [{}],
            wraps: [{}],
          },
        ],
        organizationId: "org-1",
        path: [
          {
            event: { body: {}, event: {}, eventHash: "container-event-hash" },
            manifest: {},
            manifestHash: "container-manifest-hash",
            state: {},
          },
        ],
      },
    ],
    contentKeyBundle: {
      contentKeyEpoch: 2,
      documentId: "document-1",
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "document-key-target-hash",
      targets: [
        {
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-1",
          containerManifestHash: "container-manifest-hash",
          wrappedKey: "wrapped-document-key",
          wrappingMetadata: {},
        },
      ],
    },
    documentContainerManifestHistory: [
      {
        event: { body: {}, event: {}, eventHash: "container-history-event" },
        manifest: {},
        manifestHash: "container-history-manifest",
        state: {},
      },
    ],
    documentId: "document-1",
    documentKekTargets: {
      documentId: "document-1",
      documentKeyTargetHash: "document-key-target-hash",
      linkedContainerKeyEpochIds: ["container-key-epoch-1"],
      linkedContainerManifestHashes: ["container-manifest-hash"],
      linkSetManifestHash: "document-manifest-hash",
      targets: [{}],
    },
    documentManifest: {
      event: { body: {}, event: {}, eventHash: "document-event-hash" },
      manifest: {
        epoch: 3,
        referencedPrincipalHeads: [{}],
      },
      manifestHash: "document-manifest-hash",
      state: {
        previousManifestHash: "previous-document-manifest-hash",
      },
    },
    documentManifestContainerPaths: [
      [
        {
          event: { body: {}, event: {}, eventHash: "container-path-event" },
          manifest: {},
          manifestHash: "container-path-manifest",
          state: {},
        },
      ],
    ],
    documentManifestHistory: [
      {
        event: { body: {}, event: {}, eventHash: "document-history-event" },
        manifest: {},
        manifestHash: "document-history-manifest",
        state: {},
      },
    ],
  };
}

test("loadDocumentInfo reads local runtime, attachment, blob, and remote security summaries", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-test",
  );
  const projection = createDocumentWriterProjection();
  const projectionCalls: string[] = [];
  const attachmentCalls: string[] = [];

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 3,
        accessStateHash: "document-access-state-hash",
        containerId: "container-1",
        contentKeyBundle: "{}",
        documentId: "document-1",
        documentKekTargets: "{}",
        documentKind: "note",
        documentManifestBundle: JSON.stringify({
          manifestHash: "local-document-manifest-hash",
        }),
        id: "local-document-1",
        lastCommitLsn: "commit-lsn-1",
        loroSnapshot: "",
        text: "hello",
        title: "Hello",
      },
      { updatedAt: "2026-05-18T10:00:00.000Z" },
    );
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 12,
      localId: "local-document-1",
      mimeType: "image/png",
      name: "pending.png",
      slotId: "slot-pending",
      storageKey: "pending-storage",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-1",
      byteLength: 34,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "slot-local",
      storageKey: "local-storage",
    });

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async (documentId) => {
          projectionCalls.push(documentId);
          return projection;
        },
        listDocumentAttachments: async (documentId) => {
          attachmentCalls.push(documentId);
          return [
            {
              bindingId: "binding-1",
              blobId: "blob-1",
              slotId: "slot-local",
            },
          ];
        },
      },
      execSql,
      localId: "local-document-1",
      remoteInfoMode: "if-synced",
    });

    expect(info.local).toMatchObject({
      accessEpoch: 3,
      accessStateHash: "document-access-state-hash",
      documentId: "document-1",
      hasContentKeyBundle: true,
      hasDocumentKekTargets: true,
      hasDocumentManifestBundle: true,
      lastCommitLsn: "commit-lsn-1",
      localDocumentManifestHash: "local-document-manifest-hash",
      pendingAttachmentByteLength: 12,
      pendingAttachmentCount: 1,
      pendingUpdateCount: 0,
      title: "Hello",
      updatedAt: "2026-05-18T10:00:00.000Z",
    });
    expect(
      info.attachments.map((attachment) => attachment.attachmentKind),
    ).toEqual(["pending", "local"]);
    expect(info.remoteInfo).toMatchObject({
      activeAttachmentBindings: [
        {
          bindingId: "binding-1",
          blobId: "blob-1",
          slotId: "slot-local",
        },
      ],
      contentKeyEpoch: 2,
      currentManifestHash: "document-manifest-hash",
      documentContainerManifestHistoryCount: 1,
      documentManifestContainerPathCount: 1,
      documentManifestHistoryCount: 1,
      manifestEpoch: 3,
      previousManifestHash: "previous-document-manifest-hash",
      referencedPrincipalCount: 1,
    });
    expect(info.remoteInfo?.authorizingContainerPaths).toEqual([
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-1",
        leafManifestHash: "container-manifest-hash",
        organizationId: "org-1",
        pathLength: 1,
      },
    ]);
    expect(projectionCalls).toEqual(["document-1"]);
    expect(attachmentCalls).toEqual(["document-1"]);
  } finally {
    close();
  }
});

test("loadDocumentInfo avoids remote calls for local-only documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-local-only-test",
  );
  let projectionCallCount = 0;

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "container-1",
      documentId: null,
      documentKind: "note",
      id: "local-document-1",
      lastCommitLsn: null,
      loroSnapshot: "",
      text: "local",
      title: "Local",
    });

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async () => {
          projectionCallCount += 1;
          throw new Error("Unexpected projection fetch.");
        },
        listDocumentAttachments: async () => {
          throw new Error("Unexpected attachment fetch.");
        },
      },
      execSql,
      localId: "local-document-1",
      remoteInfoMode: "if-synced",
    });

    expect(info.local.documentId).toBeNull();
    expect(info.remoteInfo).toBeNull();
    expect(projectionCallCount).toBe(0);
  } finally {
    close();
  }
});
