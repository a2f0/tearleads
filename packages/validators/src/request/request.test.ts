import { expect, test } from "bun:test";
import {
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_DSA87_SIGNATURE_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "../util";
import {
  isBlobAttachmentBindRequest,
  isBlobAttachmentDetachRequest,
  isChallengeRequest,
  isCompleteMultipartBlobStageRequest,
  isContainerCreateWithMetadataDocumentRequest,
  isCreateOrganizationGroupRequest,
  isDocumentContentKeyBundleRequest,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
  isDocumentSyncRequest,
  isInitiateMultipartBlobStageRequest,
  isPutPrincipalMemberEnvelopesRequest,
  isPutPrincipalStateRequest,
  isRegistrationRequest,
  isStageBlobRequest,
  isUpdateOrganizationProfileRequest,
  isUpdateOrganizationRosterEntryRequest,
  isUploadMultipartBlobPartRequest,
  isVerifyRequest,
} from "./index";

const VALID_FINGERPRINT = "a".repeat(64);
const VALID_SIGNING_PUBLIC_KEY = Array.from(
  { length: ML_DSA87_PUBLIC_KEY_BYTES },
  (_, index) => index % 256,
);
const VALID_ENCAPSULATION_PUBLIC_KEY = Array.from(
  { length: ML_KEM1024_PUBLIC_KEY_BYTES },
  (_, index) => index % 256,
);
const VALID_SIGNATURE = Array.from(
  { length: ML_DSA87_SIGNATURE_BYTES },
  (_, index) => index % 256,
);

test("isRegistrationRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const organizationId = "550e8400-e29b-41d4-a716-446655440002";
  const adminGroupId = "550e8400-e29b-41d4-a716-446655440003";
  const memberGroupId = "550e8400-e29b-41d4-a716-446655440004";
  const validInitialOrganizationPolicy = {
    state: {
      principalType: "organization" as const,
      principalId: organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      membershipMode: "projection" as const,
      membershipRoot: "membership-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      memberCount: 1,
      signedAt: new Date().toISOString(),
      signerUserId: userId,
      signerUserKeyFingerprint: "signing-fingerprint",
      signature: "signature",
    },
    encryptedPayload: {
      cipherSuite: "aes-256-gcm" as const,
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    projection: [
      {
        memberPrincipalType: "user" as const,
        memberPrincipalId: userId,
        role: "admin" as const,
      },
    ],
    memberEnvelopes: [
      {
        memberPrincipalType: "user" as const,
        memberPrincipalId: userId,
        memberKeyFingerprint: "member-key-fingerprint",
        kemCipherText: "kem-ciphertext",
        wrappedKey: "wrapped-key",
      },
    ],
  };
  const validInitialAdminGroup = {
    groupId: adminGroupId,
    name: "Admins",
    initialGroupPolicy: {
      state: {
        ...validInitialOrganizationPolicy.state,
        principalType: "group" as const,
        principalId: adminGroupId,
      },
      encryptedPayload: validInitialOrganizationPolicy.encryptedPayload,
      projection: validInitialOrganizationPolicy.projection,
      memberEnvelopes: validInitialOrganizationPolicy.memberEnvelopes,
    },
  };
  const validInitialMemberGroup = {
    groupId: memberGroupId,
    name: "Members",
    initialGroupPolicy: {
      state: {
        ...validInitialOrganizationPolicy.state,
        principalType: "group" as const,
        principalId: memberGroupId,
      },
      encryptedPayload: validInitialOrganizationPolicy.encryptedPayload,
      projection: validInitialOrganizationPolicy.projection,
      memberEnvelopes: validInitialOrganizationPolicy.memberEnvelopes,
    },
  };
  const createValidRequest = (overrides: Record<string, unknown> = {}) => ({
    userId,
    organizationId,
    rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
    signingPublicKey: VALID_SIGNING_PUBLIC_KEY,
    encapsulationPublicKey: VALID_ENCAPSULATION_PUBLIC_KEY,
    initialAdminGroup: validInitialAdminGroup,
    initialMemberGroup: validInitialMemberGroup,
    initialOrganizationPolicy: validInitialOrganizationPolicy,
    initialRootContainer: {
      event: { eventType: "container.create" },
      body: { eventType: "container.create" },
      expectedManifestHash: "container-manifest-hash",
      manifest: { objectKind: "container" },
      previousManifest: null,
      parentContainerPath: [],
      keyEpoch: { id: "container-key-epoch-id" },
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
      userRecipientKeys: [{ userId }],
    },
    initialRootMetadataDocument: {
      event: { eventType: "document.link" },
      body: { eventType: "document.link" },
      expectedManifestHash: "document-manifest-hash",
      manifest: { objectKind: "document" },
      previousManifest: null,
      targetContainerPath: [{ containerId: "container-1" }],
      contentKeyBundle: createDocumentContentKeyBundle(),
    },
    ...overrides,
  });

  expect(isRegistrationRequest(createValidRequest())).toBe(true);
  expect(
    isRegistrationRequest(
      createValidRequest({
        rootContainerId: "not-a-uuid",
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        signingPublicKey: [],
        encapsulationPublicKey: [],
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: VALID_SIGNING_PUBLIC_KEY,
      encapsulationPublicKey: VALID_ENCAPSULATION_PUBLIC_KEY,
    }),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: "not-array",
      encapsulationPublicKey: [1],
    }),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: [1],
      encapsulationPublicKey: ["a"],
    }),
  ).toBe(false);
  expect(isRegistrationRequest({ signingPublicKey: [1] })).toBe(false);
  expect(isRegistrationRequest({ encapsulationPublicKey: [1] })).toBe(false);
  expect(isRegistrationRequest({})).toBe(false);
  expect(isRegistrationRequest(null)).toBe(false);
});

