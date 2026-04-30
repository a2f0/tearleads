import { expect, test } from "bun:test";
import {
  isBlobV2AttachmentBindRequest,
  isBlobV2AttachmentDetachRequest,
  isChallengeRequest,
  isDocumentV2ContentKeyBundleRequest,
  isDocumentV2CreateRequest,
  isDocumentV2LinkSetMutationRequest,
  isDocumentV2SyncRequest,
  isPublicKeyRequest,
  isPutPrincipalMemberEnvelopesRequest,
  isPutPrincipalStateRequest,
  isStageBlobRequest,
  isVerifyRequest,
} from "./index";

test("isPublicKeyRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const organizationId = "550e8400-e29b-41d4-a716-446655440002";
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
  const createValidRequest = (overrides: Record<string, unknown> = {}) => ({
    userId,
    organizationId,
    rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
    signingPublicKey: [1, 2, 3],
    encapsulationPublicKey: [4, 5, 6],
    initialOrganizationPolicy: validInitialOrganizationPolicy,
    initialRootContainerV2: {
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
    initialRootMetadataDocumentV2: {
      event: { eventType: "document.link" },
      body: { eventType: "document.link" },
      expectedManifestHash: "document-manifest-hash",
      manifest: { objectKind: "document" },
      previousManifest: null,
      targetContainerPath: [{ containerId: "container-1" }],
      contentKeyBundle: createDocumentV2ContentKeyBundle(),
    },
    ...overrides,
  });

  expect(isPublicKeyRequest(createValidRequest())).toBe(true);
  expect(
    isPublicKeyRequest(
      createValidRequest({
        rootContainerId: "not-a-uuid",
      }),
    ),
  ).toBe(false);
  expect(
    isPublicKeyRequest(
      createValidRequest({
        signingPublicKey: [],
        encapsulationPublicKey: [],
      }),
    ),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: "not-array",
      encapsulationPublicKey: [1],
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1],
      encapsulationPublicKey: ["a"],
    }),
  ).toBe(false);
  expect(isPublicKeyRequest({ signingPublicKey: [1] })).toBe(false);
  expect(isPublicKeyRequest({ encapsulationPublicKey: [1] })).toBe(false);
  expect(isPublicKeyRequest({})).toBe(false);
  expect(isPublicKeyRequest(null)).toBe(false);
});

test("isChallengeRequest", () => {
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(true);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc" })).toBe(false);
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
  expect(isPutPrincipalMemberEnvelopesRequest(null)).toBe(false);
});

function createBlobV2ContentKeyBundle(overrides = {}) {
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

function createBlobV2ManifestBundle(overrides = {}) {
  return {
    event: { eventId: "event-1" },
    manifest: { version: 2 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
    ...overrides,
  };
}

function createContainerV2MutationRequest(overrides = {}) {
  return {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
    manifest: { objectKind: "container" },
    previousManifest: {
      event: { eventId: "container-event-1" },
      manifest: { version: 2 },
      manifestHash: "previous-container-manifest-hash",
      state: { containerId: "container-1" },
    },
    previousContainerPath: [
      {
        event: { eventId: "container-event-1" },
        manifest: { version: 2 },
        manifestHash: "previous-container-manifest-hash",
        state: { containerId: "container-1" },
      },
    ],
    keyEpoch: { id: "container-key-epoch-id" },
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

test("isBlobV2AttachmentBindRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.bind" },
    body: { eventType: "attachment.bind" },
    documentManifest: createBlobV2ManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerV2MutationRequest()],
    contentKeyBundle: createBlobV2ContentKeyBundle(),
    stagedBlob: {
      stageId: "550e8400-e29b-41d4-a716-446655440004",
      writeHeader: { objectKind: "blob" },
    },
  };

  expect(isBlobV2AttachmentBindRequest(validRequest)).toBe(true);
  expect(
    isBlobV2AttachmentBindRequest({
      ...validRequest,
      contentKeyBundle: createBlobV2ContentKeyBundle({ targetHash: "" }),
    }),
  ).toBe(false);
  expect(
    isBlobV2AttachmentBindRequest({
      ...validRequest,
      stagedBlob: { stageId: "", writeHeader: {} },
    }),
  ).toBe(false);
  expect(
    isBlobV2AttachmentBindRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobV2AttachmentBindRequest(null)).toBe(false);
});

