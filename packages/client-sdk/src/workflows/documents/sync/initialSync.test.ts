import { expect, test } from "bun:test";
import {
  type DocumentSyncRequest,
  documentCreateSeedSyncRequest,
} from "@tearleads/validators/request";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import {
  documentCreateSeed,
  documentCreateSeedFits,
  documentSyncFits,
} from "./initialSync";

const create = {
  contentKeyBundle: {
    contentKeyEpoch: 1,
    linkSetManifestHash: "document-link-set-hash",
    targetHash: "target-hash",
    targets: [],
  },
  targetContainerPathRefs: [
    { containerId: "container-1", manifestHash: "container-manifest-hash" },
  ],
};

function syncWithData(encryptedData: string): DocumentSyncRequest {
  return {
    authorizingContainerPathRefs: [create.targetContainerPathRefs],
    contentKeyBundle: create.contentKeyBundle,
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [
      {
        encryptedData,
        id: "550e8400-e29b-41d4-a716-446655440111",
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: {},
      },
    ],
    supportsPullPagination: true,
  };
}

const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("a create seed must fit the document sync request limit", () => {
  expect(documentCreateSeedFits(create, syncWithData("small"))).toBe(true);
  expect(
    documentCreateSeedFits(
      create,
      syncWithData("a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - 64)),
    ),
  ).toBe(false);
});

test("a create sends its update alone, and the fit is the sync the API rebuilds", () => {
  const sync = syncWithData("small");
  const seed = documentCreateSeed(sync);
  expect(seed).toEqual({ outgoingUpdates: sync.outgoingUpdates });
  // The API rebuilds everything but the bundle, which the create stores.
  const { contentKeyBundle: _stored, ...rebuilt } = sync;
  expect(documentCreateSeedSyncRequest(create, seed)).toEqual(rebuilt);
  // A seed whose rebuilt sync fits is sent even when the full sync carrying
  // the bundle (as an attachment bind's deferred update does) would not.
  const overhead = byteLength(documentCreateSeedSyncRequest(create, seed));
  const exact = syncWithData(
    "a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - overhead + "small".length),
  );
  expect(documentCreateSeedFits(create, exact)).toBe(true);
  expect(documentSyncFits(exact)).toBe(false);
});
