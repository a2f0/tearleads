import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

// Settling an adopted create owes a move only when the user moved the folder
// away from where its create committed, and that move cites where the folder
// is now (#2365 finding 26).

const QUEUED_AT = "2026-01-01T00:00:00.000Z";

async function settleAdoptedCreate(input: {
  readonly createdParent: string;
  readonly currentParent: string;
  /** The intent's parent when settlement read it. */
  readonly desiredParent: string;
  /** A newer revision re-queued under this parent while settlement ran. */
  readonly requeuedParent?: string;
  /** A move the user queued after the listing carried the folder. */
  readonly queuedMove?: { readonly from: string; readonly to: string };
}) {
  const { close, execSql } = await createTestExecSql(
    `create-adoption-settlement-${crypto.randomUUID()}`,
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const requeued = input.requeuedParent !== undefined;
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES (?, 'container-1', ?, 'container.create', 'pending', ?, ?)`,
      [
        requeued ? "intent-2" : "intent-1",
        input.requeuedParent ?? input.desiredParent,
        QUEUED_AT,
        requeued ? "2026-01-02T00:00:00.000Z" : QUEUED_AT,
      ],
    );
    if (input.queuedMove) {
      await execSql(
        `INSERT INTO container_move_intents (
          id, container_id, parent_container_id, previous_parent_container_id,
          intent_type, sync_status, created_at, updated_at
        ) VALUES ('move-1', 'container-1', ?, ?, 'container.move', 'pending',
          ?, ?)`,
        [input.queuedMove.to, input.queuedMove.from, QUEUED_AT, QUEUED_AT],
      );
    }
    const settled =
      await sqlContainerContentsPersistence.markCreateIntentRevisionSynced?.(
        execSql,
        {
          containerId: "container-1",
          createdParentContainerId: input.createdParent,
          desiredParentContainerId: input.desiredParent,
          expectedIntentId: "intent-1",
          expectedUpdatedAt: QUEUED_AT,
          remoteContainerId: "container-1",
          remoteMetadataAccessStateHash: "remote-access",
          remoteMetadataDocumentId: "remote-metadata",
          stillCurrent: () => true,
          supersededMovePreviousParentId: input.currentParent,
        },
      );
    return {
      moves: (
        await sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql)
      ).map(({ parentContainerId, previousParentContainerId }) => ({
        parentContainerId,
        previousParentContainerId,
      })),
      pending:
        await sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
      settled,
    };
  } finally {
    close();
  }
}

test("a create moved locally owes the move from its current parent", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "remotely-moved-parent",
    desiredParent: "locally-moved-parent",
  });

  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([
    {
      parentContainerId: "locally-moved-parent",
      previousParentContainerId: "remotely-moved-parent",
    },
  ]);
});

test("a create the user never moved keeps another writer's remote move", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "remotely-moved-parent",
    desiredParent: "created-parent",
  });

  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([]);
});

test("a desired parent the folder already sits under settles with no move", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "shared-destination",
    desiredParent: "shared-destination",
  });

  expect(result.settled).toBe(true);
  expect(result.moves).toEqual([]);
});

test("a revision re-queued during settlement owes the move to its parent", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "created-parent",
    desiredParent: "created-parent",
    requeuedParent: "requeued-parent",
  });

  // The compare-and-set missed the newer revision; the fallback adopts it and
  // queues the move it wants.
  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([
    {
      parentContainerId: "requeued-parent",
      previousParentContainerId: "created-parent",
    },
  ]);
});

test("a revision re-queued back to its created parent owes no move", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "remotely-moved-parent",
    desiredParent: "locally-moved-parent",
    requeuedParent: "created-parent",
  });

  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([]);
});

test("a move queued after the listing arrived keeps its destination", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "remotely-moved-parent",
    desiredParent: "locally-moved-parent",
    queuedMove: { from: "locally-moved-parent", to: "latest-parent" },
  });

  // The queued move is the user's latest choice; it now cites where the
  // folder sits remotely, since the parent it was queued from never committed.
  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([
    {
      parentContainerId: "latest-parent",
      previousParentContainerId: "remotely-moved-parent",
    },
  ]);
});

test("a move queued to where the folder already sits is dropped", async () => {
  const result = await settleAdoptedCreate({
    createdParent: "created-parent",
    currentParent: "remotely-moved-parent",
    desiredParent: "locally-moved-parent",
    queuedMove: { from: "locally-moved-parent", to: "remotely-moved-parent" },
  });

  expect(result.settled).toBe(true);
  expect(result.pending).toEqual([]);
  expect(result.moves).toEqual([]);
});
