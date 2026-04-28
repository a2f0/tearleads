import { expect, test } from "bun:test";
import {
  isBlobV2AttachmentBindResponse,
  isBlobV2AttachmentDetachResponse,
  isChallengeErrorResponse,
  isChallengeResponse,
  isContainerV2WriterProjectionResponse,
  isCreateContainerResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isDocumentV2CreateResponse,
  isDocumentV2SyncResponse,
  isDocumentV2WriterProjectionResponse,
  isHealthResponse,
  isLinkDocumentToContainerResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isMoveContainerResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
  isPublicKeyResponse,
  isShareContainerResponse,
  isStageBlobResponse,
  isUnlinkDocumentFromContainerResponse,
  isVerifyResponse,
} from "./index";

test("isHealthResponse", () => {
  expect(isHealthResponse({ message: "ok" })).toBe(true);
  expect(isHealthResponse({ message: 123 })).toBe(false);
  expect(isHealthResponse({})).toBe(false);
  expect(isHealthResponse(null)).toBe(false);
});

test("isPublicKeyResponse", () => {
  expect(
    isPublicKeyResponse({
      message: "ok",
      userId: "abc-123",
      organizationId: "org-456",
      rootContainerId: "ctr-789",
      rootMetadataDocumentId: "doc-root",
      rootMetadataAccessEpoch: 1,
      rootMetadataAccessStateHash: "root-access-state-hash",
      rootMetadataDocumentV2: createDocumentV2CreateResponse(),
      challenge: "deadbeef",
    }),
  ).toBe(true);
  expect(
    isPublicKeyResponse({
      message: "ok",
      userId: "abc-123",
      challenge: "deadbeef",
    }),
  ).toBe(false);
  expect(isPublicKeyResponse({ message: "ok" })).toBe(false);
  expect(isPublicKeyResponse({ message: 123 })).toBe(false);
  expect(isPublicKeyResponse({})).toBe(false);
  expect(isPublicKeyResponse(null)).toBe(false);
});

