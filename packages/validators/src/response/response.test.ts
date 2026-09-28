import { expect, test } from "bun:test";
import {
  ChallengeResponseSchema,
  ErrorResponseSchema,
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isChallengeErrorResponse,
  isChallengeResponse,
  isCompleteMultipartBlobStageResponse,
  isContainerDeleteResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isDestroySessionResponse,
  isErrorResponse,
  isHealthResponse,
  isInitiateMultipartBlobStageResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isListDocumentAttachmentsResponse,
  isListSessionsResponse,
  isMultipartBlobStageStatusResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
  isUploadMultipartBlobPartResponse,
  isUserIdentityResponse,
  isUserSessionResponse,
  isWebSocketTicketResponse,
} from "./index";

const VALID_CHALLENGE = "a".repeat(64);

test("isHealthResponse", () => {
  expect(isHealthResponse({ message: "ok" })).toBe(true);
  expect(isHealthResponse({ message: 123 })).toBe(false);
  expect(isHealthResponse({})).toBe(false);
  expect(isHealthResponse(null)).toBe(false);
});

test("isChallengeResponse", () => {
  const response = { challenge: VALID_CHALLENGE, extension: true };
  const result = ChallengeResponseSchema.safeParse(response);
  expect(result.success).toBe(true);
  expect(result.success && result.data).toBe(response);
  expect(isChallengeResponse(response)).toBe(true);
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

test("shared auth utility responses", () => {
  const errorResponse = { error: "Unauthorized", extension: true };
  const result = ErrorResponseSchema.safeParse(errorResponse);

  expect(result.success).toBe(true);
  expect(result.success && result.data).toBe(errorResponse);
  expect(isErrorResponse(errorResponse)).toBe(true);
  expect(isErrorResponse({ error: 401 })).toBe(false);
  expect(isDestroySessionResponse({ message: "ok" })).toBe(true);
  expect(isDestroySessionResponse({ message: "not-ok" })).toBe(false);
  expect(isWebSocketTicketResponse({ ticket: "ticket-1" })).toBe(true);
  expect(isWebSocketTicketResponse({ ticket: 1 })).toBe(false);
});

test("isUserIdentityResponse", () => {
  const response = {
    encapsulationKeyFingerprint: "b".repeat(64),
    encapsulationPublicKey: "encapsulation-key",
    signingKeyFingerprint: "a".repeat(64),
    signingPublicKey: "signing-key",
    userId: "user-1",
  };

  expect(isUserIdentityResponse(response)).toBe(true);
  expect(
    isUserIdentityResponse({
      ...response,
      encapsulationKeyFingerprint: "not-a-fingerprint",
    }),
  ).toBe(false);
  expect(
    isUserIdentityResponse({
      ...response,
      encapsulationKeyFingerprint: undefined,
    }),
  ).toBe(false);
});

test("session responses", () => {
  const session = {
    id: "a".repeat(64),
    createdAt: new Date().toISOString(),
    ipAddresses: ["198.51.100.10"],
    isCurrent: true,
    lastActiveAt: new Date().toISOString(),
    lastActiveIp: "198.51.100.10",
    signingKeyFingerprint: "signing-fingerprint",
  };

  expect(isUserSessionResponse(session)).toBe(true);
  expect(isListSessionsResponse({ sessions: [session] })).toBe(true);
  expect(isUserSessionResponse({ ...session, id: "not-hex" })).toBe(false);
  expect(isUserSessionResponse({ ...session, ipAddresses: [123] })).toBe(false);
  expect(isUserSessionResponse({ ...session, isCurrent: "yes" })).toBe(false);
  expect(isUserSessionResponse({ ...session, lastActiveIp: 123 })).toBe(false);
  expect(
    isListSessionsResponse({ sessions: [{ ...session, id: "bad" }] }),
  ).toBe(false);
  expect(isListSessionsResponse(null)).toBe(false);
});

test("multipart blob stage responses", () => {
  const initiated = {
    organizationId: "organization-1",
    byteLength: 12,
    expiresAt: new Date().toISOString(),
    sha256: "sha256-1",
    stageId: "stage-1",
    uploadId: "upload-1",
    uploadedParts: [{ byteLength: 6, etag: "etag-1", partNumber: 1 }],
  };

  expect(isInitiateMultipartBlobStageResponse(initiated)).toBe(true);
  expect(
    isMultipartBlobStageStatusResponse({
      ...initiated,
      completed: false,
    }),
  ).toBe(true);
  expect(
    isUploadMultipartBlobPartResponse({
      part: { byteLength: 6, etag: "etag-1", partNumber: 1 },
      stageId: "stage-1",
      uploadId: "upload-1",
    }),
  ).toBe(true);
  expect(
    isCompleteMultipartBlobStageResponse({
      organizationId: "organization-1",
      byteLength: 12,
      expiresAt: new Date().toISOString(),
      sha256: "sha256-1",
      stageId: "stage-1",
    }),
  ).toBe(true);

  expect(
    isInitiateMultipartBlobStageResponse({
      ...initiated,
      uploadedParts: [{ byteLength: 0, etag: "etag-1", partNumber: 1 }],
    }),
  ).toBe(false);
  expect(isMultipartBlobStageStatusResponse(initiated)).toBe(false);
  expect(isUploadMultipartBlobPartResponse(null)).toBe(false);
  expect(isCompleteMultipartBlobStageResponse(null)).toBe(false);
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
    bindingEvent: { body: {}, event: {}, eventHash: "event-hash" },
    documentManifestHash: "document-manifest-hash",
    previousBindingId: null,
    writeHeader: {},
    writeAuthorization: createBlobKekTargetsResponse(),
    bindingId: "550e8400-e29b-41d4-a716-446655440002",
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    documentId: "550e8400-e29b-41d4-a716-446655440003",
    slotId: "slot-a",
    contentKeyBundle: createBlobContentKeyBundleResponse(),
    blobKekTargets: createBlobKekTargetsResponse(),
    writeHeaderHash: "write-header-hash",
  };

  expect(isBlobAttachmentBindResponse(validResponse)).toBe(true);
  for (const key of [
    "bindingEvent",
    "documentManifestHash",
    "previousBindingId",
    "writeHeader",
    "writeAuthorization",
    "writeHeaderHash",
  ]) {
    const missingEvidence = { ...validResponse };
    Reflect.deleteProperty(missingEvidence, key);
    expect(isBlobAttachmentBindResponse(missingEvidence)).toBe(false);
  }
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

test("isListDocumentAttachmentsResponse", () => {
  const validAttachment = {
    bindingEvent: { body: {}, event: {}, eventHash: "event-hash" },
    documentManifestHash: "document-manifest-hash",
    previousBindingId: null,
    writeHeader: {},
    writeAuthorization: createBlobKekTargetsResponse(),
    blobKekTargets: createBlobKekTargetsResponse(),
    bindingId: "550e8400-e29b-41d4-a716-446655440002",
    blobId: "550e8400-e29b-41d4-a716-446655440001",
    contentKeyBundle: createBlobContentKeyBundleResponse(),
    slotId: "slot-a",
  };
  const validResponse = [validAttachment];

  expect(isListDocumentAttachmentsResponse(validResponse)).toBe(true);
  expect(
    isListDocumentAttachmentsResponse([
      {
        ...validAttachment,
        contentKeyBundle: createBlobContentKeyBundleResponse({
          contentKeyEpoch: 0,
        }),
      },
    ]),
  ).toBe(false);
  expect(
    isListDocumentAttachmentsResponse([
      {
        ...validAttachment,
        contentKeyBundle: undefined,
      },
    ]),
  ).toBe(false);
  expect(isListDocumentAttachmentsResponse(null)).toBe(false);
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
          effectiveAccessLevel: "admin",
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
          effectiveAccessLevel: "write",
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
          createdAt: new Date().toISOString(),
          currentAccessEpoch: 2,
          currentAccessStateHash: "access-state-hash",
          effectiveAccessLevel: "write",
          id: "doc-123",
          linkedContainerIds: ["ctr-root"],
          updatedAt: new Date().toISOString(),
        },
      ],
      nextWatermark: null,
      tombstones: [],
    }),
  ).toBe(false);
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
      grantCount: 0,
      grantRoot: "grant-root",
      membershipMode: "projection",
      membershipRoot: "root",
      memberEnvelopesRoot: "member-envelopes-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      memberCount: 1,
      externalAuthority: null,
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
          userId: "user-234",
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
        grantCount: 0,
        grantRoot: "grant-root",
        membershipMode: "projection",
        membershipRoot: "root",
        memberEnvelopesRoot: "member-envelopes-root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
        externalAuthority: null,
        signedAt: new Date().toISOString(),
        signerUserId: "user-1",
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
        stateHash: "state-hash",
        createdAt: new Date().toISOString(),
      },
      currentProjection: [
        {
          userId: "user-1",
          role: "admin",
        },
      ],
      currentGrants: [],
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
