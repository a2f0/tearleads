import { contentKeyEnvelopeFixture } from "../contentKeyEnvelope.testFixtures";
export function createDocumentContentKeyBundle(
  overrides: Record<string, unknown> = {},
) {
  return {
    contentKeyCommitment: "c".repeat(64),
    contentKeyEpoch: 1,
    linkSetManifestHash: "document-link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: "550e8400-e29b-41d4-a716-446655440000",
        containerManifestHash: "container-manifest-hash",
        containerKeyEpochId: "container-key-epoch-id",
        containerKeyEpoch: 1,
        ...contentKeyEnvelopeFixture("document"),
      },
    ],
    ...overrides,
  };
}

export function createContainerMutationRequest(
  overrides: Record<string, unknown> = {},
) {
  return {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
    manifest: { objectKind: "container" },
    previousManifestRef: {
      containerId: "container-1",
      manifestHash: "previous-container-manifest-hash",
    },
    previousContainerPathRefs: [
      {
        containerId: "container-1",
        manifestHash: "previous-container-manifest-hash",
      },
    ],
    principalPolicyRefs: [],
    keyEpoch: { id: "container-key-epoch-id" },
    predecessorBridge: null,
    keyring: null,
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}
