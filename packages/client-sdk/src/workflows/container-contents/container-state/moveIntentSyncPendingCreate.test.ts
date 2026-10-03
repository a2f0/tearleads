import { expect, test } from "bun:test";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { createTestContainerState } from "./containerState.testFixtures";
import { syncPendingContainerMoveIntents } from "./moveIntentSync";
import {
  createMoveIntentSyncState,
  type MoveIntentError,
  moveIntentRecord,
} from "./moveIntentSync.testFixtures";

// A folder whose create has not settled can carry a listed identity that
// adoption has not verified, or has refused. A move must neither be sent for
// it nor into it until its own create settles.

test.each([
  ["source", "child"],
  ["destination", "parent"],
] as const)(
  "a move whose %s create is pending waits without a request",
  async (_end, pendingId) => {
    const errors: MoveIntentError[] = [];
    let projectionRequests = 0;
    const containersById = new Map([
      ["child", createTestContainerState({ id: "child", parentId: "root" })],
      ["parent", createTestContainerState({ id: "parent", parentId: "root" })],
    ]);
    const movedCount = await syncPendingContainerMoveIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("unexpected persist");
        },
        updateSnapshot: () => {},
      },
      isCreatePending: (containerId) => containerId === pendingId,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: () => {},
      state: createMoveIntentSyncState({
        containersById,
        onProjectionRequest: () => {
          projectionRequests += 1;
        },
        persistence: {
          ...defaultContainerContentsPersistence,
          listUnsyncedMoveIntents: async () => [
            moveIntentRecord({ containerId: "child" }),
          ],
          recordMoveIntentError: async (_execSql, error) => {
            errors.push(error);
          },
        },
      }),
    });

    expect(movedCount).toBe(0);
    expect(projectionRequests).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.blocked).toBeUndefined();
  },
);
