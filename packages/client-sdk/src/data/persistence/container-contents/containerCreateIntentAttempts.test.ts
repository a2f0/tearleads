import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

// A create stuck in error must show WHEN it last failed, like the move
// intent twin: the recorder stamps last_attempted_at alongside the message.
test("recording a create intent error stamps the attempt time", async () => {
  const { close, execSql } = await createTestExecSql("create-intent-attempts");
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container-1', 'root', 'container.create',
        'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    const [before] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(before?.lastAttemptedAt).toBeNull();

    await sqlContainerContentsPersistence.recordCreateIntentRevisionError(
      execSql,
      {
        containerId: "container-1",
        expectedIntentId: "intent-1",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        message: "create refused",
      },
    );

    const [after] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(after?.lastError).toBe("create refused");
    expect(after?.lastAttemptedAt).toBe(after?.updatedAt ?? "");
    expect(after?.lastAttemptedAt).not.toBeNull();
  } finally {
    close();
  }
});

test("create intent settlement reports overtaking and generation races", async () => {
  const { close, execSql } = await createTestExecSql(
    "create-intent-settlement-races",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container-1', 'root', 'container.create',
        'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    const settlement = {
      containerId: "container-1",
      expectedIntentId: "intent-1",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      remoteContainerId: "container-1",
      remoteMetadataAccessStateHash: "access-state-1",
      remoteMetadataDocumentId: "metadata-1",
    };

    expect(
      await sqlContainerContentsPersistence.markCreateIntentRevisionSynced(
        execSql,
        {
          ...settlement,
          expectedUpdatedAt: "stale-intent-version",
          stillCurrent: () => true,
        },
      ),
    ).toBe(false);
    expect(
      await sqlContainerContentsPersistence.markCreateIntentRevisionSynced(
        execSql,
        {
          ...settlement,
          stillCurrent: () => false,
        },
      ),
    ).toBe(false);
    expect(
      await sqlContainerContentsPersistence.markCreateIntentRevisionSynced(
        execSql,
        {
          ...settlement,
          stillCurrent: () => true,
        },
      ),
    ).toBe(true);
    expect(
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("an overtaking create can atomically adopt remote identity as a move", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-create-intent-atomic-settlement",
  );
  const sameUpdatedAt = "2026-09-01T00:00:00.000Z";
  const record = {
    accessEpoch: 1,
    accessStateHash: "local-access",
    documentId: "local-metadata",
    id: "child-atomic-create",
    metadataUpdates: "",
    snapshotEndVersion: "",
  };
  const container = {
    effectiveAccessLevel: "admin" as const,
    icon: null,
    id: record.id,
    metadataDocumentId: record.documentId,
    name: "Child",
    organizationId: "org-1",
    parentId: "stale-parent",
  };

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
      {
        createIntent: { parentContainerId: "stale-parent" },
        localUpdatedAt: sameUpdatedAt,
      },
    );
    const [staleIntent] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!staleIntent) throw new Error("missing stale create intent");

    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      { ...container, parentId: "winning-parent" },
      record,
      {
        createIntent: { parentContainerId: "winning-parent" },
        localUpdatedAt: sameUpdatedAt,
      },
    );
    const [winningIntent] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    const current =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    expect(winningIntent?.updatedAt).toBe(staleIntent.updatedAt);
    expect(winningIntent?.id).not.toBe(staleIntent.id);
    if (!current?.record || !winningIntent) return;

    await expect(
      sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: {
          ...current.container,
          metadataDocumentId: "remote-metadata",
          parentId: "stale-parent",
        },
        createIntentSettlement: {
          containerId: staleIntent.containerId,
          expectedIntentId: staleIntent.id,
          expectedUpdatedAt: staleIntent.updatedAt,
          remoteContainerId: staleIntent.containerId,
          remoteMetadataAccessStateHash: "remote-access",
          remoteMetadataDocumentId: "remote-metadata",
        },
        expectedContainer: current.container,
        expectedRecord: current.record,
        record: {
          ...current.record,
          accessEpoch: 1,
          accessStateHash: "remote-access",
          documentId: "remote-metadata",
        },
        settleAcceptedPendingOnConflict: false,
      }),
    ).rejects.toThrow("superseded before local settlement");

    const durable =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    expect(durable?.container.parentId).toBe("winning-parent");
    expect(durable?.container.metadataDocumentId).toBe(record.documentId);
    expect(durable?.record).toMatchObject(record);
    expect(
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
    ).toEqual([
      expect.objectContaining({
        id: winningIntent.id,
        parentContainerId: "winning-parent",
        syncStatus: "pending",
      }),
    ]);

    const converted =
      await sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: {
          ...current.container,
          metadataDocumentId: "remote-metadata",
          parentId: "stale-parent",
        },
        createIntentSettlement: {
          containerId: staleIntent.containerId,
          expectedIntentId: staleIntent.id,
          expectedUpdatedAt: staleIntent.updatedAt,
          remoteContainerId: staleIntent.containerId,
          remoteMetadataAccessStateHash: "remote-access",
          remoteMetadataDocumentId: "remote-metadata",
          supersededMovePreviousParentId: "stale-parent",
        },
        expectedContainer: current.container,
        expectedRecord: current.record,
        preserveDurableStructureWhenPending: true,
        record: {
          ...current.record,
          accessEpoch: 1,
          accessStateHash: "remote-access",
          documentId: "remote-metadata",
        },
        settleAcceptedPendingOnConflict: false,
      });

    expect(converted).toMatchObject({
      committed: true,
      createIntentSettled: true,
    });
    const adopted =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    expect(adopted?.container).toMatchObject({
      metadataDocumentId: "remote-metadata",
      parentId: "winning-parent",
    });
    expect(adopted?.record).toMatchObject({
      accessStateHash: "remote-access",
      documentId: "remote-metadata",
    });
    expect(
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
    ).toEqual([]);
    expect(
      await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql),
    ).toEqual([
      expect.objectContaining({
        containerId: container.id,
        parentContainerId: "winning-parent",
        previousParentContainerId: "stale-parent",
        syncStatus: "pending",
      }),
    ]);
  } finally {
    close();
  }
});
