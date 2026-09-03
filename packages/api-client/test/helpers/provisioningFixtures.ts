import type {
  CreateOrganizationRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import {
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "@tearleads/validators/util";

const userId = "550e8400-e29b-41d4-a716-446655440001";
const organizationId = "550e8400-e29b-41d4-a716-446655440002";
const adminGroupId = "550e8400-e29b-41d4-a716-446655440003";
const memberGroupId = "550e8400-e29b-41d4-a716-446655440004";
const rootContainerId = "550e8400-e29b-41d4-a716-446655440005";
const initialUpdateId = "550e8400-e29b-41d4-a716-446655440006";

function initialPolicy(
  principalType: "group" | "organization",
  principalId: string,
): RegistrationRequest["initialOrganizationPolicy"] {
  return {
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    grants: [],
    memberEnvelopes: [
      {
        kemCipherText: "kem-ciphertext",
        memberKeyFingerprint: "member-key-fingerprint",
        userId,
        wrappedKey: "wrapped-key",
      },
    ],
    projection: [{ role: "admin", userId }],
    state: {
      encapsulationPublicKey: "public-key",
      externalAuthority: null,
      grantCount: 0,
      grantRoot: "grant-root",
      keyEpoch: 1,
      keyFingerprint: "key-fingerprint",
      memberCount: 1,
      memberEnvelopesRoot: "member-envelopes-root",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      payloadCiphertextHash: "ciphertext-hash",
      prevStateHash: null,
      principalId,
      principalType,
      projectionRoot: "projection-root",
      signature: "signature",
      signedAt: "2026-08-30T12:00:00.000Z",
      signerUserId: userId,
      signerUserKeyFingerprint: "signing-fingerprint",
      version: 1,
    },
  };
}

function initialDocumentSync(): RegistrationRequest["initialRootMetadataDocument"]["initialSync"] {
  return {
    authorizingContainerPathRefs: [
      [
        {
          containerId: rootContainerId,
          manifestHash: "container-manifest-hash",
        },
      ],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [
      {
        encryptedData: "ciphertext",
        id: initialUpdateId,
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: { updateId: initialUpdateId },
      },
    ],
    supportsPullPagination: true,
  };
}

export function createRegistrationRequestFixture(): RegistrationRequest {
  const contentKeyBundle = {
    contentKeyEpoch: 1,
    linkSetManifestHash: "document-link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: rootContainerId,
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        containerManifestHash: "container-manifest-hash",
        wrappedKey: "wrapped-key",
        wrappingMetadata: { alg: "x25519-hkdf-sha256" },
      },
    ],
  };
  return {
    encapsulationPublicKey: Array.from(
      { length: ML_KEM1024_PUBLIC_KEY_BYTES },
      (_, index) => index % 256,
    ),
    initialAdminGroup: {
      groupId: adminGroupId,
      initialGroupPolicy: initialPolicy("group", adminGroupId),
      name: "Admins",
    },
    initialMemberGroup: {
      groupId: memberGroupId,
      initialGroupPolicy: initialPolicy("group", memberGroupId),
      name: "Members",
    },
    initialOrganizationPolicy: initialPolicy("organization", organizationId),
    initialRootContainer: {
      body: { eventType: "container.create" },
      event: { eventType: "container.create" },
      expectedManifestHash: "container-manifest-hash",
      keyEpoch: { id: "container-key-epoch-id" },
      keyring: null,
      manifest: { objectKind: "container" },
      parentContainerPath: [],
      predecessorBridge: null,
      previousManifest: null,
      principalPolicies: [],
      userRecipientKeys: [{ userId }],
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    },
    initialRootMetadataDocument: {
      body: { eventType: "document.link" },
      contentKeyBundle,
      event: { eventType: "document.link" },
      expectedManifestHash: "document-manifest-hash",
      initialSync: initialDocumentSync(),
      manifest: { objectKind: "document" },
      previousManifest: null,
      targetContainerPathRefs: [
        {
          containerId: rootContainerId,
          manifestHash: "container-manifest-hash",
        },
      ],
    },
    organizationId,
    rootContainerId,
    signingPublicKey: Array.from(
      { length: ML_DSA87_PUBLIC_KEY_BYTES },
      (_, index) => index % 256,
    ),
    userId,
  };
}

export function createOrganizationRequestFixture(): CreateOrganizationRequest {
  const {
    encapsulationPublicKey: _encapsulationPublicKey,
    signingPublicKey: _signingPublicKey,
    ...request
  } = createRegistrationRequestFixture();
  return request;
}
