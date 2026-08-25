import { expect, test } from "bun:test";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { removeMissingSyncedContainerState } from "./missingSyncedContainerState";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

function containerState(id: string): ContainerState {
  return { container: { id } } as ContainerState;
}

function syncState(input: {
  containersById: Map<string, ContainerState>;
}): ContainerContentsStoreSyncState {
  return {
    containersById: input.containersById,
  } as ContainerContentsStoreSyncState;
}

test("a durably deleted metadata state is removed from the live store", () => {
  const expectedState = containerState("deleted-container");
  const state = syncState({
    containersById: new Map([[expectedState.container.id, expectedState]]),
  });
  let snapshotUpdates = 0;

  expect(
    removeMissingSyncedContainerState(state, expectedState, () => {
      snapshotUpdates += 1;
    }),
  ).toBe(true);
  expect(state.containersById.has(expectedState.container.id)).toBe(false);
  expect(snapshotUpdates).toBe(1);
});

test("a replacement installed before missing settlement survives", () => {
  const expectedState = containerState("replaced-container");
  const replacementState = containerState("replaced-container");
  const state = syncState({
    containersById: new Map([[expectedState.container.id, expectedState]]),
  });
  let snapshotUpdates = 0;

  state.containersById.set(replacementState.container.id, replacementState);
  const removal = removeMissingSyncedContainerState(
    state,
    expectedState,
    () => {
      snapshotUpdates += 1;
    },
  );
  expect(removal).toBe(false);
  expect(state.containersById.get(replacementState.container.id)).toBe(
    replacementState,
  );
  expect(snapshotUpdates).toBe(0);
});
