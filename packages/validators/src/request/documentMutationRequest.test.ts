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

function createBlobContentKeyBundle(overrides = {}) {
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

function createBlobManifestBundle(overrides = {}) {
  return {
    event: { eventId: "event-1" },
    manifest: { version: 1 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
    ...overrides,
  };
}

function createContainerMutationRequest(overrides = {}) {
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
    keyEpoch: { id: "container-key-epoch-id" },
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

test("isBlobAttachmentBindRequest", () => {
  const validRequest = {
    event: { eventType: "attachment.bind" },
    body: { eventType: "attachment.bind" },
    documentManifest: createBlobManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
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
    documentManifest: createBlobManifestBundle(),
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
  };

  expect(isBlobAttachmentDetachRequest(validRequest)).toBe(true);
  expect(
    isBlobAttachmentDetachRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
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
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
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
      targetContainerPath: [{ containerId: "container-1" }],
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
  const validRequest = {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectType: "document", objectId: "doc-1" },
    previousManifest: {
      event: { eventId: "event-1" },
      manifest: { version: 1 },
      manifestHash: "previous-manifest-hash",
      state: { documentId: "doc-1" },
    },
    targetContainerPath: [{ containerId: "container-1" }],
    authorizingContainerPaths: [[{ containerId: "container-1" }]],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };

  expect(isDocumentLinkSetMutationRequest(validRequest)).toBe(true);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      previousManifest: null,
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      targetContainerPath: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationRequest({
      ...validRequest,
      authorizingContainerPaths: [{ containerId: "container-1" }],
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
  const documentManifest = {
    event: { eventId: "event-1" },
    manifest: { version: 1 },
    manifestHash: "document-link-set-hash",
    state: { documentId: "document-1" },
  };
  const validOutgoingUpdate = {
    checkpointKind: "fresh_baseline" as const,
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    sourceVersionVector: "{}",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const validRequest = {
    authorizingContainerPaths: [
      [
        {
          event: { eventId: "container-event-1" },
          manifest: { version: 1 },
          manifestHash: "container-manifest-hash",
          state: { containerId: "container-1" },
        },
      ],
    ],
    containerRekeys: [createContainerMutationRequest()],
    contentKeyEpoch: 1,
    documentManifest,
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
      documentManifest: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      authorizingContainerPaths: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
      containerRekeys: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...validRequest,
      documentManifest: undefined,
      authorizingContainerPaths: undefined,
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
