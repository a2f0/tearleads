import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentMoveIntentTables } from "../../sqlite/schema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";

function storedDocument(localId: string, documentId: string) {
  return {
    accessEpoch: 1,
    containerId: "container",
    documentId,
    id: localId,
    snapshotEndVersion: "frontier",
    text: localId,
  };
}

test("purge teardown refuses another local alias for the remote document", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-deletion-alias-test",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("local-a", "remote-document"),
    );
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("local-b", "remote-document"),
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-a",
    );
    if (!expectedRecord) throw new Error("Expected stored document");

    let callbackCalls = 0;
    await expect(
      sqlDocumentsPersistence.deleteDocumentIfMatches(
        execSql,
        expectedRecord,
        async () => {
          callbackCalls += 1;
        },
      ),
    ).resolves.toBe(false);
    await expect(
      sqlDocumentsPersistence.deleteDocumentSideRowsIfAbsent(
        execSql,
        "missing-local",
        "remote-document",
        async () => {
          callbackCalls += 1;
        },
      ),
    ).resolves.toBe(false);
    expect(callbackCalls).toBe(0);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-a"),
    ).resolves.not.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-b"),
    ).resolves.not.toBeNull();
  } finally {
    close();
  }
});

test("absent-record purge deletes remote document projections and move intents", async () => {
  const { close, execSql } = await createTestExecSql(
    "absent-document-deletion-test",
  );
  const documentId = "remote-document";
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, documentMoveIntentTables);
    await execSql(
      `INSERT INTO document_container_projection
        (document_id, container_id, updated_at)
       VALUES (?, ?, ?)`,
      [documentId, "container", "2026-08-27T00:00:00.000Z"],
    );
    await execSql(
      `INSERT INTO document_move_intents (
        id, local_id, document_id, target_container_id,
        replace_linked_containers, intent_type, sync_status, created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "move-intent",
        "missing-local",
        documentId,
        "target-container",
        0,
        "document.move",
        "pending",
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T00:00:00.000Z",
      ],
    );

    await expect(
      sqlDocumentsPersistence.deleteDocumentSideRowsIfAbsent(
        execSql,
        "missing-local",
        documentId,
        async () => undefined,
      ),
    ).resolves.toBe(true);
    await expect(
      execSql(
        `SELECT document_id FROM document_container_projection
         WHERE document_id = ?`,
        [documentId],
      ),
    ).resolves.toEqual([]);
    await expect(
      execSql(
        `SELECT document_id FROM document_move_intents
         WHERE document_id = ?`,
        [documentId],
      ),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});
