import { expect, test } from "bun:test";
import {
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isChallengeErrorResponse,
  isChallengeResponse,
  isContainerDeleteResponse,
  isContainerWriterProjectionResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  isHealthResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
  isRegistrationResponse,
  isStageBlobResponse,
  isVerifyResponse,
} from "./index";

const VALID_CHALLENGE = "a".repeat(64);

test("isHealthResponse", () => {
  expect(isHealthResponse({ message: "ok" })).toBe(true);
  expect(isHealthResponse({ message: 123 })).toBe(false);
  expect(isHealthResponse({})).toBe(false);
  expect(isHealthResponse(null)).toBe(false);
});

test("isRegistrationResponse", () => {
  expect(
    isRegistrationResponse({
      userId: "abc-123",
      organizationId: "org-456",
      rootContainerId: "ctr-789",
      rootMetadataDocumentId: "doc-root",
      rootMetadataAccessEpoch: 1,
      rootMetadataAccessStateHash: "root-access-state-hash",
      rootMetadataDocument: createDocumentCreateResponse(),
      challenge: VALID_CHALLENGE,
    }),
  ).toBe(true);
  expect(
    isRegistrationResponse({
      userId: "abc-123",
      challenge: VALID_CHALLENGE,
    }),
  ).toBe(false);
  expect(isRegistrationResponse({})).toBe(false);
  expect(isRegistrationResponse(null)).toBe(false);
});

test("isChallengeResponse", () => {
  expect(isChallengeResponse({ challenge: VALID_CHALLENGE })).toBe(true);
  expect(isChallengeResponse({ challenge: "hex" })).toBe(false);
  expect(isChallengeResponse({ challenge: 123 })).toBe(false);
  expect(isChallengeResponse({})).toBe(false);
  expect(isChallengeResponse(null)).toBe(false);
});

test("isChallengeErrorResponse", () => {
  expect(isChallengeErrorResponse({ error: "not found" })).toBe(true);
  expect(isChallengeErrorResponse({ error: 123 })).toBe(false);
  expect(isChallengeErrorResponse({})).toBe(false);
  expect(isChallengeErrorResponse(null)).toBe(false);
});

test("isVerifyResponse", () => {
  expect(isVerifyResponse({ authenticated: true })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, token: "abc123" })).toBe(true);
  expect(isVerifyResponse({ authenticated: false, error: "bad sig" })).toBe(
    true,
  );
  expect(isVerifyResponse({ authenticated: false })).toBe(true);
  expect(isVerifyResponse({ authenticated: false, token: "abc123" })).toBe(
    false,
  );
  expect(isVerifyResponse({ authenticated: "yes" })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, token: 123 })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, error: 123 })).toBe(false);
  expect(isVerifyResponse({})).toBe(false);
  expect(isVerifyResponse(null)).toBe(false);
});

test("isStageBlobResponse", () => {
  expect(
    isStageBlobResponse({
      stageId: "stage_01",
      expiresAt: new Date().toISOString(),
    }),
  ).toBe(true);
  expect(isStageBlobResponse({ stageId: "stage_01" })).toBe(false);
  expect(isStageBlobResponse(null)).toBe(false);
});

