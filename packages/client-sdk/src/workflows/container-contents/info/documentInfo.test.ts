import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobContentKeyBundle,
  createBlobTargets,
  createDocumentWriterProjection,
} from "../../../../test/helpers/documentInfoFixtures";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { loadDocumentInfo } from "./documentInfo";

// One synced document with a pending and a local attachment, read through a
// stub API that records which documents it was asked about.
async function loadSyncedDocumentInfo(execSql: ExecSql) {
  const projection = createDocumentWriterProjection();
  const projectionCalls: string[] = [];
  const attachmentCalls: string[] = [];

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
      snapshotEndVersion: "",
      text: "hello",
      title: "Hello",
    },
    { updatedAt: "2026-05-18T10:00:00.000Z" },
  );
  const pending = {
    contentSha256: "0".repeat(64),
    byteLength: 12,
    localId: "local-document-1",
    mimeType: "image/png",
    name: "pending.png",
    slotId: "slot-pending",
    storageKey: "pending-storage",
  };
  await sqlDocumentsPersistence.savePendingAttachment(execSql, pending);
  await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
    ...pending,
    blobId: "blob-1",
    byteLength: 34,
    detachedAt: null,
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
            bindingEvent: { body: {}, event: {}, eventHash: "event-hash" },
            blobKekTargets: createBlobTargets(),
            writeAuthorization: createBlobTargets(),
            writeHeader: {},
            documentManifestHash: "document-manifest-hash",
            previousBindingId: null,
            contentKeyBundle: createBlobContentKeyBundle(),
            slotId: "slot-local",
          },
        ];
      },
      getDocumentEditAttribution: async () => ({
        attributionRevision: 1,
        documentId: "document-1",
        segments: [
          {
            peerId: "1",
            startCounter: 0,
            endCounter: 5,
            writerUserId: "writer-1",
            writerKeyFingerprint: "fp-1",
            authorityKind: "direct",
          },
        ],
      }),
    },
    execSql,
    localId: "local-document-1",
    reportSecurityIncident: async () => undefined,
    remoteInfoMode: "if-synced",
  });
  return { attachmentCalls, info, projectionCalls };
}

test("loadDocumentInfo reads local runtime and attachment summaries", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-test",
  );

  try {
    const { info } = await loadSyncedDocumentInfo(execSql);

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
  } finally {
    close();
  }
});

test("loadDocumentInfo reads remote manifest, binding, and container path summaries", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-test",
  );

  try {
    const { attachmentCalls, info, projectionCalls } =
      await loadSyncedDocumentInfo(execSql);

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

test("loadDocumentInfo reads remote attribution contributors and segments", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-test",
  );

  try {
    const { info } = await loadSyncedDocumentInfo(execSql);

    expect(info.remoteInfo?.contributors).toEqual([
      {
        writerUserId: "writer-1",
        writerKeyFingerprint: "fp-1",
        opCount: 5,
        directOpCount: 5,
        baselineOpCount: 0,
        hasDirectAuthority: true,
        hasBaselineAuthority: false,
      },
    ]);
    expect(info.remoteInfo?.attributionRevision).toBe(1);
    expect(info.remoteInfo?.attributionStatus).toBe("available");
    expect(info.remoteInfo?.attributionSegments).toEqual([
      {
        peerId: "1",
        startCounter: 0,
        endCounter: 5,
        writerUserId: "writer-1",
        writerKeyFingerprint: "fp-1",
        authorityKind: "direct",
      },
    ]);
    expect(info.remoteInfo?.characterBlame).toBeNull();
    expect(info.remoteInfo?.blameRanges).toBeNull();
    expect(info.remoteInfo?.fieldBlame).toBeNull();
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
      snapshotEndVersion: "",
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
        getDocumentEditAttribution: async () => {
          throw new Error("Unexpected attribution fetch.");
        },
      },
      execSql,
      localId: "local-document-1",
      reportSecurityIncident: async () => undefined,
      remoteInfoMode: "if-synced",
    });

    expect(info.local.documentId).toBeNull();
    expect(info.remoteInfo).toBeNull();
    expect(projectionCallCount).toBe(0);
  } finally {
    close();
  }
});
