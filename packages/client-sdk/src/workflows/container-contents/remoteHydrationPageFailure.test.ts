import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
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

function remoteContainer(id: string): ListContainersResponse["items"][number] {
  return {
    createdAt: timestamp,
    depth: 0,
    effectiveAccessLevel: "write",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId: null,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

function existingContainerState(): ContainerState {
  const remote = remoteContainer("failed");
  return {
    container: {
      id: remote.id,
      icon: null,
      metadataDocumentId: remote.metadataDocumentId,
      name: "Failed",
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

test("a failed page upsert does not checkpoint or skip trailing containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-page-failure",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const existingState = existingContainerState();
    const pageWatermark = {
      id: "page-end",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const state = {
      containersById: new Map([[existingState.container.id, existingState]]),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => ({
            results: request.lanes.map(({ laneId }) => ({
              laneId,
              page: {
                hasMore: false,
                items: [remoteContainer("failed"), remoteContainer("trailing")],
                nextWatermark: pageWatermark,
                tombstones: [],
              },
            })),
          }),
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
    } as unknown as RemoteContainerHydrationState;

    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(state.containersById.has("failed")).toBe(false);
    expect(state.containersById.has("trailing")).toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(execSql, "trailing"),
    ).resolves.toBe(true);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toBeNull();
    expect(state.rootLaneHydrated).not.toBe(true);
  } finally {
    await close();
  }
});

test("a fetched page cannot resurrect a container deleted before apply", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-delete-before-apply",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const existingState = existingContainerState();
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      existingState.container,
      existingState.record,
    );
    const pageWatermark = {
      id: "stale-page-end",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const state = {
      containersById: new Map([[existingState.container.id, existingState]]),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => {
            state.containersById.delete(existingState.container.id);
            await defaultContainerContentsPersistence.deleteContainer(
              execSql,
              existingState.container.id,
            );
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: {
                  hasMore: false,
                  items: [remoteContainer(existingState.container.id)],
                  nextWatermark: pageWatermark,
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
          throw new Error("stale page must stop before persistence");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(state.containersById.has(existingState.container.id)).toBe(false);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        existingState.container.id,
      ),
    ).resolves.toBe(false);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toBeNull();
    expect(state.rootLaneHydrated).not.toBe(true);
  } finally {
    await close();
  }
});

test("a fetched page cannot overwrite a container mutated in place during fetch", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-in-place-mutation",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const existingState = existingContainerState();
    const replacementDocumentId = "metadata-newer-local-state";
    const state = {
      containersById: new Map([[existingState.container.id, existingState]]),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => {
            existingState.record.documentId = replacementDocumentId;
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: {
                  hasMore: false,
                  items: [remoteContainer(existingState.container.id)],
                  nextWatermark: {
                    id: "stale-in-place-page",
                    updatedAt: "2026-01-02T00:00:00.000Z",
                  },
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
          throw new Error("stale page must stop before persistence");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(existingState.record.documentId).toBe(replacementDocumentId);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toBeNull();
  } finally {
    await close();
  }
});

test("a stale page item does not starve an independent new container", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-partial-page-progress",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const existingState = existingContainerState();
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      existingState.container,
      existingState.record,
    );
    const newContainer = remoteContainer("independent-new-container");
    const state = {
      containersById: new Map([[existingState.container.id, existingState]]),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => {
            existingState.record.documentId = "newer-local-metadata";
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: {
                  hasMore: false,
                  items: [
                    remoteContainer(existingState.container.id),
                    newContainer,
                  ],
                  nextWatermark: {
                    id: "partial-page-end",
                    updatedAt: "2026-01-02T00:00:00.000Z",
                  },
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
          throw new Error("stale existing item must not persist");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(existingState.record.documentId).toBe("newer-local-metadata");
    expect(state.containersById.has(newContainer.id)).toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        newContainer.id,
      ),
    ).resolves.toBe(true);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toBeNull();
  } finally {
    await close();
  }
});

test("a stale tombstone cannot delete a container restored during fetch", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-stale-tombstone",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const restoredState = existingContainerState();
    const state = {
      containersById: new Map<string, ContainerState>(),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse> => {
            await defaultContainerContentsPersistence.saveContainer(
              execSql,
              restoredState.container,
              restoredState.record,
            );
            state.containersById.set(restoredState.container.id, restoredState);
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: {
                  hasMore: false,
                  items: [],
                  nextWatermark: {
                    id: "stale-tombstone-page",
                    updatedAt: "2026-01-02T00:00:00.000Z",
                  },
                  tombstones: [
                    {
                      containerId: restoredState.container.id,
                      depth: 0,
                      parentId: null,
                      reason: "access_revoked",
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

    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("tombstone-only page must not persist");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(state.containersById.get(restoredState.container.id)).toBe(
      restoredState,
    );
    await expect(
      defaultContainerContentsPersistence.containerExists(
        execSql,
        restoredState.container.id,
      ),
    ).resolves.toBe(true);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toBeNull();
  } finally {
    await close();
  }
});
