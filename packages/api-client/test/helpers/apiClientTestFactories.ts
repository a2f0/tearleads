import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentPurgeRequest,
  DocumentSyncRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import type {
  BlobAttachmentBindResponse,
  ContainerCreateWithMetadataDocumentResponse,
  ContainerDeleteResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentPurgeResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
  UserIdentityResponse,
} from "@symcrypt/validators/response";

export function createContainerMutationRequest(): ContainerMutationRequest {
  return {
    event: { eventType: "container.create" },
    body: { eventType: "container.create" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectKind: "container" },
    keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
    predecessorBridge: null,
    keyring: null,
    principalPolicies: [],
    wraps: [],
  };
}

export function createContainerCreateWithMetadataDocumentRequest(): ContainerCreateWithMetadataDocumentRequest {
  return {
    container: createContainerMutationRequest(),
    metadataDocument: createDocumentCreateRequest(),
  };
}

export function createContainerMutationResponse(): ContainerMutationResponse {
  return {
    containerId: "container-1",
    createdAt: "2026-05-06T18:00:00.000Z",
    organizationId: "organization-1",
    parentId: "parent-1",
    updatedAt: "2026-05-06T18:00:00.000Z",
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
      manifest: { objectKind: "container" },
      manifestHash: "container-manifest-hash",
      state: { containerId: "container-1" },
    },
    containerKek: {
      containerId: "container-1",
      accessManifestHash: "container-manifest-hash",
      containerKeyEpochId: "container-key-epoch-id",
      containerKeyEpoch: 1,
      keyring: null,
      keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
      keyEpochHash: "key-epoch-hash",
      keyTargetHash: "key-target-hash",
      containerManifestHistory: [],
      parentContainerKeyEpochId: null,
      recipientTargets: [{ recipientKind: "user" }],
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    },
    referencedPrincipalHeads: [],
  };
}

export function createContainerDeleteResponse(): ContainerDeleteResponse {
  return {
    containerId: "container-1",
    deletedAt: "2026-05-06T18:00:00.000Z",
  };
}

export function createContainerWriterProjectionResponse(): ContainerWriterProjectionResponse {
  const mutationResponse = createContainerMutationResponse();

  return {
    containerId: mutationResponse.containerId,
    organizationId: mutationResponse.organizationId,
    path: [mutationResponse.accessManifest],
    containerKeks: [mutationResponse.containerKek],
  };
}

export function createDocumentLinkSetMutationRequest(): DocumentLinkSetMutationRequest {
  return {
    event: { eventType: "document.link" },
    body: { eventType: "document.link" },
    expectedManifestHash: "document-manifest-hash",
    manifest: { objectKind: "document" },
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
  };
}

export function createDocumentPurgeRequest(): DocumentPurgeRequest {
  return {
    authorizingContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    body: { eventType: "document.purge" },
    event: { eventType: "document.purge" },
  };
}

export function createDocumentPurgeResponse(): DocumentPurgeResponse {
  const authorizingContainer = createContainerMutationResponse().accessManifest;
  return {
    authorizingContainerPath: [authorizingContainer],
    documentContainerManifestHistory: [],
    documentId: "document-1",
    documentManifest: {
      event: {
        body: { eventType: "document.link" },
        event: { eventType: "document.link" },
        eventHash: "document-link-event-hash",
      },
      manifest: { objectKind: "document" },
      manifestHash: "document-manifest-hash",
      state: { documentId: "document-1" },
    },
    documentManifestContainerPaths: [],
    documentManifestPredecessors: [],
    principalPolicySnapshots: [],
    purgeEvent: {
      body: { eventType: "document.purge" },
      event: { eventType: "document.purge" },
      eventHash: "document-purge-event-hash",
    },
    purgedAt: "2026-07-14T12:00:00.000Z",
    reclaimedBlobStorageKeys: [],
  };
}

export function createDocumentLinkSetMutationResponse(): DocumentLinkSetMutationResponse {
  return {
    id: "document-1",
    accessManifest: {
      event: {
        event: { eventType: "document.link" },
        body: { eventType: "document.link" },
        eventHash: "document-event-hash",
      },
      manifest: { objectKind: "document" },
      manifestHash: "document-manifest-hash",
      state: { documentId: "document-1" },
    },
    contentKeyBundle: {
      documentId: "document-1",
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
    documentKekTargets: {
      documentId: "document-1",
      linkSetManifestHash: "document-manifest-hash",
      linkedContainerManifestHashes: ["container-manifest-hash"],
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
        },
      ],
      documentKeyTargetHash: "target-hash",
    },
  };
}

export function createDocumentCreateRequest(): DocumentCreateRequest {
  return {
    event: { eventType: "document.link" },
    body: { eventType: "document.link" },
    expectedManifestHash: "document-manifest-hash",
    manifest: { objectKind: "document" },
    previousManifest: null,
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
  };
}

