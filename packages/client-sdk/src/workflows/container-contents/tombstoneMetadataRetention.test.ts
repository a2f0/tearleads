import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

const METADATA_SCOPE = { appKind: "container-metadata", localId: "revoked" };

async function seedContainerWithQueuedRename(
  execSql: ExecSql,
  containerId: string,
): Promise<void> {
  await listPendingWrites(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: containerId,
      metadataDocumentId: `metadata-${containerId}`,
      name: "Shared",
      organizationId: "peer-organization",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: `access-${containerId}`,
      documentId: `metadata-${containerId}`,
      id: containerId,
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
      `rename-${containerId}`,
      "container-metadata",
      containerId,
      "payload",
      "{}",
      "{}",
      T1,
    ],
  );
}

async function countRows(
  execSql: ExecSql,
  table: string,
  localId: string,
): Promise<number> {
  const rows = await execSql(
    `SELECT COUNT(*) AS n FROM ${table}
     WHERE app_kind = 'container-metadata' AND local_id = ?`,
    [localId],
  );
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? 0);
}

test("deleted cascade drops the metadata document and queue", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-deleted",
  );
  try {
    await seedContainerWithQueuedRename(execSql, "doomed");

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
    expect(await countRows(execSql, "documents", "doomed")).toBe(0);
    expect(await countRows(execSql, "document_pending_updates", "doomed")).toBe(
      0,
    );
  } finally {
    await close();
  }
});

test("access_revoked cascade retains the metadata document dormant", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-revoked",
  );
  try {
    await seedContainerWithQueuedRename(execSql, "revoked");
    await recordDocumentSyncFailure(execSql, METADATA_SCOPE, {
      attemptedAt: T1,
      message: "Container metadata sync failed",
      status: 403,
    });

    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );

    // The container row itself is gone either way…
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "revoked",
      ),
    ).toBe(false);
    // …but the metadata document, its queued rename, and its failure row
    // survive, keyed by the stable container id, so access restoration
    // re-attaches them when rehydration recreates the container.
    expect(await countRows(execSql, "documents", "revoked")).toBe(1);
    expect(
      await countRows(execSql, "document_pending_updates", "revoked"),
    ).toBe(1);
    expect(await countRows(execSql, "document_sync_failures", "revoked")).toBe(
      1,
    );
  } finally {
    await close();
  }
});

test("mixed cascade retains only the revoked container's metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-mixed",
  );
  try {
    await seedContainerWithQueuedRename(execSql, "doomed");
    await seedContainerWithQueuedRename(execSql, "revoked");

    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["doomed", "revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );

    expect(await countRows(execSql, "document_pending_updates", "doomed")).toBe(
      0,
    );
    expect(
      await countRows(execSql, "document_pending_updates", "revoked"),
    ).toBe(1);
  } finally {
    await close();
  }
});
