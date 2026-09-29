import { sqlContainerContentsPersistence } from "../../src/data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { persistContainerMetadataStateFromRuntime } from "../../src/workflows/container-contents/metadataPersistence";
import { upsertRemoteContainerState } from "../../src/workflows/container-contents/remoteContainerState";
import type {
  RemoteContainer,
  RemoteContainerHydrationState,
} from "../../src/workflows/container-contents/remoteHydration/types";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/child/create";
import { createParentProjection } from "./containerFixtures";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export async function createMetadataBindingFixture(execSql: ExecSql) {
  const parent = await createParentProjection();
  const materializedPlan = await buildMaterializedContainerCreatePlan({
    author: parent.author,
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    systemSlot: null,
    trustedLocalProjection: true,
  });
  const projection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan,
    parentProjection: parent.projection,
  });
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  let projectionReads = 0;
  const incidents: unknown[] = [];
  const state = {
    containersById: new Map(),
    persistence: sqlContainerContentsPersistence,
    runtime: {
      apiClient: {
        evictContainerWriterProjection: () => {},
        getContainerWriterProjection: async () => {
          projectionReads += 1;
          return projection;
        },
        getCurrentPrincipalPolicy: async () => null,
      },
      auth: {
        organizationId: projection.organizationId,
        rootContainerId: parent.projection.containerId,
        userId: parent.userId,
      },
      infra: { execSql },
      resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
        userId: parent.userId,
        signingKeyFingerprint: parent.author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
        encapsulationPublicKey: parent.encapsulationPublicKey,
      }),
      util: {
        log: () => {},
        reportSecurityIncident: async (error: unknown) => {
          incidents.push(error);
        },
      },
    },
  } as unknown as RemoteContainerHydrationState;
  const listed: RemoteContainer = {
    id: projection.containerId,
    organizationId: projection.organizationId,
    parentId: parent.projection.containerId,
    systemSlot: null,
    metadataDocumentId: "decoy-team-document",
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "listed",
    metadataReferencedPrincipals: [],
    effectiveAccessLevel: "admin",
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:01.000Z",
  };
  return {
    incidents,
    listed,
    metadataDocumentId: materializedPlan.plan.metadataDocumentId,
    projection,
    state,
    projectionReads: () => projectionReads,
    hydrate: async () => {
      const tombstones =
        await sqlContainerContentsPersistence.loadContainerHydrationTombstones(
          execSql,
        );
      return upsertRemoteContainerState({
        expectedHydrationTombstone:
          tombstones.find((row) => row.containerId === listed.id) ?? null,
        remoteContainer: listed,
        state,
        containerIdsWithPendingMetadataUpdates: new Set([listed.id]),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: {
          updateSnapshot: () => {},
          persistContainerState: async (
            metadataState,
            patch,
            _updateView,
            saveOptions,
          ) => {
            const saved = await persistContainerMetadataStateFromRuntime({
              metadataState,
              patch,
              saveOptions,
              persistence: sqlContainerContentsPersistence,
              runtime: state.runtime,
            });
            if (saved) metadataState.container = saved.container;
            return saved
              ? { status: "persisted", record: saved.record }
              : { status: "missing" };
          },
        },
      });
    },
  };
}