function createBlobContentKeyBundleResponse(overrides = {}) {
  return {
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    contentKeyEpoch: 1,
    targetHash: "target-hash",
    targets: [
      {
        bindingId: "550e8400-e29b-41d4-a716-446655440002",
        documentId: "550e8400-e29b-41d4-a716-446655440003",
        containerId: "550e8400-e29b-41d4-a716-446655440004",
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

function createBlobKekTargetsResponse(overrides = {}) {
  return {
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    organizationId: "550e8400-e29b-41d4-a716-446655440005",
    activeBindingIds: ["550e8400-e29b-41d4-a716-446655440002"],
    documentManifestHashes: ["document-manifest-hash"],
    linkedContainerManifestHashes: ["container-manifest-hash"],
    linkedContainerKeyEpochIds: ["container-key-epoch-id"],
    targets: [{ bindingId: "550e8400-e29b-41d4-a716-446655440002" }],
    blobKeyTargetHash: "target-hash",
    blobAccessManifestHash: "blob-access-manifest-hash",
    ...overrides,
  };
}

test("isBlobAttachmentBindResponse", () => {
  const validResponse = {
    bindingId: "550e8400-e29b-41d4-a716-446655440002",
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    documentId: "550e8400-e29b-41d4-a716-446655440003",
    slotId: "slot-a",
    contentKeyBundle: createBlobContentKeyBundleResponse(),
    blobKekTargets: createBlobKekTargetsResponse(),
    writeHeaderHash: "write-header-hash",
  };

  expect(isBlobAttachmentBindResponse(validResponse)).toBe(true);
  expect(
    isBlobAttachmentBindResponse({
      ...validResponse,
      blobKekTargets: createBlobKekTargetsResponse({
        activeBindingIds: [123],
      }),
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentBindResponse({
      ...validResponse,
      contentKeyBundle: createBlobContentKeyBundleResponse({
        contentKeyEpoch: 0,
      }),
    }),
  ).toBe(false);
  expect(isBlobAttachmentBindResponse(null)).toBe(false);
});

test("isBlobAttachmentDetachResponse", () => {
  expect(
    isBlobAttachmentDetachResponse({
      bindingId: "550e8400-e29b-41d4-a716-446655440002",
      blobId: "550e8400-e29b-41d4-a716-446655440001",
      documentId: "550e8400-e29b-41d4-a716-446655440003",
      slotId: "slot-a",
    }),
  ).toBe(true);
  expect(isBlobAttachmentDetachResponse({ bindingId: "binding-1" })).toBe(
    false,
  );
  expect(isBlobAttachmentDetachResponse(null)).toBe(false);
});

test("isListContainersResponse", () => {
  expect(
    isListContainersResponse({
      hasMore: false,
      items: [
        {
          createdAt: new Date().toISOString(),
          depth: 0,
          id: "ctr-root",
          organizationId: "org-123",
          parentId: null,
          metadataDocumentId: "doc-root",
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "access-state-hash",
          metadataReferencedPrincipals: [
            {
              principalType: "organization",
              principalId: "org-123",
              version: 1,
              keyEpoch: 1,
              stateHash: "state-hash",
              keyFingerprint: "key-fingerprint",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],
      nextWatermark: {
        id: "ctr-root",
        updatedAt: new Date().toISOString(),
      },
      tombstones: [
        {
          containerId: "ctr-removed",
          depth: 1,
          parentId: "ctr-root",
          reason: "deleted",
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  ).toBe(true);
  expect(
    isListContainersResponse({
      hasMore: false,
      items: [
        {
          id: "ctr-root",
          organizationId: "org-123",
          metadataDocumentId: "doc-root",
          metadataAccessEpoch: 1,
        },
      ],
      nextWatermark: null,
      tombstones: [],
    }),
  ).toBe(false);
  expect(isListContainersResponse(null)).toBe(false);
});

test("isContainerDeleteResponse", () => {
  expect(
    isContainerDeleteResponse({
      containerId: "ctr-removed",
      deletedAt: new Date().toISOString(),
    }),
  ).toBe(true);
  expect(isContainerDeleteResponse({ containerId: "ctr-removed" })).toBe(false);
  expect(isContainerDeleteResponse(null)).toBe(false);
});

test("isListContainerDocumentsResponse", () => {
  expect(
    isListContainerDocumentsResponse({
      hasMore: false,
      items: [
        {
          createdAt: new Date().toISOString(),
          currentAccessEpoch: 2,
          currentAccessStateHash: "access-state-hash",
          id: "doc-123",
          linkedContainerIds: ["ctr-root"],
          referencedPrincipals: [
            {
              principalType: "group",
              principalId: "group-123",
              version: 1,
              keyEpoch: 1,
              stateHash: "state-hash",
              keyFingerprint: "key-fingerprint",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],
      nextWatermark: {
        id: "doc-123",
        updatedAt: new Date().toISOString(),
      },
      tombstones: [
        {
          containerId: "ctr-root",
          documentId: "doc-removed",
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  ).toBe(true);
  expect(
    isListContainerDocumentsResponse({
      hasMore: false,
      items: [
        {
          currentAccessEpoch: 2,
          id: "doc-123",
          linkedContainerIds: ["ctr-root"],
        },
      ],
      nextWatermark: null,
      tombstones: [],
    }),
  ).toBe(false);
  expect(isListContainerDocumentsResponse(null)).toBe(false);
});

test("isPrincipalStateResponse", () => {
  expect(
    isPrincipalStateResponse({
      principalType: "group",
      principalId: "group-123",
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
      signerUserId: "user-1",
      signerUserKeyFingerprint: "policy-key-fingerprint-1",
      signature: "signature",
      stateHash: "state-hash",
      createdAt: new Date().toISOString(),
    }),
  ).toBe(true);
  expect(
    isPrincipalStateResponse({
      principalType: "group",
      principalId: "group-123",
      version: 1,
    }),
  ).toBe(false);
  expect(isPrincipalStateResponse(null)).toBe(false);
});

test("isCurrentPrincipalMemberEnvelopesResponse", () => {
  expect(
    isCurrentPrincipalMemberEnvelopesResponse({
      principalType: "organization",
      principalId: "org-123",
      stateHash: "state-hash",
      epoch: 2,
      envelopes: [
        {
          memberPrincipalType: "group",
          memberPrincipalId: "group-234",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isCurrentPrincipalMemberEnvelopesResponse({
      principalType: "organization",
      principalId: "org-123",
      stateHash: "state-hash",
      envelopes: [],
    }),
  ).toBe(false);
  expect(isCurrentPrincipalMemberEnvelopesResponse(null)).toBe(false);
});

test("isPrincipalPolicyBundleResponse", () => {
  expect(
    isPrincipalPolicyBundleResponse({
      currentState: {
        principalType: "group",
        principalId: "group-123",
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
        signerUserId: "user-1",
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
        stateHash: "state-hash",
        createdAt: new Date().toISOString(),
      },
      currentProjection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-1",
          role: "admin",
        },
      ],
      currentPayload: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
        createdAt: new Date().toISOString(),
      },
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        epoch: 1,
        envelopes: [],
      },
      previousStates: [],
    }),
  ).toBe(true);
  expect(
    isPrincipalPolicyBundleResponse({
      currentState: {
        principalType: "group",
      },
      currentPayload: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
        createdAt: new Date().toISOString(),
      },
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        epoch: 1,
        envelopes: [],
      },
    }),
  ).toBe(false);
  expect(isPrincipalPolicyBundleResponse(null)).toBe(false);
});

function createDocumentContentKeyBundleResponse(overrides = {}) {
  return {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
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

function createDocumentKekTargetsResponse(overrides = {}) {
  return {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    linkSetManifestHash: "document-link-set-hash",
    linkedContainerManifestHashes: ["container-manifest-hash"],
    linkedContainerKeyEpochIds: ["container-key-epoch-id"],
    targets: [{ containerId: "550e8400-e29b-41d4-a716-446655440000" }],
    documentKeyTargetHash: "target-hash",
    ...overrides,
  };
}

function createDocumentCreateResponse(overrides = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: new Date().toISOString(),
    accessManifest: createDocumentManifestBundleResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    documentKekTargets: createDocumentKekTargetsResponse(),
    ...overrides,
  };
}

function createDocumentManifestBundleResponse(overrides = {}) {
  return {
    event: {
      event: { eventType: "document.link" },
      body: { eventType: "document.link" },
      eventHash: "document-event-hash",
    },
    manifest: { objectType: "document", objectId: "doc-1" },
    manifestHash: "manifest-hash",
    state: { objectId: "doc-1" },
    ...overrides,
  };
}

function createContainerKekResponse(overrides = {}) {
  return {
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    accessManifestHash: "container-manifest-hash",
    containerKeyEpochId: "container-key-epoch-id",
    containerKeyEpoch: 1,
    keyEpoch: { id: "container-key-epoch-id" },
    keyEpochHash: "key-epoch-hash",
    keyTargetHash: "key-target-hash",
    parentContainerKeyEpochId: null,
    recipientTargets: [{ recipientKind: "user" }],
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

function createContainerWriterProjectionResponse(overrides = {}) {
  return {
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    organizationId: "550e8400-e29b-41d4-a716-446655440099",
    path: [
      {
        event: {
          event: { eventType: "container.create" },
          body: { eventType: "container.create" },
          eventHash: "container-event-hash",
        },
        manifest: { objectType: "container" },
        manifestHash: "container-manifest-hash",
        state: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
      },
    ],
    containerKeks: [createContainerKekResponse()],
    ...overrides,
  };
}

test("isDocumentCreateResponse", () => {
  const validResponse = createDocumentCreateResponse();

  expect(isDocumentCreateResponse(validResponse)).toBe(true);
  expect(
    isDocumentCreateResponse({
      ...validResponse,
      accessManifest: createDocumentManifestBundleResponse({
        manifestHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentCreateResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        contentKeyEpoch: 0,
      }),
    }),
  ).toBe(false);
  expect(isDocumentCreateResponse(null)).toBe(false);
});

test("isDocumentLinkSetMutationResponse", () => {
  const validResponse = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    accessManifest: createDocumentManifestBundleResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    documentKekTargets: createDocumentKekTargetsResponse(),
  };

  expect(isDocumentLinkSetMutationResponse(validResponse)).toBe(true);
  expect(
    isDocumentLinkSetMutationResponse({
      ...validResponse,
      accessManifest: createDocumentManifestBundleResponse({
        manifestHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(isDocumentLinkSetMutationResponse(null)).toBe(false);
});

test("isDocumentSyncResponse", () => {
  const validResponse = {
    acceptedOutgoingUpdateIds: ["update-1"],
    commitLsn: null,
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentKekTargets: createDocumentKekTargetsResponse(),
    missingUpdateEpochs: ["current_epoch"],
    updates: [
      {
        accessEpoch: 1,
        id: "update-2",
        documentId: "550e8400-e29b-41d4-a716-446655440001",
        authorFingerprint: "author-fingerprint",
        encryptedData: "ciphertext",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"actor":1}',
        createdAt: new Date().toISOString(),
        writeHeader: { objectKind: "document" },
        writeHeaderHash: "write-header-hash",
      },
    ],
  };

  expect(isDocumentSyncResponse(validResponse)).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      missingUpdateEpochs: ["unknown_epoch"],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      commitLsn: 123,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      updates: [{ id: "update-2" }],
    }),
  ).toBe(false);
  expect(isDocumentSyncResponse(null)).toBe(false);
});

test("isContainerWriterProjectionResponse", () => {
  const validResponse = createContainerWriterProjectionResponse();

  expect(isContainerWriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      path: [{ manifestHash: "" }],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [createContainerKekResponse({ containerKeyEpoch: 0 })],
    }),
  ).toBe(false);
  expect(isContainerWriterProjectionResponse(null)).toBe(false);
});

test("isDocumentWriterProjectionResponse", () => {
  const validResponse = {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentManifest: createDocumentManifestBundleResponse(),
    documentKekTargets: createDocumentKekTargetsResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
  };

  expect(isDocumentWriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [{ containerId: "" }],
    }),
  ).toBe(false);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [],
    }),
  ).toBe(false);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(isDocumentWriterProjectionResponse(null)).toBe(false);
});
