import { expect, mock, test } from "bun:test";
import { createDomainScope } from "../../../data/shared/domainScope";
import { defaultContainerContentsPersistence } from "../../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "../runtime.testFixtures";
import { createContainerContentsStoreState } from "../state";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";

test("a metadata hint for a folder create in flight queues its first read", () => {
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
            containerIds: ["new-folder"],
            documentId: "new-folder",
            type: "document_update_created",
            updateIds: ["peer-rename"],
          },
        ],
      },
    },
    defaultContainerContentsPersistence,
  );
  state.initialized = true;
  // No record holds the id yet: only the create in flight names it.
  state.plannedMetadataDocumentIds.add("new-folder");
  const scheduleSync = mock(() => {});
  handleContainerContentsRemoteEvents({
    requestHydration: async () => {},
    scheduleSync,
    state,
  });
  expect(state.metadataDocumentIdsNeedingSync).toEqual(new Set(["new-folder"]));
  expect(scheduleSync).toHaveBeenCalledTimes(1);
});
