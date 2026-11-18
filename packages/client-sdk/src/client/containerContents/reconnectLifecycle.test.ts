import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import { seedLocalRootContainer } from "../../../test/helpers/workflows/containerContentsTestRuntime";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { createDomainScope } from "../../data/shared/domainScope";
import { disposeDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import {
  consumePendingContainerContentsReconnectRefresh,
  createContainerContentsStoreState,
} from "../../stores/container-contents/state";
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

test.each(["reopen", "organization ABA"])(
  "an old refresh cannot overwrite the new cursor after %s",
  async (change) => {
    let scopeGeneration = 0;
    const { execSql, close } = await createTestExecSql(
      "reopened-manual-cursor",
    );
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
    let input = createWorkflowInputFixture({ apiClient, execSql });
    const service = {
      ...createInternalRuntimeFixture(() => input),
      get scopeGeneration() {
        return scopeGeneration;
      },
    };
    const contents = createContainerContents(service);
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
      if (change === "reopen") {
        disposeDomainSyncCoordinator(scope);
        expect(await old.refresh()).toBe(false);
        expect(await old.refreshRootLane()).toBe(false);
        const reopened = contents.openTree();
        reopened.updateRuntime(contents.workflowRuntime());
        await waitFor(
          () => reopened.getSnapshot().ready,
          "reopened store did not initialize",
        );
        await reopened.refresh();
      } else {
        const original = input;
        input = {
          ...input,
          auth: { ...input.auth, organizationId: "another-org" },
        };
        scopeGeneration++;
        input = original;
        scopeGeneration++;
        await cursors.saveWatermark(lane, { id: "newer", updatedAt });
      }
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
  },
);

test("a queued rename on the disposed tree cannot change the reopened root", async () => {
  const { execSql, close } = await createTestExecSql("retired-tree-rename");
  const input = createWorkflowInputFixture({
    apiClient: createMockApiClient(),
    execSql,
    online: false,
  });
  const contents = createContainerContents(
    createInternalRuntimeFixture(() => input),
  );
  try {
    await seedLocalRootContainer(execSql, { rootContainerId: "root" });
    const old = contents.openTree();
    old.updateRuntime(contents.workflowRuntime());
    await waitFor(() => old.getSnapshot().ready, "old tree did not initialize");
    const queued = old.renameContainer("root", "Obsolete");
    disposeDomainSyncCoordinator(input.state.domainScope);
    const reopened = contents.openTree();
    reopened.updateRuntime(contents.workflowRuntime());
    await waitFor(
      () => reopened.getSnapshot().ready,
      "new tree did not initialize",
    );
    expect(await queued).toBeNull();
    const root =
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        "root",
      );
    expect(root?.container.name).not.toBe("Obsolete");
  } finally {
    disposeDomainSyncCoordinator(input.state.domainScope);
    await close();
  }
});

test.each(["disconnect", "new acknowledgement"] as const)(
  "a reconnect becomes stale on %s",
  async (change) => {
    const { execSql, close } = await createTestExecSql("live-ack");
    const initial = createWorkflowInputFixture({
      apiClient: createMockApiClient(),
      execSql,
    });
    let input = {
      ...initial,
      state: {
        ...initial.state,
        serverEventsConnected: true,
        serverEventsConnectionGeneration: 1,
      },
    };
    const contents = createContainerContents(
      createInternalRuntimeFixture(() => input),
    );
    const state = createContainerContentsStoreState(
      contents.workflowRuntime(),
      defaultContainerContentsPersistence,
    );
    state.initialized = true;
    state.snapshot = { ...state.snapshot, ready: true };
    const guard = Promise.withResolvers<() => boolean>();
    const release = Promise.withResolvers<void>();
    try {
      consumePendingContainerContentsReconnectRefresh(
        state,
        async (options) => {
          if (!options?.reconnect) throw new Error("expected a reconnect");
          guard.resolve(options.reconnect.isCurrent);
          await release.promise;
          return true;
        },
      );
      const isCurrent = await guard.promise;
      expect(isCurrent()).toBe(true);
      input = {
        ...input,
        state: {
          ...input.state,
          serverEventsConnected: change !== "disconnect",
          serverEventsConnectionGeneration: change === "disconnect" ? 1 : 2,
        },
      };
      expect(isCurrent()).toBe(false);
    } finally {
      state.reconnectRefresh.reset("disposed");
      release.resolve();
      disposeDomainSyncCoordinator(input.state.domainScope);
      await close();
    }
  },
);

test.each(["reconnect", "manual"])(
  "a reopened tree issues a fresh %s request",
  async (mode) => {
    const { close, execSql } = await createTestExecSql(
      "reopened-reconnect-transport",
    );
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const { lanes } = await request.json();
        const stale = ++calls === 1;
        if (stale) {
          started.resolve();
          await release.promise;
        }
        return Response.json({
          results: lanes.map(({ laneId }: { laneId: string }) => ({
            laneId,
            page: {
              items: [],
              tombstones: [],
              hasMore: false,
              nextWatermark: {
                id: stale ? "old" : "new",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            },
          })),
        });
      },
    });
    const api = new ApiClient(server.url.origin);
    const apiClient = createMockApiClient({
      listContainerParentLanes: (input) => api.listContainerParentLanes(input),
    });
    const initial = createWorkflowInputFixture({ apiClient, execSql });
    let input = {
      ...initial,
      state: {
        ...initial.state,
        serverEventsConnectionGeneration: mode === "manual" ? 0 : 1,
      },
    };
    const contents = createContainerContents(
      createInternalRuntimeFixture(() => input),
    );
    const lane = createContainerParentSyncLane(null);
    try {
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      const cursors = new ContainerSyncWatermarkRepository(execSql);
      await cursors.markChecked(lane);
      const old = contents.openTree();
      old.updateRuntime(contents.workflowRuntime());
      await waitFor(
        () => old.getSnapshot().ready,
        "old store did not initialize",
      );
      const firstRefresh = mode === "manual" ? old.refresh() : undefined;
      await started.promise;
      disposeDomainSyncCoordinator(input.state.domainScope);
      input = {
        ...input,
        state: {
          ...input.state,
          serverEventsConnectionGeneration: mode === "manual" ? 0 : 2,
        },
      };
      const fresh = contents.openTree();
      fresh.updateRuntime(contents.workflowRuntime());
      await waitFor(
        () => fresh.getSnapshot().ready,
        "fresh store did not initialize",
      );
      const secondRefresh = mode === "manual" ? fresh.refresh() : undefined;
      await waitFor(
        () => calls === 2,
        "new acknowledgement reused the previous listing",
      );
      release.resolve();
      await Promise.all([firstRefresh, secondRefresh]);
      await waitFor(
        async () => (await cursors.loadWatermark(lane))?.id === "new",
        "the new listing did not checkpoint",
      );
    } finally {
      release.resolve();
      disposeDomainSyncCoordinator(input.state.domainScope);
      await server.stop(true);
      await close();
    }
  },
);
