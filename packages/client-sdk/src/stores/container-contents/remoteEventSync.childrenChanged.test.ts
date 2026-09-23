import { expect, mock, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";

test("a generic child hint schedules the affected parent listings", () => {
  const base = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
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
    new Set(["source", "destination"]),
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