test("isChallengeResponse", () => {
  expect(isChallengeResponse({ challenge: "hex" })).toBe(true);
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
  expect(isVerifyResponse({ authenticated: true })).toBe(true);
  expect(isVerifyResponse({ authenticated: true, token: "abc123" })).toBe(true);
  expect(isVerifyResponse({ authenticated: false, error: "bad sig" })).toBe(
    true,
  );
  expect(isVerifyResponse({ authenticated: false })).toBe(true);
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

function createBlobV2ContentKeyBundleResponse(overrides = {}) {
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

function createBlobV2KekTargetsResponse(overrides = {}) {
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

test("isBlobV2AttachmentBindResponse", () => {
  const validResponse = {
    bindingId: "550e8400-e29b-41d4-a716-446655440002",
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    documentId: "550e8400-e29b-41d4-a716-446655440003",
    slotId: "slot-a",
    contentKeyBundle: createBlobV2ContentKeyBundleResponse(),
    blobKekTargets: createBlobV2KekTargetsResponse(),
    writeHeaderHash: "write-header-hash",
  };

  expect(isBlobV2AttachmentBindResponse(validResponse)).toBe(true);
  expect(
    isBlobV2AttachmentBindResponse({
      ...validResponse,
      blobKekTargets: createBlobV2KekTargetsResponse({
        activeBindingIds: [123],
      }),
    }),
  ).toBe(false);
  expect(
    isBlobV2AttachmentBindResponse({
      ...validResponse,
      contentKeyBundle: createBlobV2ContentKeyBundleResponse({
        contentKeyEpoch: 0,
      }),
    }),
  ).toBe(false);
  expect(isBlobV2AttachmentBindResponse(null)).toBe(false);
});

test("isBlobV2AttachmentDetachResponse", () => {
  expect(
    isBlobV2AttachmentDetachResponse({
      bindingId: "550e8400-e29b-41d4-a716-446655440002",
      blobId: "550e8400-e29b-41d4-a716-446655440001",
      documentId: "550e8400-e29b-41d4-a716-446655440003",
      slotId: "slot-a",
    }),
  ).toBe(true);
  expect(isBlobV2AttachmentDetachResponse({ bindingId: "binding-1" })).toBe(
    false,
  );
  expect(isBlobV2AttachmentDetachResponse(null)).toBe(false);
});

test("isCreateContainerResponse", () => {
  expect(
    isCreateContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: "ctr-root",
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "access-state-hash",
      metadataReferencedPrincipals: [
        {
          principalType: "group",
          principalId: "group-123",
          version: 1,
          keyEpoch: 1,
          stateHash: "state-hash",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isCreateContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
    }),
  ).toBe(false);
  expect(isCreateContainerResponse(null)).toBe(false);
});

test("isListContainersResponse", () => {
  expect(
    isListContainersResponse([
      {
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
            version: 2,
            keyEpoch: 1,
            stateHash: "state-hash",
          },
        ],
      },
    ]),
  ).toBe(true);
  expect(
    isListContainersResponse([
      {
        id: "ctr-root",
        organizationId: "org-123",
        metadataDocumentId: "doc-root",
        metadataAccessEpoch: 1,
      },
    ]),
  ).toBe(false);
  expect(isListContainersResponse(null)).toBe(false);
});

test("isShareContainerResponse", () => {
  expect(
    isShareContainerResponse({
      id: "ctr-123",
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
      metadataAccessStateHash: "access-state-hash",
      metadataReferencedPrincipals: [
        {
          principalType: "group",
          principalId: "group-123",
          version: 1,
          keyEpoch: 1,
          stateHash: "state-hash",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isShareContainerResponse({
      id: "ctr-123",
      metadataAccessEpoch: 2,
    }),
  ).toBe(false);
  expect(isShareContainerResponse(null)).toBe(false);
});

test("isMoveContainerResponse", () => {
  expect(
    isMoveContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: "ctr-parent",
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
      metadataAccessStateHash: "access-state-hash",
    }),
  ).toBe(true);
  expect(
    isMoveContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: null,
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
    }),
  ).toBe(false);
  expect(isMoveContainerResponse(null)).toBe(false);
});

test("isListContainerDocumentsResponse", () => {
  expect(
    isListContainerDocumentsResponse([
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
          },
        ],
      },
    ]),
  ).toBe(true);
  expect(
    isListContainerDocumentsResponse([
      {
        currentAccessEpoch: 2,
        id: "doc-123",
        linkedContainerIds: ["ctr-root"],
      },
    ]),
  ).toBe(false);
  expect(isListContainerDocumentsResponse(null)).toBe(false);
});

test("isLinkDocumentToContainerResponse", () => {
  expect(
    isLinkDocumentToContainerResponse({
      createdAt: new Date().toISOString(),
      currentAccessEpoch: 2,
      currentAccessStateHash: "access-state-hash",
      id: "doc-123",
      linkedContainerIds: ["ctr-root", "ctr-child"],
    }),
  ).toBe(true);
  expect(
    isLinkDocumentToContainerResponse({
      currentAccessEpoch: 2,
      id: "doc-123",
      linkedContainerIds: ["ctr-root", "ctr-child"],
    }),
  ).toBe(false);
  expect(isLinkDocumentToContainerResponse(null)).toBe(false);
});

