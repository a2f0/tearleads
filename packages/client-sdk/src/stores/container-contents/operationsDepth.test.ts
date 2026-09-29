import { expect, test } from "bun:test";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { ContainerPathTooDeepError } from "../../data/containers/shared/containerPathLimits";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { createChildContainer, moveContainer } from "./operations";
import type { ContainerContentsStoreState } from "./types";

/** A local chain of `length` synced containers, root first: c0 … c{length-1}. */
function localChain(length: number): Map<string, ContainerState> {
  return new Map(
    Array.from({ length }, (_, index) => [
      `c${index}`,
      createTestContainerState({
        id: `c${index}`,
        parentId: index === 0 ? null : `c${index - 1}`,
      }),
    ]),
  );
}

function storeState(
  containersById: Map<string, ContainerState>,
  writes: string[],
): ContainerContentsStoreState {
  const record = (name: string) => async () => {
    writes.push(name);
    throw new Error(`unexpected ${name}`);
  };
  return {
    containersById,
    persistence: {
      ...defaultContainerContentsPersistence,
      commitMetadataMutation: record("commitMetadataMutation"),
      saveContainer: record("saveContainer"),
      saveContainerWithPendingUpdate: record("saveContainerWithPendingUpdate"),
    },
    runtime: { infra: { dbStatus: "ready" } },
    snapshot: { ready: true },
  } as unknown as ContainerContentsStoreState;
}

const noSyncAgent = {
  scheduleSync: () => {},
} as unknown as Parameters<typeof createChildContainer>[1];

test("a local create past the readable depth is refused before queuing", async () => {
  const writes: string[] = [];
  const state = storeState(localChain(MAX_CONTAINER_PATH_LENGTH), writes);
  await expect(
    createChildContainer(
      state,
      noSyncAgent,
      `c${MAX_CONTAINER_PATH_LENGTH - 1}`,
      "Too deep",
    ),
  ).rejects.toBeInstanceOf(ContainerPathTooDeepError);
  expect(writes).toEqual([]);
  expect(state.containersById.size).toBe(MAX_CONTAINER_PATH_LENGTH);
});

test("a local move whose subtree would pass the readable depth is refused", async () => {
  const writes: string[] = [];
  const containersById = localChain(MAX_CONTAINER_PATH_LENGTH - 1);
  containersById.set(
    "moved",
    createTestContainerState({ id: "moved", parentId: "c0" }),
  );
  containersById.set(
    "below",
    createTestContainerState({ id: "below", parentId: "moved" }),
  );
  const state = storeState(containersById, writes);
  // The moved folder alone would fit at depth 99; its child would not.
  await expect(
    moveContainer(
      state,
      noSyncAgent,
      "moved",
      `c${MAX_CONTAINER_PATH_LENGTH - 2}`,
    ),
  ).rejects.toBeInstanceOf(ContainerPathTooDeepError);
  expect(writes).toEqual([]);
  expect(state.containersById.get("moved")?.container.parentId).toBe("c0");
});
