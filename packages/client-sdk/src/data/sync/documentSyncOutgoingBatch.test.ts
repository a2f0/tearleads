import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@symcrypt/validators/util";
import {
  DocumentSyncRequestLimitError,
  limitDocumentSyncRequestBytes,
  selectDocumentSyncOutgoingBatch,
} from "./documentSyncOutgoingBatch";

function updates(lengths: readonly number[]) {
  return lengths.map((length, index) => ({
    id: `update-${index}`,
    updateData: "A".repeat(length),
  }));
}

test("document sync outgoing batches cap count and preserve order", () => {
  const pending = updates(
    Array.from({ length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES + 1 }, () => 1),
  );

  expect(selectDocumentSyncOutgoingBatch(pending).map(({ id }) => id)).toEqual(
    pending.slice(0, MAX_DOCUMENT_SYNC_OUTGOING_UPDATES).map(({ id }) => id),
  );
});

test("document sync outgoing batches reserve recovery capacity", () => {
  const selected = selectDocumentSyncOutgoingBatch(updates([3, 3, 3]), {
    reservedDataCharacters: MAX_DOCUMENT_SYNC_REQUEST_BYTES - 6,
    reservedUpdateCount: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES - 2,
  });

  expect(selected.map(({ id }) => id)).toEqual(["update-0", "update-1"]);
});

test("document sync rejects recovery data that can never fit", () => {
  expect(() =>
    selectDocumentSyncOutgoingBatch(updates([1]), {
      reservedDataCharacters: MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1,
      reservedUpdateCount: 1,
    }),
  ).toThrow(DocumentSyncRequestLimitError);
});

test("document sync rejects an update that can never fit", () => {
  expect(() =>
    selectDocumentSyncOutgoingBatch(
      updates([MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1]),
    ),
  ).toThrow("Document sync update exceeds its data limit");
  expect(() =>
    selectDocumentSyncOutgoingBatch(
      updates([MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1]),
    ),
  ).toThrow(DocumentSyncRequestLimitError);
});

test("document sync selects a single update above the old half-body estimate", () => {
  const update = updates([
    Math.floor(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2) + 1,
  ])[0];
  if (!update) throw new Error("Expected one update fixture");

  expect(selectDocumentSyncOutgoingBatch([update])).toEqual([update]);
});

test("document sync outgoing batches fit the serialized request byte limit", () => {
  const vector = "V".repeat(1_024);
  const request: DocumentSyncRequest = {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "manifest-1" }],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "target-1",
    localVersionVector: vector,
    outgoingUpdates: Array.from(
      { length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES },
      (_, index) => ({
        encryptedData: "A".repeat(300_000),
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        partialEndVersionVector: vector,
        partialStartVersionVector: vector,
        plaintextHash: `plaintext-${index}`,
        sourceVersionVector: vector,
        writeHeader: { index },
      }),
    ),
    supportsPullPagination: true,
  };

  expect(
    new TextEncoder().encode(JSON.stringify(request)).byteLength,
  ).toBeGreaterThan(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  const bounded = limitDocumentSyncRequestBytes(request);

  expect(bounded.outgoingUpdates.length).toBeLessThan(
    request.outgoingUpdates.length,
  );
  expect(
    new TextEncoder().encode(JSON.stringify(bounded)).byteLength,
  ).toBeLessThanOrEqual(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  expect(bounded.outgoingUpdates).toEqual(
    request.outgoingUpdates.slice(0, bounded.outgoingUpdates.length),
  );
});

test("document sync fitting stops before serializing a large deferred tail", () => {
  const largeVector = "V".repeat(
    Math.floor(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2),
  );
  let deferredVectorReads = 0;
  const outgoingUpdates = Array.from(
    { length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES },
    (_, index) => {
      const update = {
        encryptedData: "ciphertext",
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        partialEndVersionVector: largeVector,
        partialStartVersionVector: largeVector,
        plaintextHash: `plaintext-${index}`,
        writeHeader: { index },
      };
      if (index === 0) return update;
      Object.defineProperty(update, "partialEndVersionVector", {
        enumerable: true,
        get: () => {
          deferredVectorReads += 1;
          return largeVector;
        },
      });
      return update;
    },
  );
  const request = {
    authorizingContainerPathRefs: [],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "target-1",
    localVersionVector: null,
    outgoingUpdates,
    supportsPullPagination: true,
  } as DocumentSyncRequest;

  expect(() => limitDocumentSyncRequestBytes(request)).toThrow(
    DocumentSyncRequestLimitError,
  );
  expect(deferredVectorReads).toBe(0);
});

test("document sync falls back to a full pull when the local vector cannot fit", () => {
  const request = {
    authorizingContainerPathRefs: [],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "target-1",
    localVersionVector: "V".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
    outgoingUpdates: [],
    supportsPullPagination: true,
  } as DocumentSyncRequest;

  const bounded = limitDocumentSyncRequestBytes(request);

  expect(bounded.localVersionVector).toBeNull();
  expect(bounded.outgoingUpdates).toEqual([]);
  expect(
    new TextEncoder().encode(JSON.stringify(bounded)).byteLength,
  ).toBeLessThanOrEqual(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
});

test("document sync preserves a high-actor write above the old vector ceiling", () => {
  const vector = "V".repeat(64 * 1024 + 1);
  const request = {
    authorizingContainerPathRefs: [],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "target-1",
    localVersionVector: vector,
    outgoingUpdates: [
      {
        encryptedData: "ciphertext",
        id: "00000000-0000-4000-8000-000000000001",
        partialEndVersionVector: vector,
        partialStartVersionVector: vector,
        plaintextHash: "plaintext",
        writeHeader: {},
      },
    ],
    supportsPullPagination: true,
  } as DocumentSyncRequest;

  expect(limitDocumentSyncRequestBytes(request)).toEqual(request);
});
