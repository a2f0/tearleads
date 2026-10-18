import { expect, mock, test } from "bun:test";
import { createDomainScope } from "../../../data/shared/domainScope";
import { defaultContainerContentsPersistence } from "../../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "../runtime.testFixtures";
import { createContainerContentsStoreState } from "../state";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";

test("a generic child hint schedules the affected parent listings", () => {
  const base = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  base.apiClient.evictWriterProjectionsCiting = mock(() => {});
  const state = createContainerContentsStoreState(
    {
      ...base,
      state: {
        ...base.state,
        events: [
          {
            id: "hint",
            type: "container_children_changed",
            containerIds: ["source", "destination"],
          },
        ],
      },
    },
    defaultContainerContentsPersistence,
  );
  state.initialized = true;
  const requestHydration = mock(async () => {});
  const scheduleSync = mock(() => {});
  handleContainerContentsRemoteEvents({
    state,
    requestHydration,
    scheduleSync,
  });
  expect(state.containerParentIdsNeedingHydration).toEqual(
    new Set([null, "source", "destination"]),
  );
  expect(requestHydration).toHaveBeenCalledTimes(1);
  expect(scheduleSync).not.toHaveBeenCalled();
  handleContainerContentsRemoteEvents({
    state,
    requestHydration,
    scheduleSync,
  });
  expect(requestHydration).toHaveBeenCalledTimes(1);
});
