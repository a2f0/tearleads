import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createTestContainerState } from "./containerState.testFixtures";
import {
  getCachedContainerWriterProjection,
  invalidateContainerWriterProjection,
  loadContainerWriterProjectionForState,
} from "./projectionCache";
import type { ContainerWorkflowRuntime } from "./types";

const CONTAINER = "container-1";

function projectionFor(
  manifestHash: string,
): ContainerWriterProjectionResponse {
  return {
    containerId: CONTAINER,
    containerKeks: [
      { accessManifestHash: manifestHash, containerId: CONTAINER },
    ],
    path: [{ containerId: CONTAINER, manifestHash }],
  } as unknown as ContainerWriterProjectionResponse;
}

test("a load that straddles an invalidating hint fetches again instead of caching the stale answer", async () => {
  // The pre-hint manifest, and the current one the record already names.
  const stale = projectionFor(`access-${CONTAINER}-before-grant`);
  const fresh = projectionFor(`access-${CONTAINER}`);
  const held = Promise.withResolvers<void>();
  let calls = 0;
  const runtime = {
    apiClient: {
      getContainerWriterProjection: async () => {
        if (++calls === 1) {
          await held.promise;
          return stale;
        }
        return fresh;
      },
    },
  } as unknown as ContainerWorkflowRuntime;
  const containerState = createTestContainerState({
    id: CONTAINER,
    parentId: null,
  });

  const loading = loadContainerWriterProjectionForState({
    containerState,
    runtime,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  // A peer's grant hint lands while the first fetch is still open.
  invalidateContainerWriterProjection(containerState);
  held.resolve();

  await expect(loading).resolves.toBe(fresh);
  expect(calls).toBe(2);
  expect(getCachedContainerWriterProjection(containerState)).toBe(fresh);
});

test("an undisturbed load caches its answer", async () => {
  const projection = projectionFor(`access-${CONTAINER}`);
  let calls = 0;
  const runtime = {
    apiClient: {
      getContainerWriterProjection: async () => {
        calls++;
        return projection;
      },
    },
  } as unknown as ContainerWorkflowRuntime;
  const containerState = createTestContainerState({
    id: CONTAINER,
    parentId: null,
  });
  await expect(
    loadContainerWriterProjectionForState({ containerState, runtime }),
  ).resolves.toBe(projection);
  await expect(
    loadContainerWriterProjectionForState({ containerState, runtime }),
  ).resolves.toBe(projection);
  expect(calls).toBe(1);
});
