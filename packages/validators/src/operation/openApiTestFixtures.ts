export const SYNC_PATH = "/documents/{documentId}/sync";
const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440111";

export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function createAccessManifestBundle() {
  return {
    event: { signature: "signed-event" },
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
    manifest: { containerId: "container-1" },
    predecessorBridge: null,
    principalPolicies: [],
    wraps: [],
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