test("isBlobV2AttachmentDetachRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.detach" },
    body: { eventType: "attachment.detach" },
    documentManifest: createBlobV2ManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerV2MutationRequest()],
  };

  expect(isBlobV2AttachmentDetachRequest(validRequest)).toBe(true);
  expect(
    isBlobV2AttachmentDetachRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
    }),
  ).toBe(false);
  expect(
    isBlobV2AttachmentDetachRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobV2AttachmentDetachRequest(null)).toBe(false);
});

function createDocumentV2ContentKeyBundle(overrides = {}) {
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

test("isDocumentV2ContentKeyBundleRequest", () => {
  expect(
    isDocumentV2ContentKeyBundleRequest(createDocumentV2ContentKeyBundle()),
  ).toBe(true);
  expect(
    isDocumentV2ContentKeyBundleRequest(
      createDocumentV2ContentKeyBundle({ contentKeyEpoch: 0 }),
    ),
  ).toBe(false);
  expect(
    isDocumentV2ContentKeyBundleRequest(
      createDocumentV2ContentKeyBundle({ targets: [{ wrappedKey: "" }] }),
    ),
  ).toBe(false);
  expect(isDocumentV2ContentKeyBundleRequest(null)).toBe(false);
});

test("isDocumentV2CreateRequest", () => {
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: null,
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerV2MutationRequest()],
    contentKeyBundle: createDocumentV2ContentKeyBundle(),
  };

  expect(isDocumentV2CreateRequest(validRequest)).toBe(true);
  expect(
    isDocumentV2CreateRequest({
      ...validRequest,
      expectedManifestHash: "",
    }),
  ).toBe(false);
  expect(
    isDocumentV2CreateRequest({
      ...validRequest,
      contentKeyBundle: createDocumentV2ContentKeyBundle({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentV2CreateRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentV2CreateRequest(null)).toBe(false);
});

test("isDocumentV2LinkSetMutationRequest", () => {
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: {
      event: { eventId: "event-1" },
      manifest: { version: 2 },
      manifestHash: "previous-manifest-hash",
      state: { documentId: "doc-1" },
    },
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerV2MutationRequest()],
    contentKeyBundle: createDocumentV2ContentKeyBundle(),
  };

  expect(isDocumentV2LinkSetMutationRequest(validRequest)).toBe(true);
  expect(
    isDocumentV2LinkSetMutationRequest({
      ...validRequest,
      previousManifest: null,
    }),
  ).toBe(false);
  expect(
    isDocumentV2LinkSetMutationRequest({
      ...validRequest,
      targetContainerPath: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentV2LinkSetMutationRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
    }),
  ).toBe(false);
  expect(
    isDocumentV2LinkSetMutationRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentV2LinkSetMutationRequest(null)).toBe(false);
});

test("isDocumentV2SyncRequest", () => {
  const documentManifest = {
    event: { eventId: "event-1" },
    manifest: { version: 2 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
  };
  const validRequest = {
    authorizingContainerPaths: [
      [
        {
          event: { eventId: "container-event-1" },
          manifest: { version: 2 },
          manifestHash: "container-manifest-hash",
          state: { containerId: "container-1" },
        },
      ],
    ],
    containerRekeys: [createContainerV2MutationRequest()],
    contentKeyEpoch: 1,
    documentManifest,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      {
        checkpointKind: "fresh_baseline",
        id: "update-1",
        encryptedData: "ciphertext",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"actor":1}',
        sourceVersionVector: "{}",
        writeHeader: { updateId: "update-1" },
      },
    ],
  };

  expect(isDocumentV2SyncRequest(validRequest)).toBe(true);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      documentManifest: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      authorizingContainerPaths: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
      containerRekeys: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(true);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      minLsn: "not-an-lsn",
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      outgoingUpdates: [{ id: "update-1" }],
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentV2SyncRequest(null)).toBe(false);
});
