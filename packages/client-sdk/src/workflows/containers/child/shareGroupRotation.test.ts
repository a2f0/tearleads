import { expect, test } from "bun:test";
import {
  computeContainerKekRecipientTargetHash,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  ADMIN_GROUP_ID,
  ORGANIZATION_ID,
  ROOT_CONTAINER_ID,
  setUpAdminGroupRoot,
} from "../../../../test/helpers/adminGroupRoot";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import {
  projectionHistoryPages,
  projectionPolicyWarmer,
} from "../../../../test/helpers/projectionPolicyHistory";
import { heldContainerSnapshot } from "../../../data/containers/shared/heldContainerHeads";
import { unwrapContainerKekPath } from "../../../data/documents/shared/containerKekPath";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import { containerStateHasCurrentGroupGrant } from "../../container-contents/container-state/groupGrantVerification";
import type { ContainerWorkflowRuntime } from "../../container-contents/container-state/types";
import type { ContainerState } from "../../container-contents/remoteHydration";

import { buildMaterializedContainerRekeyPlan } from "./rekey";
import { shareRemoteContainerWithGroup } from "./share";

test("current group grant verification returns false when projection verification expires", async () => {
  const {
    epochTwoPolicy,
    initialProjection,
    organizationPolicy,
    resolveUserIdentity,
    projectionBundles,
  } = await setUpAdminGroupRoot();
  const { close, execSql } = await createTestExecSql(
    "container-group-grant-verification-generation",
  );
  let current = true;
  const runtime = {
    apiClient: {
      ...projectionHistoryPages(projectionBundles),
      getContainerWriterProjection: async () => initialProjection,
      getCurrentPrincipalPolicy: async (
        principalType: "group" | "organization",
      ) =>
        principalType === "organization" ? organizationPolicy : epochTwoPolicy,
    },
    withPrincipalHistoryProtection: async (
      operation: (lease: {
        protection: { localKey: Uint8Array; context: string };
        stillCurrent: () => boolean;
      }) => Promise<unknown>,
    ) =>
      operation({
        protection: {
          localKey: new Uint8Array(32).fill(19),
          context: "rotation-test",
        },
        stillCurrent: () => true,
      }),
    infra: { execSql },
    resolveTrustedUserIdentity: resolveUserIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  } as unknown as ContainerWorkflowRuntime;
  const containerState = {
    container: {
      effectiveAccessLevel: "admin",
      id: ROOT_CONTAINER_ID,
      metadataDocumentId: "root-metadata-document",
      organizationId: ORGANIZATION_ID,
      parentId: null,
    },
    containerWriterProjection: initialProjection,
    record: {
      accessStateHash: initialProjection.path.at(-1)?.manifestHash ?? null,
    },
  } as ContainerState;

  try {
    await expect(
      containerStateHasCurrentGroupGrant({
        accessLevel: "admin",
        containerState,
        expectedContainerId: ROOT_CONTAINER_ID,
        expectedGroupHead: principalPolicyHead(epochTwoPolicy),
        expectedOrganizationId: ORGANIZATION_ID,
        groupId: ADMIN_GROUP_ID,
        resolveProjectionUserKey: async (userId) => {
          const identity = await resolveUserIdentity(userId);
          current = false;
          return identity;
        },
        runtime,
        stillCurrent: () => current,
      }),
    ).resolves.toBe(false);
    expect(current).toBe(false);
  } finally {
    close();
  }
});

