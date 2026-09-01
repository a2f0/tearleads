import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  loadContainerSyncWatermark,
} from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const timestamp = "2026-01-01T00:00:00.000Z";

function remoteContainer(
  id: string,
  parentId: string | null,
): ListContainersResponse["items"][number] {
  return {
    createdAt: timestamp,
    depth: parentId ? 1 : 0,
    effectiveAccessLevel: "write",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

function existingContainerState(
  id: string,
  parentId: string | null,
): ContainerState {
  const remote = remoteContainer(id, parentId);
  return {
    container: {
      id: remote.id,
      icon: null,
      metadataDocumentId: remote.metadataDocumentId,
      name: id,
      organizationId: remote.organizationId,
      parentId: remote.parentId,
      updatedAt: remote.updatedAt,
    },
    doc: {},
    record: {
      accessEpoch: remote.metadataAccessEpoch,
      accessStateHash: remote.metadataAccessStateHash,
      documentId: remote.metadataDocumentId,
      id: remote.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as unknown as ContainerState;
}

test("a stale tombstone does not starve independent page work", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-stale-tombstone-partial-progress",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const parentState = existingContainerState("shared-parent", null);
    const staleRestoredState = existingContainerState(
      "stale-restored",
      parentState.container.id,
    );
    const deletedState = existingContainerState(
      "independent-deleted",
      parentState.container.id,
    );
    const discoveredContainer = remoteContainer(
      "independent-discovered",
      parentState.container.id,
    );
    for (const containerState of [parentState, deletedState]) {
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        containerState.container,
        containerState.record,
      );
    }
    const pageWatermark = {
      id: "mixed-tombstone-page",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const state = {
      containersById: new Map([
        [parentState.container.id, parentState],
        [deletedState.container.id, deletedState],
      ]),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{
              laneId: string;
              parentId: string | null;
            }>;
          }): Promise<ListContainerParentLanesResponse> => {
            await defaultContainerContentsPersistence.saveContainer(
              execSql,
              staleRestoredState.container,
              staleRestoredState.record,
            );
            state.containersById.set(
              staleRestoredState.container.id,
              staleRestoredState,
            );
            return {
              results: request.lanes.map(({ laneId, parentId }) => ({
                laneId,
                page:
                  parentId === parentState.container.id
                    ? {
                        hasMore: false,
                        items: [discoveredContainer],
                        nextWatermark: pageWatermark,
                        tombstones: [
                          {
                            containerId: staleRestoredState.container.id,
                            depth: 1,
                            parentId: parentState.container.id,
                            reason: "access_revoked",
                            updatedAt: timestamp,
                          },
                          {
                            containerId: deletedState.container.id,
                            depth: 1,
                            parentId: parentState.container.id,
                            reason: "deleted",
                            updatedAt: timestamp,
                          },
                        ],
                      }
                    : {
                        hasMore: false,
                        items: [],
                        nextWatermark: null,
                        tombstones: [],
                      },
              })),
            };
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
    } as unknown as RemoteContainerHydrationState;

    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("mixed page has no existing-container upsert");
        },
        updateSnapshot: () => {},
      },
      parentIds: [parentState.container.id],
      state,
    });

    expect(state.containersById.get(staleRestoredState.container.id)).toBe(
      staleRestoredState,
    );
    expect(state.containersById.has(deletedState.container.id)).toBe(false);
    expect(state.containersById.has(discoveredContainer.id)).toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        staleRestoredState.container.id,
      ),
    ).resolves.toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        deletedState.container.id,
      ),
    ).resolves.toBe(false);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        discoveredContainer.id,
      ),
    ).resolves.toBe(true);
    await expect(
      loadContainerSyncWatermark(
        execSql,
        createContainerParentSyncLane(parentState.container.id),
      ),
    ).resolves.toBeNull();
  } finally {
    await close();
  }
});

test("a stale descendant keeps its whole tombstone cascade retryable", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-stale-tombstone-descendant",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const parentState = existingContainerState("shared-parent", null);
    const removedRoot = existingContainerState(
      "removed-root",
      parentState.container.id,
    );
    const staleChild = existingContainerState(
      "stale-child",
      removedRoot.container.id,
    );
    const unchangedChild = existingContainerState(
      "unchanged-child",
      removedRoot.container.id,
    );
    for (const containerState of [
      parentState,
      removedRoot,
      staleChild,
      unchangedChild,
    ]) {
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        containerState.container,
        containerState.record,
      );
    }
    const pageWatermark = {
      id: "stale-descendant-page",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    let fetchCount = 0;
    const state = {
      containersById: new Map(
        [parentState, removedRoot, staleChild, unchangedChild].map(
          (containerState) => [containerState.container.id, containerState],
        ),
      ),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => {
            fetchCount += 1;
            if (fetchCount === 1) {
              staleChild.record.documentId = "newer-stale-child-metadata";
            }
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: {
                  hasMore: false,
                  items: [],
                  nextWatermark: pageWatermark,
                  tombstones: [
                    {
                      containerId: removedRoot.container.id,
                      depth: 1,
                      parentId: parentState.container.id,
                      reason: "deleted",
                      updatedAt: timestamp,
                    },
                  ],
                },
              })),
            };
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
    } as unknown as RemoteContainerHydrationState;

    const hydrate = () =>
      hydrateRemoteContainers({
        host: {
          persistContainerState: async () => {
            throw new Error("tombstone page must not upsert containers");
          },
          updateSnapshot: () => {},
        },
        parentIds: [parentState.container.id],
        state,
      });

    await hydrate();

    for (const containerState of [removedRoot, staleChild, unchangedChild]) {
      expect(state.containersById.has(containerState.container.id)).toBe(true);
      await expect(
        defaultContainerContentsPersistence.containerExists(
          execSql,
          containerState.container.id,
        ),
      ).resolves.toBe(true);
    }
    await expect(
      loadContainerSyncWatermark(
        execSql,
        createContainerParentSyncLane(parentState.container.id),
      ),
    ).resolves.toBeNull();

    await hydrate();

    for (const containerState of [removedRoot, staleChild, unchangedChild]) {
      expect(state.containersById.has(containerState.container.id)).toBe(false);
      await expect(
        defaultContainerContentsPersistence.containerExists(
          execSql,
          containerState.container.id,
        ),
      ).resolves.toBe(false);
    }
    await expect(
      loadContainerSyncWatermark(
        execSql,
        createContainerParentSyncLane(parentState.container.id),
      ),
    ).resolves.toEqual(pageWatermark);
  } finally {
    await close();
  }
});
