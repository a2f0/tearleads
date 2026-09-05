import { expect, test } from "bun:test";
import {
  ChallengeResponseSchema,
  ContainerWriterProjectionResponseSchema,
  DocumentWriterProjectionResponseSchema,
  ErrorResponseSchema,
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isChallengeErrorResponse,
  isChallengeResponse,
  isCompleteMultipartBlobStageResponse,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isDestroySessionResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  isErrorResponse,
  isHealthResponse,
  isInitiateMultipartBlobStageResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isListDocumentAttachmentsResponse,
  isListOrganizationGroupsResponse,
  isListSessionsResponse,
  isMultipartBlobStageStatusResponse,
  isOrganizationContainerGrantsResponse,
  isOrganizationDirectoryResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationUserDetailResponse,
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

test("organization manager responses", () => {
  expect(
    isOrganizationDirectoryResponse({
      organizationId: "org-1",
      profileDocumentId: null,
      currentUser: { isOrgAdmin: true },
      users: [
        {
          userId: "user-1",
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey: "signing-key",
          encapsulationPublicKey: "encapsulation-key",
          encapsulationKeyFingerprint: "encapsulation-fingerprint",
          createdAt: new Date().toISOString(),
          isSelf: true,
          status: "active",
          profileDocumentId: null,
          joinedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          disabledAt: null,
          disabledByUserId: null,
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationDirectoryResponse({
      organizationId: "org-1",
      currentUser: { isOrgAdmin: false },
      users: [{ userId: "user-1" }],
    }),
  ).toBe(false);
  expect(
    isOrganizationProfileResponse({
      organizationId: "org-1",
      profileDocumentId: "profile-document-1",
    }),
  ).toBe(true);
  expect(isOrganizationProfileResponse({ organizationId: "org-1" })).toBe(
    false,
  );

  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      memberGroupId: "member-group-1",
      groups: [
        {
          groupId: "group-1",
          organizationId: "org-1",
          name: "Operators",
          createdAt: new Date().toISOString(),
          isBuiltin: false,
          currentState: {
            stateHash: "state-hash",
            version: 1,
            keyEpoch: 1,
            keyFingerprint: "key-fingerprint",
            memberCount: 1,
          },
        },
      ],
    }),
  ).toBe(true);
  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      groups: [],
    }),
  ).toBe(false);
  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      groups: [{ groupId: "group-1", currentState: { memberCount: -1 } }],
    }),
  ).toBe(false);

  expect(
    isOrganizationGroupMembersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      members: [
        {
          userId: "user-1",
          role: "admin",
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey: "signing-key",
          encapsulationPublicKey: "encapsulation-key",
          encapsulationKeyFingerprint: "encapsulation-fingerprint",
        },
      ],
    }),
  ).toBe(true);
  expect(isOrganizationGroupMembersResponse(null)).toBe(false);

  expect(
    isOrganizationGroupContainersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      containers: [
        {
          accessLevel: "admin",
          containerId: "container-1",
          createdAt: new Date().toISOString(),
          depth: 0,
          isBuiltin: false,
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "access-state-hash",
          metadataDocumentId: "metadata-document-1",
          parentId: null,
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationGroupContainersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      containers: [{ containerId: "container-1", accessLevel: "owner" }],
    }),
  ).toBe(false);

  expect(
    isOrganizationContainerGrantsResponse({
      organizationId: "org-1",
      grants: [
        {
          accessLevel: "admin",
          containerId: "container-1",
          createdAt: new Date().toISOString(),
          depth: 0,
          isBuiltin: true,
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "access-state-hash",
          metadataDocumentId: "metadata-document-1",
          parentId: null,
          updatedAt: new Date().toISOString(),
          subjectType: "group",
          subjectId: "group-1",
          userId: null,
          signingKeyFingerprint: null,
          groupId: "group-1",
          groupName: "Admins",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationContainerGrantsResponse({
      organizationId: "org-1",
      grants: [{ containerId: "container-1", subjectType: "team" }],
    }),
  ).toBe(false);

  expect(
    isOrganizationUserDetailResponse({
      organizationId: "org-1",
      user: {
        userId: "user-1",
        signingKeyFingerprint: "signing-fingerprint",
        signingPublicKey: "signing-key",
        encapsulationPublicKey: "encapsulation-key",
        encapsulationKeyFingerprint: "encapsulation-fingerprint",
        createdAt: new Date().toISOString(),
        isSelf: true,
        status: "disabled",
        profileDocumentId: "profile-document-1",
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        disabledAt: new Date().toISOString(),
        disabledByUserId: "admin-1",
      },
      groups: [
        {
          groupId: "group-1",
          organizationId: "org-1",
          name: "Operators",
          createdAt: new Date().toISOString(),
          isBuiltin: false,
          currentState: null,
        },
      ],
      grants: {
        directGrants: [],
        groupGrants: [
          {
            accessLevel: "admin",
            containerId: "container-1",
            createdAt: new Date().toISOString(),
            depth: 0,
            isBuiltin: true,
            metadataAccessEpoch: 1,
            metadataAccessStateHash: "access-state-hash",
            metadataDocumentId: "metadata-document-1",
            parentId: null,
            updatedAt: new Date().toISOString(),
            subjectType: "group",
            subjectId: "group-1",
            userId: null,
            signingKeyFingerprint: null,
            groupId: "group-1",
            groupName: "Admins",
          },
        ],
      },
    }),
  ).toBe(true);
  expect(
    isOrganizationUserDetailResponse({
      organizationId: "org-1",
      user: { userId: "user-1" },
      groups: [],
      grants: {
        directGrants: [],
        groupGrants: [],
      },
    }),
  ).toBe(false);
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
    containerManifestHistory: [],
    parentContainerKeyEpochId: null,
    keyring: null,
    recipientTargets: [{ recipientKind: "user" }],
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

function createContainerMutationResponse(overrides = {}) {
  return {
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    createdAt: new Date().toISOString(),
    organizationId: "550e8400-e29b-41d4-a716-446655440099",
    parentId: "550e8400-e29b-41d4-a716-446655440098",
    updatedAt: new Date().toISOString(),
    manifestHead: {
      epoch: 1,
      manifestHash: "container-manifest-hash",
    },
    accessManifest: {
      event: {
        event: { eventType: "container.create" },
        body: { eventType: "container.create" },
        eventHash: "container-event-hash",
      },
      manifest: { objectType: "container" },
      manifestHash: "container-manifest-hash",
      state: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
    },
    containerKek: createContainerKekResponse(),
    referencedPrincipalHeads: [],
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

test("isContainerCreateWithMetadataDocumentResponse", () => {
  const validResponse = {
    container: createContainerMutationResponse(),
    metadataDocument: createDocumentCreateResponse(),
  };

  expect(isContainerMutationResponse(validResponse.container)).toBe(true);
  expect(isContainerCreateWithMetadataDocumentResponse(validResponse)).toBe(
    true,
  );
  expect(
    isContainerCreateWithMetadataDocumentResponse({
      ...validResponse,
      container: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
    }),
  ).toBe(false);
  expect(
    isContainerCreateWithMetadataDocumentResponse({
      ...validResponse,
      metadataDocument: { id: "550e8400-e29b-41d4-a716-446655440001" },
    }),
  ).toBe(false);
  expect(isContainerCreateWithMetadataDocumentResponse(null)).toBe(false);
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
    commitLsnMode: "tracked",
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    contentKeyBundles: [createDocumentContentKeyBundleResponse()],
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentKekTargets: createDocumentKekTargetsResponse(),
    pullPage: { hasMore: false, nextCursor: null },
    updates: [
      {
        accessEpoch: 1,
        id: "update-2",
        authorizationTargets: createDocumentContentKeyBundleResponse().targets,
        documentId: "550e8400-e29b-41d4-a716-446655440001",
        authorFingerprint: "author-fingerprint",
        encryptedData: "ciphertext",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"actor":1}',
        plaintextHash: "plaintext-hash",
        createdAt: new Date().toISOString(),
        writeHeader: { objectKind: "document" },
      },
    ],
  };

  expect(isDocumentSyncResponse(validResponse)).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      commitLsn: 123,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      contentKeyBundles: [
        createDocumentContentKeyBundleResponse({ targetHash: "" }),
      ],
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
  const validResponse = {
    ...createContainerWriterProjectionResponse(),
    extension: true,
  };

  const result =
    ContainerWriterProjectionResponseSchema.safeParse(validResponse);
  expect(result.success && result.data).toBe(validResponse);
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
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [createContainerKekResponse({ containerKeyEpoch: 2 })],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [
        createContainerKekResponse({
          keyring: {
            containerId: "container-id",
            containerKeyEpochId: "container-key-epoch-id",
            iv: "iv",
            sealed: "sealed",
            sealingSuite: "aes-256-gcm",
            version: 1,
          },
        }),
      ],
    }),
  ).toBe(false);
  expect(isContainerWriterProjectionResponse(null)).toBe(false);
});

test("isDocumentWriterProjectionResponse", () => {
  const validResponse = {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentManifest: createDocumentManifestBundleResponse(),
    documentManifestHistory: [],
    documentManifestContainerPaths: [],
    documentContainerManifestHistory: [],
    documentKekTargets: createDocumentKekTargetsResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
    extension: true,
  };

  const result =
    DocumentWriterProjectionResponseSchema.safeParse(validResponse);
  expect(result.success && result.data).toBe(validResponse);
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
