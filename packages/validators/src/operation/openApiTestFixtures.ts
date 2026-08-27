export const SYNC_PATH = "/documents/{documentId}/sync";
const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440111";

export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function createAccessManifestBundle() {
  return {
    event: {
      body: { eventType: "container.create" },
      event: { signature: "signed-event" },
      eventHash: "event-hash",
    },
    manifest: { containerId: "container-1" },
    manifestHash: "manifest-hash",
    state: { epoch: 1 },
  };
}

export function createContainerMutation() {
  return {
    body: { containerId: "container-1" },
    event: { signature: "signed-event" },
    expectedManifestHash: "manifest-hash",
    futureContainerMutationField: true,
    keyEpoch: { epoch: 1 },
    keyring: null,
    manifest: { containerId: "container-1" },
    predecessorBridge: null,
    principalPolicies: [],
    wraps: [],
  };
}

export function createContainerMutationResponse() {
  return {
    accessManifest: createAccessManifestBundle(),
    containerId: "container-1",
    containerKek: createContainerWriterProjectionResponse().containerKeks[0],
    createdAt: "2026-08-06T00:00:00.000Z",
    manifestHead: { epoch: 1, manifestHash: "manifest-hash" },
    organizationId: "organization-1",
    parentId: "parent-1",
    referencedPrincipalHeads: [],
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

export function createContainerDeleteResponse() {
  return {
    containerId: "container-1",
    deletedAt: "2026-08-06T00:00:00.000Z",
  };
}

export function createContainerWithMetadataDocumentRequest() {
  return {
    container: createContainerMutation(),
    metadataDocument: {
      body: { documentId: "document-1" },
      contentKeyBundle: {
        contentKeyEpoch: 1,
        linkSetManifestHash: "document-manifest-hash",
        targetHash: "target-hash",
        targets: [],
      },
      event: { signature: "signed-event" },
      expectedManifestHash: "document-manifest-hash",
      manifest: { documentId: "document-1" },
    },
  };
}

export function createContainerWithMetadataDocumentResponse() {
  const contentKeyBundle = createContentKeyBundleResponse();
  return {
    container: createContainerMutationResponse(),
    metadataDocument: {
      accessManifest: createAccessManifestBundle(),
      contentKeyBundle,
      createdAt: "2026-08-06T00:00:00.000Z",
      documentKekTargets: {
        documentId: "document-1",
        documentKeyTargetHash: contentKeyBundle.targetHash,
        linkedContainerKeyEpochIds: ["container-key-epoch-id"],
        linkedContainerManifestHashes: ["manifest-hash"],
        linkSetManifestHash: contentKeyBundle.linkSetManifestHash,
        targets: [{ containerId: "container-1" }],
      },
      id: "document-1",
    },
  };
}

function createDocumentContentKeyBundleRequest() {
  return {
    contentKeyEpoch: 1,
    linkSetManifestHash: "link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        containerManifestHash: "manifest-hash",
        wrappedKey: "wrapped-key",
        wrappingMetadata: { algorithm: "test" },
      },
    ],
  };
}

export function createDocumentCreateRequest() {
  return {
    body: { documentId: "document-1" },
    contentKeyBundle: createDocumentContentKeyBundleRequest(),
    event: { signature: "signed-event" },
    expectedManifestHash: "document-manifest-hash",
    futureDocumentCreateField: true,
    manifest: { documentId: "document-1" },
  };
}

export function createDocumentCreateResponse() {
  return createContainerWithMetadataDocumentResponse().metadataDocument;
}

export function createDocumentLinkSetMutationRequest() {
  return {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "manifest-hash" }],
    ],
    body: { documentId: "document-1" },
    contentKeyBundle: createDocumentContentKeyBundleRequest(),
    event: { signature: "signed-event" },
    expectedManifestHash: "document-manifest-hash",
    futureDocumentLinkField: true,
    manifest: { documentId: "document-1" },
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "manifest-hash" },
    ],
  };
}

export function createDocumentLinkSetMutationResponse() {
  const contentKeyBundle = createContentKeyBundleResponse();
  return {
    accessManifest: createAccessManifestBundle(),
    contentKeyBundle,
    documentKekTargets: {
      documentId: "document-1",
      documentKeyTargetHash: contentKeyBundle.targetHash,
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      linkedContainerManifestHashes: ["manifest-hash"],
      linkSetManifestHash: contentKeyBundle.linkSetManifestHash,
      targets: [{ containerId: "container-1" }],
    },
    id: "document-1",
  };
}

export function createDocumentPurgeResponse() {
  return {
    ...createDocumentPurgeProofResponse(),
    reclaimedBlobStorageKeys: ["blobs/document-1"],
  };
}

