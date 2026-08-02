import { expect, test } from "bun:test";
import {
  isBlobAttachmentBindRequest,
  isBlobAttachmentDetachRequest,
  isContainerCreateWithMetadataDocumentRequest,
  isDocumentContentKeyBundleRequest,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
  isDocumentSyncRequest,
} from "./index";
import { createDocumentContentKeyBundle } from "./requestTestFixtures";

function createBlobContentKeyBundle(overrides: Record<string, unknown> = {}) {
  return {
    contentKeyEpoch: 1,
    targetHash: "target-hash",
    targets: [
      {
        bindingId: "550e8400-e29b-41d4-a716-446655440001",
        documentId: "550e8400-e29b-41d4-a716-446655440002",
        containerId: "550e8400-e29b-41d4-a716-446655440003",
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

function createContainerMutationRequest(
  overrides: Record<string, unknown> = {},
) {
  return {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
    manifest: { objectKind: "container" },
    previousManifest: {
      event: { eventId: "container-event-1" },
      manifest: { version: 1 },
      manifestHash: "previous-container-manifest-hash",
      state: { containerId: "container-1" },
    },
    previousContainerPath: [
      {
        event: { eventId: "container-event-1" },
        manifest: { version: 1 },
        manifestHash: "previous-container-manifest-hash",
        state: { containerId: "container-1" },
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

test("isBlobAttachmentBindRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.bind" },
    body: { eventType: "attachment.bind" },
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createBlobContentKeyBundle(),
    stagedBlob: {
      stageId: "550e8400-e29b-41d4-a716-446655440004",
      writeHeader: { objectKind: "blob" },
    },
  };

  expect(isBlobAttachmentBindRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      contentKeyBundle: createBlobContentKeyBundle({ targetHash: "" }),
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      stagedBlob: { stageId: "", writeHeader: {} },
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentBindRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobAttachmentBindRequest(null)).toBe(false);
});

test("isBlobAttachmentDetachRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.detach" },
    body: { eventType: "attachment.detach" },
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    containerRekeys: [createContainerMutationRequest()],
  };

  expect(isBlobAttachmentDetachRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      authorizingContainerPathRefs: [
        { containerId: "container-1", manifestHash: "container-manifest-hash" },
      ],
    }),
  ).toBe(false);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isBlobAttachmentDetachRequest(null)).toBe(false);
});

test("isDocumentContentKeyBundleRequest", () => {
  expect(
    isDocumentContentKeyBundleRequest(createDocumentContentKeyBundle()),
  ).toBe(true);
  expect(
    isDocumentContentKeyBundleRequest(
      createDocumentContentKeyBundle({ contentKeyEpoch: 0 }),
    ),
  ).toBe(false);
  expect(
    isDocumentContentKeyBundleRequest(
      createDocumentContentKeyBundle({ targets: [{ wrappedKey: "" }] }),
    ),
  ).toBe(false);
  expect(isDocumentContentKeyBundleRequest(null)).toBe(false);
});

test("isDocumentCreateRequest", () => {
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: null,
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentCreateRequest(validRequest)).toBe(true);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      expectedManifestHash: "",
    }),
  ).toBe(false);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      contentKeyBundle: createDocumentContentKeyBundle({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentCreateRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentCreateRequest(null)).toBe(false);
});

test("isContainerCreateWithMetadataDocumentRequest", () => {
  const validRequest = {
    container: createContainerMutationRequest(),
    metadataDocument: {
      event: { eventType: "document.link" },
      body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
      expectedManifestHash: "manifest-hash",
      manifest: { objectType: "document", objectId: "doc-1" },
      previousManifest: null,
      targetContainerPathRefs: [
        { containerId: "container-1", manifestHash: "container-manifest-hash" },
      ],
      contentKeyBundle: createDocumentContentKeyBundle(),
    },
  };

  expect(isContainerCreateWithMetadataDocumentRequest(validRequest)).toBe(true);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...validRequest,
      container: { event: { eventType: "container.create" } },
    }),
  ).toBe(false);
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      ...validRequest,
      metadataDocument: { event: { eventType: "document.link" } },
    }),
  ).toBe(false);
  expect(isContainerCreateWithMetadataDocumentRequest(null)).toBe(false);
});

test("isDocumentLinkSetMutationRequest", () => {
  const rotationBaseline = {
    checkpointKind: "rotate_baseline" as const,
    checkpointPayloadKind: "full_history_snapshot" as const,
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    sourceVersionVector: '{"actor":1}',
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentLinkSetMutationRequest(validRequest)).toBe(true);
  expect(
    isDocumentLinkSetMutationRequest({ ...validRequest, rotationBaseline }),
  ).toBe(true);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      rotationBaseline: { ...rotationBaseline, sourceVersionVector: undefined },
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      targetContainerPathRefs: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      authorizingContainerPathRefs: [
        { containerId: "container-1", manifestHash: "container-manifest-hash" },
      ],
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentLinkSetMutationRequest(null)).toBe(false);
});

test("isDocumentSyncRequest", () => {
  const validOutgoingUpdate = {
    checkpointKind: "rotate_baseline" as const,
    checkpointPayloadKind: "full_history_snapshot" as const,
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    sourceVersionVector: '{"actor":1}',
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const validRequest = {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [validOutgoingUpdate],
  };

  expect(isDocumentSyncRequest(validRequest)).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      authorizingContainerPathRefs: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      authorizingContainerPathRefs: undefined,
      containerRekeys: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      authorizingContainerPathRefs: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      minLsn: "not-an-lsn",
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      outgoingUpdates: [{ id: "550e8400-e29b-41d4-a716-446655440111" }],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      outgoingUpdates: [validOutgoingUpdate, validOutgoingUpdate],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      containerRekeys: [{ event: { eventType: "container.rekey" } }],
    }),
  ).toBe(false);
  expect(isDocumentSyncRequest(null)).toBe(false);
});
