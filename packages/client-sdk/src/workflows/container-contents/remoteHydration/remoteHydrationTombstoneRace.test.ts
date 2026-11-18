import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../../test/helpers/data/signedContainerDirectory";
import { withPrincipalPolicies } from "../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { upsertAccessManifestCheckpointInTransaction } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { createDomainScope } from "../../../data/shared/domainScope";
import { keyingCheckpointTables } from "../../../data/sqlite/schema/keyingCheckpointSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { containerContentsOrganizationHost } from "../../organizations/containerContentsHost";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { hydrateRemoteContainers } from "./index";
import {
  existingContainerState,
  remoteContainer,
  timestamp,
} from "./lanes/tombstoneApplication.testFixtures";
import type { RemoteContainerHydrationState } from "./types";

function loadParentWatermark(execSql: ExecSql, parentId: string) {
  return new ContainerSyncWatermarkRepository(execSql).loadWatermark(
    createContainerParentSyncLane(parentId),
  );
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
    const directory = await createSignedContainerDirectory([
      {
        id: parentState.container.id,
        parentId: null,
        organizationId: discoveredContainer.organizationId,
      },
      {
        id: discoveredContainer.id,
        parentId: parentState.container.id,
        organizationId: discoveredContainer.organizationId,
        metadataDocumentId: discoveredContainer.metadataDocumentId,
      },
    ]);
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
      runtime: withPrincipalPolicies({
        organizations: containerContentsOrganizationHost,
        resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
        apiClient: {
          getContainerWriterProjection: directory.getContainerWriterProjection,
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
        state: { domainScope: createDomainScope(), online: true },
        util: { log: () => {} },
      }),
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
      loadParentWatermark(execSql, parentState.container.id),
    ).resolves.toBeNull();
  } finally {
    await close();
  }
});

test.each(["newer", "older"] as const)(
  "a replayed removal checks %s-clock descendants before advancing its cursor",
  async (clock) => {
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
      const stillReadable = existingContainerState(
        "still-readable",
        removedRoot.container.id,
      );
      const later = "2026-01-03T00:00:00.000Z";
      for (const row of [unchangedChild, stillReadable, removedRoot]) {
        row.container.serverUpdatedAt =
          clock === "newer" ? later : "2025-12-01T00:00:00.000Z";
      }
      const deniedGrandchild = existingContainerState(
        "denied-grandchild",
        stillReadable.container.id,
      );
      const legacyCursor = { id: parentState.container.id, updatedAt: later };
      await new ContainerSyncWatermarkRepository(execSql).saveWatermark(
        createContainerParentSyncLane(parentState.container.id),
        legacyCursor,
      );
      for (const containerState of [
        parentState,
        stillReadable,
        deniedGrandchild,
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
        id: "d1/removed-root",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      let fetchCount = 0;
      const retryParents = new Set<string | null>();
      const state = {
        containerParentIdsNeedingHydration: retryParents,
        containerListingFailures: 0,
        containersById: new Map(
          [
            parentState,
            removedRoot,
            staleChild,
            unchangedChild,
            stillReadable,
            deniedGrandchild,
          ].map((containerState) => [
            containerState.container.id,
            containerState,
          ]),
        ),
        persistence: defaultContainerContentsPersistence,
        runtime: withPrincipalPolicies({
          organizations: containerContentsOrganizationHost,
          apiClient: {
            listContainerDocumentLanes: async ({
              afterParentPage,
              lanes,
            }: {
              afterParentPage: unknown;
              lanes: { containerId: string; laneId: string }[];
            }) => {
              expect(afterParentPage).toEqual({
                parentId: parentState.container.id,
                watermark: pageWatermark,
              });
              if (fetchCount === 3) {
                await ensureSqlTables(execSql, keyingCheckpointTables);
                await upsertAccessManifestCheckpointInTransaction(
                  getClientSQLitePersistenceRuntime(execSql).db,
                  {
                    objectKind: "container",
                    objectId: removedRoot.container.id,
                    organizationId: removedRoot.container.organizationId,
                    epoch: 2,
                    manifestHash: "new-placement",
                  },
                  later,
                );
              }
              return fetchCount === 2
                ? null
                : {
                    results: lanes.map(({ containerId, laneId }) =>
                      containerId === stillReadable.container.id
                        ? {
                            laneId,
                            page: {
                              items: [],
                              tombstones: [],
                              hasMore: false,
                              nextWatermark: null,
                            },
                          }
                        : {
                            laneId,
                            failure: { status: 403, error: "Forbidden" },
                          },
                    ),
                  };
            },
            getCurrentPrincipalPolicy: async () => null,
            listContainerParentLanes: async (request: {
              lanes: ReadonlyArray<{ laneId: string }>;
            }): Promise<ListContainerParentLanesResponse> => {
              fetchCount += 1;
              if (fetchCount === 1) {
                staleChild.record.accessStateHash = "newer-stale-child-head";
                await defaultContainerContentsPersistence.saveContainer(
                  execSql,
                  staleChild.container,
                  staleChild.record,
                );
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
          state: { domainScope: createDomainScope(), online: true },
          util: { log: () => {} },
        }),
      } as unknown as RemoteContainerHydrationState;

      const hydrate = (
        parentIds: readonly (string | null)[] = [parentState.container.id],
      ) =>
        hydrateRemoteContainers({
          host: {
            persistContainerState: async () => {
              throw new Error("tombstone page must not upsert containers");
            },
            updateSnapshot: () => {},
          },
          parentIds,
          state,
        });

      await hydrate();

      expect(state.containersById.has(stillReadable.container.id)).toBe(true);
      for (const containerState of [
        removedRoot,
        staleChild,
        unchangedChild,
        deniedGrandchild,
      ]) {
        expect(state.containersById.has(containerState.container.id)).toBe(
          true,
        );
        await expect(
          defaultContainerContentsPersistence.containerExists(
            execSql,
            containerState.container.id,
          ),
        ).resolves.toBe(true);
      }
      await expect(
        loadParentWatermark(execSql, parentState.container.id),
      ).resolves.toEqual(legacyCursor);

      await hydrate();
      expect(fetchCount).toBe(2);
      expect(state.containerListingFailures).toBe(1);
      expect([...retryParents]).toEqual([parentState.container.id]);
      expect(state.containersById.has(removedRoot.container.id)).toBe(true);
      await expect(
        loadParentWatermark(execSql, parentState.container.id),
      ).resolves.toEqual(legacyCursor);

      await hydrate([...retryParents]);
      expect(state.containersById.has(removedRoot.container.id)).toBe(true);
      await expect(
        loadParentWatermark(execSql, parentState.container.id),
      ).resolves.toEqual(legacyCursor);
      await hydrate([...retryParents]);

      await expect(
        defaultContainerContentsPersistence.containerExists(
          execSql,
          stillReadable.container.id,
        ),
      ).resolves.toBe(true);
      expect(state.containersById.has(stillReadable.container.id)).toBe(true);
      for (const containerState of [
        removedRoot,
        staleChild,
        unchangedChild,
        deniedGrandchild,
      ]) {
        expect(state.containersById.has(containerState.container.id)).toBe(
          false,
        );
        await expect(
          defaultContainerContentsPersistence.containerExists(
            execSql,
            containerState.container.id,
          ),
        ).resolves.toBe(false);
      }
      await expect(
        loadParentWatermark(execSql, parentState.container.id),
      ).resolves.toEqual(pageWatermark);
    } finally {
      await close();
    }
  },
);
