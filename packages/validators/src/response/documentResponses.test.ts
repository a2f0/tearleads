import { expect, test } from "bun:test";
import {
  ContainerWriterProjectionResponseSchema,
  DocumentWriterProjectionResponseSchema,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "./index";

function createDocumentContentKeyBundleResponse(overrides = {}) {
  return {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
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

function createDocumentKekTargetsResponse(overrides = {}) {
  return {
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    linkSetManifestHash: "document-link-set-hash",
    linkedContainerManifestHashes: ["container-manifest-hash"],
    linkedContainerKeyEpochIds: ["container-key-epoch-id"],
    targets: [{ containerId: "550e8400-e29b-41d4-a716-446655440000" }],
    documentKeyTargetHash: "target-hash",
    ...overrides,
  };
}

function createDocumentCreateResponse(overrides = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: new Date().toISOString(),
    accessManifest: createDocumentManifestBundleResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    documentKekTargets: createDocumentKekTargetsResponse(),
    ...overrides,
  };
}

function createDocumentManifestBundleResponse(overrides = {}) {
  return {
    event: {
      event: { eventType: "document.link" },
      body: { eventType: "document.link" },
      eventHash: "document-event-hash",
    },
    manifest: { objectType: "document", objectId: "doc-1" },
    manifestHash: "manifest-hash",
    state: { objectId: "doc-1" },
    ...overrides,
  };
}

function createContainerKekResponse(overrides = {}) {
  return {
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    accessManifestHash: "container-manifest-hash",
    containerKeyEpochId: "container-key-epoch-id",
    containerKeyEpoch: 1,
    keyEpoch: { id: "container-key-epoch-id" },
    keyEpochHash: "key-epoch-hash",
    keyTargetHash: "key-target-hash",
    containerManifestHistory: [],
    parentContainerKeyEpochId: null,
    keyring: null,
    recipientTargets: [{ recipientKind: "user" }],
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    ...overrides,
  };
}

function createContainerMutationResponse(overrides = {}) {
  return {
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    createdAt: new Date().toISOString(),
    organizationId: "550e8400-e29b-41d4-a716-446655440099",
    parentId: "550e8400-e29b-41d4-a716-446655440098",
    updatedAt: new Date().toISOString(),
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
      manifest: { objectType: "container" },
      manifestHash: "container-manifest-hash",
      state: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
    },
    containerKek: createContainerKekResponse(),
    referencedPrincipalHeads: [],
    ...overrides,
  };
}

function createContainerWriterProjectionResponse(overrides = {}) {
  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    containerId: "550e8400-e29b-41d4-a716-446655440000",
    organizationId: "550e8400-e29b-41d4-a716-446655440099",
    path: [
      {
        event: {
          event: { eventType: "container.create" },
          body: { eventType: "container.create" },
          eventHash: "container-event-hash",
        },
        manifest: { objectType: "container" },
        manifestHash: "container-manifest-hash",
        state: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
      },
    ],
    containerKeks: [createContainerKekResponse()],
    ...overrides,
  };
}

test("isDocumentCreateResponse", () => {
  const validResponse = createDocumentCreateResponse();

  expect(isDocumentCreateResponse(validResponse)).toBe(true);
  expect(
    isDocumentCreateResponse({
      ...validResponse,
      accessManifest: createDocumentManifestBundleResponse({
        manifestHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentCreateResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        contentKeyEpoch: 0,
      }),
    }),
  ).toBe(false);
  expect(isDocumentCreateResponse(null)).toBe(false);
});

test("isContainerCreateWithMetadataDocumentResponse", () => {
  const validResponse = {
    container: createContainerMutationResponse(),
    metadataDocument: createDocumentCreateResponse(),
  };

  expect(isContainerMutationResponse(validResponse.container)).toBe(true);
  expect(isContainerCreateWithMetadataDocumentResponse(validResponse)).toBe(
    true,
  );
  expect(
    isContainerCreateWithMetadataDocumentResponse({
      ...validResponse,
      container: { containerId: "550e8400-e29b-41d4-a716-446655440000" },
    }),
  ).toBe(false);
  expect(
    isContainerCreateWithMetadataDocumentResponse({
      ...validResponse,
      metadataDocument: { id: "550e8400-e29b-41d4-a716-446655440001" },
    }),
  ).toBe(false);
  expect(isContainerCreateWithMetadataDocumentResponse(null)).toBe(false);
});