test("same-level Admins re-wrap survives a group rotation and cold root unwrap", async () => {
  const {
    author,
    containerKey,
    epochOnePolicy,
    epochTwoPolicy,
    initialProjection,
    memberKem,
    organizationPolicy,
    resolveUserIdentity,
    projectionBundles,
  } = await setUpAdminGroupRoot();
  const submittedRequests: ContainerMutationRequest[] = [];
  const { close, execSql } = await createTestExecSql(
    "container-share-admin-group-rotation",
  );

  try {
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      epochOnePolicy,
      "2026-04-28T12:00:30.000Z",
      ORGANIZATION_ID,
    );
    await unwrapContainerKekPath({
      execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql,
        bundles: projectionBundles,
        resolveUserKey: resolveUserIdentity,
      }),
      projection: initialProjection,
      resolveProjectionUserKey: resolveUserIdentity,
      secretKey: memberKem.secretKey,
    });
    const shared = await shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "admin",
      apiClient: {
        reciteContainer: async () => null,
        evictContainerWriterProjection: () => {},
        commitOrganizationGroupPolicy: async () => {
          throw new Error("Unexpected group policy commit");
        },
        getContainerWriterProjectionResult: async () => ({
          ok: true,
          data: initialProjection,
        }),
        getContainerWriterProjection: async () => initialProjection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") {
            expect(principalId).toBe(ORGANIZATION_ID);
            return organizationPolicy;
          }
          expect(principalId).toBe(ADMIN_GROUP_ID);
          return epochTwoPolicy;
        },
        shareContainer: async (_containerId, request) => {
          submittedRequests.push(request);
          return createMutationResponseFromRequest(request);
        },
      },
      author,
      containerId: ROOT_CONTAINER_ID,
      execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql,
        bundles: projectionBundles,
        resolveUserKey: resolveUserIdentity,
      }),
      expectedGroupName: "Admins",
      previousProjection: initialProjection,
      recipientGroupId: ADMIN_GROUP_ID,
      resolveProjectionUserKey: resolveUserIdentity,
      resolveTrustedUserIdentity: resolveUserIdentity,
      signedAt: "2026-04-28T12:02:00.000Z",
      targetSecretKey: memberKem.secretKey,
    });
    expect(shared).not.toBeNull();
    expect(
      heldContainerSnapshot(execSql, ORGANIZATION_ID).policies,
    ).toContainEqual(
      expect.objectContaining({
        principalId: ADMIN_GROUP_ID,
        stateHash: epochTwoPolicy.currentState.stateHash,
        keyEpoch: 2,
      }),
    );
    expect(submittedRequests).toHaveLength(1);
    if (!shared) {
      throw new Error("Expected root Admins re-wrap");
    }
    const submittedRequest = submittedRequests[0];
    if (!submittedRequest) {
      throw new Error("Expected submitted root Admins re-wrap request");
    }
    expect(
      (submittedRequest.principalPolicies ?? []).map((policy) => ({
        grants: Reflect.get(policy, "grants"),
        keyEpoch: Reflect.get(policy, "keyEpoch"),
        principalId: Reflect.get(policy, "principalId"),
      })),
    ).toEqual([
      {
        grants: epochTwoPolicy.currentGrants,
        keyEpoch: 2,
        principalId: ADMIN_GROUP_ID,
      },
    ]);

    const initialManifest = initialProjection.path[0];
    const initialKek = initialProjection.containerKeks[0];
    if (!initialManifest || !initialKek) {
      throw new Error("Expected initial root projection");
    }
    const rotatedManifest = {
      event: {
        event: shared.plan.event as unknown as Record<string, unknown>,
        body: shared.plan.body as unknown,
        eventHash: shared.plan.eventHash,
      },
      manifest: shared.plan.manifest as unknown as Record<string, unknown>,
      manifestHash: shared.plan.manifestHash,
      state: shared.plan.state as unknown as Record<string, unknown>,
    };
    const rotatedProjection: ContainerWriterProjectionResponse = {
      policyEvidence: initialProjection.policyEvidence,
      containerId: ROOT_CONTAINER_ID,
      organizationId: ORGANIZATION_ID,
      path: [rotatedManifest],
      containerKeks: [
        {
          ...initialKek,
          accessManifestHash: shared.plan.manifestHash,
          containerManifestHistory: [initialManifest],
          keyTargetHash: await computeContainerKekRecipientTargetHash([
            shared.plan.recipientTarget,
          ]),
          recipientTargets: [
            shared.plan.recipientTarget as unknown as Record<string, unknown>,
          ],
          wraps: shared.plan.wraps as unknown as Record<string, unknown>[],
        },
      ],
    };
    const cachedPolicy = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      ADMIN_GROUP_ID,
    );
    expect(cachedPolicy?.currentState.keyEpoch).toBe(2);
    expect(cachedPolicy?.currentState.keyFingerprint).toBe(
      epochTwoPolicy.currentState.keyFingerprint,
    );
    await expect(
      unwrapContainerKekPath({
        execSql,
        warmReferencedPrincipalPolicies: projectionPolicyWarmer({
          execSql,
          bundles: projectionBundles,
          resolveUserKey: resolveUserIdentity,
        }),
        projection: initialProjection,
        resolveProjectionUserKey: resolveUserIdentity,
        secretKey: memberKem.secretKey,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    const coldKeks = await unwrapContainerKekPath({
      execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql,
        bundles: projectionBundles,
        resolveUserKey: resolveUserIdentity,
      }),
      projection: rotatedProjection,
      resolveProjectionUserKey: resolveUserIdentity,
      secretKey: memberKem.secretKey,
    });

    expect(
      Array.from(coldKeks.get(initialKek.containerKeyEpochId) ?? []),
    ).toEqual(Array.from(containerKey));
  } finally {
    close();
  }
});

