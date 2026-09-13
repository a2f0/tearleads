import { expect, test } from "bun:test";
import { createParentProjection } from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import { upsertRemoteContainerState } from "../remoteContainerState";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

const SLOT = `sys_v1_${"a".repeat(43)}`;
for (const [signedSlot, listedSlot] of [
  [null, SLOT],
  [SLOT, SLOT],
  [null, null],
]) {
  test(`hydration derives a destination's slot and parent from its signed manifest (${listedSlot === null ? "forged session root" : signedSlot === null ? "ordinary" : "system"})`, async () => {
    const parent = await createParentProjection();
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      author: parent.author,
      parentProjection: parent.projection,
      parentSecretKey: parent.secretKey,
      systemSlot: signedSlot ?? null,
      trustedLocalProjection: true,
    });
    const projection = childContainerWriterProjectionFromCreatePlan({
      materializedPlan,
      parentProjection: parent.projection,
    });
    await withTestExecSql("verified-system-destination", async (execSql) => {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      let projectionReads = 0;
      const state = {
        containersById: new Map(),
        persistence: sqlContainerContentsPersistence,
        runtime: {
          apiClient: {
            getContainerWriterProjection: async () => {
              projectionReads += 1;
              return projection;
            },
            getCurrentPrincipalPolicy: async () => null,
          },
          auth: {
            organizationId: projection.organizationId,
            rootContainerId:
              listedSlot === null
                ? projection.containerId
                : parent.projection.containerId,
          },
          infra: { execSql },
          resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
            userId: parent.userId,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            encapsulationPublicKey: parent.encapsulationPublicKey,
          }),
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        },
      } as unknown as RemoteContainerHydrationState;
      const listed: RemoteContainer = {
        id: projection.containerId,
        organizationId: projection.organizationId,
        parentId: null,
        systemSlot: listedSlot ?? null,
        metadataDocumentId: "untrusted-listed-metadata",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "metadata-hash",
        metadataReferencedPrincipals: [],
        effectiveAccessLevel: "admin",
        createdAt: "2026-09-12T00:00:00.000Z",
        updatedAt: "2026-09-12T00:00:00.000Z",
      };
      const hydrated = await upsertRemoteContainerState({
        remoteContainer: listed,
        state,
        containerIdsWithPendingMetadataUpdates: new Set(),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: {
          updateSnapshot: () => {},
          persistContainerState: async () => {
            throw new Error("expected insert");
          },
        },
      });
      expect(hydrated?.container.systemSlot).toBe(signedSlot);
      expect(hydrated?.container.parentId).toBe(parent.projection.containerId);
      expect(hydrated?.container.metadataDocumentId).toBe(
        materializedPlan.plan.metadataDocumentId,
      );
      const [stored] =
        await sqlContainerContentsPersistence.loadContainers(execSql);
      expect(stored?.container.systemSlot).toBe(signedSlot);
      expect(stored?.container.parentId).toBe(parent.projection.containerId);
      const again = await verifyRemoteContainerDestination({
        remoteContainer: { ...listed, metadataDocumentId: "another-forged-id" },
        state,
      });
      expect(again?.metadataDocumentId).toBe(
        materializedPlan.plan.metadataDocumentId,
      );
      expect(again?.parentId).toBe(parent.projection.containerId);
      expect(projectionReads).toBe(signedSlot === SLOT ? 1 : 2);
    });
  });
}
