import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  addDocumentAttachments,
  removeDocumentAttachment,
} from "../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { deleteDocumentPlacements } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { localSchemaMigrations } from "../../../data/sqlite/migrations/localSchemaMigrations";
import { migrateLocalSchema } from "../../../data/sqlite/migrations/migrateLocalSchema";
import { persistDocumentState } from "../../documents/persistence";
import { listBlobInfo } from "./blobInfo";

const slotId = 'file."front"';
const attachment = {
  byteLength: 2,
  contentSha256: "0".repeat(64),
  mimeType: "application/pdf",
  slotId,
};

test("grouped filenames follow each document across creation, rename, replacement and removal", async () => {
  const { close, execSql } = await createTestExecSql("blob-info-filenames");
  const first = await createDocument("first");
  const second = await createDocument("second");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const save = async (localId: string, doc: typeof first) => {
      doc.commit();
      const currentRecord = await sqlDocumentsPersistence.loadDocument(
        execSql,
        localId,
      );
      expect(
        await persistDocumentState({
          currentDoc: doc,
          currentRecord,
          execSql,
          localId,
          persistence: sqlDocumentsPersistence,
          documentProjectors: defaultDocumentProjectorRegistry,
          deleteDocumentPlacements,
          patch: { snapshotEndVersion: encodeVersionVector(doc) },
        }),
      ).not.toBeNull();
    };
    for (const [doc, localId, name] of [
      [second, "second", "rÉsumÉ.pdf"],
      [first, "first", "invoice.pdf"],
    ] as const) {
      addDocumentAttachments(doc, [{ ...attachment, name }]);
      await save(localId, doc);
      await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
        ...attachment,
        localId,
        blobId: "blob",
        storageKey: "storage",
        detachedAt: null,
      });
    }
    for (const query of ["INVOICE.PDF", "rÉsumÉ.pdf"]) {
      const info = await listBlobInfo({ execSql, query });
      expect(info.totalCount).toBe(1);
      expect(info.rows[0]?.name).toBe("invoice.pdf");
      expect(
        Object.fromEntries(
          info.rows[0]?.references.map((ref) => [ref.localId, ref.name]) ?? [],
        ),
      ).toEqual({
        first: "invoice.pdf",
        second: "rÉsumÉ.pdf",
      });
    }
    addDocumentAttachments(first, [{ ...attachment, name: "final.pdf" }]);
    await save("first", first);
    expect(
      (await listBlobInfo({ execSql, query: "invoice.pdf" })).totalCount,
    ).toBe(0);
    expect(
      (await listBlobInfo({ execSql, query: "rÉsumÉ.pdf" })).rows[0]?.name,
    ).toBe("final.pdf");
    addDocumentAttachments(first, [
      { ...attachment, contentSha256: "1".repeat(64), name: "replacement.pdf" },
    ]);
    await save("first", first);
    removeDocumentAttachment(second, slotId);
    await save("second", second);
    const unnamed = await listBlobInfo({ execSql, query: "blob" });
    expect(unnamed.rows[0]).toMatchObject({ name: null, referenceCount: 2 });
    expect(unnamed.rows[0]?.references.map((ref) => ref.name)).toEqual([
      null,
      null,
    ]);
  } finally {
    first.free();
    second.free();
    close();
  }
});

test("a pre-upgrade attachment gets its filename from the checkpoint and later tail", async () => {
  const { close, execSql } = await createTestExecSql("blob-info-pre-upgrade");
  const doc = await createDocument("history");
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 3),
    });
    await execSql(
      "CREATE TABLE document_projection_text(local_id TEXT PRIMARY KEY, text TEXT NOT NULL)",
    );
    await execSql(
      "INSERT INTO document_projection_text VALUES ('older', 'original text')",
    );
    await sqlDocumentsPersistence.ensureSchema(execSql);
    addDocumentAttachments(doc, [{ ...attachment, name: "draft.pdf" }]);
    doc.commit();
    const before = encodeVersionVector(doc);
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      localId: "older",
      coveredTailIds: [],
      endVersionVector: before,
      snapshot: bytesToBase64(doc.export({ mode: "snapshot" })),
      force: true,
    });
    addDocumentAttachments(doc, [{ ...attachment, name: "signed.pdf" }]);
    doc.commit();
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: "older",
      origin: "remote",
      updates: [bytesToBase64(exportUpdatesSince(doc, before))],
    });
    await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
      ...attachment,
      localId: "older",
      blobId: "old-blob",
      storageKey: "storage",
      detachedAt: null,
    });
    expect(
      (await listBlobInfo({ execSql, query: "signed.pdf" })).rows[0],
    ).toMatchObject({
      name: "signed.pdf",
      references: [{ name: "signed.pdf" }],
    });
    expect(
      (await listBlobInfo({ execSql, query: "draft.pdf" })).totalCount,
    ).toBe(0);
    expect(
      await execSql(
        "SELECT text FROM document_projection_text WHERE local_id = 'older'",
      ),
    ).toEqual([{ text: "original text" }]);
  } finally {
    doc.free();
    close();
  }
});
