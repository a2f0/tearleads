import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

function container(id: string) {
  return {
    effectiveAccessLevel: "write" as const,
    icon: null,
    id,
    metadataDocumentId: `metadata-${id}`,
    name: id,
    organizationId: "organization-1",
    parentId: null,
  };
}

function record(id: string) {
  return {
    accessEpoch: 1,
    accessStateHash: `access-${id}`,
    documentId: `metadata-${id}`,
    id,
    metadataUpdates: "",
    snapshotEndVersion: "",
  };
}

test("metadata settlement cannot delete another container's pending id", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-metadata-accepted-scope",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    for (const id of ["container-a", "container-b"]) {
      await sqlContainerContentsPersistence.saveContainer(
        execSql,
        container(id),
        record(id),
      );
    }
    const acceptedA =
      await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
        containerId: "container-a",
        partialEndVersionVector: "end-a",
        partialStartVersionVector: "start-a",
        sourceVersionVector: null,
        updateData: "update-a",
      });
    const foreignB = await sqlContainerContentsPersistence.enqueuePendingUpdate(
      execSql,
      {
        containerId: "container-b",
        partialEndVersionVector: "end-b",
        partialStartVersionVector: "start-b",
        sourceVersionVector: null,
        updateData: "update-b",
      },
    );
    const storedA =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        "container-a",
      );
    if (!storedA?.record) throw new Error("Expected container A metadata");

    await sqlContainerContentsPersistence.settleAcceptedMetadataPendingUpdates(
      execSql,
      {
        containerId: "container-a",
        expectedRecord: storedA.record,
        pendingUpdateIds: [acceptedA, foreignB],
      },
    );

    await expect(
      sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        "container-a",
      ),
    ).resolves.toEqual([]);
    await expect(
      sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        "container-b",
      ),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});
