import {
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readContainerKeyEpoch,
  readContainerKeyWrap,
} from "../../src/data/keyingProjectionVerification/readers";
import {
  buildAddGroupUserPolicyRequest,
  buildSetGroupContainerGrantPolicyRequest,
} from "../../src/workflows/organizations/groupPolicy/groupPolicyRequests";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/organizationProvisioning";
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
 * The commit checks every container acknowledgement's hashes against its
 * request, so each stub carries a well-formed key epoch and `echoMutation`
 * computes the hashes an honest server would return.
 */
function stubHash(label: string, id: string): string {
  return Array.from(new TextEncoder().encode(`${label}:${id}`), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
}

export function stubRekeyRequest(id: string) {
  return {
    body: { eventType: "container.rekey" },
    event: { objectId: id, objectKind: "container" },
    expectedManifestHash: `manifest-${id}`,
    keyEpoch: {
      id: `epoch-${id}`,
      containerId: id,
      keyEpoch: 2,
      accessManifestHash: stubHash("m", id),
      parentContainerKeyEpochId: null,
      createdByEventHash: stubHash("e", id),
      createdByManifestHash: stubHash("m", id),
    },
    keyring: null,
    manifest: { epoch: 2, eventHash: `event-${id}`, objectId: id },
    predecessorBridge: null,
    principalPolicyRefs: [],
    wraps: [],
  } as never;
}

/** The acknowledgement an honest server returns for `request`: its hashes. */
export async function echoMutation(request: {
  body: unknown;
  event: unknown;
  expectedManifestHash: string;
  keyEpoch: unknown;
  manifest: unknown;
  wraps: readonly unknown[];
}) {
  const keyEpoch = readContainerKeyEpoch(request.keyEpoch, "stub key epoch");
  const targets = request.wraps
    .map((value) => readContainerKeyWrap(value, "stub wrap"))
    .map((wrap) => ({
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      recipientKind: wrap.recipientKind,
    }));
  return {
    containerId: String(Reflect.get(Object(request.event), "objectId")),
    createdAt: "2026-05-05T00:00:00.000Z",
    eventHash: String(Reflect.get(Object(request.manifest), "eventHash")),
    manifestHead: {
      epoch: Number(Reflect.get(Object(request.manifest), "epoch")),
      manifestHash: request.expectedManifestHash,
    },
    organizationId: "stub-organization",
    parentId: null,
    updatedAt: "2026-05-05T00:00:00.000Z",
    containerKek: {
      containerKeyEpoch: keyEpoch.keyEpoch,
      containerKeyEpochId: keyEpoch.id,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyringHash: null,
      keyTargetHash: await computeContainerKekRecipientTargetHash(targets),
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    },
  };
}

export function mutationObjectIds(
  mutations: readonly { readonly event: unknown }[] | undefined,
): string[] {
  return (mutations ?? []).map((request) =>
    String(Reflect.get(Object(request.event), "objectId")),
  );
}
