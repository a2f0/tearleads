import type {
  BlobContentKeyBundleResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

export function createDocumentWriterProjection(): DocumentWriterProjectionResponse {
  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [
      {
        policyEvidence: {
          organization: null,
          organizationPayloads: [],
          groups: [],
        },
        containerId: "container-1",
        containerKeks: [
          {
            accessManifestHash: "container-manifest-hash",
            containerId: "container-1",
            containerKeyEpoch: 1,
            containerKeyEpochId: "container-key-epoch-1",
            keyEpoch: {},
            keyEpochHash: "container-key-epoch-hash",
            keyTargetHash: "container-key-target-hash",
            parentContainerKeyEpochId: null,
            containerManifestHistory: [],
            keyring: null,
            recipientTargets: [{}],
            wraps: [{}],
          },
        ],
        organizationId: "org-1",
        path: [
          {
            event: { body: {}, event: {}, eventHash: "container-event-hash" },
            manifest: {},
            manifestHash: "container-manifest-hash",
            state: {},
          },
        ],
      },
    ],
    contentKeyBundle: {
      contentKeyEpoch: 2,
      documentId: "document-1",
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "document-key-target-hash",
      targets: [
        {
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-1",
          containerManifestHash: "container-manifest-hash",
          wrappedKey: "wrapped-document-key",
          wrappingMetadata: {},
        },
      ],
    },
    documentContainerManifestHistory: [
      {
        event: { body: {}, event: {}, eventHash: "container-history-event" },
        manifest: {},
        manifestHash: "container-history-manifest",
        state: {},
      },
    ],
    documentId: "document-1",
    documentKekTargets: {
      documentId: "document-1",
      documentKeyTargetHash: "document-key-target-hash",
      linkedContainerKeyEpochIds: ["container-key-epoch-1"],
      linkedContainerManifestHashes: ["container-manifest-hash"],
      linkSetManifestHash: "document-manifest-hash",
      targets: [{}],
    },
    documentManifest: {
      event: { body: {}, event: {}, eventHash: "document-event-hash" },
      manifest: {
        epoch: 3,
        referencedPrincipalHeads: [{}],
      },
      manifestHash: "document-manifest-hash",
      state: {
        previousManifestHash: "previous-document-manifest-hash",
      },
    },
    documentManifestContainerPaths: [
      [
        {
          event: { body: {}, event: {}, eventHash: "container-path-event" },
          manifest: {},
          manifestHash: "container-path-manifest",
          state: {},
        },
      ],
    ],
    documentManifestHistory: [
      {
        event: { body: {}, event: {}, eventHash: "document-history-event" },
        manifest: {},
        manifestHash: "document-history-manifest",
        state: {},
      },
    ],
  };
}

export function createBlobContentKeyBundle(): BlobContentKeyBundleResponse {
  return {
    blobId: "blob-1",
    contentKeyEpoch: 1,
    targetHash: "blob-key-target-hash",
    targets: [
      {
        bindingId: "binding-1",
        documentId: "document-1",
        containerId: "container-1",
        containerManifestHash: "container-manifest-hash",
        containerKeyEpochId: "container-key-epoch-1",
        containerKeyEpoch: 1,
        wrappedKey: "wrapped-blob-key",
        wrappingMetadata: {},
      },
    ],
  };
}

export function createBlobTargets() {
  return {
    activeBindingIds: ["binding-1"],
    blobId: "blob-1",
    blobAccessManifestHash: "blob-manifest",
    blobKeyTargetHash: "blob-key-target-hash",
    documentManifestHashes: ["document-manifest-hash"],
    linkedContainerKeyEpochIds: ["container-key-epoch-1"],
    linkedContainerManifestHashes: ["container-manifest-hash"],
    organizationId: "org-1",
    targets: createBlobContentKeyBundle().targets.map((target) => ({
      ...target,
    })),
  };
}
