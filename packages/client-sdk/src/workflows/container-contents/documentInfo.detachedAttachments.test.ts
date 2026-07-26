import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadDocumentInfo } from "./documentInfo";

test("loadDocumentInfo hides attachments unlinked before the detach flushes", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-detached-test",
  );

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
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-kept",
      byteLength: 34,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "slot-kept",
      storageKey: "storage-kept",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-unlinked",
      byteLength: 34,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "slot-unlinked",
      storageKey: "storage-unlinked",
    });
    await sqlDocumentsPersistence.markLocalAttachmentDetached(
      execSql,
      "local-document-1",
      "slot-unlinked",
      "storage-unlinked",
    );

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async () => {
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
      remoteInfoMode: "if-synced",
    });

    expect(info.attachments.map((attachment) => attachment.slotId)).toEqual([
      "slot-kept",
    ]);
  } finally {
    close();
  }
});
