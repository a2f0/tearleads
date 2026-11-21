import { expect, test } from "bun:test";
import { createDocument, emptyVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  addDocumentAttachments,
  serializeDocumentAttachmentNames,
} from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createContainerDocumentQueriesFromRuntime } from "./index";

const RECEIPT = {
  byteLength: 4,
  contentSha256: "a".repeat(64),
  mimeType: "image/jpeg",
  name: "receipt.jpg",
  slotId: "receipt",
};
const PHOTO = {
  byteLength: 5,
  contentSha256: "b".repeat(64),
  mimeType: "image/png",
  name: "saw.png",
  slotId: "photos:0f1e",
};
const MANUAL = {
  byteLength: 6,
  contentSha256: "c".repeat(64),
  mimeType: "application/pdf",
  name: "manual.pdf",
  slotId: "manual",
};
const UPLOAD = {
  byteLength: 7,
  contentSha256: "d".repeat(64),
  mimeType: "image/jpeg",
  name: "upload.jpg",
  slotId: "upload",
};

async function saveSyncedDocument(
  execSql: ExecSql,
  input: {
    attachments: ReadonlyArray<typeof RECEIPT>;
    documentId: string | null;
    localId: string;
    snapshotEndVersion?: string;
    title: string;
  },
): Promise<void> {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    id: input.localId,
    accessEpoch: 1,
    containerId: "folder",
    documentId: input.documentId,
    documentKind: "note",
    effectiveAccessLevel: "admin",
    snapshotEndVersion: input.snapshotEndVersion ?? "synced-end-version",
    text: input.title,
    title: input.title,
  });
  const doc = await createDocument(input.localId);
  try {
    addDocumentAttachments(doc, input.attachments);
    await execSql(
      "UPDATE document_projection_text SET attachment_names = ? WHERE local_id = ?",
      [serializeDocumentAttachmentNames(doc), input.localId],
    );
  } finally {
    doc.free();
  }
}

test("Downloads lists each recorded file this device has not received", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-attachment-downloads",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await saveSyncedDocument(execSql, {
      attachments: [RECEIPT, PHOTO, MANUAL, UPLOAD],
      documentId: "drill-remote",
      localId: "drill",
      title: "Drill",
    });
    // Held bytes are not a first download.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "manual-blob",
      byteLength: MANUAL.byteLength,
      contentSha256: MANUAL.contentSha256,
      detachedAt: null,
      localId: "drill",
      mimeType: MANUAL.mimeType,
      slotId: MANUAL.slotId,
      storageKey: "blob-manual-blob",
    });
    // A file this device is uploading is not a download.
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      ...UPLOAD,
      localId: "drill",
      storageKey: "local-upload",
    });
    // A local-only document has nothing to fetch.
    await saveSyncedDocument(execSql, {
      attachments: [RECEIPT],
      documentId: null,
      localId: "draft",
      title: "Draft",
    });
    // A discovered shell is listed as the document itself, not its files.
    await saveSyncedDocument(execSql, {
      attachments: [RECEIPT],
      documentId: "shell-remote",
      localId: "shell",
      snapshotEndVersion: "",
      title: "Shell",
    });

    const pending = await queries.listPendingDownloads();
    expect(pending.filter((item) => item.objectKind === "attachment")).toEqual([
      {
        localId: "drill",
        documentId: "drill-remote",
        objectKind: "attachment",
        title: "Drill",
        reason: "initial",
        lastError: null,
        slotId: PHOTO.slotId,
        fileName: PHOTO.name,
      },
      {
        localId: "drill",
        documentId: "drill-remote",
        objectKind: "attachment",
        title: "Drill",
        reason: "initial",
        lastError: null,
        slotId: RECEIPT.slotId,
        fileName: RECEIPT.name,
      },
    ]);
    expect(
      pending.filter((item) => item.objectKind !== "attachment"),
    ).toMatchObject([{ localId: "shell", objectKind: "document" }]);

    // A slot awaiting its remote detach still has a local row.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "receipt-blob",
      byteLength: RECEIPT.byteLength,
      contentSha256: RECEIPT.contentSha256,
      detachedAt: "2026-11-21T00:00:00.000Z",
      localId: "drill",
      mimeType: RECEIPT.mimeType,
      slotId: RECEIPT.slotId,
      storageKey: "blob-receipt-blob",
    });
    // Removing a slot from the content removes its row; a durable sync
    // failure on the document is shown on its remaining files.
    await saveSyncedDocument(execSql, {
      attachments: [PHOTO],
      documentId: "drill-remote",
      localId: "drill",
      title: "Drill",
    });
    await execSql(
      "UPDATE documents SET sync_failure_message = 'Connection failed', sync_failure_attempted_at = '2026-11-21' WHERE local_id = 'drill'",
    );
    expect(await queries.listPendingDownloads()).toMatchObject([
      { localId: "shell", objectKind: "document" },
      {
        lastError: "Connection failed",
        objectKind: "attachment",
        slotId: PHOTO.slotId,
      },
    ]);

    // Once the bytes are held the row is gone.
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      blobId: "photo-blob",
      byteLength: PHOTO.byteLength,
      contentSha256: PHOTO.contentSha256,
      detachedAt: null,
      localId: "drill",
      mimeType: PHOTO.mimeType,
      slotId: PHOTO.slotId,
      storageKey: "blob-photo-blob",
    });
    expect(await queries.listPendingDownloads()).toMatchObject([
      { localId: "shell", objectKind: "document" },
    ]);
    // Once the shell's content arrives, its file is the next download.
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...(await loadRecord(execSql, "shell")),
      snapshotEndVersion: emptyVersionVector(),
    });
    expect(await queries.listPendingDownloads()).toMatchObject([
      { localId: "shell", objectKind: "attachment", slotId: RECEIPT.slotId },
    ]);
  } finally {
    close();
  }
});

test("a document awaiting its filename backfill lists no files yet", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-attachment-legacy",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveSyncedDocument(execSql, {
      attachments: [RECEIPT],
      documentId: "legacy-remote",
      localId: "legacy",
      title: "Legacy",
    });
    await execSql(
      "UPDATE document_projection_text SET attachment_names = NULL WHERE local_id = 'legacy'",
    );
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    expect(await queries.listPendingDownloads()).toEqual([]);
  } finally {
    close();
  }
});

async function loadRecord(execSql: ExecSql, localId: string) {
  const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
  if (!record) throw new Error(`Expected ${localId}`);
  return record;
}
