import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createParentProjection } from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createDomainScope } from "../../../data/domainScope";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createContainerContentsTestRuntime } from "../../../stores/container-contents/runtime.testFixtures";
import { createContainerContentsStoreState } from "../../../stores/container-contents/state";
import { findRootContainerState } from "../../../stores/container-contents/systemContainerLookup";
import { createTestContainerState } from "../container-state/containerState.testFixtures";
import { upsertRemoteContainerState } from "../remoteContainerState";
import type { RemoteContainer } from "./types";

for (const forgeOrganization of [false, true]) {
  test(
    forgeOrganization
      ? "a signed foreign root cannot be relabeled as the session organization"
      : "a root created on another device is usable after signed verification",
    async () => {
      const parent = await createParentProjection();
      const organizationId = forgeOrganization
        ? "forged-organization"
        : parent.projection.organizationId;
      await withTestExecSql("destination-organization", async (execSql) => {
        await sqlContainerContentsPersistence.ensureSchema(execSql);
        let projectionReads = 0;
        const runtime = createContainerContentsTestRuntime({
          domainScope: createDomainScope(),
          execSql,
          organizationId,
          containerId: parent.projection.containerId,
          apiClient: createMockApiClient({
            getContainerWriterProjection: async () => {
              projectionReads += 1;
              return { ...parent.projection, organizationId };
            },
          }),
          resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
            userId: parent.userId,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            encapsulationPublicKey: parent.encapsulationPublicKey,
          }),
        });
        // Selecting a locally listed organization supplies a view, never a root acknowledgement.
        const state = createContainerContentsStoreState(
          {
            ...runtime,
            auth: {
              ...runtime.auth,
              defaultOrganizationId: "personal-organization",
              rootContainerId: forgeOrganization
                ? parent.projection.containerId
                : null,
            },
          },
          sqlContainerContentsPersistence,
        );
        const pendingRoot = createTestContainerState({
          id: "pending-local-root",
          parentId: null,
          organizationId: "",
          synced: false,
        });
        state.containersById.set(pendingRoot.container.id, pendingRoot);
        const listed: RemoteContainer = {
          id: parent.projection.containerId,
          organizationId,
          parentId: null,
          systemSlot: null,
          metadataDocumentId: "listed-metadata",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "listed-hash",
          metadataReferencedPrincipals: [],
          effectiveAccessLevel: "admin",
          createdAt: "2026-09-13T00:00:00.000Z",
          updatedAt: "2026-09-13T00:00:00.000Z",
        };
        const hydrate = () =>
          upsertRemoteContainerState({
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
        if (forgeOrganization) {
          await expect(hydrate()).rejects.toMatchObject({
            code: "object_mismatch",
          });
          expect(
            await sqlContainerContentsPersistence.loadContainers(execSql),
          ).toEqual([]);
        } else {
          const hydrated = await hydrate();
          expect(hydrated).not.toBeNull();
          expect(findRootContainerState(state)?.container.id).toBe(
            parent.projection.containerId,
          );
          expect(state.runtime.auth.rootContainerId).toBeNull();
          expect(state.containersById.has("pending-local-root")).toBe(true);
        }
        expect(projectionReads).toBe(1);
      });
    },
  );
}
