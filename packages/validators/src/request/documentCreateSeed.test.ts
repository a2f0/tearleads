import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "../util";
import {
  isContainerCreateWithMetadataDocumentRequest,
  isDocumentCreateRequest,
} from "./index";
import { createDocumentContentKeyBundle } from "./requestTestFixtures";

function createContainerMutationRequest(
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
    principalPolicies: [],
    keyEpoch: { id: "container-key-epoch-id" },
    predecessorBridge: null,
    keyring: null,
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

test("a create seed holds exactly one update and no container rekeys", () => {
  const update = {
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const seed = {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [update],
    supportsPullPagination: true,
  };
  const twoUpdates = {
    ...seed,
    outgoingUpdates: [
      update,
      { ...update, id: "550e8400-e29b-41d4-a716-446655440112" },
    ],
  };
  const document = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };
  const container = {
    container: createContainerMutationRequest(),
    metadataDocument: document,
  };

  expect(isDocumentCreateRequest({ ...document, initialSync: seed })).toBe(
    true,
  );
  expect(
    isDocumentCreateRequest({ ...document, initialSync: twoUpdates }),
  ).toBe(false);
  expect(
    isDocumentCreateRequest({
      ...document,
      initialSync: {
        ...seed,
        containerRekeys: [createContainerMutationRequest()],
      },
    }),
  ).toBe(false);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...container,
      initialMetadataSync: seed,
    }),
  ).toBe(true);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...container,
      initialMetadataSync: twoUpdates,
    }),
  ).toBe(false);
});

test("a create seed is held to the document sync request limit", () => {
  // Each field stays within its own bound; only the whole seed is too large.
  const update = {
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - 64),
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const seed = {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [update],
    supportsPullPagination: true,
  };
  const document = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentCreateRequest({ ...document, initialSync: seed })).toBe(
    false,
  );
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      container: createContainerMutationRequest(),
      initialMetadataSync: seed,
      metadataDocument: document,
    }),
  ).toBe(false);
});
