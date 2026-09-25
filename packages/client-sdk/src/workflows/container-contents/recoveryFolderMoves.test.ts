import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultContainerContentsPersistence as persistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import { saveTestSyncedContainer } from "./documentQueries.testFixtures";

test("recovery distinguishes a queued folder move from an inaccessible shared parent", async () => {
  const { execSql, close } = await createTestExecSql("recovery-folder-moves");
  try {
    await persistence.ensureSchema(execSql);
    for (const id of ["shared", "moving"])
      await saveTestSyncedContainer({
        execSql,
        id,
        name: id,
        organizationId: "org",
        parentId: "missing",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    const scope = { currentOrganizationId: "org" };
    expect(await queries.listRecoveryFolderMoveIds(scope)).toEqual([]);
    expect(await queries.hasOrphanedDocuments(scope)).toBe(false);
    const moving = await persistence.loadContainerMetadataState(
      execSql,
      "moving",
    );
    if (!moving?.record) throw new Error("Missing folder metadata");
    await persistence.saveContainer(execSql, moving.container, moving.record, {
      moveIntent: {
        parentContainerId: "missing",
        previousParentContainerId: "previous",
      },
    });
    expect(await queries.listRecoveryFolderMoveIds(scope)).toEqual(["moving"]);
    expect(await queries.hasOrphanedDocuments(scope)).toBe(true);
    expect(
      await queries.listRecoveryFolderMoveIds({
        currentOrganizationId: "other",
      }),
    ).toEqual([]);
    await execSql("UPDATE container_move_intents SET sync_status = 'blocked'");
    expect(await queries.listRecoveryFolderMoveIds(scope)).toEqual(["moving"]);
    await saveTestSyncedContainer({
      execSql,
      id: "missing",
      name: "Restored parent",
      organizationId: "org",
      timestamp: "2026-01-02T00:00:00.000Z",
    });
    expect(await queries.listRecoveryFolderMoveIds(scope)).toEqual([]);
    expect(await queries.hasOrphanedDocuments(scope)).toBe(false);
  } finally {
    await close();
  }
});