test("isUpdateOrganizationRosterEntryRequest", () => {
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: null,
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: "not-a-uuid",
    }),
  ).toBe(false);
  expect(isUpdateOrganizationRosterEntryRequest({})).toBe(false);
});

test("isUpdateOrganizationProfileRequest", () => {
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: null,
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: "not-a-uuid",
    }),
  ).toBe(false);
  expect(isUpdateOrganizationProfileRequest({})).toBe(false);
});

test("isChallengeRequest", () => {
  expect(isChallengeRequest({ fingerprint: VALID_FINGERPRINT })).toBe(true);
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(false);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  expect(
    isVerifyRequest({
      fingerprint: VALID_FINGERPRINT,
      signature: VALID_SIGNATURE,
    }),
  ).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(
    false,
  );
  expect(
    isVerifyRequest({ fingerprint: VALID_FINGERPRINT, signature: [] }),
  ).toBe(false);
  expect(isVerifyRequest({ fingerprint: VALID_FINGERPRINT })).toBe(false);
  expect(isVerifyRequest({ signature: [1, 2] })).toBe(false);
  expect(isVerifyRequest(null)).toBe(false);
});

test("isStageBlobRequest", () => {
  expect(
    isStageBlobRequest({
      encryptedBytes: "YWJj",
      byteLength: 3,
      sha256: "sha256-1",
    }),
  ).toBe(true);
  expect(
    isStageBlobRequest({
      encryptedBytes: "YWJj",
      byteLength: 0,
      sha256: "sha256-1",
    }),
  ).toBe(false);
  expect(isStageBlobRequest(null)).toBe(false);
});

test("isInitiateMultipartBlobStageRequest", () => {
  expect(
    isInitiateMultipartBlobStageRequest({
      byteLength: 6,
      sha256: "sha256-1",
    }),
  ).toBe(true);
  expect(
    isInitiateMultipartBlobStageRequest({
      byteLength: 0,
      sha256: "sha256-1",
    }),
  ).toBe(false);
  expect(isInitiateMultipartBlobStageRequest(null)).toBe(false);
});

test("isUploadMultipartBlobPartRequest", () => {
  expect(
    isUploadMultipartBlobPartRequest({
      encryptedBytes: "part-1",
      uploadId: "upload-1",
    }),
  ).toBe(true);
  expect(
    isUploadMultipartBlobPartRequest({
      encryptedBytes: "",
      uploadId: "upload-1",
    }),
  ).toBe(false);
  expect(isUploadMultipartBlobPartRequest(null)).toBe(false);
});