test("Admins rotation rekeys the root and a fresh current member opens all epochs", async () => {
  const {
    author,
    containerKey: originalContainerKey,
    epochOnePolicy,
    epochTwoPolicy,
    initialProjection,
    memberKem,
    resolveUserIdentity,
    projectionBundles,
  } = await setUpAdminGroupRoot();
  const nextState = epochTwoPolicy.currentState;
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash: nextState.stateHash,
    state: nextState,
    projection: epochTwoPolicy.currentProjection,
    grants: epochTwoPolicy.currentGrants,
    history: [
      {
        state: epochOnePolicy.currentState,
        projection: epochOnePolicy.currentProjection,
        grants: epochOnePolicy.currentGrants,
      },
      {
        state: nextState,
        projection: epochTwoPolicy.currentProjection,
        grants: epochTwoPolicy.currentGrants,
      },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash: nextState.stateHash,
    },
  });
  const initialManifest = initialProjection.path[0];
  const initialKek = initialProjection.containerKeks[0];
  if (!initialManifest || !initialKek) {
    throw new Error("Expected initial root projection");
  }
  const warmDatabase = await createTestExecSql(
    "container-rekey-admin-group-warm",
  );
  const coldDatabase = await createTestExecSql(
    "container-rekey-admin-group-cold",
  );

  try {
    await ensurePrincipalPolicyTables(warmDatabase.execSql);
    await savePrincipalPolicyBundle(
      warmDatabase.execSql,
      epochOnePolicy,
      "2026-04-28T12:00:30.000Z",
      ORGANIZATION_ID,
    );
    const rekeyed = await buildMaterializedContainerRekeyPlan({
      author,
      execSql: warmDatabase.execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql: warmDatabase.execSql,
        bundles: projectionBundles,
        resolveUserKey: resolveUserIdentity,
      }),
      previousProjection: initialProjection,
      replacementPrincipalPolicy: nextPolicy,
      resolveProjectionUserKey: resolveUserIdentity,
      signedAt: "2026-04-28T12:02:00.000Z",
      targetSecretKey: memberKem.secretKey,
    });
    const response = await createMutationResponseFromRequest(
      rekeyed.plan.request,
      initialKek,
    );
    const coldProjection: ContainerWriterProjectionResponse = {
      policyEvidence: initialProjection.policyEvidence,
      containerId: ROOT_CONTAINER_ID,
      organizationId: ORGANIZATION_ID,
      path: [response.accessManifest],
      containerKeks: [
        {
          ...response.containerKek,
          containerManifestHistory: [initialManifest],
        },
      ],
    };

    await ensurePrincipalPolicyTables(coldDatabase.execSql);
    await savePrincipalPolicyBundle(
      coldDatabase.execSql,
      epochTwoPolicy,
      "2026-04-28T12:02:30.000Z",
      ORGANIZATION_ID,
    );
    const coldKeks = await unwrapContainerKekPath({
      execSql: coldDatabase.execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql: coldDatabase.execSql,
        bundles: projectionBundles,
        resolveUserKey: resolveUserIdentity,
      }),
      projection: coldProjection,
      resolveProjectionUserKey: resolveUserIdentity,
      secretKey: memberKem.secretKey,
    });

    expect(
      Array.from(coldKeks.get(rekeyed.plan.containerKeyEpochId) ?? []),
    ).toEqual(Array.from(rekeyed.containerKey));
    expect(
      Array.from(coldKeks.get(initialKek.containerKeyEpochId) ?? []),
    ).toEqual(Array.from(originalContainerKey));
    expect(response.referencedPrincipalHeads).toContainEqual({
      principalType: "group",
      principalId: nextPolicy.principalId,
      version: nextPolicy.version,
      keyEpoch: nextPolicy.keyEpoch,
      stateHash: nextPolicy.stateHash,
      keyFingerprint: nextPolicy.state.keyFingerprint,
    });
  } finally {
    warmDatabase.close();
    coldDatabase.close();
  }
});
