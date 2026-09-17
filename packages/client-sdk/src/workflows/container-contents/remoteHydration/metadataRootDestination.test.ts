import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestGroupMetadataProjection } from "../../../../test/helpers/groupMetadataProjection";
import { createGroupNameDirectory } from "../../../../test/helpers/groupNameDirectory";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

test("a self-authorized signed root cannot impersonate the organization's metadata destination", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-destination-substitution",
  );
  try {
    const parent = await createParentProjection();
    const metadata = await createTestGroupMetadataProjection(parent);
    const directory = await createGroupNameDirectory();
    const owner = createParentProjectionUserKeyResolver(parent);
    let reads = 0;
    const state = {
      containersById: new Map(),
      runtime: {
        apiClient: {
          ...directory.apiClient,
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
        verifyRemoteContainerDestination({ remoteContainer, state }),
      ).rejects.toThrow("reserved group grants");
    expect(reads).toBe(2); // A rejected role must never enter the destination cache.
  } finally {
    close();
  }
});
