import { expect, test } from "bun:test";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { enqueuePendingContainerUpdate } from "../../../workflows/container-contents/containerPersistence";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

test("a refused metadata generation rolls back the mutation transaction", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-generation-guard",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-generation-guard",
      metadataDocumentId: "metadata-generation-guard",
      name: "Original",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: container.metadataDocumentId,
      id: container.id,
      metadataUpdates: "original-update",
      snapshotEndVersion: "original-version",
    };
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
      { localUpdatedAt: "2026-01-01T00:00:01.000Z" },
    );
    const current =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    if (!current?.record) throw new Error("Expected metadata state");

    await expect(
      sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: { ...current.container, name: "Stale rename" },
        expectedContainer: current.container,
        expectedRecord: current.record,
        record: { ...current.record, metadataUpdates: "stale update" },
        settleAcceptedPendingOnConflict: false,
        stillCurrent: () => false,
      }),
    ).resolves.toMatchObject({
      committed: false,
      currentState: {
        container: { name: "Original" },
        record: { metadataUpdates: "original-update" },
      },
    });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      container: { name: "Original" },
      record: { metadataUpdates: "original-update" },
    });
  } finally {
    close();
  }
});

test("an expired generation rolls back superseded update settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-settlement-generation-guard",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-settlement-generation-guard",
      metadataDocumentId: "metadata-settlement-generation-guard",
      name: "Original",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: container.metadataDocumentId,
      id: container.id,
      metadataUpdates: "original-update",
      snapshotEndVersion: "original-version",
    };
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    const pendingDocument = await createDocument("metadata-settlement-pending");
    pendingDocument.getText("content").insert(0, "queued edit");
    const pendingUpdateId = await enqueuePendingContainerUpdate(
      execSql,
      sqlContainerContentsPersistence,
      { containerId: container.id, update: exportAllUpdates(pendingDocument) },
    );
    if (!pendingUpdateId) throw new Error("Expected pending metadata update");
    let current = true;
    const persistence: typeof sqlContainerContentsPersistence = {
      ...sqlContainerContentsPersistence,
      settleAcceptedMetadataPendingUpdates(...args) {
        current = false;
        return sqlContainerContentsPersistence.settleAcceptedMetadataPendingUpdates(
          ...args,
        );
      },
    };

    await expect(
      persistence.settleAcceptedMetadataPendingUpdates(execSql, {
        containerId: container.id,
        expectedRecord: record,
        pendingUpdateIds: [pendingUpdateId],
        stillCurrent: () => current,
      }),
    ).resolves.toBeNull();
    await expect(
      sqlContainerContentsPersistence.listPendingUpdates(execSql, container.id),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});
