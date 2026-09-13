import { expect, mock, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  getCachedContainerWriterProjection,
  loadContainerWriterProjectionForState,
} from "../../workflows/container-contents/container-state/projectionCache";
import type { ContainerWorkflowRuntime } from "../../workflows/container-contents/container-state/types";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerContentsWorkflowRuntimeInput } from "../../workflows/container-contents/runtime";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";

const CONTAINER = "container-1";

/** A projection whose manifest matches the container record, so the cache serves it. */
function projectionFor(
  containerId: string,
  manifestHash: string,
): ContainerWriterProjectionResponse {
  return {
    containerId,
    containerKeks: [{ accessManifestHash: manifestHash, containerId }],
    path: [{ containerId, manifestHash }],
  } as unknown as ContainerWriterProjectionResponse;
}

test("a peer's grant hint drops the cached writer projection so the next write fetches afresh", async () => {
  const stale = projectionFor(CONTAINER, `access-${CONTAINER}`);
  const fresh = projectionFor(CONTAINER, `access-${CONTAINER}-rotated`);
  const evictContainerWriterProjection = mock((_containerId: string) => {});
  const evictDocumentWriterProjection = mock((_documentId: string) => {});
  const getContainerWriterProjection = mock(async () => fresh);
  const apiClient = {
    evictContainerWriterProjection,
    evictDocumentWriterProjection,
    getContainerWriterProjection,
  } as unknown as ContainerContentsWorkflowRuntimeInput["apiClient"];
  const baseRuntime = createContainerContentsTestRuntime({
    apiClient,
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const runtime = {
    ...baseRuntime,
    state: {
      ...baseRuntime.state,
      events: [
        {
          containerId: CONTAINER,
          eventType: "container.grant",
          id: "event-1",
          parentId: null,
          type: "container_mutation_created",
        },
      ],
    },
  };
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const containerState = createTestContainerState({
    id: CONTAINER,
    parentId: null,
  });
  containerState.containerWriterProjection = stale;
  state.containersById.set(CONTAINER, containerState);
  state.initialized = true;
  // Before the hint the cached projection is served without a fetch.
  expect(getCachedContainerWriterProjection(containerState)).toBe(stale);

  handleContainerContentsRemoteEvents({
    requestHydration: async () => {},
    scheduleSync: () => {},
    state,
  });

  expect(evictContainerWriterProjection).toHaveBeenCalledWith(CONTAINER);
  // The metadata document's projection cites the same path.
  expect(evictDocumentWriterProjection).toHaveBeenCalledWith(
    `metadata-${CONTAINER}`,
  );
  expect(getCachedContainerWriterProjection(containerState)).toBeNull();
  // The next share/move loads through the API instead of reusing the stale
  // manifest hash.
  const loaded = await loadContainerWriterProjectionForState({
    containerState,
    runtime: { apiClient } as unknown as ContainerWorkflowRuntime,
  });
  expect(getContainerWriterProjection).toHaveBeenCalledTimes(1);
  expect(loaded).toBe(fresh);
});

test("hints for other containers leave a cached projection in place", () => {
  const cached = projectionFor(CONTAINER, `access-${CONTAINER}`);
  const evictContainerWriterProjection = mock((_containerId: string) => {});
  const apiClient = {
    evictContainerWriterProjection,
    evictDocumentWriterProjection: () => {},
  } as unknown as ContainerContentsWorkflowRuntimeInput["apiClient"];
  const baseRuntime = createContainerContentsTestRuntime({
    apiClient,
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const runtime = {
    ...baseRuntime,
    state: {
      ...baseRuntime.state,
      events: [
        {
          containerId: "container-2",
          eventType: "container.rekey",
          id: "event-1",
          parentId: null,
          type: "container_mutation_created",
        },
        {
          containerIds: [CONTAINER],
          documentId: "document-1",
          id: "event-2",
          type: "document_update_created",
        },
      ],
    },
  };
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const containerState = createTestContainerState({
    id: CONTAINER,
    parentId: null,
  });
  containerState.containerWriterProjection = cached;
  state.containersById.set(CONTAINER, containerState);
  state.initialized = true;

  handleContainerContentsRemoteEvents({
    requestHydration: async () => {},
    scheduleSync: () => {},
    state,
  });

  expect(evictContainerWriterProjection.mock.calls).toEqual([["container-2"]]);
  expect(getCachedContainerWriterProjection(containerState)).toBe(cached);
});

/** A store holding a tree; every container starts with a cached projection. */
function treeState(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
  events: ReadonlyArray<unknown>,
) {
  const evicted: string[] = [];
  const apiClient = {
    evictContainerWriterProjection: (containerId: string) => {
      evicted.push(containerId);
    },
    evictDocumentWriterProjection: () => {},
  } as unknown as ContainerContentsWorkflowRuntimeInput["apiClient"];
  const baseRuntime = createContainerContentsTestRuntime({
    apiClient,
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const state = createContainerContentsStoreState(
    { ...baseRuntime, state: { ...baseRuntime.state, events } },
    defaultContainerContentsPersistence,
  );
  for (const node of nodes) {
    const containerState = createTestContainerState(node);
    containerState.containerWriterProjection = projectionFor(
      node.id,
      `access-${node.id}`,
    );
    state.containersById.set(node.id, containerState);
  }
  state.initialized = true;
  const cached = (id: string) => {
    const containerState = state.containersById.get(id);
    return containerState
      ? getCachedContainerWriterProjection(containerState) !== null
      : null;
  };
  return { cached, evicted, state };
}

test("an ancestor grant hint drops the locally known subtree's projections and leaves a sibling subtree alone", () => {
  const { cached, evicted, state } = treeState(
    [
      { id: "ancestor", parentId: null },
      { id: "child", parentId: "ancestor" },
      { id: "grandchild", parentId: "child" },
      { id: "sibling", parentId: null },
      { id: "sibling-child", parentId: "sibling" },
    ],
    [
      {
        containerId: "ancestor",
        eventType: "container.grant",
        id: "event-1",
        parentId: null,
        type: "container_mutation_created",
      },
    ],
  );
  handleContainerContentsRemoteEvents({
    requestHydration: async () => {},
    scheduleSync: () => {},
    state,
  });
  expect(cached("ancestor")).toBe(false);
  expect(cached("child")).toBe(false);
  expect(cached("grandchild")).toBe(false);
  expect(cached("sibling")).toBe(true);
  expect(cached("sibling-child")).toBe(true);
  expect([...evicted].sort()).toEqual(["ancestor", "child", "grandchild"]);
});

test("a container_path_changed hint drops exactly the named dependents", () => {
  // The subscriber holds only the granted subtree; the ancestor is unknown
  // locally and its own hint never arrives, so the gateway's path hint is the
  // signal.
  const { cached, evicted, state } = treeState(
    [
      { id: "granted", parentId: "unknown-ancestor" },
      { id: "granted-child", parentId: "granted" },
      { id: "sibling", parentId: null },
    ],
    [
      {
        containerIds: ["granted", "granted-child"],
        id: "event-1",
        type: "container_path_changed",
      },
    ],
  );
  handleContainerContentsRemoteEvents({
    requestHydration: async () => {},
    scheduleSync: () => {},
    state,
  });
  expect(cached("granted")).toBe(false);
  expect(cached("granted-child")).toBe(false);
  expect(cached("sibling")).toBe(true);
  expect([...evicted].sort()).toEqual(["granted", "granted-child"]);
});
