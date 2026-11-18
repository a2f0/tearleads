import { expect, spyOn, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainersResponse } from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../../test/helpers/data/signedContainerDirectory";
import { withPrincipalPolicies } from "../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { createDomainScope } from "../../../data/shared/domainScope";
import { containerContentsOrganizationHost } from "../../organizations/containerContentsHost";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence as persistence,
} from "../containerPersistence";
import { hydrateRemoteContainers } from "./index";
import type { RemoteContainerHydrationState } from "./types";

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
    metadataVersionVector: "",
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

for (const failure of [
  "withheld",
  "tampered",
  "mixed",
  "dependency",
  "manual dependency",
  "policy",
  "expired",
  "runtime",
] as const) {
  test(
    failure === "runtime"
      ? "unexpected projection defects still abort discovery"
      : `${failure === "expired" ? "an" : "a"} ${failure} ordinary child proof preserves independent discovery`,
    async () => {
      const { close, execSql } = createNativeTestExecSql();
      const firstRoot = container("first-root");
      const laterRoot = container("later-root");
      const bad = container("bad-child", firstRoot.id);
      if (failure === "policy")
        bad.metadataReferencedPrincipals = [
          {
            keyEpoch: 1,
            keyFingerprint: "refused",
            principalType: "group",
            principalId: "group",
            stateHash: "refused",
            version: 1,
          },
        ];
      const sibling = container("good-sibling", firstRoot.id);
      const descendant = container("good-descendant", sibling.id);
      const later = container("later-child", laterRoot.id);
      const withheld = container("withheld-child", firstRoot.id);
      const containers = [
        ...(failure === "mixed" ? [withheld] : []),
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
          runtime: withPrincipalPolicies({
            organizations: containerContentsOrganizationHost,
            resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
            apiClient: {
              evictContainerWriterProjection: () => {},
              getContainerWriterProjection: async (id: string) => {
                if (id === withheld.id) return null;
                if (id !== bad.id)
                  return directory.getContainerWriterProjection(id);
                badProofReads += 1;
                if (failure === "withheld") return null;
                if (failure === "dependency" || failure === "manual dependency")
                  throw new ProjectionDependencyUnavailableError(
                    "signer unavailable",
                  );
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
                results: request.lanes.map(
                  ({ laneId, parentId, watermark: after }) => {
                    requestedParents.push(parentId);
                    return {
                      laneId,
                      page: {
                        hasMore: parentId === firstRoot.id && !after,
                        items: containers.filter((container) => {
                          if (container.parentId !== parentId) return false;
                          if (parentId !== firstRoot.id) return true;
                          return after
                            ? container.id === sibling.id
                            : container.id !== sibling.id;
                        }),
                        nextWatermark: watermark,
                        tombstones: [],
                      },
                    };
                  },
                ),
              }),
            },
            auth: { isAuthenticated: true },
            infra: { dbStatus: "ready", execSql },
            state: { domainScope: createDomainScope(), online: true },
            util: {
              log: () => {},
              reportSecurityIncident: async (error: unknown) => {
                incidents.push(error);
              },
            },
          }),
        } as unknown as RemoteContainerHydrationState;
        if (failure === "policy")
          spyOn(
            state.runtime.principalPolicies,
            "createWarmer",
          ).mockReturnValue(async ({ references }) => {
            if (references.some((ref) => ref.principalId === "group"))
              throw new KeyingVerificationError(
                "equivocation",
                "refused test reference",
              );
          });
        let completed = false;
        let outcome: string | undefined;
        const hydration = hydrateRemoteContainers({
          host: {
            persistContainerState: async () => {
              throw new Error("Expected inserts only");
            },
            updateSnapshot: () => {},
          },
          reconnect:
            failure === "manual dependency"
              ? undefined
              : {
                  isCurrent: () => true,
                  record: (value) => {
                    outcome = value;
                  },
                },
          onFullyHydrated: () => {
            completed = true;
          },
          parentIds: [null],
          state,
        });
        if (failure === "manual dependency") {
          await expect(hydration).rejects.toThrow("signer unavailable");
          return;
        }
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
        expect(badProofReads).toBe(
          failure === "policy"
            ? 0
            : failure === "expired" || failure === "dependency"
              ? 2
              : 1,
        );
        const watermarks = new ContainerSyncWatermarkRepository(execSql);
        expect(
          await watermarks.loadWatermark(
            createContainerParentSyncLane(firstRoot.id),
          ),
        ).toBeNull();
        expect(
          await watermarks.loadWatermark(
            createContainerParentSyncLane(laterRoot.id),
          ),
        ).toEqual(watermark);
        expect(completed).toBe(false);
        expect(outcome).toBe(
          ["policy", "tampered"].includes(failure) ? "refused" : "retry",
        );
        expect(incidents).toHaveLength(
          ["mixed", "tampered"].includes(failure) ? 1 : 0,
        );
      } finally {
        close();
      }
    },
  );
}
