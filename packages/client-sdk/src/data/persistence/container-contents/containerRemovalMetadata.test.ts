import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";
import { captureRemovalPlacementHeads } from "./containerRemovalPlacements";

test("confirmed removal queued behind a metadata commit preserves the newer folder", async () => {
  const { execSql, close } = await createTestExecSql(
    "confirmed-removal-metadata-commit",
  );
  const stamp = "2026-01-02T00:00:00.000Z";
  try {
    await persistence.ensureSchema(execSql);
    const container = {
      id: "folder",
      name: "Folder",
      icon: null,
      metadataDocumentId: "metadata",
      organizationId: "org",
      parentId: null,
      serverUpdatedAt: stamp,
    };
    const record = {
      id: container.id,
      documentId: "metadata",
      accessEpoch: 1,
      accessStateHash: "head",
      metadataUpdates: "",
      snapshotEndVersion: "",
    };
    await persistence.saveContainer(execSql, container, record, {
      localUpdatedAt: stamp,
    });
    const before = await persistence.loadContainerMetadataState(
      execSql,
      container.id,
    );
    if (!before?.record) throw new Error("Expected the original metadata");
    const placementHash =
      (await captureRemovalPlacementHeads(execSql, [container.id])).get(
        container.id,
      ) ?? null;
    const earlier = before.record;
    const changed = { ...earlier, accessStateHash: "new-head" };
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = runSerializedSqlMutation(execSql, async (locked) => {
      acquired.resolve();
      await release.promise;
      return persistence.commitMetadataMutation(locked, {
        acceptedPendingUpdateIds: [],
        settleAcceptedPendingOnConflict: false,
        container: before.container,
        expectedContainer: before.container,
        expectedRecord: earlier,
        record: changed,
        saveOptions: { localUpdatedAt: stamp },
      });
    });
    await acquired.promise;
    const removal = {
      containerId: container.id,
      reason: "access_revoked" as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remove = (expectedMetadata: typeof earlier) =>
      persistence.deleteContainers(execSql, [removal], {
        discoveryOnly: true,
        expectedContainers: [
          {
            containerId: container.id,
            expectedContainer: before.container,
            confirmedAccessLoss: { expectedMetadata, placementHash },
          },
        ],
      });
    const queued = remove(earlier);
    release.resolve();
    expect(await writer).toMatchObject({ committed: true });
    expect(await queued).toEqual([]);
    expect(
      (await persistence.loadContainerMetadataState(execSql, container.id))
        ?.record?.accessStateHash,
    ).toBe("new-head");
    expect(await remove(changed)).toEqual([container.id]);
  } finally {
    close();
  }
});
