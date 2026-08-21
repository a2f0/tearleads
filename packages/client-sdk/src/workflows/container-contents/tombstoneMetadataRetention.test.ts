import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { encodeVersionVector, exportAllUpdates } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "./documentQueries.testFixtures";
import { listPendingWrites } from "./pendingWrites";
import { reattachDormantContainerMetadata } from "./remoteHydration/reattachMetadata";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

const METADATA_SCOPE = { appKind: "container-metadata", localId: "revoked" };

async function saveContainerRow(
  execSql: ExecSql,
  containerId: string,
  organizationId = "peer-organization",
): Promise<void> {
  await saveTestSyncedContainer({
    accessLevel: "write",
    execSql,
    id: containerId,
    metadataUpdates: "c2VlZA==",
    name: "Shared",
    organizationId,
    snapshotEndVersion: "seed-end",
    timestamp: T0,
  });
}

async function seedContainerWithQueuedRename(
  execSql: ExecSql,
  containerId: string,
  organizationId = "peer-organization",
): Promise<void> {
  await listPendingWrites(execSql);
  await saveContainerRow(execSql, containerId, organizationId);
  await execSql(
    `INSERT INTO document_history_updates (
      id, app_kind, local_id, update_data, origin, created_at
    ) VALUES (?, ?, ?, ?, 'local', ?)`,
    [`tail-${containerId}`, "container-metadata", containerId, "payload", T1],
  );
  await insertTestPendingUpdate({
    appKind: "container-metadata",
    createdAt: T1,
    execSql,
    id: `rename-${containerId}`,
    localId: containerId,
  });
}

async function countDormantMarkers(
  execSql: ExecSql,
  containerId: string,
): Promise<number> {
  const rows = await execSql(
    `SELECT COUNT(*) AS n FROM dormant_container_metadata
     WHERE container_id = ?`,
    [containerId],
  );
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? 0);
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
    // The metadata document's durable history goes with its record — no
    // orphaned checkpoint or tail rows behind a deleted cascade.
    expect(
      await countRows(execSql, "document_history_checkpoints", "doomed"),
    ).toBe(0);
    expect(await countRows(execSql, "document_history_updates", "doomed")).toBe(
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
    expect(await countDormantMarkers(execSql, "revoked")).toBe(1);
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

test("a later deleted tombstone purges dormant retained metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-purge",
  );
  try {
    await seedContainerWithQueuedRename(execSql, "revoked");
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );
    expect(
      await countRows(execSql, "document_pending_updates", "revoked"),
    ).toBe(1);

    // The container is already absent locally; the purge call carries no
    // retain entry, mirroring a later `deleted` tombstone for the same id.
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { updatedAt: T1 },
    );

    expect(await countRows(execSql, "documents", "revoked")).toBe(0);
    expect(
      await countRows(execSql, "document_pending_updates", "revoked"),
    ).toBe(0);
    expect(await countRows(execSql, "document_sync_failures", "revoked")).toBe(
      0,
    );
    // The dormant purge drops the retained document's history rows too.
    expect(
      await countRows(execSql, "document_history_checkpoints", "revoked"),
    ).toBe(0);
    expect(
      await countRows(execSql, "document_history_updates", "revoked"),
    ).toBe(0);
    expect(await countDormantMarkers(execSql, "revoked")).toBe(0);
  } finally {
    await close();
  }
});

test("dormant metadata loads by container id for re-attachment", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-metadata-load");
  try {
    await seedContainerWithQueuedRename(execSql, "revoked");
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );

    const dormant =
      await defaultContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        "revoked",
      );
    expect(dormant).toMatchObject({
      documentId: "metadata-revoked",
      id: "revoked",
      metadataUpdates: "c2VlZA==",
    });
  } finally {
    await close();
  }
});

test("dormant metadata stays out of the write queue until re-attach", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-visibility",
  );
  try {
    await seedContainerWithQueuedRename(execSql, "revoked");
    const listed = await listPendingWrites(execSql);
    expect(listed.some((item) => item.localId === "revoked")).toBe(true);

    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );
    const dormantListed = await listPendingWrites(execSql);
    expect(dormantListed.some((item) => item.localId === "revoked")).toBe(
      false,
    );

    // Access restored: the container row returns; the retained queue item
    // resurfaces with it.
    await saveContainerRow(execSql, "revoked");
    const restored = await listPendingWrites(execSql);
    expect(restored.some((item) => item.localId === "revoked")).toBe(true);
  } finally {
    await close();
  }
});

