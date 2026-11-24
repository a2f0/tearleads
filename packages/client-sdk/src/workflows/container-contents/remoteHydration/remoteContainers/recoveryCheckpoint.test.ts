import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { verifyContainerWriterProjection } from "../../../../data/keyingProjectionVerification/container/containerProjectionVerification";
import { KeyingCheckpointRepository } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { openPrincipalPolicyBundleReader } from "../../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../../containers/child/create";
import { containerWriterProjectionFromRotationPlan } from "../../../containers/child/rekey/rekeyProjection";
import { containerContentsOrganizationHost } from "../../../organizations/containerContentsHost";
import { defaultContainerContentsPersistence as persistence } from "../../containerPersistence";
import { persistContainerMetadataStateFromRuntime } from "../../metadata/metadataPersistence";
import type { RemoteContainer, RemoteContainerHydrationState } from "../types";
import { upsertRemoteContainerState } from "./remoteContainerState";

test.each(["before verification", "before insertion"])(
  "recovery refuses a move pinned %s",
  async (timing) => {
    const { execSql, close } = await createTestExecSql("recovery-checkpoint");
    const otherDevice = await createTestExecSql("recovery-moving-device");
    const moveExecSql =
      timing === "before verification" ? execSql : otherDevice.execSql;
    try {
      const parent = await createParentProjection();
      const createChild = async () => {
        const materializedPlan = await buildMaterializedContainerCreatePlan({
          author: parent.author,
          parentProjection: parent.projection,
          parentSecretKey: parent.secretKey,
          trustedLocalProjection: true,
        });
        return childContainerWriterProjectionFromCreatePlan({
          materializedPlan,
          parentProjection: parent.projection,
        });
      };
      const [original, destination] = await Promise.all([
        createChild(),
        createChild(),
      ]);
      const resolveUserKey = createParentProjectionUserKeyResolver(parent);
      const moved = await createContainerMutationServiceFixture({
        api: {
          getContainerWriterProjection: async (id) =>
            id === original.containerId ? original : destination,
          moveContainer: async (_id, request) =>
            createMutationResponseFromRequest(request, original),
          reciteContainer: async () => null,
        },
        execSql: moveExecSql,
        reportSecurityIncident: async () => {},
        encapsulationSecretKey: parent.secretKey,
      }).moveRemoteContainer({
        author: parent.author,
        containerId: original.containerId,
        destinationParentContainerId: destination.containerId,
        resolveProjectionUserKey: resolveUserKey,
      });
      if (!moved) throw new Error("Move was not acknowledged");
      const current = await containerWriterProjectionFromRotationPlan({
        ancestors: destination,
        plan: moved.plan,
        previousProjection: original,
      });
      const pinned = await new KeyingCheckpointRepository(
        moveExecSql,
      ).loadAccessManifestCheckpoint(
        "container",
        original.organizationId,
        original.containerId,
      );
      expect(pinned?.manifestHash).toBe(moved.plan.manifestHash);
      await persistence.ensureSchema(execSql);
      await persistence.deleteContainers(
        execSql,
        [
          {
            containerId: original.containerId,
            reason: "deleted",
            updatedAt: "9999-01-01T00:00:00.000Z",
          },
        ],
        { discoveryOnly: true },
      );
      const [fence] =
        await persistence.loadContainerHydrationTombstones(execSql);
      if (!fence) throw new Error("Missing recovery fence");
      let served = original;
      let advancedBeforeInsert = false;
      const state = {
        containersById: new Map(),
        persistence: {
          ...persistence,
          loadContainerMetadataRecord: async (
            ...args: Parameters<typeof persistence.loadContainerMetadataRecord>
          ) => {
            if (timing === "before insertion" && !advancedBeforeInsert) {
              advancedBeforeInsert = true;
              await verifyContainerWriterProjection({
                execSql,
                openPrincipalPolicyBundleReader,
                projection: current,
                resolveUserKey,
              });
            }
            return persistence.loadContainerMetadataRecord(...args);
          },
        },
        runtime: withPrincipalPolicies({
          organizations: containerContentsOrganizationHost,
          apiClient: {
            getContainerWriterProjection: async () => served,
            evictContainerWriterProjection: () => {},
            evictWriterProjectionsCiting: () => {},
            getCurrentPrincipalPolicy: async () => null,
          },
          auth: {
            userId: parent.userId,
            organizationId: original.organizationId,
            rootContainerId: parent.projection.containerId,
          },
          state: { domainScope: createDomainScope() },
          infra: { execSql },
          resolveTrustedUserIdentity: resolveUserKey,
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        }),
      } as unknown as RemoteContainerHydrationState;
      const listed: RemoteContainer = {
        id: original.containerId,
        organizationId: original.organizationId,
        parentId: parent.projection.containerId,
        systemSlot: null,
        metadataDocumentId: "untrusted-listed-metadata",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "untrusted-listed-hash",
        metadataVersionVector: "",
        metadataReferencedPrincipals: [],
        effectiveAccessLevel: "admin",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      };
      const hydrate = (
        remoteContainer = listed,
        heldFence: typeof fence | null = fence,
      ) =>
        upsertRemoteContainerState({
          remoteContainer,
          state,
          expectedHydrationTombstone: heldFence,
          containerIdsWithPendingMetadataUpdates: new Set(),
          containerIdsWithPendingStructuralIntents: new Set(),
          host: {
            updateSnapshot: () => {},
            persistContainerState: async () => {
              throw new Error("Expected insertion");
            },
          },
        });
      if (timing === "before verification") {
        await expect(hydrate()).rejects.toMatchObject({ code: "rollback" });
      } else {
        expect(await hydrate()).toBeNull();
      }
      expect(
        await persistence.containerExists(execSql, original.containerId),
      ).toBe(false);
      expect(
        await persistence.loadContainerHydrationTombstones(execSql),
      ).toHaveLength(1);
      served = current;
      const restored = await hydrate();
      expect(restored?.container.parentId).toBe(destination.containerId);
      expect(
        await persistence.loadContainerHydrationTombstones(execSql),
      ).toEqual([]);
      if (!restored) throw new Error("Expected restored folder");
      let active = true;
      await upsertRemoteContainerState({
        state,
        isCurrent: () => active,
        remoteContainer: {
          ...listed,
          parentId: destination.containerId,
          updatedAt: "2026-09-24T00:00:00.000Z",
          metadataDocumentId:
            restored.container.metadataDocumentId ?? listed.metadataDocumentId,
          metadataAccessStateHash: moved.plan.manifestHash,
        },
        containerIdsWithPendingMetadataUpdates: new Set(),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: {
          updateSnapshot: () => {},
          persistContainerState: async (
            candidate,
            patch,
            _view,
            saveOptions,
            options,
          ) => {
            // The pause arrives after the signed placement read, while entering
            // the durable write. Use the same guard and persistence as the host.
            active = false;
            const saved = await persistContainerMetadataStateFromRuntime({
              metadataState: candidate,
              patch,
              persistence,
              runtime: state.runtime,
              saveOptions,
              stillCurrent: options?.isCurrent,
            });
            return saved
              ? { status: "persisted", record: saved.record }
              : { status: "identity-superseded", record: candidate.record };
          },
        },
      });
      expect(active).toBe(false);
      expect(
        (await persistence.loadContainerMetadataState(execSql, listed.id))
          ?.container.serverUpdatedAt,
      ).toBe(listed.updatedAt);
      // A backdated listing names a different manifest. Its proof is signed
      // and serves the current local pin, but cannot establish the listed move.
      const mismatch = await hydrate(
        {
          ...listed,
          updatedAt: "2026-09-24T00:00:00.000Z",
          metadataDocumentId:
            restored?.container.metadataDocumentId ?? listed.metadataDocumentId,
          metadataAccessStateHash: "unseen-newer-manifest",
        },
        null,
      );
      expect(mismatch).toBeNull();
      expect(
        state.containersById.get(listed.id)?.record.accessStateHash,
      ).not.toBe("unseen-newer-manifest");
      expect(
        await new KeyingCheckpointRepository(
          execSql,
        ).loadAccessManifestCheckpoint(
          "container",
          original.organizationId,
          original.containerId,
        ),
      ).toEqual(pinned);
    } finally {
      await close();
      await otherDevice.close();
    }
  },
);
