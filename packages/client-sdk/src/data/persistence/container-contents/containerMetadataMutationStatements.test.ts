import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { insertQueuedUpdateRows } from "../../../../test/helpers/queuedUpdateRows";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

test("a settling metadata mutation reads the structural intents once", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-mutation-structural-read",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-1",
      metadataDocumentId: "metadata-1",
      name: "Container",
      organizationId: "organization-1",
      parentId: null,
    };
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      {
        accessEpoch: 1,
        accessStateHash: "access-1",
        documentId: "metadata-1",
        id: container.id,
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
      {
        localUpdatedAt: T1,
        serverTimestamps: { createdAt: T1, updatedAt: T1 },
      },
    );
    await insertQueuedUpdateRows(execSql, [
      { appKind: "container-metadata", id: "rename", localId: container.id },
    ]);
    const state =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    if (!state?.record) throw new Error("Expected metadata state");
    const counted = countingExecSql(execSql);
    await sqlContainerContentsPersistence.ensureSchema(counted.execSql);
    const { record } = state;
    const results: Array<{ committed: boolean }> = [];
    const statements = await counted.count(async () => {
      const result =
        await sqlContainerContentsPersistence.commitMetadataMutation(
          counted.execSql,
          {
            acceptedPendingUpdateIds: ["rename"],
            container: { ...state.container, name: "Renamed" },
            expectedContainer: state.container,
            expectedRecord: record,
            preserveDurableStructureWhenPending: true,
            record: { ...record, metadataUpdates: "renamed" },
            saveOptions: { localUpdatedAt: T2 },
            settleAcceptedPendingOnConflict: true,
          },
        );
      results.push(result);
    });
    expect(results).toMatchObject([{ committed: true }]);
    // The settled queue and the structural intent read share one read (was
    // one more).
    expect(statements).toBe(13);
  } finally {
    close();
  }
});
