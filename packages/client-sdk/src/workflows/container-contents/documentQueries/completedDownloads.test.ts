import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  emptyVersionVector,
  exportAllUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  addDocumentAttachments,
  serializeDocumentAttachmentNames,
} from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../metadata/containerMetadataDocument";
import { createContainerDocumentQueriesFromRuntime } from "./index";

async function discoverDocument(
  queries: ReturnType<typeof createContainerDocumentQueriesFromRuntime>,
  documentId: string,
) {
  await queries.upsertDiscoveredDocuments([
    {
      accessEpoch: 1,
      containerId: "root",
      createdAt: "2026-11-21T00:00:00Z",
      documentId,
      linkedContainerIds: ["root"],
    },
  ]);
}

test("a document is complete once its content is stored and no page remains", async () => {
  const { execSql, close } = await createTestExecSql("completed-downloads");
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await discoverDocument(queries, "photo");
    await discoverDocument(queries, "deleted");
    const refs = [
      { localId: "photo", objectKind: "document" },
      { localId: "deleted", objectKind: "document" },
    ] as const;
    expect(await queries.listCompletedDownloads(refs)).toEqual([]);

    const shell = await sqlDocumentsPersistence.loadDocument(execSql, "photo");
    if (!shell) throw new Error("Expected discovery shell");
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      documentKind: "photo",
      title: "Holiday.jpg",
      snapshotEndVersion: emptyVersionVector(),
      pullContinuation: {
        commitLsn: "0/20",
        commitLsnMode: "tracked",
        cursor: "page-2",
      },
    });
    // The first page is stored, but the pull still has pages to read.
    expect(await queries.listCompletedDownloads(refs)).toEqual([]);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      documentKind: "photo",
      title: "Holiday.jpg",
      snapshotEndVersion: emptyVersionVector(),
      pullContinuation: null,
    });
    // The shell that left the queue because its projection was removed is not
    // a finished download.
    await execSql("DELETE FROM document_projection WHERE local_id = ?", [
      "deleted",
    ]);
    expect(await queries.listPendingDownloads()).toEqual([]);
    expect(await queries.listCompletedDownloads(refs)).toEqual([
      {
        // Where the document is shown, for a host to link to it.
        containerId: "root",
        documentId: "photo",
        localId: "photo",
        objectKind: "document",
        title: "Holiday.jpg",
      },
    ]);
    // A ref of the wrong kind names a different queue row.
    expect(
      await queries.listCompletedDownloads([
        { localId: "photo", objectKind: "container" },
      ]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a folder is complete once its metadata arrives", async () => {
  const { execSql, close } = await createTestExecSql(
    "completed-folder-downloads",
  );
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const doc = await createContainerMetadataDocument("folder");
    const container = {
      id: "folder",
      parentId: "root",
      organizationId: "org",
      metadataDocumentId: "metadata-folder",
      name: "Projects",
      icon: null,
    };
    const record = {
      id: "folder",
      documentId: "metadata-folder",
      accessEpoch: 1,
      snapshotEndVersion: "",
      metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
    };
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    const refs = [{ localId: "folder", objectKind: "container" }] as const;
    expect(await queries.listPendingDownloads()).toMatchObject([
      { localId: "folder", objectKind: "container" },
    ]);
    expect(await queries.listCompletedDownloads(refs)).toEqual([]);

    writeContainerMetadataValue(doc, { name: "Projects", icon: null });
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      container,
      { ...record, metadataUpdates: bytesToBase64(exportAllUpdates(doc)) },
    );
    expect(await queries.listPendingDownloads()).toEqual([]);
    expect(await queries.listCompletedDownloads(refs)).toEqual([
      {
        documentId: "metadata-folder",
        localId: "folder",
        objectKind: "container",
        title: "Projects",
      },
    ]);
  } finally {
    close();
  }
});