test("revoke then rehydrate re-attaches dormant metadata content", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-reattach",
  );
  try {
    // Seed with REAL metadata content: a queued local rename to "Renamed".
    const authoredDoc = await createContainerMetadataDocument("revoked");
    writeContainerMetadataValue(authoredDoc, {
      icon: "folder-special",
      name: "Renamed",
    });
    const authoredSnapshot = bytesToBase64(exportAllUpdates(authoredDoc));
    await seedContainerWithQueuedRename(execSql, "revoked");
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: "revoked",
        metadataDocumentId: "metadata-revoked",
        name: "Shared",
        organizationId: "peer-organization",
        parentId: null,
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-revoked",
        documentId: "metadata-revoked",
        id: "revoked",
        metadataUpdates: authoredSnapshot,
        snapshotEndVersion: "",
      },
      { localUpdatedAt: T1 },
    );

    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );

    // Access restored: rehydration discovers the container fresh, loads the
    // dormant record, and re-attaches its content instead of seeding empty.
    const dormantRecord =
      await defaultContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        "revoked",
      );
    expect(dormantRecord?.metadataUpdates).toBe(authoredSnapshot);

    const rehydratedDoc = await createContainerMetadataDocument("revoked");
    const reattached = reattachDormantContainerMetadata({
      defaultName: "Untitled",
      doc: rehydratedDoc,
      dormantRecord: dormantRecord ?? null,
      remoteMetadataDocumentId: "metadata-revoked",
    });
    expect(reattached).toEqual({
      icon: "folder-special",
      initialSnapshot: authoredSnapshot,
      lastCommitLsn: null,
      name: "Renamed",
      snapshotEndVersion: dormantRecord?.snapshotEndVersion ?? "",
    });

    // A rotated metadata document id means the dormant stream is dead: no
    // content, marker, or LSN cursor may carry over.
    const freshDoc = await createContainerMetadataDocument("revoked");
    const mismatched = reattachDormantContainerMetadata({
      defaultName: "Untitled",
      doc: freshDoc,
      dormantRecord: dormantRecord ?? null,
      remoteMetadataDocumentId: "metadata-replaced",
    });
    expect(mismatched.name).toBe("Untitled");
    expect(mismatched.lastCommitLsn).toBeNull();
    expect(mismatched.snapshotEndVersion).toBe("");
    expect(mismatched.initialSnapshot).not.toBe(authoredSnapshot);
  } finally {
    await close();
  }
});

test("dormant metadata stays out of deferred-tail candidates", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-metadata-deferred",
  );
  try {
    const authoredDoc = await createContainerMetadataDocument("revoked");
    writeContainerMetadataValue(authoredDoc, {
      icon: null,
      name: "Renamed",
    });
    const authoredSnapshot = bytesToBase64(exportAllUpdates(authoredDoc));
    const authoredVersion = encodeVersionVector(authoredDoc);
    await seedContainerWithQueuedRename(execSql, "revoked");
    // Give the metadata document a real content frontier so the deferred-tail
    // candidate query considers it (an empty marker was masking this path).
    await execSql(
      `UPDATE documents
       SET snapshot_end_version = ?, pending_base_version = ''
       WHERE app_kind = 'container-metadata' AND local_id = ?`,
      [authoredVersion, "revoked"],
    );
    await execSql(
      `UPDATE document_pending_updates SET update_data = ?
       WHERE app_kind = 'container-metadata' AND local_id = ?`,
      [authoredSnapshot, "revoked"],
    );

    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["revoked"],
      { retainMetadataForContainerIds: ["revoked"], updatedAt: T1 },
    );

    const dormantListed = await listPendingWrites(execSql);
    expect(dormantListed.some((item) => item.localId === "revoked")).toBe(
      false,
    );

    await saveContainerRow(execSql, "revoked");
    const restored = await listPendingWrites(execSql);
    expect(restored.some((item) => item.localId === "revoked")).toBe(true);
  } finally {
    await close();
  }
});
