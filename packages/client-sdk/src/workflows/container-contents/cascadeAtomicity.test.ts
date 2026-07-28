import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

async function seedContainerWithMetadata(execSql: ExecSql): Promise<void> {
  await listPendingWrites(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: "doomed",
      metadataDocumentId: "metadata-doomed",
      name: "Doomed",
      organizationId: "org-a",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: "access-doomed",
      documentId: "metadata-doomed",
      id: "doomed",
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
    {
      localUpdatedAt: T0,
      serverTimestamps: { createdAt: T0, updatedAt: T0 },
    },
  );
  await execSql(
    `INSERT INTO document_pending_updates (
      id, app_kind, local_id, update_data,
      partial_start_version_vector, partial_end_version_vector,
      source_version_vector, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      "rename-doomed",
      "container-metadata",
      "doomed",
      "payload",
      "{}",
      "{}",
      T1,
    ],
  );
}

async function countRows(
  execSql: ExecSql,
  sql: string,
  params: unknown[],
): Promise<number> {
  const rows = await execSql(sql, params);
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? -1);
}

// The cascade is ONE transaction: a crash at its last statement must leave
// it fully unapplied — container, intents, and metadata all intact — so the
// re-fetched tombstone can re-apply it, instead of stranding metadata rows
// that re-delivered tombstones would skip.
test("a mid-cascade crash leaves the cascade fully unapplied", async () => {
  const { close, execSql } = await createTestExecSql("cascade-atomicity");
  try {
    await seedContainerWithMetadata(execSql);

    const failingExecSql: ExecSql = async (sql, params) => {
      if (
        typeof sql === "string" &&
        /delete\s+from\s+"?container_sync_watermarks/i.test(sql)
      ) {
        throw new Error("injected crash before the cascade's last statement");
      }
      return execSql(sql, params);
    };

    await expect(
      defaultContainerContentsPersistence.deleteContainers(
        failingExecSql,
        ["doomed"],
        { updatedAt: T1 },
      ),
    ).rejects.toThrow(/container_sync_watermarks/);

    // Fully unapplied: nothing was deleted.
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "doomed",
      ),
    ).toBe(true);
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM documents
         WHERE app_kind = 'container-metadata' AND local_id = ?`,
        ["doomed"],
      ),
    ).toBe(1);
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM document_pending_updates
         WHERE app_kind = 'container-metadata' AND local_id = ?`,
        ["doomed"],
      ),
    ).toBe(1);

    // The re-applied cascade (the refetched tombstone) completes cleanly.
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["doomed"],
      { updatedAt: T1 },
    );
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "doomed",
      ),
    ).toBe(false);
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM document_pending_updates
         WHERE app_kind = 'container-metadata' AND local_id = ?`,
        ["doomed"],
      ),
    ).toBe(0);
  } finally {
    await close();
  }
});
