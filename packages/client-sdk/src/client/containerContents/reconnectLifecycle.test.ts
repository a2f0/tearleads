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

test("an outstanding manual refresh cannot overwrite the reopened tree's cursor", async () => {
  const { execSql, close } = await createTestExecSql("reopened-manual-cursor");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const updatedAt = "2026-01-01T00:00:00.000Z";
  let calls = 0;
  const apiClient = createMockApiClient({
    listContainerParentLanes: async ({ lanes }) => {
      const first = ++calls === 1;
      if (first) {
        started.resolve();
        await release.promise;
      }
      return {
        results: lanes.map(({ laneId }) => ({
          laneId,
          page: {
            items: [],
            tombstones: [],
            hasMore: false,
            nextWatermark: { id: first ? "older" : "newer", updatedAt },
          },
        })),
      };
    },
  });
  const input = createWorkflowInputFixture({ apiClient, execSql });
  const contents = createContainerContents(
    createInternalRuntimeFixture(() => input),
  );
  const scope = input.state.domainScope;
  const lane = createContainerParentSyncLane(null);
  const cursors = new ContainerSyncWatermarkRepository(execSql);
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await cursors.markChecked(lane);
    const old = contents.openTree();
    old.updateRuntime(contents.workflowRuntime());
    await waitFor(
      () => old.getSnapshot().ready,
      "old store did not initialize",
    );
    const pending = old.refresh();
    await started.promise;
    disposeDomainSyncCoordinator(scope);
    const reopened = contents.openTree();
    reopened.updateRuntime(contents.workflowRuntime());
    await waitFor(
      () => reopened.getSnapshot().ready,
      "reopened store did not initialize",
    );
    await reopened.refresh();
    expect(await cursors.loadWatermark(lane)).toEqual({
      id: "newer",
      updatedAt,
    });
    release.resolve();
    await pending;
    expect(await cursors.loadWatermark(lane)).toEqual({
      id: "newer",
      updatedAt,
    });
  } finally {
    release.resolve();
    disposeDomainSyncCoordinator(scope);
    await close();
  }
});
