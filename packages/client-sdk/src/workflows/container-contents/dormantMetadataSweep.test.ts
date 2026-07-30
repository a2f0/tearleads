import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  listDormantMetadataSweepRequests,
  requestDormantMetadataRestorationSweeps,
} from "../../data/persistence/container-contents/dormantMetadataSweep";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

async function saveContainer(
  execSql: ExecSql,
  containerId: string,
  organizationId = "peer-organization",
): Promise<void> {
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: containerId,
      metadataDocumentId: `metadata-${containerId}`,
      name: "Shared",
      organizationId,
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: `access-${containerId}`,
      documentId: `metadata-${containerId}`,
      id: containerId,
      metadataUpdates: "c2VlZA==",
      snapshotEndVersion: "seed-end",
    },
    {
      localUpdatedAt: T0,
      serverTimestamps: { createdAt: T0, updatedAt: T0 },
    },
  );
}

async function seedDormantCandidate(
  execSql: ExecSql,
  containerId: string,
  organizationId = "peer-organization",
): Promise<void> {
  await listPendingWrites(execSql);
  await saveContainer(execSql, containerId, organizationId);
  await execSql(
    `INSERT INTO document_pending_updates (
      id, app_kind, local_id, update_data,
      partial_start_version_vector, partial_end_version_vector,
      source_version_vector, created_at
    ) VALUES (?, 'container-metadata', ?, 'payload', '{}', '{}', NULL, ?)`,
    [`rename-${containerId}`, containerId, T1],
  );
}

async function countRows(
  execSql: ExecSql,
  table: "documents" | "document_pending_updates",
  localId: string,
): Promise<number> {
  const rows = await execSql(
    `SELECT COUNT(*) AS n FROM ${table}
     WHERE app_kind = 'container-metadata' AND local_id = ?`,
    [localId],
  );
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? 0);
}

async function countMarkers(execSql: ExecSql, containerId: string) {
  const rows = await execSql(
    `SELECT COUNT(*) AS n FROM dormant_container_metadata
     WHERE container_id = ?`,
    [containerId],
  );
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? 0);
}

test("restoration sweep purges only unmatched metadata in its organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-restoration-sweep",
  );
  try {
    await seedDormantCandidate(execSql, "deleted-after-revoke");
    await seedDormantCandidate(execSql, "reattached");
    await seedDormantCandidate(
      execSql,
      "other-organization",
      "other-organization",
    );
    for (const containerId of [
      "deleted-after-revoke",
      "reattached",
      "other-organization",
    ]) {
      await defaultContainerContentsPersistence.deleteContainers(
        execSql,
        [containerId],
        { retainMetadataForContainerIds: [containerId], updatedAt: T1 },
      );
    }

    // The completed crawl found this container, so saving it clears its marker.
    await saveContainer(execSql, "reattached");
    await requestDormantMetadataRestorationSweeps(execSql, {
      requesterUserId: "user-1",
    });
    const sweeps = await listDormantMetadataSweepRequests(execSql, "user-1");
    expect(sweeps.map((sweep) => sweep.organizationId)).toEqual([
      "other-organization",
      "peer-organization",
    ]);
    const sweep = sweeps.find(
      (candidate) => candidate.organizationId === "peer-organization",
    );
    if (!sweep) {
      throw new Error("Expected a restoration sweep");
    }
    const candidates =
      await defaultContainerContentsPersistence.listDormantMetadataSweepCandidates(
        execSql,
        sweep,
      );
    expect(candidates).toEqual(["deleted-after-revoke"]);
    await expect(
      defaultContainerContentsPersistence.purgeDormantContainerMetadataCandidates(
        execSql,
        sweep,
        candidates,
      ),
    ).resolves.toBe(1);

    expect(await countRows(execSql, "documents", "deleted-after-revoke")).toBe(
      0,
    );
    expect(
      await countRows(
        execSql,
        "document_pending_updates",
        "deleted-after-revoke",
      ),
    ).toBe(0);
    expect(await countMarkers(execSql, "deleted-after-revoke")).toBe(0);
    expect(await countRows(execSql, "documents", "reattached")).toBe(1);
    expect(await countMarkers(execSql, "reattached")).toBe(0);
    expect(await countRows(execSql, "documents", "other-organization")).toBe(1);
    expect(await countMarkers(execSql, "other-organization")).toBe(1);
  } finally {
    await close();
  }
});
