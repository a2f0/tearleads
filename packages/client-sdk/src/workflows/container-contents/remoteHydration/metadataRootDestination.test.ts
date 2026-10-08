import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestGroupMetadataProjection } from "../../../../test/helpers/groupMetadataProjection";
import { createGroupNameDirectory } from "../../../../test/helpers/groupNameDirectory";
import {
  repairPolicyPages,
  repairProtectionLease,
} from "../../../../test/helpers/principalPolicyRepair";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

test.each([true, false])(
  "metadata destination requires reserved authority and private custody (%s)",
  async (withCustody) => {
    const { close, execSql } = await createTestExecSql(
      "metadata-destination-substitution",
    );
    try {
      const parent = await createParentProjection();
      const metadata = await createTestGroupMetadataProjection(parent);
      const directory = await createGroupNameDirectory();
      const organization = await directory.apiClient.getCurrentPrincipalPolicy(
        "organization",
        parent.author.organizationId,
      );
      if (!organization) throw new Error("Missing directory fixture");
      directory.fetched.length = 0;
      const owner = createParentProjectionUserKeyResolver(parent);
      let reads = 0;
      const state = {
        containersById: new Map(),
        runtime: {
          ...(withCustody
            ? { withPrincipalHistoryProtection: repairProtectionLease() }
            : {}),
          apiClient: {
            ...directory.apiClient,
            getPrincipalPolicyPages: repairPolicyPages([
              organization,
              ...Object.values(directory.servedGroups),
            ]),
            evictContainerWriterProjection: () => {},
            getContainerWriterProjection: async () => {
              reads += 1;
              return metadata.projection;
            },
          },
          auth: {
            organizationId: parent.author.organizationId,
            rootContainerId: parent.projection.containerId,
            userId: parent.userId,
          },
          infra: { execSql },
          resolveTrustedUserIdentity: async (userId: string) =>
            (await owner(userId)) ??
            (await directory.resolveTrustedUserIdentity(userId)),
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        },
      } as unknown as RemoteContainerHydrationState;
      const remoteContainer: RemoteContainer = {
        id: metadata.key.containerId,
        organizationId: parent.author.organizationId,
        parentId: null,
        systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
          organizationId: parent.author.organizationId,
        }),
        metadataDocumentId: metadata.key.containerId,
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "listed-head",
        metadataReferencedPrincipals: [],
        effectiveAccessLevel: "admin",
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z",
      };
      for (let attempt = 0; attempt < 2; attempt += 1)
        await expect(
          verifyRemoteContainerDestination({
            heldBinding: null,
            remoteContainer,
            state,
          }),
        ).rejects.toMatchObject(
          withCustody
            ? {
                code: "object_mismatch",
                message: expect.stringContaining("reserved group grants"),
              }
            : { name: "ProjectionDependencyUnavailableError" },
        );
      expect(directory.fetched).toEqual([]);
      expect(reads).toBe(2); // A rejected role must never enter the destination cache.
    } finally {
      close();
    }
  },
);
