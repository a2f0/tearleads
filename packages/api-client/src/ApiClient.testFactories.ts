import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export function createContainerMutationRequest(): ContainerMutationRequest {
  return {
    event: { eventType: "container.create" },
    body: { eventType: "container.create" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectKind: "container" },
    keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
    wraps: [],
  };
}

export function createContainerCreateWithMetadataDocumentRequest(): ContainerCreateWithMetadataDocumentRequest {
  return {
    container: createContainerMutationRequest(),
    metadataDocument: createDocumentCreateRequest(),
  };
}

export function createContainerMutationResponse() {
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
      keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
      keyEpochHash: "key-epoch-hash",
      keyTargetHash: "key-target-hash",
      parentContainerKeyEpochId: null,
      recipientTargets: [{ recipientKind: "user" }],
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    },
    referencedPrincipalHeads: [],
  };
}

export function createContainerDeleteResponse() {
  return {
    containerId: "container-1",
    deletedAt: "2026-05-06T18:00:00.000Z",
  };
}

export function createContainerWriterProjectionResponse() {
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
    previousManifest: {
      event: { eventType: "document.link" },
      manifest: { objectKind: "document" },
      manifestHash: "previous-document-manifest-hash",
      state: { documentId: "document-1" },
    },
    targetContainerPath: [{ manifestHash: "container-manifest-hash" }],
    authorizingContainerPaths: [[{ manifestHash: "container-manifest-hash" }]],
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

export function createDocumentLinkSetMutationResponse() {
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
    targetContainerPath: [{ manifestHash: "container-manifest-hash" }],
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

export function createDocumentCreateResponse() {
  return {
    ...createDocumentLinkSetMutationResponse(),
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

export function createContainerCreateWithMetadataDocumentResponse() {
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
      membershipMode: "projection",
      membershipRoot: "membership-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "payload-ciphertext-hash",
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
        memberPrincipalType: "user",
        memberPrincipalId: "user-1",
        role: "admin",
      },
    ],
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
  };
}

export function createDocumentSyncResponse() {
  const mutationResponse = createDocumentLinkSetMutationResponse();

  return {
    acceptedOutgoingUpdateIds: [],
    commitLsn: "0/16B6C50",
    contentKeyBundle: mutationResponse.contentKeyBundle,
    documentId: mutationResponse.id,
    documentKekTargets: mutationResponse.documentKekTargets,
    missingUpdateEpochs: [],
    updates: [],
  };
}

export function createBlobAttachmentBindRequest(): BlobAttachmentBindRequest {
  return {
    authorizingContainerPaths: [],
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
    documentManifest: {
      event: {},
      manifest: {},
      manifestHash: "blob-manifest-hash",
      state: {},
    },
    event: {},
  };
}

export function createBlobAttachmentDetachRequest(): BlobAttachmentDetachRequest {
  return {
    authorizingContainerPaths: [],
    body: {},
    documentManifest: {
      event: {},
      manifest: {},
      manifestHash: "blob-manifest-hash",
      state: {},
    },
    event: {},
  };
}

export function createBlobAttachmentBindResponse() {
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

export function createDocumentWriterProjectionResponse() {
  const mutationResponse = createDocumentLinkSetMutationResponse();

  return {
    documentId: mutationResponse.id,
    documentManifest: mutationResponse.accessManifest,
    documentKekTargets: mutationResponse.documentKekTargets,
    contentKeyBundle: mutationResponse.contentKeyBundle,
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
  };
}

export function createPrincipalStateRequest(): PutPrincipalStateRequest {
  return {
    state: {
      principalType: "group",
      principalId: "550e8400-e29b-41d4-a716-446655440001",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
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
        memberPrincipalType: "user",
        memberPrincipalId: "550e8400-e29b-41d4-a716-446655440002",
        role: "admin",
      },
    ],
  };
}

export function createPrincipalMemberEnvelopesRequest(): PutPrincipalMemberEnvelopesRequest {
  return {
    stateHash: "state-hash",
    envelopes: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: "550e8400-e29b-41d4-a716-446655440002",
        memberKeyFingerprint: "member-fingerprint",
        kemCipherText: "kem-ciphertext",
        wrappedKey: "wrapped-key",
      },
    ],
  };
}

export function createOrganizationGroupRequest(): CreateOrganizationGroupRequest {
  const stateRequest = createPrincipalStateRequest();

  return {
    groupId: stateRequest.state.principalId,
    name: "Operators",
    initialGroupPolicy: {
      ...stateRequest,
      memberEnvelopes: createPrincipalMemberEnvelopesRequest().envelopes,
    },
  };
}

export function createEncapsulationKeyResponse(userId: string) {
  return {
    encapsulationPublicKey: "encapsulation-key",
    signingKeyFingerprint: "a".repeat(64),
    signingPublicKey: "signing-key",
    userId,
  };
}

export function createOrganizationGroupSummary(organizationId: string) {
  return {
    groupId: "group-1",
    organizationId,
    name: "Operators",
    createdAt: "2026-05-12T12:00:00.000Z",
    isBuiltin: false,
    currentState: null,
  };
}
