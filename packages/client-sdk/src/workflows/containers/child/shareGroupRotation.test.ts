import { expect, test } from "bun:test";
import {
  computeContainerKekRecipientTargetHash,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { createSuccessorGroupPolicyBundle } from "../../../../test/helpers/groupPolicyFixtures";
import { policyBundleFromInitialRequest } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { unwrapContainerKekPath } from "../../../data/documents/shared/containerKekPath";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../root/create";
import { buildMaterializedContainerRekeyPlan } from "./rekey";
import { shareRemoteContainerWithGroup } from "./share";

const ADMIN_GROUP_ID = "admins-group";
const ORGANIZATION_ID = "organization-1";
const ROOT_CONTAINER_ID = "root-container";
const USER_ID = "remaining-admin";

async function setUpAdminGroupRoot() {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    grants: [{ accessLevel: "admin", containerId: ROOT_CONTAINER_ID }],
    groupId: ADMIN_GROUP_ID,
    name: "Admins",
    signerUserId: USER_ID,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const epochOnePolicy =
    await policyBundleFromInitialRequest(initialAdminGroup);
  const epochTwoPolicy = await createSuccessorGroupPolicyBundle({
    author,
    groupId: ADMIN_GROUP_ID,
    groupKem: generateKemSeedAndKeyPair(),
    memberPublicKey: memberKem.publicKey,
    previousBundle: epochOnePolicy,
    signedAt: new Date(
      Date.parse(epochOnePolicy.currentState.signedAt) + 1_000,
    ).toISOString(),
    userId: USER_ID,
  });
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const root = await buildRootContainerCreatePlan({
    adminGroup: initialAdminGroup,
    author,
    containerId: ROOT_CONTAINER_ID,
    containerKey,
    metadataDocumentId: "root-metadata-document",
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  expect(
    Reflect.get(root.plan.request.principalPolicies[0] ?? {}, "grants"),
  ).toEqual(initialAdminGroup.initialGroupPolicy.grants);
  const initialProjection = rootContainerWriterProjectionFromCreatePlan(
    root.plan,
  );
  const resolveUserIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: memberKem.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: USER_ID,
  });

  return {
    author,
    containerKey,
    epochOnePolicy,
    epochTwoPolicy,
    initialProjection,
    memberKem,
    resolveUserIdentity,
  };
}

test("same-level Admins re-wrap survives a group rotation and cold root unwrap", async () => {
  const {
    author,
    containerKey,
    epochOnePolicy,
    epochTwoPolicy,
    initialProjection,
    memberKem,
    resolveUserIdentity,
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
    );
    await unwrapContainerKekPath({
      execSql,
      projection: initialProjection,
      resolveProjectionUserKey: resolveUserIdentity,
      secretKey: memberKem.secretKey,
    });
    const shared = await shareRemoteContainerWithGroup({
      accessLevel: "admin",
      apiClient: {
        getContainerWriterProjection: async () => initialProjection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          expect(principalType).toBe("group");
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
      previousProjection: initialProjection,
      recipientGroupId: ADMIN_GROUP_ID,
      resolveProjectionUserKey: resolveUserIdentity,
      resolveTrustedUserIdentity: resolveUserIdentity,
      signedAt: "2026-04-28T12:02:00.000Z",
      targetSecretKey: memberKem.secretKey,
    });

    expect(shared).not.toBeNull();
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
        projection: initialProjection,
        resolveProjectionUserKey: resolveUserIdentity,
        secretKey: memberKem.secretKey,
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    const coldKeks = await unwrapContainerKekPath({
      execSql,
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
    );
    const rekeyed = await buildMaterializedContainerRekeyPlan({
      author,
      execSql: warmDatabase.execSql,
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
    );
    const coldKeks = await unwrapContainerKekPath({
      execSql: coldDatabase.execSql,
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
      principalType: nextPolicy.principalType,
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
