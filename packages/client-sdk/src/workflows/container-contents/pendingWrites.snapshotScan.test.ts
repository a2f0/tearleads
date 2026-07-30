import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

async function saveDeferredTailDocument(execSql: ExecSql): Promise<string> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const doc = await createDocument("pending-write-scan-doc");
  doc.getText("text").update("baseline");
  doc.commit();
  const pendingBaseVersion = encodeVersionVector(doc);
  doc.getText("text").update("deferred tail");
  doc.commit();

  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: "root",
      metadataDocumentId: "metadata-root",
      name: "/",
      organizationId: "organization-a",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: "access-root",
      documentId: "metadata-root",
      id: "root",
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
    {
      localUpdatedAt: UPDATED_AT,
      serverTimestamps: { createdAt: UPDATED_AT, updatedAt: UPDATED_AT },
    },
  );
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "root",
      documentId: "remote-scan-doc",
      documentKind: "note",
      id: "scan-document",
      pendingBaseVersion,
      snapshotEndVersion: encodeVersionVector(doc),
      text: "deferred tail",
      title: "Scan document",
    },
    { updatedAt: UPDATED_AT },
  );
  return encodeVersionVector(doc);
}

test("listPendingWrites never queries the durable content tables", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-snapshot-scan",
  );
  try {
    await saveDeferredTailDocument(execSql);

    const capturedSql: string[] = [];
    const spyExecSql = ((
      sql: string,
      bind?: Parameters<ExecSql>[1],
      options?: { rowMode?: "object" | "array" },
    ) => {
      capturedSql.push(sql);
      return execSql(sql, bind, options);
    }) as ExecSql;

    await sqlDocumentsPersistence.ensureSchema(spyExecSql);
    capturedSql.length = 0;
    const items = await listPendingWrites(spyExecSql);

    // The deferred tail must still be detected through the derived column...
    expect(
      items.find((item) => item.localId === "scan-document")?.operations,
    ).toEqual([expect.objectContaining({ kind: "deferred-update" })]);
    expect(
      capturedSql.some((sql) => sql.includes("snapshot_end_version")),
    ).toBe(true);
    // ...while the listing never materializes content blobs: content lives in
    // the durable-history tables (checkpoint + tail), and with the 1000-file
    // stress profile a content scan is O(total stored content) that re-fires
    // while sync drains. Schema DDL (CREATE/ALTER/PRAGMA) legitimately names
    // the tables; queries must not touch them.
    expect(
      capturedSql.filter(
        (sql) =>
          (sql.includes("document_history_checkpoints") ||
            sql.includes("document_history_updates")) &&
          !/^\s*(?:CREATE|ALTER|PRAGMA)/iu.test(sql),
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("document writers persist the snapshot end version of the saved content", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-snapshot-end-version",
  );
  try {
    const liveVersion = await saveDeferredTailDocument(execSql);

    const rows = await execSql(
      `SELECT snapshot_end_version FROM documents
       WHERE app_kind = 'documents' AND local_id = 'scan-document'`,
    );
    const persistedVersion = Reflect.get(rows[0] ?? {}, "snapshot_end_version");
    if (typeof persistedVersion !== "string") {
      throw new Error("Expected a persisted snapshot end version");
    }
    expect(persistedVersion).not.toBe("");
    expect(satisfiesVersionVector(persistedVersion, liveVersion)).toBe(true);
    expect(satisfiesVersionVector(liveVersion, persistedVersion)).toBe(true);
  } finally {
    close();
  }
});
