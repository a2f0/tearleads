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
    loroSnapshot: "",
    text: input.title,
    title: input.title,
  });
}

test("listBlobInfo groups local attachments by blob id and links documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-group-test",
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

    const info = await listBlobInfo({
      execSql,
      query: "blob-shared",
    });

    expect(info.totalCount).toBe(1);
    expect(info.rows[0]).toMatchObject({
      blobId: "blob-shared",
      byteLength: 12,
      documentCount: 2,
      mimeType: "image/png",
      referenceCount: 2,
    });
    expect(
      info.rows[0]?.references
        .map((reference) => ({
          documentTitle: reference.documentTitle,
          localId: reference.localId,
          slotId: reference.slotId,
        }))
        .sort((left, right) => left.localId.localeCompare(right.localId)),
    ).toEqual([
      {
        documentTitle: "First",
        localId: "local-document-1",
        slotId: "front",
      },
      {
        documentTitle: "Second",
        localId: "local-document-2",
        slotId: "copy",
      },
    ]);
  } finally {
    close();
  }
});

test("listBlobInfo keeps every reference when search matches one reference", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-filter-group-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: "document-1",
      execSql,
      id: "local-document-1",
      title: "Receipt",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-2",
      execSql,
      id: "local-document-2",
      title: "Invoice",
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

    const info = await listBlobInfo({
      execSql,
      query: "invoice",
    });

    expect(info.totalCount).toBe(1);
    expect(info.rows[0]).toMatchObject({
      blobId: "blob-shared",
      documentCount: 2,
      referenceCount: 2,
    });
    expect(
      info.rows[0]?.references.map((reference) => reference.documentTitle),
    ).toContain("Receipt");
    expect(
      info.rows[0]?.references.map((reference) => reference.documentTitle),
    ).toContain("Invoice");
  } finally {
    close();
  }
});

test("listBlobInfo includes pending storage-key blobs", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-pending-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: null,
      execSql,
      id: "local-document-1",
      title: "Draft",
    });
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 34,
      localId: "local-document-1",
      mimeType: "text/plain",
      name: "draft.txt",
      slotId: "attachment",
      storageKey: "pending-storage-key",
    });

    const info = await listBlobInfo({
      execSql,
      query: "draft.txt",
    });

    expect(info).toMatchObject({
      totalCount: 1,
      rows: [
        {
          blobId: null,
          byteLength: 34,
          documentCount: 1,
          key: "storage:pending-storage-key",
          mimeType: "text/plain",
          name: "draft.txt",
          referenceCount: 1,
          storageKey: "pending-storage-key",
        },
      ],
    });
    expect(info.rows[0]?.references[0]).toMatchObject({
      attachmentKind: "pending",
      blobId: null,
      documentTitle: "Draft",
      localId: "local-document-1",
      storageKey: "pending-storage-key",
    });
  } finally {
    close();
  }
});

test("listBlobInfo sorts grouped rows by MIME type", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-mime-sort-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: "document-1",
      execSql,
      id: "local-document-1",
      title: "Image",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-2",
      execSql,
      id: "local-document-2",
      title: "Text",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-3",
      execSql,
      id: "local-document-3",
      title: "Unknown",
    });
    await saveBlobInfoTestDocument({
      documentId: null,
      execSql,
      id: "local-document-4",
      title: "Pending",
    });

    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-image",
      byteLength: 12,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "front",
      storageKey: "storage-image",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-text",
      byteLength: 24,
      detachedAt: null,
      localId: "local-document-2",
      mimeType: "text/plain",
      slotId: "copy",
      storageKey: "storage-text",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-unknown",
      byteLength: 36,
      detachedAt: null,
      localId: "local-document-3",
      mimeType: null,
      slotId: "raw",
      storageKey: "storage-unknown",
    });
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 48,
      localId: "local-document-4",
      mimeType: "application/pdf",
      name: "pending.pdf",
      slotId: "pending",
      storageKey: "storage-pending",
    });

    const ascending = await listBlobInfo({
      execSql,
      sort: { direction: "asc", key: "mimeType" },
    });
    const descending = await listBlobInfo({
      execSql,
      sort: { direction: "desc", key: "mimeType" },
    });

    expect(ascending.rows.map((row) => row.mimeType)).toEqual([
      "application/pdf",
      "image/png",
      "text/plain",
      null,
    ]);
    expect(descending.rows.map((row) => row.mimeType)).toEqual([
      "text/plain",
      "image/png",
      "application/pdf",
      null,
    ]);

    const windowed = await listBlobInfo({
      execSql,
      limit: 2,
      offset: 1,
      sort: { direction: "asc", key: "mimeType" },
    });

    expect(windowed.totalCount).toBe(4);
    expect(windowed.rows.map((row) => row.mimeType)).toEqual([
      "image/png",
      "text/plain",
    ]);
  } finally {
    close();
  }
});

test("listBlobInfo sorts grouped rows by byte length", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-size-sort-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveBlobInfoTestDocument({
      documentId: "document-1",
      execSql,
      id: "local-document-1",
      title: "Small",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-2",
      execSql,
      id: "local-document-2",
      title: "Medium",
    });
    await saveBlobInfoTestDocument({
      documentId: "document-3",
      execSql,
      id: "local-document-3",
      title: "Large",
    });

    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-small",
      byteLength: 12,
      detachedAt: null,
      localId: "local-document-1",
      mimeType: "image/png",
      slotId: "front",
      storageKey: "storage-small",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-medium",
      byteLength: 240,
      detachedAt: null,
      localId: "local-document-2",
      mimeType: "text/plain",
      slotId: "copy",
      storageKey: "storage-medium",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "blob-large",
      byteLength: 3600,
      detachedAt: null,
      localId: "local-document-3",
      mimeType: null,
      slotId: "raw",
      storageKey: "storage-large",
    });

    const ascending = await listBlobInfo({
      execSql,
      sort: { direction: "asc", key: "byteLength" },
    });
    const descending = await listBlobInfo({
      execSql,
      sort: { direction: "desc", key: "byteLength" },
    });

    expect(ascending.rows.map((row) => row.byteLength)).toEqual([
      12, 240, 3600,
    ]);
    expect(descending.rows.map((row) => row.byteLength)).toEqual([
      3600, 240, 12,
    ]);
  } finally {
    close();
  }
});

test("listBlobInfo returns an empty window without SQLite", async () => {
  await expect(listBlobInfo({ execSql: null })).resolves.toEqual({
    rows: [],
    totalCount: 0,
  });
});