export function createDocumentPurgeProofResponse() {
  const authorizingContainer = createAccessManifestBundle();
  const documentManifestBundle = createAccessManifestBundle();
  const documentManifest = {
    manifest: documentManifestBundle.manifest,
    manifestHash: "document-manifest-hash",
    state: documentManifestBundle.state,
  };
  return {
    authorizingContainerCheckpointHeads: [authorizingContainer],
    authorizingContainerPath: [authorizingContainer],
    documentContainerManifestHistory: [],
    documentId: "document-1",
    documentManifest,
    documentManifestPredecessors: [],
    purgeEvent: {
      body: { eventType: "document.purge" },
      event: { signature: "signed-purge-event" },
      eventHash: "purge-event-hash",
    },
    purgedAt: "2026-08-06T00:00:00.000Z",
  };
}

export function createDocumentPurgeRequest() {
  return {
    authorizingContainerPathRefs: [
      { containerId: "container-1", manifestHash: "manifest-hash" },
    ],
    body: { eventType: "document.purge" },
    event: { signature: "signed-purge-event" },
  };
}

export function createSyncRequest() {
  return {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "manifest-hash" }],
    ],
    containerRekeys: [createContainerMutation()],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "link-set-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-id",
          containerManifestHash: "manifest-hash",
          wrappedKey: "wrapped-key",
          wrappingMetadata: { algorithm: "test" },
        },
      ],
    },
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "link-set-hash",
    expectedTargetHash: "target-hash",
    futureRequestField: true,
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      {
        encryptedData: "ciphertext",
        futureUpdateField: true,
        id: UPDATE_ID,
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: { updateId: UPDATE_ID },
      },
    ],
    supportsPullPagination: true as const,
  };
}

function createContentKeyBundleResponse() {
  return {
    contentKeyEpoch: 1,
    documentId: "document-1",
    linkSetManifestHash: "link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        containerManifestHash: "manifest-hash",
        wrappedKey: "wrapped-key",
        wrappingMetadata: { algorithm: "test" },
      },
    ],
  };
}

export function createContainerWriterProjectionResponse() {
  return {
    containerId: "container-1",
    containerKeks: [
      {
        accessManifestHash: "manifest-hash",
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        containerManifestHistory: [],
        keyEpoch: { epoch: 1 },
        keyEpochHash: "key-epoch-hash",
        keyring: null,
        keyTargetHash: "key-target-hash",
        parentContainerKeyEpochId: null,
        recipientTargets: [{ recipientKind: "user" }],
        wraps: [{ wrappedKey: "wrapped-key" }],
      },
    ],
    organizationId: "organization-1",
    path: [createAccessManifestBundle()],
  };
}

export function createContainerKekLogResponse() {
  return {
    containerId: "container-1",
    epochs: [
      {
        accessManifestHash: "manifest-hash",
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: [],
      },
    ],
    hasMore: false,
  };
}

export function createContainerKekLogKeyring(containerKeyEpochId: string) {
  return {
    containerId: "container-1",
    containerKeyEpochId,
    iv: "iv",
    sealed: "sealed",
    sealingSuite: "test-suite",
    version: 1,
  };
}

export function createListContainerDocumentsResponse() {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

export function createListContainerParentLanesRequest() {
  return {
    lanes: [
      {
        laneId: "root",
        parentId: null,
        watermark: null,
      },
    ],
  };
}

export function createListContainerParentLanesResponse() {
  return {
    results: [
      {
        laneId: "root",
        page: {
          hasMore: false,
          items: [],
          nextWatermark: null,
          tombstones: [],
        },
      },
    ],
  };
}

export function createDocumentWriterProjectionResponse() {
  return {
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
    contentKeyBundle: createContentKeyBundleResponse(),
    documentContainerManifestHistory: [],
    documentId: "document-1",
    documentKekTargets: {
      documentId: "document-1",
      documentKeyTargetHash: "target-hash",
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      linkedContainerManifestHashes: ["manifest-hash"],
      linkSetManifestHash: "link-set-hash",
      targets: [{ containerId: "container-1" }],
    },
    documentManifest: createAccessManifestBundle(),
    documentManifestContainerPaths: [],
    documentManifestHistory: [],
  };
}

export function createSyncResponse() {
  return {
    acceptedOutgoingUpdateIds: [UPDATE_ID],
    commitLsn: null,
    contentKeyBundle: createContentKeyBundleResponse(),
    contentKeyBundles: [createContentKeyBundleResponse()],
    documentId: "document-1",
    documentKekTargets: {
      documentId: "document-1",
      documentKeyTargetHash: "target-hash",
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      linkedContainerManifestHashes: ["manifest-hash"],
      linkSetManifestHash: "link-set-hash",
      targets: [{ containerId: "container-1" }],
    },
    futureResponseField: true,
    pullPage: { hasMore: false, nextCursor: null },
    updates: [
      {
        accessEpoch: 1,
        authorFingerprint: "author-fingerprint",
        createdAt: "2026-07-17T00:00:00.000Z",
        documentId: "document-1",
        encryptedData: "ciphertext",
        futureUpdateField: true,
        id: UPDATE_ID,
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: { updateId: UPDATE_ID },
      },
    ],
  };
}
