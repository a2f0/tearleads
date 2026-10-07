import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainersResponse } from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../test/helpers/signedContainerDirectory";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  createContainerParentSyncLane,
  loadContainerSyncWatermark,
  defaultContainerContentsPersistence as persistence,
} from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type { RemoteContainerHydrationState } from "./remoteHydration/types";

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

for (const failure of ["withheld", "tampered", "expired", "runtime"] as const) {
  test(
    failure === "runtime"
      ? "unexpected projection defects still abort discovery"
      : `${failure === "expired" ? "an" : "a"} ${failure} ordinary child proof preserves independent discovery`,
    async () => {
      const { close, execSql } = createNativeTestExecSql();
      const firstRoot = container("first-root");
      const laterRoot = container("later-root");
      const bad = container("bad-child", firstRoot.id);
      const sibling = container("good-sibling", firstRoot.id);
      const descendant = container("good-descendant", sibling.id);
      const later = container("later-child", laterRoot.id);
      const containers = [
        firstRoot,
        laterRoot,
        bad,
        sibling,
        descendant,
        later,
      ];
      const directory = await createSignedContainerDirectory(
        containers.map(
          ({ id, parentId, organizationId, metadataDocumentId }) => ({
            id,
            parentId,
            organizationId,
            metadataDocumentId,
          }),
        ),
      );
      const watermark = { id: "page-end", updatedAt: timestamp };
      const requestedParents: (string | null)[] = [];
      const incidents: unknown[] = [];
      let badProofReads = 0;
      const unexpectedFailure = new TypeError("Unexpected projection defect");
      try {
        await persistence.ensureSchema(execSql);
        const state = {
          containersById: new Map(),
          persistence,
          runtime: {
            resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
            apiClient: {
              evictContainerWriterProjection: () => {},
              getContainerWriterProjection: async (id: string) => {
                if (id !== bad.id)
                  return directory.getContainerWriterProjection(id);
                badProofReads += 1;
                if (failure === "withheld") return null;
                if (failure === "runtime") throw unexpectedFailure;
                if (failure === "expired")
                  assertProjectionVerificationCurrent(() => false);
                const projection = structuredClone(
                  await directory.getContainerWriterProjection(id),
                );
                const leaf = projection.path.at(-1);
                if (!leaf) throw new Error("Expected signed child proof");
                leaf.event.event = {
                  ...leaf.event.event,
                  signedAt: "2026-09-29T00:00:00.000Z",
                };
                return projection;
              },
              getCurrentPrincipalPolicy: async () => null,
              listContainerParentLanes: async (
                request: ListContainerParentLanesRequest,
              ) => ({
                results: request.lanes.map(({ laneId, parentId }) => {
                  requestedParents.push(parentId);
                  return {
                    laneId,
                    page: {
                      hasMore: false,
                      items: containers.filter(
                        (container) => container.parentId === parentId,
                      ),
                      nextWatermark: watermark,
                      tombstones: [],
                    },
                  };
                }),
              }),
            },
            auth: { isAuthenticated: true },
            infra: { dbStatus: "ready", execSql },
            state: { online: true },
            util: {
              log: () => {},
              reportSecurityIncident: async (error: unknown) => {
                incidents.push(error);
              },
            },
          },
        } as unknown as RemoteContainerHydrationState;
        let completed = false;
        const hydration = hydrateRemoteContainers({
          host: {
            persistContainerState: async () => {
              throw new Error("Expected inserts only");
            },
            updateSnapshot: () => {},
          },
          onFullyHydrated: () => {
            completed = true;
          },
          parentIds: [null],
          state,
        });
        if (failure === "runtime") {
          await expect(hydration).rejects.toBe(unexpectedFailure);
          expect(incidents).toHaveLength(0);
          return;
        }
        await hydration;
        expect(state.containersById.has(bad.id)).toBe(false);
        expect(await persistence.containerExists(execSql, bad.id)).toBe(false);
        for (const accepted of [sibling, descendant, later]) {
          expect(state.containersById.has(accepted.id)).toBe(true);
          expect(await persistence.containerExists(execSql, accepted.id)).toBe(
            true,
          );
        }
        expect(requestedParents).not.toContain(bad.id);
        // A rejected prefetch leaves no projection, so verification reads again.
        expect(badProofReads).toBe(failure === "expired" ? 2 : 1);
        expect(
          await loadContainerSyncWatermark(
            execSql,
            createContainerParentSyncLane(firstRoot.id),
          ),
        ).toBeNull();
        expect(
          await loadContainerSyncWatermark(
            execSql,
            createContainerParentSyncLane(laterRoot.id),
          ),
        ).toEqual(watermark);
        expect(completed).toBe(false);
        expect(incidents).toHaveLength(failure === "tampered" ? 1 : 0);
      } finally {
        close();
      }
    },
  );
}
