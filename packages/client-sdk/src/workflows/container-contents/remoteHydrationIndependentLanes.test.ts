import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../test/helpers/signedContainerDirectory";
import {
  createContainerParentSyncLane,
  loadContainerSyncWatermark,
  defaultContainerContentsPersistence as persistence,
} from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const timestamp = "2026-01-01T00:00:00.000Z";
function container(
  id: string,
  parentId: string | null = null,
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

test.each([false, true])(
  "a stale root page preserves independent child discovery (hasMore=%s)",
  async (hasMore) => {
    const { close, execSql } = await createTestExecSql(
      "independent-container-discovery-lanes",
    );
    const stale = container("existing-root");
    const discovered = container("shared-root");
    const child = container("shared-child", discovered.id);
    const directory = await createSignedContainerDirectory(
      [stale, discovered, child].map(
        ({ id, parentId, organizationId, metadataDocumentId }) => ({
          id,
          parentId,
          organizationId,
          metadataDocumentId,
        }),
      ),
    );
    try {
      await persistence.ensureSchema(execSql);
      const existing = {
        container: { ...stale, name: "Existing" },
        doc: {},
        record: {
          accessEpoch: 1,
          accessStateHash: stale.metadataAccessStateHash,
          documentId: stale.metadataDocumentId,
          id: stale.id,
          metadataUpdates: "",
          snapshotEndVersion: "",
        },
      } as unknown as ContainerState;
      await persistence.saveContainer(
        execSql,
        existing.container,
        existing.record,
      );
      const requestedParents: (string | null)[] = [];
      const watermark = { id: "page-end", updatedAt: timestamp };
      const state = {
        containersById: new Map([[stale.id, existing]]),
        persistence,
        runtime: {
          resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
          apiClient: {
            getContainerWriterProjection:
              directory.getContainerWriterProjection,
            getCurrentPrincipalPolicy: async () => null,
            listContainerParentLanes: async (request: {
              lanes: ReadonlyArray<{ laneId: string; parentId: string | null }>;
            }): Promise<ListContainerParentLanesResponse> => {
              existing.record.documentId = "concurrent-local-metadata";
              return {
                results: request.lanes.map(({ laneId, parentId }) => {
                  requestedParents.push(parentId);
                  return {
                    laneId,
                    page: {
                      hasMore: parentId === null && hasMore,
                      items:
                        parentId === null
                          ? [stale, discovered]
                          : parentId === discovered.id
                            ? [child]
                            : [],
                      nextWatermark: watermark,
                      tombstones: [],
                    },
                  };
                }),
              };
            },
          },
          auth: { isAuthenticated: true },
          infra: { dbStatus: "ready", execSql },
          state: { online: true },
          util: { log: () => {} },
        },
      } as unknown as RemoteContainerHydrationState;
      let completed = false;
      await hydrateRemoteContainers({
        host: {
          persistContainerState: async () => {
            throw new Error("The stale existing item must not be persisted");
          },
          updateSnapshot: () => {},
        },
        onFullyHydrated: () => {
          completed = true;
        },
        parentIds: [null, stale.id],
        state,
      });

      expect(existing.record.documentId).toBe("concurrent-local-metadata");
      expect(state.containersById.has(discovered.id)).toBe(true);
      expect(state.containersById.has(child.id)).toBe(true);
      expect(requestedParents).toEqual([
        null,
        stale.id,
        discovered.id,
        child.id,
      ]);
      expect(await persistence.containerExists(execSql, child.id)).toBe(true);
      expect(
        await loadContainerSyncWatermark(
          execSql,
          createContainerParentSyncLane(null),
        ),
      ).toBeNull();
      expect(
        await loadContainerSyncWatermark(
          execSql,
          createContainerParentSyncLane(discovered.id),
        ),
      ).toEqual(watermark);
      expect(state.rootLaneHydrated).not.toBe(true);
      expect(completed).toBe(false);
    } finally {
      await close();
    }
  },
);
