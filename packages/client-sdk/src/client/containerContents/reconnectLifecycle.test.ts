import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { createDomainScope } from "../../data/shared/domainScope";
import { disposeDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContents } from "./index";

for (const scenario of [
  "replace database during backoff",
  "reopen after disposal",
] as const) {
  test(scenario, async () => {
    const { execSql, close } = await createTestExecSql(scenario);
    let listings = 0;
    const apiClient = createMockApiClient({
      listContainerParentLanes: async ({ lanes }) => {
        listings++;
        if (scenario === "replace database during backoff" && listings === 1)
          return null;
        return {
          results: lanes.map(({ laneId }) => ({
            laneId,
            page: {
              items: [],
              tombstones: [],
              hasMore: false,
              nextWatermark: null,
            },
          })),
        };
      },
    });
    let input = createWorkflowInputFixture({ apiClient, execSql });
    const scope = input.state.domainScope;
    input = {
      ...input,
      state: { ...input.state, serverEventsConnectionGeneration: 1 },
    };
    const contents = createContainerContents(
      createInternalRuntimeFixture(() => input),
    );
    try {
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      await new ContainerSyncWatermarkRepository(execSql).markChecked(
        createContainerParentSyncLane(null),
      );
      contents.openTree().updateRuntime(contents.workflowRuntime());
      await waitFor(() => listings === 1, "first reconnect did not list");
      if (scenario === "replace database during backoff") {
        input = {
          ...input,
          state: { ...input.state, domainScope: createDomainScope() },
        };
        await Bun.sleep(1_200);
        expect(listings).toBe(1);
      } else {
        disposeDomainSyncCoordinator(scope);
        input = {
          ...input,
          state: { ...input.state, serverEventsConnectionGeneration: 2 },
        };
        contents.openTree().updateRuntime(contents.workflowRuntime());
        await waitFor(() => listings === 2, "reopened scope did not list");
      }
    } finally {
      disposeDomainSyncCoordinator(scope);
      await close();
    }
  });
}
