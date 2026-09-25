import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  buildAddGroupUserPolicyRequest,
  buildSetGroupContainerGrantPolicyRequest,
} from "../../src/workflows/organizations/groupPolicyRequests";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import {
  buildInitialGroupPolicyRequest,
  testGroupMetadataKey,
} from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

function signerPublicKeys(input: {
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): PrincipalPolicySignerPublicKey[] {
  return [
    {
      userId: input.signerUserId,
      signingKeyFingerprint: input.signingFingerprint,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    },
  ];
}

/**
 * A group with one member to remove, so the commit rotates the group key and
 * rematerializes its grants; the container mutations themselves are stubbed
 * by each test.
 */
export async function createRemovalFixture(
  input: { grantedContainerIds?: readonly string[] } = {},
) {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const remainingUserKem = generateKemSeedAndKeyPair();
  const removedUserKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    metadataKey: testGroupMetadataKey(organizationId),
    creatorEncapsulationKeyPair: remainingUserKem,
    groupId,
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      metadataKey: testGroupMetadataKey(organizationId),
      creatorEncapsulationKeyPair: remainingUserKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const addedMutation = await buildAddGroupUserPolicyRequest({
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys: signerPublicKeys({
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
    currentUsers: [],
    currentUserSecretKey: remainingUserKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: createTestTrustedUserIdentity({
      userId: removedUserId,
      encapsulationPublicKey: removedUserKem.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(
        removedUserKem.publicKey,
      ),
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    }),
  });
  let previousPolicy = await policyBundleAfterMutation({
    mutation: addedMutation,
    previous: initialPolicy,
  });
  for (const containerId of input.grantedContainerIds ?? []) {
    previousPolicy = await policyBundleAfterMutation({
      previous: previousPolicy,
      mutation: await buildSetGroupContainerGrantPolicyRequest({
        currentPolicy: previousPolicy,
        currentPolicySignerPublicKeys: signerPublicKeys({
          signerUserId,
          signingFingerprint,
          signingKeyPair,
        }),
        signerUserId,
        signingFingerprint,
        signingKeyPair,
        containerId,
        accessLevel: "read",
      }),
    });
  }
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: remainingUserKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, memberGroupId),
        principalPolicyHead(previousPolicy),
      ],
      memberGroupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );
  const { close, execSql } = await createTestExecSql(
    `group-removal-carry-${crypto.randomUUID()}`,
  );
  let currentPolicy = previousPolicy;
  const remainingUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(
      remainingUserKem.publicKey,
    ),
    encapsulationPublicKey: remainingUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: signerUserId,
  });
  const removedUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(removedUserKem.publicKey),
    encapsulationPublicKey: removedUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: removedUserId,
  });
  const resolveTrustedUserIdentity = async (userId: string) => {
    if (userId === signerUserId) {
      return remainingUserIdentity;
    }
    if (userId === removedUserId) {
      return removedUserIdentity;
    }
    return null;
  };
  return {
    adminGroupId,
    adminPolicy,
    close,
    execSql,
    getCurrentPolicy: () => currentPolicy,
    getOrganizationPolicy: () => organizationPolicy,
    groupId,
    organizationId,
    removedUserId,
    resolveTrustedUserIdentity,
    setCurrentPolicy: (policy: typeof currentPolicy) => {
      currentPolicy = policy;
    },
    setOrganizationPolicy: (policy: typeof organizationPolicy) => {
      organizationPolicy = policy;
    },
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  };
}

/**
 * The commit checks every container acknowledgement against its request field
 * by field, so each stub is a full mutation and `echoMutation` its exact echo.
 */
export function stubRekeyRequest(id: string) {
  return {
    body: { eventType: "container.rekey" },
    event: { objectId: id, objectKind: "container" },
    expectedManifestHash: `manifest-${id}`,
    keyEpoch: { id: `epoch-${id}` },
    keyring: null,
    manifest: { objectId: id },
    predecessorBridge: null,
    principalPolicies: [],
    wraps: [],
  } as never;
}

export function echoMutation(request: {
  body: unknown;
  event: unknown;
  keyEpoch: unknown;
  manifest: unknown;
}) {
  return {
    accessManifest: {
      event: { body: request.body, event: request.event },
      manifest: request.manifest,
    },
    containerId: String(Reflect.get(Object(request.event), "objectId")),
    containerKek: { keyEpoch: request.keyEpoch, wraps: [] },
  };
}

export function mutationObjectIds(
  mutations: readonly { readonly event: unknown }[] | undefined,
): string[] {
  return (mutations ?? []).map((request) =>
    String(Reflect.get(Object(request.event), "objectId")),
  );
}
