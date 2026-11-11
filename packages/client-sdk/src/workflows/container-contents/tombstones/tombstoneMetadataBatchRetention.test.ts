import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { QUEUED_UPDATES_SQL } from "../../../../test/helpers/queuedUpdateRows";
import { defaultContainerContentsPersistence as persistence } from "../containerPersistence";
import {
  ensurePendingWriteSchema,
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "../documentQueries/documentQueries.testFixtures";

const timestamp = "2026-01-03T00:00:00.000Z";

test("discovery removal retains populated metadata with later-batch pending work", async () => {
  const { close, execSql } = await createTestExecSql("metadata-removal-batch");
  const retainedId = "container-199";
  const removals = Array.from({ length: 200 }, (_, index) => ({
    containerId: `container-${index}`,
    reason: "access_revoked" as const,
    updatedAt: timestamp,
  }));
  try {
    await ensurePendingWriteSchema(execSql);
    for (const id of ["container-0", retainedId, "outside"]) {
      await saveTestSyncedContainer({
        execSql,
        id,
        name: id,
        organizationId: "organization",
        metadataUpdates: "c2VlZA==",
        timestamp,
      });
    }
    await insertTestPendingUpdate({
      execSql,
      appKind: "container-metadata",
      localId: retainedId,
      id: "queued-rename",
      updateData: "retained-payload",
      createdAt: timestamp,
    });
    const metadataBefore = await persistence.loadContainerMetadataRecord(
      execSql,
      retainedId,
    );
    expect(metadataBefore?.metadataUpdates).toBe("c2VlZA==");
    const queueBefore = await execSql(`SELECT * FROM ${QUEUED_UPDATES_SQL}`);
    expect(queueBefore).toHaveLength(1);

    expect(
      await persistence.deleteContainers(execSql, removals, {
        discoveryOnly: true,
      }),
    ).toEqual(removals.map(({ containerId }) => containerId));

    expect(await execSql("SELECT id FROM containers")).toEqual([
      { id: "outside" },
    ]);
    expect(
      await persistence.loadContainerMetadataRecord(execSql, retainedId),
    ).toEqual(metadataBefore);
    expect(await execSql("SELECT * FROM dormant_container_metadata")).toEqual([
      {
        container_id: retainedId,
        organization_id: "organization",
        retained_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);

    expect(await execSql(`SELECT * FROM ${QUEUED_UPDATES_SQL}`)).toEqual(
      queueBefore,
    );
    expect(
      await execSql(
        "SELECT local_id FROM documents WHERE app_kind = 'container-metadata' ORDER BY local_id",
      ),
    ).toEqual([{ local_id: retainedId }, { local_id: "outside" }]);
  } finally {
    await close();
  }
});
