import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "../util";
import {
  documentCreateSeedSyncRequest,
  isContainerCreateWithMetadataDocumentRequest,
  isDocumentCreateRequest,
  isDocumentSyncRequest,
} from "./index";
import { createDocumentContentKeyBundle } from "./requestTestFixtures";

function createContainerMutationRequest(
  overrides: Record<string, unknown> = {},
) {
  return {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
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

function seedUpdate(encryptedData = "ciphertext") {
  return {
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData,
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
}

function documentCreate() {
  return {
    event: { eventType: "document.link" },
    body: { documentId: "550e8400-e29b-41d4-a716-446655440001" },
    expectedManifestHash: "manifest-hash",
    targetContainerPathRefs: [
      { containerId: "container-1", manifestHash: "container-manifest-hash" },
    ],
    contentKeyBundle: createDocumentContentKeyBundle(),
  };
}

const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("a create seed holds exactly one update and nothing the create names", () => {
  const seed = { outgoingUpdates: [seedUpdate()] };
  const twoUpdates = {
    outgoingUpdates: [
      seedUpdate(),
      { ...seedUpdate(), id: "550e8400-e29b-41d4-a716-446655440112" },
    ],
  };
  const document = documentCreate();
  const container = {
    container: createContainerMutationRequest(),
    metadataDocument: document,
  };

  expect(isDocumentCreateRequest({ ...document, initialSync: seed })).toBe(
    true,
  );
  // The sync it stands for takes the create's bundle, hashes and path.
  const sync = documentCreateSeedSyncRequest(document, seed);
  expect(isDocumentSyncRequest(sync)).toBe(true);
  expect(sync).toMatchObject({
    authorizingContainerPathRefs: [document.targetContainerPathRefs],
    contentKeyEpoch: document.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: document.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: document.contentKeyBundle.targetHash,
    localVersionVector: '{"actor":1}',
    outgoingUpdates: seed.outgoingUpdates,
  });
  // The create stores the bundle; the sync checks the stored one.
  expect(sync).not.toHaveProperty("contentKeyBundle");
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
  // Without a target path the sync would write with no authorizing path.
  const { targetContainerPathRefs: _omitted, ...unplaced } = document;
  expect(isDocumentCreateRequest(unplaced)).toBe(true);
  expect(isDocumentCreateRequest({ ...unplaced, initialSync: seed })).toBe(
    false,
  );
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

test("the sync a create seed stands for is held to the sync request limit", () => {
  const document = documentCreate();
  // Size the update so the seed fits but its sync, which adds the create's
  // hashes and path, is one byte over the limit.
  const seedOverhead = byteLength({ outgoingUpdates: [seedUpdate("")] });
  const syncOverhead = byteLength(
    documentCreateSeedSyncRequest(document, {
      outgoingUpdates: [seedUpdate("")],
    }),
  );
  expect(syncOverhead).toBeGreaterThan(seedOverhead);
  const fits = {
    outgoingUpdates: [
      seedUpdate("a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - syncOverhead)),
    ],
  };
  const over = {
    outgoingUpdates: [
      seedUpdate(
        "a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - syncOverhead + 1),
      ),
    ],
  };
  expect(byteLength(over)).toBeLessThanOrEqual(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  expect(byteLength(documentCreateSeedSyncRequest(document, fits))).toBe(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );

  expect(isDocumentCreateRequest({ ...document, initialSync: fits })).toBe(
    true,
  );
  expect(isDocumentCreateRequest({ ...document, initialSync: over })).toBe(
    false,
  );
  expect(
    isContainerCreateWithMetadataDocumentRequest({
      container: createContainerMutationRequest(),
      initialMetadataSync: over,
      metadataDocument: document,
    }),
  ).toBe(false);
});
