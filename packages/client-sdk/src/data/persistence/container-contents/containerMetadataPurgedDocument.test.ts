import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

const PURGED_DOCUMENT_ID = "metadata-purged";

function container(id: string, metadataDocumentId: string) {
  return {
    effectiveAccessLevel: "write" as const,
    icon: null,
    id,
    metadataDocumentId,
    name: id,
    organizationId: "organization-1",
    parentId: null,
  };
}

function record(id: string, documentId: string) {
  return {
    accessEpoch: 1,
    accessStateHash: `access-${id}`,
    documentId,
    id,
    metadataUpdates: "",
    snapshotEndVersion: "",
  };
}

test("a container's metadata never recreates a locally purged document row", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-metadata-purged-document",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO document_purge_checkpoints
         (document_id, organization_id, document_manifest_hash, purge_event_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        PURGED_DOCUMENT_ID,
        "organization-1",
        "a".repeat(64),
        "b".repeat(64),
        "2026-10-27T00:00:00.000Z",
      ],
    );

    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container("container-purged", PURGED_DOCUMENT_ID),
      record("container-purged", PURGED_DOCUMENT_ID),
    );
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container("container-live", "metadata-live"),
      record("container-live", "metadata-live"),
    );

    await expect(
      sqlContainerContentsPersistence.containerExists(
        execSql,
        "container-purged",
      ),
    ).resolves.toBe(true);
    const purgedRows = await execSql(
      "SELECT local_id FROM documents WHERE document_id = ?",
      [PURGED_DOCUMENT_ID],
    );
    expect(purgedRows).toEqual([]);
    const liveRows = await execSql(
      "SELECT local_id FROM documents WHERE document_id = ?",
      ["metadata-live"],
    );
    expect(liveRows).toHaveLength(1);
  } finally {
    close();
  }
});
