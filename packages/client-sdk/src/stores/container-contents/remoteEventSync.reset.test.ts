import { expect, mock, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

test("database loss preserves buffered events for replacement initialization", () => {
  const readyRuntime = createContainerContentsTestRuntime({
    dbStatus: "ready",
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const idleRuntime = {
    ...readyRuntime,
    infra: { ...readyRuntime.infra, dbStatus: "idle" as const },
    state: {
      ...readyRuntime.state,
      events: [
        {
          documentId: "metadata-container-1",
          id: "event-1",
          type: "document_update_created" as const,
        },
        {
          documentId: "metadata-container-2",
          id: "event-2",
          type: "document_update_created" as const,
        },
      ],
    },
  };
  const state = createContainerContentsStoreState(
    readyRuntime,
    defaultContainerContentsPersistence,
  );
  state.initialized = true;
  state.lastEventCount = 1;

  updateContainerContentsStoreRuntime(
    state,
    idleRuntime,
    {} as ContainerContentsStoreSyncAgent,
  );

  expect(state.initialized).toBe(false);
  expect(state.lastEventCount).toBe(0);
});

test("replacement initialization replays buffered metadata events", () => {
  const baseRuntime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const runtime = {
    ...baseRuntime,
    state: {
      ...baseRuntime.state,
      events: [
        {
          documentId: "metadata-container-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
    },
  };
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const scheduleSync = mock(() => {});
  const handleEvents = () =>
    handleContainerContentsRemoteEvents({
      requestHydration: async () => {},
      scheduleSync,
      state,
    });

  handleEvents();
  expect(state.lastEventCount).toBe(0);

  state.containersById.set(
    "container-1",
    createTestContainerState({ id: "container-1", parentId: null }),
  );
  state.initialized = true;
  handleEvents();

  expect(state.lastEventCount).toBe(1);
  expect(state.metadataDocumentIdsNeedingSync).toEqual(
    new Set(["metadata-container-1"]),
  );
  expect(scheduleSync).toHaveBeenCalledTimes(1);
});