test("isUnlinkDocumentFromContainerResponse", () => {
  expect(
    isUnlinkDocumentFromContainerResponse({
      createdAt: new Date().toISOString(),
      currentAccessEpoch: 3,
      currentAccessStateHash: "access-state-hash",
      id: "doc-123",
      linkedContainerIds: ["ctr-root"],
    }),
  ).toBe(true);
  expect(
    isUnlinkDocumentFromContainerResponse({
      createdAt: new Date().toISOString(),
      id: "doc-123",
      linkedContainerIds: ["ctr-root"],
    }),
  ).toBe(false);
  expect(isUnlinkDocumentFromContainerResponse(null)).toBe(false);
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
      membershipMode: "projection_v1",
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
        membershipMode: "projection_v1",
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
        cipherSuite: "aes-256-gcm-v1",
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
        cipherSuite: "aes-256-gcm-v1",
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

function createDocumentV2ContentKeyBundleResponse(overrides = {}) {
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

function createDocumentV2KekTargetsResponse(overrides = {}) {
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

function createDocumentV2CreateResponse(overrides = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: new Date().toISOString(),
    accessManifest: createDocumentV2ManifestBundleResponse(),
    contentKeyBundle: createDocumentV2ContentKeyBundleResponse(),
    documentKekTargets: createDocumentV2KekTargetsResponse(),
    ...overrides,
  };
}

function createDocumentV2ManifestBundleResponse(overrides = {}) {
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

function createContainerV2KekResponse(overrides = {}) {
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

function createContainerV2WriterProjectionResponse(overrides = {}) {
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
    containerKeks: [createContainerV2KekResponse()],
    ...overrides,
  };
}

test("isDocumentV2CreateResponse", () => {
  const validResponse = createDocumentV2CreateResponse();

  expect(isDocumentV2CreateResponse(validResponse)).toBe(true);
  expect(
    isDocumentV2CreateResponse({
      ...validResponse,
      accessManifest: createDocumentV2ManifestBundleResponse({
        manifestHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentV2CreateResponse({
      ...validResponse,
      contentKeyBundle: createDocumentV2ContentKeyBundleResponse({
        contentKeyEpoch: 0,
      }),
    }),
  ).toBe(false);
  expect(isDocumentV2CreateResponse(null)).toBe(false);
});

test("isDocumentV2SyncResponse", () => {
  const validResponse = {
    acceptedOutgoingUpdateIds: ["update-1"],
    commitLsn: null,
    contentKeyBundle: createDocumentV2ContentKeyBundleResponse(),
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentKekTargets: createDocumentV2KekTargetsResponse(),
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

  expect(isDocumentV2SyncResponse(validResponse)).toBe(true);
  expect(
    isDocumentV2SyncResponse({
      ...validResponse,
      missingUpdateEpochs: ["unknown_epoch"],
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncResponse({
      ...validResponse,
      commitLsn: 123,
    }),
  ).toBe(false);
  expect(
    isDocumentV2SyncResponse({
      ...validResponse,
      updates: [{ id: "update-2" }],
    }),
  ).toBe(false);
  expect(isDocumentV2SyncResponse(null)).toBe(false);
});

test("isContainerV2WriterProjectionResponse", () => {
  const validResponse = createContainerV2WriterProjectionResponse();

  expect(isContainerV2WriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isContainerV2WriterProjectionResponse({
      ...validResponse,
      path: [{ manifestHash: "" }],
    }),
  ).toBe(false);
  expect(
    isContainerV2WriterProjectionResponse({
      ...validResponse,
      containerKeks: [],
    }),
  ).toBe(false);
  expect(
    isContainerV2WriterProjectionResponse({
      ...validResponse,
      containerKeks: [createContainerV2KekResponse({ containerKeyEpoch: 0 })],
    }),
  ).toBe(false);
  expect(isContainerV2WriterProjectionResponse(null)).toBe(false);
});

test("isDocumentV2WriterProjectionResponse", () => {
  const validResponse = {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentManifest: createDocumentV2ManifestBundleResponse(),
    documentKekTargets: createDocumentV2KekTargetsResponse(),
    contentKeyBundle: createDocumentV2ContentKeyBundleResponse(),
    authorizingContainerPaths: [createContainerV2WriterProjectionResponse()],
  };

  expect(isDocumentV2WriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isDocumentV2WriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [{ containerId: "" }],
    }),
  ).toBe(false);
  expect(
    isDocumentV2WriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [],
    }),
  ).toBe(false);
  expect(
    isDocumentV2WriterProjectionResponse({
      ...validResponse,
      contentKeyBundle: createDocumentV2ContentKeyBundleResponse({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(isDocumentV2WriterProjectionResponse(null)).toBe(false);
});
