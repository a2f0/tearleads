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
      `INSERT INTO local_intents (
        id, lane, subject_id, target_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container.create', 'container-1', 'root', 'container.create',
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
      `INSERT INTO local_intents (
        id, lane, subject_id, target_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'container.create', 'container-1', 'root', 'container.create',
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
  // A local create is unbound until the server acknowledges its signed create.
  const record = {
    accessEpoch: 1,
    accessStateHash: "local-access",
    documentId: null,
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

test("typed holds honor CAS, stay mutually exclusive with lastError, and clear on reparent or settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-create-intent-holds-sqlite",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "admin",
        icon: null,
        id: "folder-a",
        metadataDocumentId: null,
        name: "Folder A",
        organizationId: "org-1",
        parentId: "local-parent",
      },
      null,
      { createIntent: { parentContainerId: "local-parent" } },
    );

    const [initial] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!initial) throw new Error("Expected initial create intent");
    expect(initial.hold).toEqual({ status: "none" });

    // Record a real error first, then verify a mismatched CAS hold is ignored.
    await sqlContainerContentsPersistence.recordCreateIntentRevisionError(
      execSql,
      {
        containerId: initial.containerId,
        expectedIntentId: initial.id,
        expectedUpdatedAt: initial.updatedAt,
        message: "transient 503",
      },
    );
    const [errored] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!errored) throw new Error("Expected errored create intent");
    expect(errored.lastError).toBe("transient 503");

    await sqlContainerContentsPersistence.recordCreateIntentRevisionHold(
      execSql,
      {
        containerId: errored.containerId,
        expectedIntentId: "stale-id",
        expectedUpdatedAt: errored.updatedAt,
        hold: { status: "slotTaken" },
      },
    );
    const [afterStaleHold] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(afterStaleHold).toMatchObject({
      hold: { status: "none" },
      lastError: "transient 503",
    });

    // Matching CAS hold writes hold_kind/hold_since and clears lastError.
    const heldSince = "2026-11-27T01:00:00.000Z";
    await sqlContainerContentsPersistence.recordCreateIntentRevisionHold(
      execSql,
      {
        containerId: errored.containerId,
        expectedIntentId: errored.id,
        expectedUpdatedAt: errored.updatedAt,
        hold: { since: heldSince, status: "awaitingParentListing" },
      },
    );
    const [held] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!held) throw new Error("Expected held create intent");
    expect(held.hold).toEqual({
      since: heldSince,
      status: "awaitingParentListing",
    });
    expect(held.lastError).toBeNull();
    expect(held.lastAttemptedAt).not.toBeNull();

    // A later real error clears the active hold columns.
    await sqlContainerContentsPersistence.recordCreateIntentRevisionError(
      execSql,
      {
        containerId: held.containerId,
        expectedIntentId: held.id,
        expectedUpdatedAt: held.updatedAt,
        message: "post failed after expiry",
      },
    );
    const [reErrored] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!reErrored) throw new Error("Expected re-errored create intent");
    expect(reErrored.hold).toEqual({ status: "none" });
    expect(reErrored.lastError).toBe("post failed after expiry");

    // Re-park as pathTooDeep, then fold local-parent into remote-parent and
    // verify reparentLocalContainerChildren clears the hold.
    await sqlContainerContentsPersistence.recordCreateIntentRevisionHold(
      execSql,
      {
        containerId: reErrored.containerId,
        expectedIntentId: reErrored.id,
        expectedUpdatedAt: reErrored.updatedAt,
        hold: { status: "pathTooDeep" },
      },
    );
    await sqlContainerContentsPersistence.reconcileLocalSystemContainer(
      execSql,
      {
        localContainerId: "local-parent",
        remoteContainerId: "remote-parent",
        remoteOrganizationId: "org-1",
      },
    );
    const [reparented] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!reparented) throw new Error("Expected reparented create intent");
    expect(reparented.parentContainerId).toBe("remote-parent");
    expect(reparented.hold).toEqual({ status: "none" });

    // Hold again and settle: markCreateIntentRevisionSynced clears hold columns.
    await sqlContainerContentsPersistence.recordCreateIntentRevisionHold(
      execSql,
      {
        containerId: reparented.containerId,
        expectedIntentId: reparented.id,
        expectedUpdatedAt: reparented.updatedAt,
        hold: { since: heldSince, status: "awaitingParentListing" },
      },
    );
    const [heldAgain] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    if (!heldAgain) throw new Error("Expected held create intent");
    await expect(
      sqlContainerContentsPersistence.markCreateIntentRevisionSynced(execSql, {
        containerId: heldAgain.containerId,
        expectedIntentId: heldAgain.id,
        expectedUpdatedAt: heldAgain.updatedAt,
        remoteContainerId: heldAgain.containerId,
        remoteMetadataAccessStateHash: "hash-1",
        remoteMetadataDocumentId: "meta-1",
        stillCurrent: () => true,
      }),
    ).resolves.toBe(true);
    expect(
      await execSql(
        `SELECT sync_status, hold_kind, hold_since, last_error
           FROM local_intents WHERE subject_id = 'folder-a'`,
      ),
    ).toEqual([
      {
        hold_kind: null,
        hold_since: null,
        last_error: null,
        sync_status: "synced",
      },
    ]);
  } finally {
    close();
  }
});
