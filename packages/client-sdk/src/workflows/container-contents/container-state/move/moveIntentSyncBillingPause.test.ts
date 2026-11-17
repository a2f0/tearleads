import { expect, test } from "bun:test";
import { defaultContainerContentsPersistence } from "../../containerPersistence";
import { createTestContainerState } from "../containerState.testFixtures";
import type { ContainerMoveIntentSyncState } from "../types";
import { syncPendingContainerMoveIntents } from "./moveIntentSync";
import {
  createMoveIntentSyncState,
  type MoveIntentError,
  moveIntentRecord,
} from "./moveIntentSync.testFixtures";

/**
 * Replays one queued move whose request returns nothing. `paymentRequired`
 * models the request itself being the organization's first 402: the billing
 * gate answers "not blocked" before the request and "blocked" after it.
 */
async function replayRefusedMove(paymentRequired: boolean) {
  const errors: MoveIntentError[] = [];
  const gateChecks: string[] = [];
  let blocked = false;
  const containersById = new Map(
    ["child", "parent"].map((id) => [
      id,
      createTestContainerState({
        id,
        organizationId: "custom-organization",
        parentId: "root",
      }),
    ]),
  );
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listUnsyncedMoveIntents: async () => [
      moveIntentRecord({ containerId: "child" }),
    ],
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };
  const movedCount = await syncPendingContainerMoveIntents({
    acceptedMoveRetry: { arm: () => {}, resume: () => {} },
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
      updateSnapshot: () => {},
    },
    isCreatePending: () => false,
    isCurrent: () => true,
    isRemoteSyncBlocked: (organizationId) => {
      gateChecks.push(organizationId);
      return blocked;
    },
    requestRemoteReconciliation: () => {},
    state: createMoveIntentSyncState({
      containersById,
      onProjectionRequest: () => {
        blocked = paymentRequired;
      },
      persistence,
      projectionUnavailable: true,
    }),
  });
  return { errors, gateChecks, movedCount };
}

// Sync-edge-cases row 19: the queue keeps `pending` with its "billing paused"
// note, which a recorded error would replace.
test("a move refused by the organization's first 402 stays pending with no error", async () => {
  const result = await replayRefusedMove(true);

  expect(result.movedCount).toBe(0);
  expect(result.errors).toEqual([]);
  // Asked before the request and again after its refusal.
  expect(result.gateChecks).toEqual([
    "custom-organization",
    "custom-organization",
  ]);
});

test("a move refused while the organization can sync records the refusal", async () => {
  const result = await replayRefusedMove(false);

  expect(result.movedCount).toBe(0);
  expect(result.errors.map((error) => error.message)).toEqual([
    "Remote container move was rejected or unavailable",
  ]);
});