test("completed downloads are read in batches within the bind budget", async () => {
  const { execSql, close } = await createTestExecSql(
    "completed-download-batches",
  );
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await discoverDocument(queries, "last");
    const shell = await sqlDocumentsPersistence.loadDocument(execSql, "last");
    if (!shell) throw new Error("Expected discovery shell");
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...shell,
      title: "Last",
      snapshotEndVersion: emptyVersionVector(),
    });
    const refs = [
      ...Array.from({ length: 2_500 }, (_, index) => ({
        localId: `missing-${index}`,
        objectKind: "document" as const,
      })),
      { localId: "last", objectKind: "document" as const },
    ];
    expect(await queries.listCompletedDownloads(refs)).toMatchObject([
      { localId: "last", title: "Last" },
    ]);
  } finally {
    close();
  }
});

test("completed downloads search the documents primary key", async () => {
  const f = await createTestExecSql("completed-download-plan");
  const statements: Array<{ bind: Parameters<ExecSql>[1]; sql: string }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (sql.includes('"pull_continuation" is null'))
        statements.push({ bind, sql });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await queries.listCompletedDownloads([
      { localId: "a", objectKind: "document" },
      { localId: "b", objectKind: "container" },
    ]);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    if (!statement) throw new Error("Expected the completion statement");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
      statement.bind,
    );
    const details = plan.map((row) => String(Reflect.get(row, "detail")));
    expect(details).toContainEqual(
      expect.stringMatching(
        /^SEARCH documents USING INDEX \S+ \(app_kind=\? AND local_id=\?\)/,
      ),
    );
    expect(details.filter((detail) => detail.startsWith("SCAN"))).toEqual([]);
  } finally {
    f.close();
  }
});

test("a file is complete once its slot holds an attached local copy", async () => {
  const { execSql, close } = await createTestExecSql(
    "completed-file-downloads",
  );
  try {
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "drill",
      accessEpoch: 1,
      containerId: "folder",
      documentId: "drill-remote",
      documentKind: "note",
      effectiveAccessLevel: "admin",
      snapshotEndVersion: "synced-end-version",
      text: "Drill",
      title: "Drill",
    });
    const files = ["manual", "receipt"].map((slotId, index) => ({
      byteLength: 4,
      contentSha256: String(index).repeat(64),
      mimeType: "application/pdf",
      name: `${slotId}.pdf`,
      slotId,
    }));
    const doc = await createDocument("drill");
    try {
      addDocumentAttachments(doc, files);
      await execSql(
        "UPDATE document_projection_text SET attachment_names = ? WHERE local_id = ?",
        [serializeDocumentAttachmentNames(doc), "drill"],
      );
    } finally {
      doc.free();
    }
    const refs = files.map(({ slotId }) => ({
      localId: "drill",
      objectKind: "attachment" as const,
      slotId,
    }));
    expect(await queries.listPendingDownloads()).toHaveLength(2);
    expect(await queries.listCompletedDownloads(refs)).toEqual([]);

    for (const [index, file] of files.entries()) {
      await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
        blobId: `${file.slotId}-blob`,
        byteLength: file.byteLength,
        contentSha256: file.contentSha256,
        // The receipt was removed here before it reached the server.
        detachedAt: index === 1 ? "2026-11-21T00:00:00Z" : null,
        localId: "drill",
        mimeType: file.mimeType,
        slotId: file.slotId,
        storageKey: `blob-${file.slotId}`,
      });
    }
    expect(await queries.listPendingDownloads()).toEqual([]);
    expect(await queries.listCompletedDownloads(refs)).toEqual([
      {
        // The stored blob, for a host to open the file's detail.
        blobId: "manual-blob",
        containerId: "folder",
        documentId: "drill-remote",
        localId: "drill",
        objectKind: "attachment",
        slotId: "manual",
        storageKey: "blob-manual",
        title: "Drill",
      },
    ]);
    // A document ref is answered on its own, apart from its file slots.
    expect(
      await queries.listCompletedDownloads([
        { localId: "drill", objectKind: "document" },
      ]),
    ).toMatchObject([{ objectKind: "document" }]);
  } finally {
    close();
  }
});
