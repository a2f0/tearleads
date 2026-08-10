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
    await persistence.markMoveIntentSynced(execSql, {
      containerId: "child-1",
      expectedUpdatedAt: blockedIntent?.updatedAt ?? "",
    });
    expect(await persistence.listUnsyncedMoveIntents(execSql)).toEqual([]);
  } finally {
    close();
  }
});
