import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  containerDocumentTombstoneHolds,
  documentContainerProjectionTables,
} from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../../sqlite/sqlTableSchema";
import { placementPairsMatch } from "./containerDocumentTombstoneHolds";

test("an empty placement list matches no row, so a delete removes nothing", async () => {
  const { close, execSql } = await createTestExecSql("placement-pairs-empty");
  try {
    await ensureSqlTables(execSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const hold = (documentId: string, containerId: string) => ({
      documentId,
      containerId,
      tombstonedAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    });
    await db
      .insert(containerDocumentTombstoneHolds)
      .values([hold("doc-1", "folder-1"), hold("doc-2", "folder-2")])
      .run();
    const deleteMatching = (
      placements: Parameters<typeof placementPairsMatch>[0],
    ) =>
      db
        .delete(containerDocumentTombstoneHolds)
        .where(
          placementPairsMatch(
            placements,
            containerDocumentTombstoneHolds.documentId,
            containerDocumentTombstoneHolds.containerId,
          ),
        )
        .run();
    const remaining = async () =>
      (
        await db
          .select({ documentId: containerDocumentTombstoneHolds.documentId })
          .from(containerDocumentTombstoneHolds)
      ).map((row) => row.documentId);

    await deleteMatching([]);
    expect((await remaining()).sort()).toEqual(["doc-1", "doc-2"]);
    // A listed pair still matches exactly its own row.
    await deleteMatching([{ documentId: "doc-1", containerId: "folder-1" }]);
    expect(await remaining()).toEqual(["doc-2"]);
  } finally {
    close();
  }
});
