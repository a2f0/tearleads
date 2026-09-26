import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification/containerProjectionVerification";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import { moveRemoteContainer } from "../../containers/child/move";
import { containerWriterProjectionFromRotationPlan } from "../../containers/child/rekeyProjection";
import { defaultContainerContentsPersistence as persistence } from "../containerPersistence";
import { upsertRemoteContainerState } from "../remoteContainerState";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";

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
      const moved = await moveRemoteContainer({
        apiClient: {
          getContainerWriterProjection: async (id) =>
            id === original.containerId ? original : destination,
          moveContainer: async (_id, request) =>
            createMutationResponseFromRequest(
              request,
              original.containerKeks.at(-1),
            ),
          reciteContainer: async () => null,
        },
        author: parent.author,
        containerId: original.containerId,
        destinationParentContainerId: destination.containerId,
        execSql: moveExecSql,
        reportSecurityIncident: async () => {},
        resolveProjectionUserKey: resolveUserKey,
        targetSecretKey: parent.secretKey,
      });
      if (!moved) throw new Error("Move was not acknowledged");
      const current = await containerWriterProjectionFromRotationPlan({
        ancestors: destination,
        plan: moved.plan,
        previousProjection: original,
      });
      const pinned = await loadAccessManifestCheckpoint(
        moveExecSql,
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
                projection: current,
                resolveUserKey,
              });
            }
            return persistence.loadContainerMetadataRecord(...args);
          },
        },
        runtime: {
          apiClient: {
            getContainerWriterProjection: async () => served,
            evictContainerWriterProjection: () => {},
            getCurrentPrincipalPolicy: async () => null,
          },
          auth: {
            userId: parent.userId,
            organizationId: original.organizationId,
            rootContainerId: parent.projection.containerId,
          },
          infra: { execSql },
          resolveTrustedUserIdentity: resolveUserKey,
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        },
      } as unknown as RemoteContainerHydrationState;
      const listed: RemoteContainer = {
        id: original.containerId,
        organizationId: original.organizationId,
        parentId: parent.projection.containerId,
        systemSlot: null,
        metadataDocumentId: "untrusted-listed-metadata",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "untrusted-listed-hash",
        metadataReferencedPrincipals: [],
        effectiveAccessLevel: "admin",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      };
      const hydrate = () =>
        upsertRemoteContainerState({
          remoteContainer: listed,
          state,
          expectedHydrationTombstone: fence,
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
      expect(
        await loadAccessManifestCheckpoint(
          execSql,
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
