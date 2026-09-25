import { expect, mock, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createDomainScope } from "../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { handleContainerContentsRemoteEvents } from "./remoteEventSync";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";

test("a remote-event hydration refusal is reported without an unhandled rejection", async () => {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const reportSecurityIncident = mock(async () => {});
  runtime.apiClient.clearWriterProjectionCaches = () => {};
  const logError = mock(() => {});
  const state = createContainerContentsStoreState(
    {
      ...runtime,
      util: { ...runtime.util, reportSecurityIncident, logError },
      state: {
        ...runtime.state,
        events: [
          {
            id: "hint",
            type: "container_children_changed",
            containerIds: ["parent"],
          },
        ],
      },
    },
    defaultContainerContentsPersistence,
  );
  state.initialized = true;
  const failure = new KeyingVerificationError(
    "unauthorized",
    "initial principal policy state signer is not an admin",
  );
  const requestHydration = mock(async () => {
    throw failure;
  });
  handleContainerContentsRemoteEvents({
    state,
    requestHydration,
    scheduleSync: () => {},
  });
  await Bun.sleep(0);
  expect(requestHydration).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalledWith(
    "Container background hydration failed",
    failure,
  );
  expect(reportSecurityIncident).toHaveBeenCalledWith(failure, {
    objectId: null,
    objectKind: "container",
    operation: "container.hydration.background",
    organizationId: runtime.auth.organizationId,
  });
  expect(state.containersById.size).toBe(0);
});