export function createDocumentCreateResponse(): DocumentCreateResponse {
  return {
    ...createDocumentLinkSetMutationResponse(),
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

export function createContainerCreateWithMetadataDocumentResponse(): ContainerCreateWithMetadataDocumentResponse {
  return {
    container: createContainerMutationResponse(),
    metadataDocument: createDocumentCreateResponse(),
  };
}

export function createPrincipalPolicyBundleResponse(): PrincipalPolicyBundleResponse {
  return {
    currentState: {
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: "previous-state-hash",
      keyEpoch: 2,
      encapsulationPublicKey: "principal-public-key",
      keyFingerprint: "principal-key-fingerprint",
      grantCount: 0,
      grantRoot: "grant-root",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      memberEnvelopesRoot: "member-envelopes-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "payload-ciphertext-hash",
      externalAuthority: null,
      memberCount: 1,
      signedAt: "2026-06-21T12:00:00.000Z",
      signerUserId: "user-1",
      signerUserKeyFingerprint: "signer-key-fingerprint",
      signature: "signature",
      stateHash: "state-hash",
      createdAt: "2026-06-21T12:00:00.000Z",
    },
    currentPayload: {
      principalType: "group",
      principalId: "group-1",
      stateHash: "state-hash",
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: "payload-ciphertext-hash",
      createdAt: "2026-06-21T12:00:00.000Z",
    },
    currentProjection: [
      {
        userId: "user-1",
        role: "admin",
      },
    ],
    currentGrants: [],
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: "group-1",
      stateHash: "state-hash",
      epoch: 2,
      envelopes: [],
    },
    previousStates: [],
  };
}

export function createDocumentSyncRequest(): DocumentSyncRequest {
  return {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-manifest-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  };
}

export function createDocumentSyncResponse(): DocumentSyncResponse {
  const mutationResponse = createDocumentLinkSetMutationResponse();

  return {
    acceptedOutgoingUpdateIds: [],
    commitLsn: "0/16B6C50",
    contentKeyBundle: mutationResponse.contentKeyBundle,
    contentKeyBundles: [mutationResponse.contentKeyBundle],
    documentId: mutationResponse.id,
    documentKekTargets: mutationResponse.documentKekTargets,
    pullPage: { hasMore: false, nextCursor: null },
    updates: [],
  };
}

export function createBlobAttachmentBindRequest(): BlobAttachmentBindRequest {
  return {
    authorizingContainerPathRefs: [],
    body: {},
    contentKeyBundle: {
      contentKeyEpoch: 1,
      targetHash: "blob-target-hash",
      targets: [
        {
          bindingId: "binding-1",
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-id",
          containerManifestHash: "container-manifest-hash",
          documentId: "document-1",
          wrappedKey: "wrapped-key",
          wrappingMetadata: {},
        },
      ],
    },
    event: {},
  };
}

export function createBlobAttachmentDetachRequest(): BlobAttachmentDetachRequest {
  return {
    authorizingContainerPathRefs: [],
    body: {},
    event: {},
  };
}

export function createBlobAttachmentBindResponse(): BlobAttachmentBindResponse {
  return {
    bindingId: "binding-1",
    blobId: "blob-1",
    blobKekTargets: {
      activeBindingIds: ["binding-1"],
      blobAccessManifestHash: "blob-manifest-hash",
      blobId: "blob-1",
      blobKeyTargetHash: "blob-target-hash",
      documentManifestHashes: ["blob-manifest-hash"],
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      linkedContainerManifestHashes: ["container-manifest-hash"],
      organizationId: "organization-1",
      targets: [],
    },
    contentKeyBundle: {
      blobId: "blob-1",
      contentKeyEpoch: 1,
      targetHash: "blob-target-hash",
      targets: [
        {
          bindingId: "binding-1",
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-id",
          containerManifestHash: "container-manifest-hash",
          documentId: "document-1",
          wrappedKey: "wrapped-key",
          wrappingMetadata: {},
        },
      ],
    },
    documentId: "document-1",
    slotId: "slot-a",
  };
}

export function createDocumentWriterProjectionResponse(): DocumentWriterProjectionResponse {
  const mutationResponse = createDocumentLinkSetMutationResponse();

  return {
    documentId: mutationResponse.id,
    documentManifest: mutationResponse.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [],
    documentContainerManifestHistory: [],
    documentKekTargets: mutationResponse.documentKekTargets,
    contentKeyBundle: mutationResponse.contentKeyBundle,
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
  };
}

export function createPrincipalPolicyRequest(): PutPrincipalPolicyRequest {
  return {
    state: {
      principalType: "group",
      principalId: "550e8400-e29b-41d4-a716-446655440001",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      grantCount: 0,
      grantRoot: "grant-root",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      memberEnvelopesRoot: "member-envelopes-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      externalAuthority: null,
      memberCount: 1,
      signedAt: "2026-05-12T12:00:00.000Z",
      signerUserId: "550e8400-e29b-41d4-a716-446655440002",
      signerUserKeyFingerprint: "signing-fingerprint",
      signature: "signature",
    },
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    projection: [
      {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        role: "admin",
      },
    ],
    grants: [],
    memberEnvelopes: [
      {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        memberKeyFingerprint: "member-fingerprint",
        kemCipherText: "kem-ciphertext",
        wrappedKey: "wrapped-key",
      },
    ],
  };
}

export function createOrganizationGroupRequest(): CreateOrganizationGroupRequest {
  const policyRequest = createPrincipalPolicyRequest();

  return {
    groupId: policyRequest.state.principalId,
    name: "Operators",
    initialGroupPolicy: policyRequest,
  };
}

export function createUserIdentityResponse(
  userId: string,
): UserIdentityResponse {
  return {
    encapsulationKeyFingerprint: "b".repeat(64),
    encapsulationPublicKey: "encapsulation-key",
    signingKeyFingerprint: "a".repeat(64),
    signingPublicKey: "signing-key",
    userId,
  };
}
