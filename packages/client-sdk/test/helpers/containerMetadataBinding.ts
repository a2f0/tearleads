import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
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

/**
 * Serve an independently valid signed projection for the same container id
 * from another organization's identity, naming another metadata document.
 */
export async function installForeignOrganizationBinding(
  fixture: Awaited<ReturnType<typeof createMetadataBindingFixture>>,
  metadataDocumentId = "foreign-metadata",
) {
  const signer = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signer.signingPublicKey);
  const foreign = await createContainerWriterProjectionFixture({
    containerId: fixture.listed.id,
    encapsulationPublicKey: kem.publicKey,
    metadataDocumentId,
    organizationId: "foreign-organization",
    signerKeyFingerprint: fingerprint,
    signerPrivateKey: signer.signingPrivateKey,
    userId: "foreign-owner",
  });
  let foreignReads = 0;
  const runtime = fixture.state.runtime;
  const ownProjection = runtime.apiClient.getContainerWriterProjection;
  runtime.apiClient.getContainerWriterProjection = async (containerId) => {
    if (fixture.listed.organizationId !== "foreign-organization")
      return ownProjection(containerId);
    foreignReads += 1;
    return foreign;
  };
  const ownResolver = runtime.resolveTrustedUserIdentity;
  const foreignResolver = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: kem.publicKey,
    signingKeyFingerprint: fingerprint,
    signingPublicKey: signer.signingPublicKey,
    userId: "foreign-owner",
  });
  const resolveTrustedUserIdentity: typeof ownResolver = async (userId) =>
    userId === "foreign-owner" ? foreignResolver(userId) : ownResolver(userId);
  Object.assign(runtime, { resolveTrustedUserIdentity });
  return {
    foreignReads: () => foreignReads,
    relist: () => {
      fixture.listed.organizationId = "foreign-organization";
      fixture.listed.metadataDocumentId = metadataDocumentId;
    },
  };
}
