import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { addDocumentAttachments } from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { listBlobInfo } from "./blobInfo";

const attachment = {
  contentSha256: "a".repeat(64),
  mimeType: "text/plain",
  slotId: "file",
};

async function saveLegacyBlob(
  execSql: ExecSql,
  localId: string,
  byteLength: number,
) {
  await execSql(
    "INSERT INTO document_projection_text (local_id, text) VALUES (?, '')",
    [localId],
  );
  await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
    ...attachment,
    byteLength,
    localId,
    blobId: localId,
    storageKey: localId,
    detachedAt: null,
  });
}

async function saveHistory(
  execSql: ExecSql,
  localId: string,
  byteLength: number,
) {
  const doc = await createDocument(localId);
  try {
    addDocumentAttachments(doc, [
      { ...attachment, byteLength, name: `${localId}.txt` },
    ]);
    doc.commit();
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      localId,
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(doc),
      snapshot: bytesToBase64(doc.export({ mode: "snapshot" })),
      force: true,
    });
  } finally {
    doc.free();
  }
}

test("opening a page only restores filenames for that page", async () => {
  const { close, execSql } = await createTestExecSql("blob-info-page-backfill");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    for (const [id, size] of [
      ["first", 1],
      ["second", 2],
    ] as const) {
      await saveLegacyBlob(execSql, id, size);
      await saveHistory(execSql, id, size);
    }
    const page = {
      execSql,
      limit: 1,
      sort: { direction: "asc", key: "byteLength" },
    } as const;
    expect((await listBlobInfo(page)).rows[0]?.name).toBe("first.txt");
    expect(
      await execSql(
        "SELECT local_id FROM document_projection_text WHERE attachment_names IS NULL",
      ),
    ).toEqual([{ local_id: "second" }]);
    expect((await listBlobInfo({ ...page, offset: 1 })).rows[0]?.name).toBe(
      "second.txt",
    );
  } finally {
    close();
  }
});

test("a legacy filename becomes searchable when its history arrives after the first read", async () => {
  const { close, execSql } = await createTestExecSql(
    "blob-info-retry-backfill",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveLegacyBlob(execSql, "late", 1);
    expect((await listBlobInfo({ execSql })).rows[0]?.name).toBeNull();
    // Search must get past a full batch whose histories are still missing.
    for (let i = 0; i < 16; i++) {
      await saveLegacyBlob(execSql, `earlier-${i}`, 1);
    }
    await saveHistory(execSql, "late", 1);
    expect(
      (await listBlobInfo({ execSql, query: "late.txt" })).rows[0]?.name,
    ).toBe("late.txt");
  } finally {
    close();
  }
});
