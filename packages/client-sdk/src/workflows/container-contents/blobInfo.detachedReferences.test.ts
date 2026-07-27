import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { listBlobInfo } from "./blobInfo";

async function saveBlobInfoTestDocument(input: {
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  title: string;
  documentId: string | null;
}) {
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    accessEpoch: 1,
    accessStateHash: null,
    containerId: "container-1",
    documentId: input.documentId,
    documentKind: "note",
    id: input.id,
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: input.title,
    title: input.title,
  });
}

test("listBlobInfo drops references unlinked before the detach flushes", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-detached-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: "document-1",
      execSql,
      id: "local-document-1",
      title: "First",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-2",
      execSql,
      id: "local-document-2",
      title: "Second",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-shared",
      byteLength: 12,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "front",
      storageKey: "storage-front",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-shared",
      byteLength: 12,
      detachedAt: null,
      localId: "local-document-2",
      mimeType: "image/png",
      slotId: "copy",
      storageKey: "storage-copy",
    });

    // The row survives as the pending-detach marker, so the blob browser has to
    // stop counting it on its own rather than waiting for the row to disappear.
    await sqlDocumentsPersistence.markLocalAttachmentDetached(
      execSql,
      "local-document-2",
      "copy",
      "storage-copy",
    );

    const info = await listBlobInfo({ execSql, query: "blob-shared" });

    expect(info.totalCount).toBe(1);
    expect(info.rows[0]).toMatchObject({
      blobId: "blob-shared",
      documentCount: 1,
      referenceCount: 1,
    });
    expect(
      info.rows[0]?.references.map((reference) => reference.localId),
    ).toEqual(["local-document-1"]);

    await sqlDocumentsPersistence.markLocalAttachmentDetached(
      execSql,
      "local-document-1",
      "front",
      "storage-front",
    );

    const emptied = await listBlobInfo({ execSql, query: "blob-shared" });

    expect(emptied).toEqual({ rows: [], totalCount: 0 });
  } finally {
    close();
  }
});

test("listBlobInfo restores a reference when a detached slot is refilled", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-refilled-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: "document-1",
      execSql,
      id: "local-document-1",
      title: "First",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-one",
      byteLength: 12,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "front",
      storageKey: "storage-front",
    });
    await sqlDocumentsPersistence.markLocalAttachmentDetached(
      execSql,
      "local-document-1",
      "front",
      "storage-front",
    );
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-two",
      byteLength: 20,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "front",
      storageKey: "storage-front-2",
    });

    const info = await listBlobInfo({ execSql });

    expect(info.totalCount).toBe(1);
    expect(info.rows[0]).toMatchObject({
      blobId: "blob-two",
      referenceCount: 1,
    });
  } finally {
    close();
  }
});
