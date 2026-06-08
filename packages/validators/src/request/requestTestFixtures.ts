export function createDocumentContentKeyBundle(overrides = {}) {
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
