import { expect, test } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  computeContainerKekRecipientTargetHash,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { policyBundleFromInitialRequest } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
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
import { shareRemoteContainerWithGroup } from "./share";

const ADMIN_GROUP_ID = "admins-group";
const ORGANIZATION_ID = "organization-1";
const ROOT_CONTAINER_ID = "root-container";
const USER_ID = "remaining-admin";

type TestAuthor = Awaited<ReturnType<typeof createAuthor>>["author"];

async function createAdminPolicyBundle(input: {
  author: TestAuthor;
  groupKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  memberPublicKey: Uint8Array;
  previousBundle?: PrincipalPolicyBundleResponse | undefined;
  signedAt: string;
}): Promise<PrincipalPolicyBundleResponse> {
  const previousState = input.previousBundle?.currentState ?? null;
  const version = (previousState?.version ?? 0) + 1;
  const keyEpoch = (previousState?.keyEpoch ?? 0) + 1;
  const projection = [
    {
      userId: USER_ID,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = `admins-payload-${version}`;
  const [wrappedMember] = await wrapDekForRecipients(input.groupKem.secretKey, [
    input.memberPublicKey,
  ]);
  if (!wrappedMember) {
    throw new Error("Expected Admins member envelope");
  }
  const memberEnvelopes = [
    {
      userId: USER_ID,
      memberKeyFingerprint: wrappedMember.keyFingerprint,
      kemCipherText: bytesToBase64(wrappedMember.kemCipherText),
      wrappedKey: bytesToBase64(wrappedMember.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: ADMIN_GROUP_ID,
      version,
      prevStateHash: previousState?.stateHash ?? null,
      keyEpoch,
      encapsulationPublicKey: bytesToBase64(input.groupKem.publicKey),
      keyFingerprint: await toFingerprint(input.groupKem.publicKey),
      members: [{ userId: USER_ID }],
      memberEnvelopes,
      projection,
      payloadCiphertext,
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId: USER_ID,
      signerUserKeyFingerprint: input.author.signerKeyFingerprint,
    }),
    input.author.signerPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(state);

  return {
    currentState: {
      ...state,
      stateHash,
      createdAt: input.signedAt,
    },
    currentPayload: {
      principalType: "group",
      principalId: ADMIN_GROUP_ID,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
      createdAt: input.signedAt,
    },
    currentProjection: projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: ADMIN_GROUP_ID,
      stateHash,
      epoch: keyEpoch,
      envelopes: memberEnvelopes,
    },
    previousStates: input.previousBundle
      ? [
          ...input.previousBundle.previousStates,
          {
            state: input.previousBundle.currentState,
            projection: input.previousBundle.currentProjection,
          },
        ]
      : [],
  };
}

test("same-level Admins re-wrap survives a group rotation and cold root unwrap", async () => {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
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
  const epochTwoGroupKem = generateKemSeedAndKeyPair();
  const epochTwoPolicy = await createAdminPolicyBundle({
    author,
    groupKem: epochTwoGroupKem,
    memberPublicKey: memberKem.publicKey,
    previousBundle: epochOnePolicy,
    signedAt: new Date(
      Date.parse(epochOnePolicy.currentState.signedAt) + 1_000,
    ).toISOString(),
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
  const initialProjection = rootContainerWriterProjectionFromCreatePlan(
    root.plan,
  );
  const resolveUserIdentity = async (userId: string) =>
    userId === USER_ID
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: memberKem.publicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey,
          userId,
        })
      : null;
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
        keyEpoch: Reflect.get(policy, "keyEpoch"),
        principalId: Reflect.get(policy, "principalId"),
      })),
    ).toEqual([{ keyEpoch: 2, principalId: ADMIN_GROUP_ID }]);

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
