import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  containerCreateIntentTables,
  documentContainerProjectionTables,
} from "../../data/sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  type SqlBind,
  type SqlRowMode,
} from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

async function seedContainerWithMetadata(execSql: ExecSql): Promise<void> {
  await listPendingWrites(execSql);
  await ensureSqlTables(execSql, [
    ...containerCreateIntentTables,
    ...documentContainerProjectionTables,
  ]);
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
  await execSql(
    `INSERT INTO container_create_intents (
      id, container_id, parent_container_id, intent_type, sync_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["intent-doomed", "doomed", "root", "create", "pending", T0, T0],
  );
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "doomed",
      documentId: "remote-linked",
      documentKind: "note",
      id: "linked-doc",
      snapshotEndVersion: "",
      text: "linked",
      title: "linked",
    },
    { updatedAt: T0 },
  );
  await execSql(
    `INSERT INTO document_container_projection (document_id, container_id, updated_at)
     VALUES (?, ?, ?)`,
    ["remote-linked", "doomed", T0],
  );
}

async function linkedDocContainerId(execSql: ExecSql): Promise<unknown> {
  const rows = await execSql(
    "SELECT container_id AS c FROM document_projection WHERE local_id = ?",
    ["linked-doc"],
  );
  return Reflect.get(rows[0] ?? {}, "c");
}

async function countRows(
  execSql: ExecSql,
  sql: string,
  params: SqlBind,
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

    // Forward ALL arguments (including rowMode) so the wrapped connection
    // behaves identically to the real one for every statement it passes.
    const failingExecSql = (async (
      sql: string,
      bind?: SqlBind,
      options?: { rowMode?: SqlRowMode },
    ) => {
      if (/delete\s+from\s+"?container_sync_watermarks/i.test(sql)) {
        throw new Error("injected crash before the cascade's last statement");
      }
      return execSql(sql, bind, options as { rowMode: "array" });
    }) as ExecSql;

    await expect(
      defaultContainerContentsPersistence.deleteContainers(
        failingExecSql,
        ["doomed"],
        { updatedAt: T1 },
      ),
    ).rejects.toThrow();

    // Fully unapplied: nothing was deleted, repaired, or unlinked.
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "doomed",
      ),
    ).toBe(true);
    expect(await linkedDocContainerId(execSql)).toBe("doomed");
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM document_container_projection
         WHERE container_id = ?`,
        ["doomed"],
      ),
    ).toBe(1);
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM container_create_intents
         WHERE container_id = ?`,
        ["doomed"],
      ),
    ).toBe(1);
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
    // The retry orphaned the linked document and removed links and intents.
    expect(await linkedDocContainerId(execSql)).toBeNull();
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM document_container_projection
         WHERE container_id = ?`,
        ["doomed"],
      ),
    ).toBe(0);
    expect(
      await countRows(
        execSql,
        `SELECT COUNT(*) AS n FROM container_create_intents
         WHERE container_id = ?`,
        ["doomed"],
      ),
    ).toBe(0);
  } finally {
    await close();
  }
});
