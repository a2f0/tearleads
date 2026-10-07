import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import {
  projectionDirectoryPayload,
  projectionHistoryPages,
  projectionPolicySource,
} from "../../../../test/helpers/projectionPolicyHistory";
import { createReservedGroupAdvance } from "../../../../test/helpers/reservedGroupAdvance";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

// A metadata root read before a reserved-group commit is an honest race: the
// destination check drops the root it was handed, reads it once more, and
// reports only a root that is still behind (#2365 finding 22).

async function staleMetadataRoot() {
  const scenario = await createReservedGroupAdvance("Members");
  const { artifacts } = scenario;
  const created = await createMutationResponseFromRequest(
    artifacts.organizationMetadataBootstrap.containerRequest.container,
  );
  const projection: ContainerWriterProjectionResponse = {
    containerId: created.containerId,
    containerKeks: [created.containerKek],
    organizationId: artifacts.organizationId,
    path: [created.accessManifest],
    policyEvidence: {
      groups: [scenario.admin, scenario.advanced].map(projectionPolicySource),
      organization: projectionPolicySource(scenario.advancedDirectory),
      organizationPayloads: [
        projectionDirectoryPayload(scenario.advancedDirectory),
      ],
    },
  };
  const listed: RemoteContainer = {
    createdAt: "2026-10-01T00:00:00.000Z",
    effectiveAccessLevel: "admin",
    id: created.containerId,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: created.manifestHead.manifestHash,
    metadataDocumentId:
      artifacts.organizationMetadataBootstrap.containerPlan.plan
        .metadataDocumentId,
    metadataReferencedPrincipals: [],
    organizationId: artifacts.organizationId,
    parentId: null,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: artifacts.organizationId,
    }),
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  return { listed, projection, scenario };
}

test("a stale prefetched metadata root is read once more, then reported", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-reload");
  try {
    const { listed, projection, scenario } = await staleMetadataRoot();
    const evicted: string[] = [];
    const incidents: string[] = [];
    let reads = 0;
    const state = {
      containersById: new Map(),
      runtime: {
        withPrincipalHistoryProtection: async (
          operation: (lease: {
            protection: { localKey: Uint8Array; context: string };
            stillCurrent: () => boolean;
          }) => Promise<unknown>,
        ) =>
          operation({
            protection: {
              localKey: new Uint8Array(32).fill(19),
              context: "metadata-root-test",
            },
            stillCurrent: () => true,
          }),
        apiClient: {
          ...projectionHistoryPages([
            scenario.admin,
            scenario.advanced,
            scenario.advancedDirectory,
          ]),
          evictContainerWriterProjection: (containerId: string) => {
            evicted.push(containerId);
          },
          getContainerWriterProjection: async () => {
            reads += 1;
            return projection;
          },
          getCurrentPrincipalPolicy: scenario.currentPolicy,
        },
        auth: {
          organizationId: listed.organizationId,
          rootContainerId: "personal-root",
          userId: "founder",
        },
        infra: { execSql },
        resolveTrustedUserIdentity: scenario.resolveTrustedUserIdentity,
        util: {
          log: () => {},
          reportSecurityIncident: async (
            _error: unknown,
            context: { operation: string },
          ) => {
            incidents.push(context.operation);
          },
        },
      },
    } as unknown as RemoteContainerHydrationState;

    await expect(
      verifyRemoteContainerDestination({
        heldBinding: null,
        prefetchedProjection: { projection },
        remoteContainer: listed,
        state,
      }),
    ).rejects.toThrow("still behind the signed directory after a reload");
    // The handed root was dropped for exactly one fresh read, which the
    // cache could not answer.
    expect(reads).toBe(1);
    expect(evicted).toEqual([listed.id, listed.id]);
    expect(incidents).toEqual(["container.destination.verify"]);
  } finally {
    close();
  }
});
