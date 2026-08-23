import { expect, test } from "bun:test";
import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS,
  MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS,
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_VERSION_VECTOR_CHARACTERS,
} from "../util/documentSyncLimits";
import { isDocumentSyncRequest } from "./index";

const MANIFEST_REF = {
  containerId: "container-1",
  manifestHash: "container-manifest-hash",
};
const TARGET = {
  containerId: "container-1",
  containerKeyEpoch: 1,
  containerKeyEpochId: "container-key-epoch-id",
  containerManifestHash: "container-manifest-hash",
  wrappedKey: "wrapped-key",
  wrappingMetadata: { algorithm: "test" },
};
const UPDATE = {
  encryptedData: "ciphertext",
  id: "550e8400-e29b-41d4-a716-446655440111",
  partialEndVersionVector: '{"actor":1}',
  partialStartVersionVector: "{}",
  plaintextHash: "plaintext-hash",
  writeHeader: {},
};

function createSyncRequest() {
  return {
    authorizingContainerPathRefs: [[MANIFEST_REF]],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-link-set-hash",
      targetHash: "target-hash",
      targets: [TARGET],
    },
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    outgoingUpdates: [UPDATE],
  };
}

function updateId(index: number): string {
  return `550e8400-e29b-41d4-a716-${String(446655440000 + index).padStart(12, "0")}`;
}

test("document sync bounds outgoing update count", () => {
  const valid = createSyncRequest();
  const outgoingUpdates = Array.from(
    { length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES + 1 },
    (_, index) => ({ ...UPDATE, id: updateId(index) }),
  );

  expect(isDocumentSyncRequest({ ...valid, outgoingUpdates })).toBe(false);
});

test("complete request validation does not rescan an oversized update array", () => {
  const valid = createSyncRequest();
  let idReads = 0;
  const outgoingUpdates = Array.from(
    { length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES + 1 },
    (_, index) => {
      const update = { ...UPDATE };
      Object.defineProperty(update, "id", {
        enumerable: true,
        get: () => {
          idReads += 1;
          return updateId(index);
        },
      });
      return update;
    },
  );

  expect(isDocumentSyncRequest({ ...valid, outgoingUpdates })).toBe(false);
  expect(idReads).toBe(0);
});

test("document sync bounds encrypted update data", () => {
  const valid = createSyncRequest();
  const encryptedData = "A".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1);

  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [{ ...UPDATE, encryptedData }],
    }),
  ).toBe(false);
});

test("document sync accepts ciphertext above the old half-body estimate", () => {
  const valid = createSyncRequest();
  const encryptedData = "A".repeat(
    Math.floor(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2) + 1,
  );

  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [{ ...UPDATE, encryptedData }],
    }),
  ).toBe(true);
});

test("document sync bounds version vectors", () => {
  const valid = createSyncRequest();
  const localVersionVector = "A".repeat(
    MAX_DOCUMENT_SYNC_VERSION_VECTOR_CHARACTERS + 1,
  );

  expect(isDocumentSyncRequest({ ...valid, localVersionVector })).toBe(false);
});

test("document sync bounds authorization path count", () => {
  const valid = createSyncRequest();
  const authorizingContainerPathRefs = Array.from(
    { length: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS + 1 },
    () => [MANIFEST_REF],
  );

  expect(
    isDocumentSyncRequest({ ...valid, authorizingContainerPathRefs }),
  ).toBe(false);
});

test("document sync bounds authorization path depth", () => {
  const valid = createSyncRequest();
  const path = Array.from(
    { length: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH + 1 },
    () => MANIFEST_REF,
  );

  expect(
    isDocumentSyncRequest({
      ...valid,
      authorizingContainerPathRefs: [path],
    }),
  ).toBe(false);
});

test("document sync bounds total authorization references", () => {
  const valid = createSyncRequest();
  const pathCount =
    Math.floor(
      MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS /
        MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
    ) + 1;
  const authorizingContainerPathRefs = Array.from({ length: pathCount }, () =>
    Array.from(
      { length: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH },
      () => MANIFEST_REF,
    ),
  );

  expect(
    isDocumentSyncRequest({ ...valid, authorizingContainerPathRefs }),
  ).toBe(false);
});

test("document sync bounds content-key targets", () => {
  const valid = createSyncRequest();
  const targets = Array.from(
    { length: MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS + 1 },
    () => TARGET,
  );

  expect(
    isDocumentSyncRequest({
      ...valid,
      contentKeyBundle: { ...valid.contentKeyBundle, targets },
    }),
  ).toBe(false);
});