test("isDocumentLinkSetMutationResponse", () => {
  const validResponse = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    accessManifest: createDocumentManifestBundleResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    documentKekTargets: createDocumentKekTargetsResponse(),
  };

  expect(isDocumentLinkSetMutationResponse(validResponse)).toBe(true);
  expect(
    isDocumentLinkSetMutationResponse({
      ...validResponse,
      accessManifest: createDocumentManifestBundleResponse({
        manifestHash: "",
      }),
    }),
  ).toBe(false);
  expect(
    isDocumentLinkSetMutationResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(isDocumentLinkSetMutationResponse(null)).toBe(false);
});

test("isDocumentSyncResponse", () => {
  const validResponse = {
    acceptedOutgoingUpdateIds: ["update-1"],
    commitLsn: null,
    commitLsnMode: "tracked",
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    contentKeyBundles: [createDocumentContentKeyBundleResponse()],
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentKekTargets: createDocumentKekTargetsResponse(),
    pullPage: { hasMore: false, nextCursor: null },
    updates: [
      {
        accessEpoch: 1,
        id: "update-2",
        authorizationTargets: createDocumentContentKeyBundleResponse().targets,
        documentId: "550e8400-e29b-41d4-a716-446655440001",
        authorFingerprint: "author-fingerprint",
        encryptedData: "ciphertext",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"actor":1}',
        plaintextHash: "plaintext-hash",
        createdAt: new Date().toISOString(),
        writeHeader: { objectKind: "document" },
      },
    ],
  };

  expect(isDocumentSyncResponse(validResponse)).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      commitLsn: 123,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      contentKeyBundles: [
        createDocumentContentKeyBundleResponse({ targetHash: "" }),
      ],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...validResponse,
      updates: [{ id: "update-2" }],
    }),
  ).toBe(false);
  expect(isDocumentSyncResponse(null)).toBe(false);
});

test("isContainerWriterProjectionResponse", () => {
  const validResponse = {
    ...createContainerWriterProjectionResponse(),
    extension: true,
  };

  const result =
    ContainerWriterProjectionResponseSchema.safeParse(validResponse);
  expect(result.success && result.data).toBe(validResponse);
  expect(isContainerWriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      path: [{ manifestHash: "" }],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [createContainerKekResponse({ containerKeyEpoch: 0 })],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [createContainerKekResponse({ containerKeyEpoch: 2 })],
    }),
  ).toBe(false);
  expect(
    isContainerWriterProjectionResponse({
      ...validResponse,
      containerKeks: [
        createContainerKekResponse({
          keyring: {
            containerId: "container-id",
            containerKeyEpochId: "container-key-epoch-id",
            iv: "iv",
            sealed: "sealed",
            sealingSuite: "aes-256-gcm",
            version: 1,
          },
        }),
      ],
    }),
  ).toBe(false);
  expect(isContainerWriterProjectionResponse(null)).toBe(false);
});

test("isDocumentWriterProjectionResponse", () => {
  const validResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    documentId: "550e8400-e29b-41d4-a716-446655440001",
    documentManifest: createDocumentManifestBundleResponse(),
    documentManifestHistory: [],
    documentManifestContainerPaths: [],
    documentContainerManifestHistory: [],
    documentKekTargets: createDocumentKekTargetsResponse(),
    contentKeyBundle: createDocumentContentKeyBundleResponse(),
    authorizingContainerPaths: [createContainerWriterProjectionResponse()],
    extension: true,
  };

  const result =
    DocumentWriterProjectionResponseSchema.safeParse(validResponse);
  expect(result.success && result.data).toBe(validResponse);
  expect(isDocumentWriterProjectionResponse(validResponse)).toBe(true);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [{ containerId: "" }],
    }),
  ).toBe(false);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      authorizingContainerPaths: [],
    }),
  ).toBe(false);
  expect(
    isDocumentWriterProjectionResponse({
      ...validResponse,
      contentKeyBundle: createDocumentContentKeyBundleResponse({
        targetHash: "",
      }),
    }),
  ).toBe(false);
  expect(isDocumentWriterProjectionResponse(null)).toBe(false);
});
