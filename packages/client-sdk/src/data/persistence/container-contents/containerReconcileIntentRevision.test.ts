import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "./documentMoveIntentPersistence";

const SAME_UPDATED_AT = "2026-09-01T12:00:00.000Z";

async function saveContainerWithIntents(input: {
  containerId: string;
  execSql: ExecSql;
  parentContainerId: string;
}) {
  await sqlContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.containerId,
      metadataDocumentId: null,
      name: input.containerId,
      organizationId: "organization",
      parentId: input.parentContainerId,
    },
    null,
    {
      createIntent: {
        id: `create-${input.containerId}`,
        parentContainerId: input.parentContainerId,
      },
      localUpdatedAt: SAME_UPDATED_AT,
      moveIntent: {
        id: `move-${input.containerId}`,
        parentContainerId: input.parentContainerId,
        previousParentContainerId: "previous-parent",
      },
    },
  );
}

async function saveContainer(input: {
  containerId: string;
  execSql: ExecSql;
  parentContainerId: string | null;
}) {
  await sqlContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.containerId,
      metadataDocumentId: null,
      name: input.containerId,
      organizationId: "organization",
      parentId: input.parentContainerId,
    },
    null,
    { localUpdatedAt: SAME_UPDATED_AT },
  );
}

test("same-timestamp document reassignment rotates every affected intent revision", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-document-reassignment-intent-revision",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "source-document",
      id: "stale-source-revision",
      localId: "source-local",
      sourceContainerId: "local-root",
      targetContainerId: "other-container",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "target-document",
      id: "stale-target-revision",
      localId: "target-local",
      sourceContainerId: "other-container",
      targetContainerId: "local-root",
    });
    await execSql(`UPDATE document_move_intents SET updated_at = ?`, [
      SAME_UPDATED_AT,
    ]);
    const before =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);

    await sqlContainerContentsPersistence.reassignContainerDocuments(execSql, {
      fromContainerId: "local-root",
      toContainerId: "remote-root",
      updatedAt: SAME_UPDATED_AT,
    });

    const after =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    expect(after).toHaveLength(2);
    expect(new Set(after.map((intent) => intent.id)).size).toBe(2);
    for (const previous of before) {
      const current = after.find(
        (intent) => intent.documentId === previous.documentId,
      );
      expect(current?.id).not.toBe(previous.id);
      expect(current?.updatedAt).toBe(previous.updatedAt);
      expect(
        await sqlDocumentMoveIntentPersistence.markMoveIntentSynced(execSql, {
          documentId: previous.documentId,
          expectedIntentId: previous.id,
          expectedUpdatedAt: previous.updatedAt,
        }),
      ).toBe(false);
    }
    expect(after).toEqual([
      expect.objectContaining({
        documentId: "source-document",
        sourceContainerId: "remote-root",
      }),
      expect.objectContaining({
        documentId: "target-document",
        targetContainerId: "remote-root",
      }),
    ]);
  } finally {
    close();
  }
});

test("same-timestamp root repair rotates descendant create and move revisions", async () => {
  const { close, execSql } = await createTestExecSql(
    "root-repair-intent-revision",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await saveContainer({
      containerId: "local-root",
      execSql,
      parentContainerId: null,
    });
    await saveContainer({
      containerId: "remote-root",
      execSql,
      parentContainerId: null,
    });
    await saveContainerWithIntents({
      containerId: "descendant",
      execSql,
      parentContainerId: "local-root",
    });
    const [previousCreate] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    const [previousMove] =
      await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql);
    if (!previousCreate || !previousMove) {
      throw new Error("Expected descendant intents");
    }

    await sqlContainerContentsPersistence.reconcileLocalRootContainer(execSql, {
      descendantReparents: [
        {
          containerId: "descendant",
          parentContainerId: "remote-root",
          updateCreateIntent: true,
        },
      ],
      localRootContainerId: "local-root",
      remoteOrganizationId: "organization",
      remoteRootContainerId: "remote-root",
      updatedAt: SAME_UPDATED_AT,
    });

    const [currentCreate] =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    const [currentMove] =
      await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql);
    expect(currentCreate).toMatchObject({
      containerId: "descendant",
      parentContainerId: "remote-root",
      updatedAt: SAME_UPDATED_AT,
    });
    expect(currentMove).toMatchObject({
      containerId: "descendant",
      parentContainerId: "remote-root",
      updatedAt: SAME_UPDATED_AT,
    });
    expect(currentCreate?.id).not.toBe(previousCreate.id);
    expect(currentMove?.id).not.toBe(previousMove.id);
    expect(
      await sqlContainerContentsPersistence.markCreateIntentRevisionSynced(
        execSql,
        {
          containerId: previousCreate.containerId,
          expectedIntentId: previousCreate.id,
          expectedUpdatedAt: previousCreate.updatedAt,
          remoteContainerId: "stale-remote-container",
          remoteMetadataAccessStateHash: "stale-access-state",
          remoteMetadataDocumentId: "stale-metadata-document",
          stillCurrent: () => true,
        },
      ),
    ).toBe(false);
    expect(
      await sqlContainerContentsPersistence.markMoveIntentRevisionSynced(
        execSql,
        {
          containerId: previousMove.containerId,
          expectedIntentId: previousMove.id,
          expectedUpdatedAt: previousMove.updatedAt,
          stillCurrent: () => true,
        },
      ),
    ).toBe(false);
  } finally {
    close();
  }
});

test("same-timestamp system repair gives every child intent a fresh revision", async () => {
  const { close, execSql } = await createTestExecSql(
    "system-repair-intent-revision",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await saveContainer({
      containerId: "local-system",
      execSql,
      parentContainerId: "local-root",
    });
    await saveContainer({
      containerId: "remote-system",
      execSql,
      parentContainerId: "remote-root",
    });
    for (const containerId of ["first-child", "second-child"]) {
      await saveContainerWithIntents({
        containerId,
        execSql,
        parentContainerId: "local-system",
      });
    }
    const previousCreateByContainer = new Map(
      (
        await sqlContainerContentsPersistence.listPendingCreateIntents(execSql)
      ).map((intent) => [intent.containerId, intent]),
    );
    const previousMoveByContainer = new Map(
      (
        await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql)
      ).map((intent) => [intent.containerId, intent]),
    );

    await sqlContainerContentsPersistence.reconcileLocalSystemContainer(
      execSql,
      {
        localContainerId: "local-system",
        remoteContainerId: "remote-system",
        remoteOrganizationId: "organization",
        updatedAt: SAME_UPDATED_AT,
      },
    );

    const currentCreates =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    const currentMoves =
      await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql);
    expect(new Set(currentCreates.map((intent) => intent.id)).size).toBe(2);
    expect(new Set(currentMoves.map((intent) => intent.id)).size).toBe(2);
    for (const current of [...currentCreates, ...currentMoves]) {
      const previous = (
        "remoteContainerId" in current
          ? previousCreateByContainer
          : previousMoveByContainer
      ).get(current.containerId);
      expect(current.id).not.toBe(previous?.id);
      expect(current.parentContainerId).toBe("remote-system");
      expect(current.updatedAt).toBe(SAME_UPDATED_AT);
    }
  } finally {
    close();
  }
});