test("isCompleteMultipartBlobStageRequest", () => {
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [{ partNumber: 1, etag: "etag-1" }],
    }),
  ).toBe(true);
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [],
    }),
  ).toBe(false);
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [{ partNumber: 0, etag: "etag-1" }],
    }),
  ).toBe(false);
  expect(isCompleteMultipartBlobStageRequest(null)).toBe(false);
});

test("isPutPrincipalStateRequest", () => {
  expect(
    isPutPrincipalStateRequest({
      state: {
        principalType: "group",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
        signedAt: new Date().toISOString(),
        signerUserId: "550e8400-e29b-41d4-a716-446655440001",
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
      },
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440001",
          role: "member",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isPutPrincipalStateRequest({
      state: {
        principalType: "team",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 0,
        signedAt: new Date().toISOString(),
        signerUserId: "550e8400-e29b-41d4-a716-446655440001",
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
      },
      projection: [],
    }),
  ).toBe(false);
  expect(isPutPrincipalStateRequest(null)).toBe(false);
});

test("isPutPrincipalMemberEnvelopesRequest", () => {
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "state-hash",
      envelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440000",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "state-hash",
      envelopes: [
        {
          memberPrincipalType: "organization",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440000",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(false);
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "",
      envelopes: [],
    }),
  ).toBe(false);
  expect(isPutPrincipalMemberEnvelopesRequest(null)).toBe(false);
});

test("isCreateOrganizationGroupRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const groupId = "550e8400-e29b-41d4-a716-446655440002";
  const request = {
    groupId,
    name: "Operators",
    initialGroupPolicy: {
      state: {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
        signedAt: new Date().toISOString(),
        signerUserId: userId,
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
      },
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: userId,
          role: "admin",
        },
      ],
      memberEnvelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: userId,
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    },
  };

  expect(isCreateOrganizationGroupRequest(request)).toBe(true);
  expect(isCreateOrganizationGroupRequest({ ...request, name: "" })).toBe(
    false,
  );
  expect(isCreateOrganizationGroupRequest({ ...request, name: "   " })).toBe(
    false,
  );
  expect(isCreateOrganizationGroupRequest({ ...request, groupId: "bad" })).toBe(
    false,
  );
  expect(isCreateOrganizationGroupRequest(null)).toBe(false);
});

function createBlobContentKeyBundle(overrides = {}) {
  return {
    contentKeyEpoch: 1,
    targetHash: "target-hash",
    targets: [
      {
        bindingId: "550e8400-e29b-41d4-a716-446655440001",
        documentId: "550e8400-e29b-41d4-a716-446655440002",
        containerId: "550e8400-e29b-41d4-a716-446655440003",
        containerManifestHash: "container-manifest-hash",
        containerKeyEpochId: "container-key-epoch-id",
        containerKeyEpoch: 1,
        wrappedKey: "wrapped-key",
        wrappingMetadata: { alg: "x25519-hkdf-sha256" },
      },
    ],
    ...overrides,
  };
}

function createBlobManifestBundle(overrides = {}) {
  return {
    event: { eventId: "event-1" },
    manifest: { version: 1 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
    ...overrides,
  };
}

function createContainerMutationRequest(overrides = {}) {
  return {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
    manifest: { objectKind: "container" },
    previousManifest: {
      event: { eventId: "container-event-1" },
      manifest: { version: 1 },
      manifestHash: "previous-container-manifest-hash",
      state: { containerId: "container-1" },
    },
    previousContainerPath: [
      {
        event: { eventId: "container-event-1" },
        manifest: { version: 1 },
        manifestHash: "previous-container-manifest-hash",
        state: { containerId: "container-1" },
      },
    ],
    keyEpoch: { id: "container-key-epoch-id" },
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

test("isBlobAttachmentBindRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.bind" },
    body: { eventType: "attachment.bind" },
    documentManifest: createBlobManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createBlobContentKeyBundle(),
    stagedBlob: {
      stageId: "550e8400-e29b-41d4-a716-446655440004",
      writeHeader: { objectKind: "blob" },
    },
  };

  expect(isBlobAttachmentBindRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      contentKeyBundle: createBlobContentKeyBundle({ targetHash: "" }),
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      stagedBlob: { stageId: "", writeHeader: {} },
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobAttachmentBindRequest(null)).toBe(false);
});

test("isBlobAttachmentDetachRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.detach" },
    body: { eventType: "attachment.detach" },
    documentManifest: createBlobManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
  };

  expect(isBlobAttachmentDetachRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobAttachmentDetachRequest(null)).toBe(false);
});

function createDocumentContentKeyBundle(overrides = {}) {
  return {
    contentKeyEpoch: 1,
    linkSetManifestHash: "document-link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: "550e8400-e29b-41d4-a716-446655440000",
        containerManifestHash: "container-manifest-hash",
        containerKeyEpochId: "container-key-epoch-id",
        containerKeyEpoch: 1,
        wrappedKey: "wrapped-key",
        wrappingMetadata: { alg: "x25519-hkdf-sha256" },
      },
    ],
    ...overrides,
  };
}

test("isDocumentContentKeyBundleRequest", () => {
  expect(
    isDocumentContentKeyBundleRequest(createDocumentContentKeyBundle()),
  ).toBe(true);
  expect(
    isDocumentContentKeyBundleRequest(
      createDocumentContentKeyBundle({ contentKeyEpoch: 0 }),
    ),
  ).toBe(false);
  expect(
    isDocumentContentKeyBundleRequest(
      createDocumentContentKeyBundle({ targets: [{ wrappedKey: "" }] }),
    ),
  ).toBe(false);
  expect(isDocumentContentKeyBundleRequest(null)).toBe(false);
});

test("isDocumentCreateRequest", () => {
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: null,
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentCreateRequest(validRequest)).toBe(true);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      expectedManifestHash: "",
    }),
  ).toBe(false);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      contentKeyBundle: createDocumentContentKeyBundle({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentCreateRequest(null)).toBe(false);
});

test("isContainerCreateWithMetadataDocumentRequest", () => {
  const validRequest = {
    container: createContainerMutationRequest(),
    metadataDocument: {
      event: { eventType: "document.link" },
      body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
      expectedManifestHash: "manifest-hash",
      manifest: { objectType: "document", objectId: "doc-1" },
      previousManifest: null,
      targetContainerPath: [{ containerId: "container-1" }],
      contentKeyBundle: createDocumentContentKeyBundle(),
    },
  };

  expect(isContainerCreateWithMetadataDocumentRequest(validRequest)).toBe(true);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...validRequest,
      container: { event: { eventType: "container.create" } },
    }),
  ).toBe(false);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...validRequest,
      metadataDocument: { event: { eventType: "document.link" } },
    }),
  ).toBe(false);
  expect(isContainerCreateWithMetadataDocumentRequest(null)).toBe(false);
});

test("isDocumentLinkSetMutationRequest", () => {
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: {
      event: { eventId: "event-1" },
      manifest: { version: 1 },
      manifestHash: "previous-manifest-hash",
      state: { documentId: "doc-1" },
    },
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentLinkSetMutationRequest(validRequest)).toBe(true);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      previousManifest: null,
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      targetContainerPath: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentLinkSetMutationRequest(null)).toBe(false);
});

test("isDocumentSyncRequest", () => {
  const documentManifest = {
    event: { eventId: "event-1" },
    manifest: { version: 1 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
  };
  const validOutgoingUpdate = {
    checkpointKind: "fresh_baseline" as const,
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    sourceVersionVector: "{}",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const validRequest = {
    authorizingContainerPaths: [
      [
        {
          event: { eventId: "container-event-1" },
          manifest: { version: 1 },
          manifestHash: "container-manifest-hash",
          state: { containerId: "container-1" },
        },
      ],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyEpoch: 1,
    documentManifest,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [validOutgoingUpdate],
  };

  expect(isDocumentSyncRequest(validRequest)).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      documentManifest: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      authorizingContainerPaths: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
      containerRekeys: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      minLsn: "not-an-lsn",
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      outgoingUpdates: [{ id: "550e8400-e29b-41d4-a716-446655440111" }],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      outgoingUpdates: [validOutgoingUpdate, validOutgoingUpdate],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentSyncRequest(null)).toBe(false);
});
