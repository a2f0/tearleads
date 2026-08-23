import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_VERSION_VECTOR_CHARACTERS,
} from "@symcrypt/validators/util";
import {
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

test("document sync rejects an update that can never fit", () => {
  expect(() =>
    selectDocumentSyncOutgoingBatch(
      updates([MAX_DOCUMENT_SYNC_REQUEST_BYTES + 1]),
    ),
  ).toThrow("Document sync update exceeds its data limit");
});

test("document sync selects a single update above the old half-body estimate", () => {
  const update = updates([
    Math.floor(MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2) + 1,
  ])[0];
  if (!update) throw new Error("Expected one update fixture");

  expect(selectDocumentSyncOutgoingBatch([update])).toEqual([update]);
});

test("document sync outgoing batches fit the serialized request byte limit", () => {
  const vector = "V".repeat(MAX_DOCUMENT_SYNC_VERSION_VECTOR_CHARACTERS);
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
        encryptedData: "A".repeat(100_000),
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        partialEndVersionVector: vector,
        partialStartVersionVector: vector,
        plaintextHash: `plaintext-${index}`,
        sourceVersionVector: vector,
        writeHeader: { index },
      }),
    ),
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
