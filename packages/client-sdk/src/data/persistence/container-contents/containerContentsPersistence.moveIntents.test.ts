import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

// Regression guard: a blocked move intent (its destination parent has not synced
// yet — the common boot-time case) is still an unsynced local move.
// listUnsyncedMoveIntents must keep returning it, or hydration's
// parent-preserve logic would revert the local move.
test("listUnsyncedMoveIntents returns blocked moves until they sync", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-unsynced-move-intents-test",
  );

  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "child-1",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "child-1-metadata-document",
        name: "Child",
        organizationId: "org-1",
        parentId: "new-parent",
      },
      null,
      {
        moveIntent: {
          parentContainerId: "new-parent",
          previousParentContainerId: "old-parent",
        },
      },
    );

    expect(
      (await persistence.listUnsyncedMoveIntents(execSql)).map(
        (intent) => intent.containerId,
      ),
    ).toEqual(["child-1"]);

    // The destination parent is not synced yet, so the move is marked blocked.
    await persistence.recordMoveIntentError(execSql, {
      blocked: true,
      containerId: "child-1",
      message: "Container move destination parent is not synced yet",
    });

    // Blocked rows keep replaying: the list still returns the move, with the
    // blocked status preserved for the queue UI.
    expect(
      (await persistence.listUnsyncedMoveIntents(execSql)).map(
        (intent) => intent.syncStatus,
      ),
    ).toEqual(["blocked"]);

    // Syncing the move deletes the row, so the list no longer returns it.
    const [blockedIntent] = await persistence.listUnsyncedMoveIntents(execSql);
    expect(
      await persistence.markMoveIntentSynced(execSql, {
        containerId: "child-1",
        expectedIntentId: blockedIntent?.id ?? "",
        expectedUpdatedAt: "stale-intent-version",
        stillCurrent: () => true,
      }),
    ).toBe(false);
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toHaveLength(1);

    expect(
      await persistence.markMoveIntentSynced(execSql, {
        containerId: "child-1",
        expectedIntentId: blockedIntent?.id ?? "",
        expectedUpdatedAt: blockedIntent?.updatedAt ?? "",
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toHaveLength(1);

    expect(
      await persistence.markMoveIntentSynced(execSql, {
        containerId: "child-1",
        expectedIntentId: blockedIntent?.id ?? "",
        expectedUpdatedAt: blockedIntent?.updatedAt ?? "",
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toEqual([]);
  } finally {
    close();
  }
});

test("a decorated atomic committer reports successful move settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-move-intent-decorated-settlement",
  );
  const metadataRecord = {
    accessEpoch: 1,
    accessStateHash: "access-decorated",
    documentId: "metadata-decorated",
    id: "child-decorated",
    metadataUpdates: "",
    snapshotEndVersion: "",
  };
  const container = {
    effectiveAccessLevel: "admin" as const,
    icon: null,
    id: "child-decorated",
    metadataDocumentId: metadataRecord.documentId,
    name: "Child",
    organizationId: "org-1",
    parentId: "source",
  };
  const decoratedCommit: typeof persistence.commitMetadataMutation = async (
    ...args
  ) => persistence.commitMetadataMutation(...args);

  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(
      execSql,
      { ...container, parentId: "target" },
      metadataRecord,
      {
        moveIntent: {
          parentContainerId: "target",
          previousParentContainerId: "source",
        },
      },
    );
    const [intent] = await persistence.listUnsyncedMoveIntents(execSql);
    const current = await persistence.loadContainerMetadataState(
      execSql,
      container.id,
    );
    if (!intent || !current?.record) {
      throw new Error("Expected a stored container move intent");
    }

    const result = await decoratedCommit(execSql, {
      acceptedPendingUpdateIds: [],
      container: current.container,
      expectedContainer: current.container,
      expectedRecord: current.record,
      moveIntentSettlement: {
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
      },
      record: current.record,
      settleAcceptedPendingOnConflict: false,
    });

    expect(result).toMatchObject({
      committed: true,
      moveIntentSettled: true,
    });
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toEqual([]);
  } finally {
    close();
  }
});

test("an overtaking same-tick move rolls stale container persistence back", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-move-intent-atomic-settlement",
  );
  const sameUpdatedAt = "2026-09-01T00:00:00.000Z";
  const metadataRecord = {
    accessEpoch: 1,
    accessStateHash: "access-1",
    documentId: "metadata-1",
    id: "child-atomic",
    metadataUpdates: "",
    snapshotEndVersion: "",
  };
  const container = {
    effectiveAccessLevel: "admin" as const,
    icon: null,
    id: "child-atomic",
    metadataDocumentId: metadataRecord.documentId,
    name: "Child",
    organizationId: "org-1",
    parentId: "source",
  };

  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(
      execSql,
      { ...container, parentId: "stale-target" },
      metadataRecord,
      {
        localUpdatedAt: sameUpdatedAt,
        moveIntent: {
          parentContainerId: "stale-target",
          previousParentContainerId: "source",
        },
      },
    );
    const [staleIntent] = await persistence.listUnsyncedMoveIntents(execSql);
    expect(staleIntent).toBeDefined();
    if (!staleIntent) return;

    await persistence.saveContainer(
      execSql,
      { ...container, parentId: "winning-target" },
      metadataRecord,
      {
        localUpdatedAt: sameUpdatedAt,
        moveIntent: {
          parentContainerId: "winning-target",
          previousParentContainerId: "stale-target",
        },
      },
    );
    const [winningIntent] = await persistence.listUnsyncedMoveIntents(execSql);
    const current = await persistence.loadContainerMetadataState(
      execSql,
      container.id,
    );
    expect(winningIntent?.updatedAt).toBe(staleIntent.updatedAt);
    expect(winningIntent?.id).not.toBe(staleIntent.id);
    if (!current?.record || !winningIntent) return;

    await expect(
      persistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        moveIntentSettlement: {
          containerId: staleIntent.containerId,
          expectedIntentId: staleIntent.id,
          expectedUpdatedAt: staleIntent.updatedAt,
        },
        container: { ...current.container, parentId: "stale-target" },
        expectedContainer: current.container,
        expectedRecord: current.record,
        record: current.record,
        settleAcceptedPendingOnConflict: false,
      }),
    ).rejects.toThrow("superseded before local settlement");

    expect(
      (await persistence.loadContainerMetadataState(execSql, container.id))
        ?.container.parentId,
    ).toBe("winning-target");
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toEqual([
      expect.objectContaining({
        id: winningIntent.id,
        parentContainerId: "winning-target",
      }),
    ]);
  } finally {
    close();
  }
});
