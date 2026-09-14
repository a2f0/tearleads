import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { createParentProjection } from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { SecurityIncidentContext } from "../../../data/securityIncidents";
import type { ContainerContentsPersistence } from "../containerPersistence";
import { localOnlyRootState } from "./localRootState.testFixtures";
import { reconcileLocalOnlyRootContainers } from "./reconciliation";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

test("a persisted shared root created by another user never absorbs local content on reconciliation", async () => {
  // This device once hydrated another user's root as an ordinary shared
  // container, so the row (and its cached role) already exist. A later unsigned
  // login answer names that root as the session root in its organization. The
  // persisted-root path reconciles straight from the local row, so the creator
  // check has to hold at the reconciliation boundary itself.
  const victimUserId = "victim-user";
  const victimKeys = generateKemSeedAndKeyPair();
  const owner = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: victimKeys.publicKey,
      recipientKeyEpochId: `user:${victimUserId}:encapsulation:${await toFingerprint(victimKeys.publicKey)}`,
      userId: victimUserId,
    },
  });
  const sharedRootId = owner.projection.containerId;
  await withTestExecSql("persisted-shared-root-reconcile", async (execSql) => {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const incidents: Array<{ code: unknown; operation: string }> = [];
    const rootMerges: string[] = [];
    let projectionReads = 0;
    const auth = {
      organizationId: owner.projection.organizationId,
      rootContainerId: "victims-own-root",
      userId: victimUserId,
    };
    const infra: { execSql: typeof execSql } = { execSql };
    const localRoot = await localOnlyRootState("pre-login-local-root");
    // The row as the earlier hydration persisted it: remote-backed, in the
    // owner's organization.
    const sharedRootBase = await localOnlyRootState(sharedRootId);
    const sharedRoot: ContainerState = {
      ...sharedRootBase,
      container: {
        ...sharedRootBase.container,
        metadataDocumentId: `${sharedRootId}-metadata`,
        organizationId: owner.projection.organizationId,
      },
      record: {
        ...sharedRootBase.record,
        accessStateHash: `${sharedRootId}-access-state`,
        documentId: `${sharedRootId}-metadata`,
      },
    };
    const state = {
      containersById: new Map([
        [localRoot.container.id, localRoot],
        [sharedRootId, sharedRoot],
      ]),
      persistence: {
        reconcileLocalRootContainer: async (
          _execSql: unknown,
          input: { localRootContainerId: string },
        ) => {
          rootMerges.push(input.localRootContainerId);
        },
      } as unknown as ContainerContentsPersistence,
      runtime: {
        apiClient: {
          getContainerWriterProjection: async () => {
            projectionReads += 1;
            return owner.projection;
          },
          getCurrentPrincipalPolicy: async () => null,
        },
        auth,
        infra,
        resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
          userId: owner.userId,
          signingKeyFingerprint: owner.author.signerKeyFingerprint,
          signingPublicKey: owner.signingPublicKey,
          encapsulationPublicKey: owner.encapsulationPublicKey,
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
              operation: context.operation,
            });
          },
        },
      },
    } as unknown as RemoteContainerHydrationState;
    const listed: RemoteContainer = {
      id: sharedRootId,
      organizationId: owner.projection.organizationId,
      parentId: null,
      systemSlot: null,
      metadataDocumentId: `${sharedRootId}-metadata`,
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "metadata-hash",
      metadataReferencedPrincipals: [],
      effectiveAccessLevel: "write",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    const reconcile = () =>
      reconcileLocalOnlyRootContainers({ remoteRootState: sharedRoot, state });

    // Hydrated earlier as an ordinary shared root: verified, cached, no signer
    // check because it was not the session root then.
    const verified = await verifyRemoteContainerDestination({
      remoteContainer: listed,
      state,
    });
    expect(verified?.parentId).toBeNull();
    expect(projectionReads).toBe(1);
    expect(incidents).toEqual([]);

    // The login now names it as the session root in that organization.
    auth.rootContainerId = sharedRootId;
    await expect(reconcile()).resolves.toBe(0);
    expect(incidents).toEqual([
      { code: "signer_mismatch", operation: "container.root.reconcile" },
    ]);
    expect(rootMerges).toEqual([]);
    expect(state.containersById.has(localRoot.container.id)).toBe(true);
    expect(localRoot.container.parentId).toBeNull();
    expect(projectionReads).toBe(1);

    // After a restart the role cache is cold (it is keyed by the database
    // handle): the served projection is verified first, and the decision is
    // the same.
    infra.execSql = ((...args: Parameters<typeof execSql>) =>
      execSql(...args)) as typeof execSql;
    await expect(reconcile()).resolves.toBe(0);
    expect(projectionReads).toBe(2);
    expect(incidents).toHaveLength(2);
    expect(rootMerges).toEqual([]);

    // The creator's own device merges its pre-login content into that root.
    auth.userId = owner.userId;
    await expect(reconcile()).resolves.toBe(1);
    expect(rootMerges).toEqual([localRoot.container.id]);
    expect(incidents).toHaveLength(2);
  });
});
