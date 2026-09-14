import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { SecurityIncidentContext } from "../../../data/securityIncidents";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import { upsertRemoteContainerState } from "../remoteContainerState";
import { localOnlyRootState } from "./localRootState.testFixtures";
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

test("an acknowledged root created by another identity is never the merge target", async () => {
  // The server names an attacker-created root (same organization, a write
  // grant to the victim) as the victim's root in the unsigned login response.
  const victimUserId = "victim-user";
  const victimKeys = generateKemSeedAndKeyPair();
  const attacker = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: victimKeys.publicKey,
      recipientKeyEpochId: `user:${victimUserId}:encapsulation:${await toFingerprint(victimKeys.publicKey)}`,
      userId: victimUserId,
    },
  });
  const forgedRootId = attacker.projection.containerId;
  await withTestExecSql("forged-session-root-signer", async (execSql) => {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const incidents: Array<{ code: unknown; objectId: string | null }> = [];
    let projectionReads = 0;
    const auth = {
      organizationId: attacker.projection.organizationId,
      rootContainerId: forgedRootId,
      userId: victimUserId,
    };
    const localRoot = await localOnlyRootState("pre-login-local-root");
    const state = {
      containersById: new Map([[localRoot.container.id, localRoot]]),
      persistence: sqlContainerContentsPersistence,
      runtime: {
        apiClient: {
          getContainerWriterProjection: async () => {
            projectionReads += 1;
            return attacker.projection;
          },
          getCurrentPrincipalPolicy: async () => null,
        },
        auth,
        infra: { execSql },
        resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
          userId: attacker.userId,
          signingKeyFingerprint: attacker.author.signerKeyFingerprint,
          signingPublicKey: attacker.signingPublicKey,
          encapsulationPublicKey: attacker.encapsulationPublicKey,
        }),
        util: {
          log: () => {},
          reportSecurityIncident: async (
            error: unknown,
            context: SecurityIncidentContext,
          ) => {
            incidents.push({
              code:
                error instanceof KeyingVerificationError ? error.code : error,
              objectId: context.objectId,
            });
          },
        },
      },
    } as unknown as RemoteContainerHydrationState;
    const listed: RemoteContainer = {
      id: forgedRootId,
      organizationId: attacker.projection.organizationId,
      parentId: null,
      systemSlot: null,
      metadataDocumentId: "untrusted-listed-metadata",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "metadata-hash",
      metadataReferencedPrincipals: [],
      effectiveAccessLevel: "write",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
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

    await expect(hydrate()).rejects.toMatchObject({ code: "signer_mismatch" });
    expect(incidents).toEqual([
      { code: "signer_mismatch", objectId: forgedRootId },
    ]);
    // Nothing verified, nothing persisted, and the pre-login local root (with
    // everything under it) stays where it is instead of merging into the forgery.
    await expect(
      sqlContainerContentsPersistence.loadContainers(execSql),
    ).resolves.toEqual([]);
    expect(state.containersById.has(localRoot.container.id)).toBe(true);
    expect(state.containersById.has(forgedRootId)).toBe(false);

    // The same root is a legitimate destination for the identity that created
    // it. Its immutable role was cached by the first verification, so both
    // later checks reuse it without a fetch, and the cached role is re-checked
    // against the session user on every reuse.
    auth.userId = attacker.userId;
    const own = await verifyRemoteContainerDestination({
      remoteContainer: listed,
      state,
    });
    expect(own?.parentId).toBeNull();
    auth.userId = victimUserId;
    await expect(
      verifyRemoteContainerDestination({ remoteContainer: listed, state }),
    ).rejects.toMatchObject({ code: "signer_mismatch" });
    expect(projectionReads).toBe(1);
    expect(incidents).toHaveLength(2);
  });
});

test("a root head at a later epoch binds the epoch-1 creator through its served lineage", async () => {
  // A real root's head advances with every grant or revoke; the creator is
  // only named by the epoch-1 create, which the projection's history carries.
  const revokedUserId = "former-admin";
  const revokedKeys = generateKemSeedAndKeyPair();
  const owner = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "admin",
      publicKey: revokedKeys.publicKey,
      recipientKeyEpochId: `user:${revokedUserId}:encapsulation:${await toFingerprint(revokedKeys.publicKey)}`,
      userId: revokedUserId,
    },
  });
  const createManifest = owner.projection.path[0];
  if (!createManifest) throw new Error("expected the root create manifest");
  const revokedManifest = await createContainerRevokeManifestFixture({
    author: owner.author,
    containerId: owner.projection.containerId,
    containerKeyEpochId: `${owner.parentKekState.containerKeyEpochId}-rotated`,
    eventId: "root-revoke-event-2",
    keyringHash: "b".repeat(64),
    organizationId: owner.projection.organizationId,
    predecessorBridgeHash: "c".repeat(64),
    previousManifest: createManifest as unknown as Parameters<
      typeof createContainerRevokeManifestFixture
    >[0]["previousManifest"],
    subjectId: revokedUserId,
    subjectType: "user",
    signingPublicKey: owner.signingPublicKey,
  });
  const kek = owner.projection.containerKeks[0];
  if (!kek) throw new Error("expected the root KEK");
  const projection = {
    ...owner.projection,
    path: [
      revokedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
    containerKeks: [{ ...kek, containerManifestHistory: [createManifest] }],
  };
  await withTestExecSql("later-epoch-root-creator", async (execSql) => {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const auth = {
      organizationId: owner.projection.organizationId,
      rootContainerId: owner.projection.containerId,
      userId: owner.userId,
    };
    const state = {
      containersById: new Map(),
      persistence: sqlContainerContentsPersistence,
      runtime: {
        apiClient: {
          getContainerWriterProjection: async () => projection,
          getCurrentPrincipalPolicy: async () => null,
        },
        auth,
        infra: { execSql },
        resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
          userId: owner.userId,
          signingKeyFingerprint: owner.author.signerKeyFingerprint,
          signingPublicKey: owner.signingPublicKey,
          encapsulationPublicKey: owner.encapsulationPublicKey,
        }),
        util: { log: () => {}, reportSecurityIncident: async () => {} },
      },
    } as unknown as RemoteContainerHydrationState;
    const listed: RemoteContainer = {
      id: owner.projection.containerId,
      organizationId: owner.projection.organizationId,
      parentId: null,
      systemSlot: null,
      metadataDocumentId: "listed",
      metadataAccessEpoch: 2,
      metadataAccessStateHash: "metadata-hash",
      metadataReferencedPrincipals: [],
      effectiveAccessLevel: "admin",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    const own = await verifyRemoteContainerDestination({
      remoteContainer: listed,
      state,
    });
    expect(own?.parentId).toBeNull();
    const { metadataDocumentId: signedMetadataDocumentId } =
      createManifest.state;
    if (typeof signedMetadataDocumentId !== "string") {
      throw new Error("expected the signed metadata document id");
    }
    expect(own?.metadataDocumentId).toBe(signedMetadataDocumentId);
    auth.userId = revokedUserId;
    await expect(
      verifyRemoteContainerDestination({ remoteContainer: listed, state }),
    ).rejects.toMatchObject({ code: "signer_mismatch" });
  });
});
